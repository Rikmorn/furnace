// packages/core/src/field/reconfigure.ts — the four smart-object verbs, which
// share one locator over the ONE linear log.
//
// reconfigureGenerator (F3 spec §2.1, D-F3-2..5) re-evaluates a committed
// generator IN PLACE: its span is spliced out and replaced, and only the
// downstream ops whose bounded influence touches the change are replayed.
// Bounded influence is what buys that culling — the whole reason charter §2.2
// demands it.
//
// deleteGeneratorEntity (F4.5b) is that same splice with no replacement: the
// span AND its entity op go, the affected chunks rewind, the downstream ops
// replay. It lives here because it reuses every private helper reconfigure
// built — the locator, the layout check, the rewind and the closure.
//
// setGeneratorFrozen and bakeGeneratorEntity (§2.2) re-evaluate NOTHING. They
// swap the entity RECORD in place under one entity-update entry, touching no
// chunk and no span: protection (reversible) and severing (not).
import {
  chunkKey,
  createFieldStore,
  densityEqual,
  voxelChunk,
  worldToVoxel,
} from "./chunks.ts";
import { evaluateGenerator, generatorById } from "./generators.ts";
import { materialsEqual } from "./materials.ts";
import {
  applyFieldOp,
  assertOpValid,
  assertPatchValid,
  assertPlacementsValid,
  fieldOpChunks,
  imagesOf,
  restoreImages,
  spliceOps,
} from "./ops.ts";
import type { SnapshotRecord } from "./snapshots.ts";
import { restoreSeeds } from "./snapshots.ts";
import type {
  BrushOp,
  ChunkKey,
  DriftFinding,
  EntityOp,
  EvaluateContext,
  FieldOp,
  FieldStore,
  GeneratorDef,
  GeneratorEntity,
  MaterialTable,
  MergePolicy,
  OpInverse,
  OpLog,
  PatchOp,
  PlacementOp,
  PlacementRecord,
} from "./types.ts";

/** A span member: everything a generator commit appends BEFORE the entity op —
 *  field ops (brush / patch) plus an optional placement op. Excludes the entity
 *  op itself. The shape {@link evaluateSpan} produces and the reconfigure
 *  splices back in. */
type SpanOp = BrushOp | PatchOp | PlacementOp;

/** The merge policy a reconfigure assumes when the caller does not supply one.
 *  F2b's {@link GeneratorEntity} does not record the policy the commit used, so
 *  it cannot be recovered from provenance — see {@link reconfigureGenerator}. */
const FALLBACK_POLICY: MergePolicy = "replace";

/** What a reconfigure changes about a committed generator. Every field is
 *  optional and falls back to the entity's recorded provenance; `params` is the
 *  COMPLETE replacement set, never a patch (see {@link reconfigureGenerator}). */
export type ReconfigureChanges = {
  params?: Record<string, unknown>;
  seed?: number;
  region?: { min: [number, number, number]; max: [number, number, number] };
  policy?: MergePolicy;
};

/** The provenance a reconfigure records: `changes` merged over the entity's
 *  own, deep-cloned so the log owns its copy. */
type Provenance = {
  params: Record<string, unknown>;
  seed: number;
  region: { min: [number, number, number]; max: [number, number, number] };
  policy: MergePolicy;
};

/** One downstream op paired with the chunks it writes, computed ONCE: the
 *  transitive closure, the replay and the drift pass all read the same set
 *  rather than re-deriving it three times. */
type Downstream = {
  op: FieldOp;
  chunks: Set<ChunkKey>;
  readsOutside: boolean;
};

/** True when an op's replay output can depend on field state OUTSIDE the cells
 *  it writes: a flood-selection mask re-materializes against replayed state, so
 *  it reads wherever the flood runs (unbounded by construction — that is what a
 *  flood is).
 *
 *  Including such ops unconditionally guarantees they are REPLAYED and, since
 *  their own writes are in the affected set, REPORTED when their output moves.
 *  It does NOT make their replay match a from-scratch build: the read set still
 *  reaches chunks outside `affected`, which are never rewound and therefore hold
 *  END-OF-LOG state. See the known gap on {@link reconfigureGenerator}.
 *
 *  Only `op.mask` is inspected, which is exhaustive TODAY because a span's ops
 *  come from `evaluate` and both registered generators emit at most a
 *  `solid-only` mask. A generator that emitted flood-masked ops would make
 *  {@link directlyAffected} under-approximate the OLD span's reads the same way. */
function readsOutsideItsWrites(op: FieldOp): boolean {
  if (op.kind !== "brush") return false;
  const mask = op.mask;
  if (mask === undefined || mask.kind !== "selection") return false;
  return mask.selection.kind !== "region";
}

function intersects(a: Set<ChunkKey>, b: Set<ChunkKey>): boolean {
  for (const key of a) if (b.has(key)) return true;
  return false;
}

/** Finds the entity op carrying `entityId` and where it sits. Deliberately says
 *  NOTHING about the op's span: {@link setGeneratorFrozen} and
 *  {@link bakeGeneratorEntity} write only the record and must be able to reach
 *  a corrupt entity — being unable to protect, or retire, a broken one is the
 *  wrong failure mode. The two SPLICING verbs, {@link reconfigureGenerator} and
 *  {@link deleteGeneratorEntity}, pair this with {@link verifySpanLayout}, in
 *  that order and with the record's own guards between them (see their bodies).
 *
 *  `verb` prefixes the throw with the PUBLIC verb the caller is implementing,
 *  matching every other throw those verbs emit. These strings reach an editor's
 *  error surface without a stack frame attached, so a shared helper naming
 *  itself — or naming nothing — would leave the reader without the one fact
 *  that identifies the call.
 *
 *  @throws {@link Error} if no entity op carries `entityId`. */
function findEntityOp(
  log: OpLog,
  entityId: number,
  verb: string,
): { entityIdx: number; entityOp: EntityOp } {
  const entityIdx = log.ops.findIndex(
    (o) => o.kind === "entity" && o.entity.entityId === entityId,
  );
  const entityOp = entityIdx < 0 ? undefined : log.ops[entityIdx];
  if (entityOp === undefined || entityOp.kind !== "entity")
    throw new Error(`${verb}: unknown entity ${entityId}`);
  return { entityIdx, entityOp };
}

/** Verifies the layout {@link commitGenerator} establishes and both splicing
 *  verbs depend on: the span's `opSpan[1] - opSpan[0] + 1` ops sit immediately
 *  before the entity op with sequential ids, none of them an entity op of its
 *  own. {@link reconfigureGenerator} then PRESERVES that layout;
 *  {@link deleteGeneratorEntity} removes the whole of it. Setup-loud rather
 *  than trusting a stored index — a span left stale by an earlier edit is
 *  exactly how a bad splice arises, and passing this is what makes
 *  {@link spliceOps}' own range guard unreachable from either caller.
 *
 *  `verb` names the PUBLIC caller in the throw, for the reason spelled out on
 *  {@link findEntityOp}: these strings reach an editor's error surface with no
 *  stack frame attached.
 *
 *  @throws {@link Error} if the log does not hold the span where the record
 *    says. */
function verifySpanLayout(
  log: OpLog,
  entityIdx: number,
  entityOp: EntityOp,
  verb: string,
): { spanStartIdx: number; spanOps: FieldOp[] } {
  const [firstId, lastId] = entityOp.entity.opSpan;
  const spanLength = lastId - firstId + 1;
  const spanStartIdx = entityIdx - spanLength;
  const spanOps =
    spanStartIdx < 0 ? [] : log.ops.slice(spanStartIdx, entityIdx);
  const laidOutAsCommitted =
    spanLength > 0 &&
    spanOps.length === spanLength &&
    spanOps.every((op, i) => op.kind !== "entity" && op.id === firstId + i);
  if (!laidOutAsCommitted)
    throw new Error(
      `${verb}: entity ${entityOp.entity.entityId}'s span [${firstId}, ${lastId}] is not the ${spanLength} op(s) immediately before its entity op — the log layout is corrupt`,
    );
  return { spanStartIdx, spanOps };
}

/** `changes` merged over the recorded provenance, cloned before anything is
 *  written (a non-cloneable value must throw HERE, not after a mutation).
 *
 *  @throws {@link DOMException} `DataCloneError` if `params`/`region` hold
 *    structured-clone-incompatible values. */
function mergeProvenance(
  entity: GeneratorEntity,
  changes: ReconfigureChanges,
): Provenance {
  return {
    params: structuredClone(changes.params ?? entity.params),
    seed: changes.seed ?? entity.seed,
    region: structuredClone(changes.region ?? entity.region),
    policy: changes.policy ?? FALLBACK_POLICY,
  };
}

/** Evaluates the generator with the merged provenance and validates the WHOLE
 *  result — the {@link commitGenerator} validate-all-then-apply posture, and the
 *  last leg of a reconfigure that can throw. Returns the whole span in commit
 *  order: the field ops (brush / patch), then — if any — ONE placement op
 *  wrapping the emitted records (the {@link commitGenerator} layout), all with
 *  placeholder id 0 for {@link stampSpan} to renumber.
 *
 *  `ctx` is the re-cook context for a `contextFree: false` generator ({@link
 *  recookContext}) and `undefined` otherwise; {@link evaluateGenerator}'s guard
 *  enforces the pairing.
 *
 *  @throws {@link Error} if the generator rejects the params, returns a result
 *    contradicting its `emits` declaration ({@link evaluateGenerator}'s guard),
 *    evaluates to an empty result, or emits an op / placement
 *    {@link assertOpValid}/{@link assertPatchValid}/{@link assertPlacementsValid}
 *    rejects — that last class re-thrown as `reconfigureGenerator: generator
 *    "<id>" — <the predicate's own message>` with the original on `cause`. What
 *    every committing path shares is that shape: a locator, an em dash, the
 *    predicate's message intact, the original on `cause`. What they do NOT share
 *    is the locator itself — this path and {@link commitGenerator} name the DEF
 *    because nobody wrote these spans, while `logApplyGroup` names a list INDEX,
 *    which is reserved for ops the CALLER handed over and can address. */
function evaluateSpan(
  def: GeneratorDef,
  provenance: Provenance,
  table: MaterialTable,
  ctx: EvaluateContext | undefined,
): SpanOp[] {
  const { ops, placements } = evaluateGenerator(
    def,
    provenance.params,
    provenance.seed,
    provenance.region,
    table,
    provenance.policy,
    ctx,
  );
  if (ops.length + placements.length === 0)
    throw new Error(
      `reconfigureGenerator: generator "${def.id}" evaluated to an empty result`,
    );
  // Validated under the DEF's address, the {@link commitGenerator} form: nobody
  // wrote this span, so a position inside it points at nothing a reader can
  // open, and the generator is the thing to fix. Same locator the empty-result
  // rejection above already uses — the two now agree. The empty check stays
  // OUTSIDE the try, or it would arrive double-prefixed with its own name.
  const span: SpanOp[] = [...ops];
  try {
    for (const op of ops) {
      if (op.kind === "patch") assertPatchValid(op, table);
      else assertOpValid(op, table);
    }
    if (placements.length > 0) {
      assertPlacementsValid(placements);
      span.push({ id: 0, kind: "placement", records: placements });
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`reconfigureGenerator: generator "${def.id}" — ${detail}`, {
      cause: e,
    });
  }
  return span;
}

/** The chunk keys a region AABB spans, in the store's chunk grid — a
 *  `contextFree: false` generator's declared influence bound (evaluate reads
 *  only inside its region by contract). The re-cook restores exactly these
 *  chunks into its scratch so the generator re-reads the same surfaces it saw at
 *  commit time. */
function regionChunkKeys(
  region: Provenance["region"],
  cellSize: number,
): Set<ChunkKey> {
  const keys = new Set<ChunkKey>();
  const cc = (w: number): number => voxelChunk(worldToVoxel(w, cellSize));
  for (let cz = cc(region.min[2]); cz <= cc(region.max[2]); cz++)
    for (let cy = cc(region.min[1]); cy <= cc(region.max[1]); cy++)
      for (let cx = cc(region.min[0]); cx <= cc(region.max[0]); cx++)
        keys.add(chunkKey(cx, cy, cz));
  return keys;
}

/** Builds the re-cook context for a `contextFree: false` generator: a SCRATCH
 *  store holding the generator's region chunks as of BEFORE its span (log
 *  position `spanStartIdx`), so its evaluate re-reads the pre-span surfaces — the
 *  reconfigured cave, say — rather than the live end-of-log state that includes
 *  its own span and everything after.
 *
 *  Critically it touches the LIVE store not at all: {@link preStateImages} builds
 *  the pre-span images without mutating it (the scratch-half of
 *  {@link restorePreState}), and they are restored into a FRESH store. That is
 *  what preserves the no-mutation-on-throw invariant — the re-cook's evaluate can
 *  reject, and the live store, log and stacks are still untouched when it does. */
function recookContext(
  store: FieldStore,
  log: OpLog,
  spanStartIdx: number,
  region: Provenance["region"],
  table: MaterialTable,
  snapshots: readonly SnapshotRecord[],
): EvaluateContext {
  const regionChunks = regionChunkKeys(region, store.cellSize);
  const images = preStateImages(
    store,
    log,
    spanStartIdx,
    regionChunks,
    table,
    snapshots,
  );
  const scratch = createFieldStore(store.cellSize);
  restoreImages(scratch, images);
  return { store: scratch };
}

/** The chunks the edit disturbs directly: the old span's bounded influence ∪
 *  the new evaluation's — the latter EMPTY for a delete, which replaces the
 *  span with nothing. */
function directlyAffected(
  oldSpan: readonly FieldOp[],
  newSpan: readonly FieldOp[],
  cellSize: number,
): Set<ChunkKey> {
  const affected = new Set<ChunkKey>();
  for (const op of [...oldSpan, ...newSpan])
    for (const key of fieldOpChunks(op, cellSize)) affected.add(key);
  return affected;
}

/** The ops after the entity op, each with its written chunks. A zero-chunk op
 *  (an entity op today) writes nothing, so it is never replayed and never
 *  reported — replaying it could only manufacture a spurious "orphaned". */
function downstreamOf(
  log: OpLog,
  entityIdx: number,
  cellSize: number,
): Downstream[] {
  return log.ops.slice(entityIdx + 1).flatMap((op) => {
    const chunks = fieldOpChunks(op, cellSize);
    if (chunks.size === 0) return [];
    return [{ op, chunks, readsOutside: readsOutsideItsWrites(op) }];
  });
}

/** Closes `seed` transitively over the downstream ops that intersect it
 *  (D-F3-3), returning the grown set plus the absorbed ops in LOG order — the
 *  ops replay must re-run. An absorbed op's chunks are all added, so
 *  `chunks ⊆ affected` holds for every returned candidate.
 *
 *  The fixpoint rescans the not-yet-absorbed candidates each pass: O(n²)
 *  intersection tests in the worst case (a chain of overlapping ops running
 *  BACKWARDS through the log absorbs one per pass). That is a deliberate
 *  choice, not an oversight — the pending list strictly shrinks every pass, the
 *  realistic shape settles in one or two, and at F3 log scale the cost is
 *  dominated by the prefix replay in {@link restorePreState} by orders of
 *  magnitude. A worklist keyed by chunk earns its complexity only once the
 *  prefix replay stops being the bottleneck. */
function closeOverDownstream(
  seed: Set<ChunkKey>,
  candidates: Downstream[],
): { affected: Set<ChunkKey>; replay: Downstream[] } {
  const affected = new Set(seed);
  const absorbed = new Set<Downstream>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const candidate of candidates) {
      if (absorbed.has(candidate)) continue;
      if (!candidate.readsOutside && !intersects(candidate.chunks, affected))
        continue;
      absorbed.add(candidate);
      for (const key of candidate.chunks)
        if (!affected.has(key)) {
          affected.add(key);
          grew = true;
        }
    }
  }
  return {
    affected,
    replay: candidates.filter((candidate) => absorbed.has(candidate)),
  };
}

/** Builds the affected chunks' state as of BEFORE log position `pos` as an
 *  {@link OpInverse} of images, reading ONLY `log`/`snapshots` and `store`'s cell
 *  size — never `store`'s chunk bytes, and never mutating it. The
 *  scratch-building HALF of the rewind: {@link restorePreState} commits these
 *  images to the LIVE store; {@link recookContext} materializes them into a fresh
 *  scratch instead, which is what lets a `contextFree: false` re-cook run and
 *  validate before the live store is touched (the no-mutation-on-throw
 *  invariant).
 *
 *  Two routes to the same bytes. The CULLED route rebuilds each affected chunk
 *  ALONE, in a scratch store holding nothing else, replaying only the ops that
 *  touch it from the starting point `restoreSeeds` found — a snapshot record, or
 *  the empty pre-op-0 state every chunk has for free. The FULL-PREFIX route
 *  replays the whole prefix into one scratch and copies the affected chunks off
 *  it; it is exact for any log, and it is what F3a shipped.
 *
 *  The choice is all-or-nothing, and measured rather than assumed (the extended
 *  P-F3-2 bench). The culled route runs only when EVERY affected chunk is
 *  cell-local back to its seed AND the ops it would replay are fewer than the
 *  prefix it replaces. One disqualified chunk means the prefix replay happens
 *  anyway, at which point the per-chunk work is pure overhead: reconfiguring a
 *  stamp at the top of a 2850-op log, mixing the routes measured 348 ms against
 *  the prefix's own 347 ms. All-culled measured 83 ms with no records at all,
 *  and 8 ms with records on a 2-op tail budget.
 *
 *  The `culledOps < pos` half is a real budget, not a formality: the culled
 *  route replays per CHUNK, so ops shared by many affected chunks are paid for
 *  many times, and a wide affected set can cost more than the single prefix
 *  replay it replaces. */
function preStateImages(
  store: FieldStore,
  log: OpLog,
  pos: number,
  affected: Set<ChunkKey>,
  table: MaterialTable,
  snapshots: readonly SnapshotRecord[],
): OpInverse {
  const seeds = restoreSeeds(log, pos, affected, snapshots, store.cellSize);
  const everyChunkCulled = seeds.size === affected.size;
  const culledOps = [...seeds.values()].reduce((n, s) => n + s.ops.length, 0);
  const takeCulledRoute = everyChunkCulled && culledOps < pos;
  if (!takeCulledRoute) {
    const scratch = createFieldStore(store.cellSize);
    for (const op of log.ops.slice(0, pos)) applyFieldOp(scratch, op, table);
    return imagesOf(scratch, affected);
  }
  const images: OpInverse = new Map();
  for (const [key, seed] of seeds) {
    const scratch = createFieldStore(store.cellSize);
    restoreImages(scratch, new Map([[key, seed.image]]));
    for (const op of seed.ops) applyFieldOp(scratch, op, table);
    for (const [rebuilt, image] of imagesOf(scratch, [key]))
      images.set(rebuilt, image);
  }
  return images;
}

/** Rebuilds the affected chunks' state as of BEFORE log position `pos` and
 *  copies ONLY those chunks back — every other chunk in the store is left
 *  exactly as it is. The route choice + cost model live on
 *  {@link preStateImages}; this is that image set committed to the LIVE store. */
function restorePreState(
  store: FieldStore,
  log: OpLog,
  pos: number,
  affected: Set<ChunkKey>,
  table: MaterialTable,
  snapshots: readonly SnapshotRecord[],
): void {
  restoreImages(
    store,
    preStateImages(store, log, pos, affected, table, snapshots),
  );
}

/** True when any of `chunks` reads differently now than it did in `before` (the
 *  old-final images). The missing-key branch is a DEFENSIVE guard with no
 *  reachable caller today: every replay candidate's chunks are in `affected` and
 *  `before` images exactly `affected`, so no lookup misses. Do not hunt for the
 *  case — it exists so a future caller passing a wider chunk set gets "unchanged"
 *  rather than a crash. */
function outcomeChanged(
  store: FieldStore,
  before: OpInverse,
  chunks: Set<ChunkKey>,
): boolean {
  for (const key of chunks) {
    const image = before.get(key);
    if (image === undefined) continue;
    if (!densityEqual(image.density, store.chunks.get(key))) return true;
    if (!materialsEqual(image.materials, store.materials.get(key))) return true;
  }
  return false;
}

/** How one replayed op is reported, or null when it is not. Orphaned WINS: an
 *  op that wrote nothing has no outcome left to have drifted. */
function findingKind(
  store: FieldStore,
  before: OpInverse,
  candidate: Downstream,
  orphaned: Set<number>,
): DriftFinding["kind"] | null {
  if (orphaned.has(candidate.op.id)) return "orphaned";
  return outcomeChanged(store, before, candidate.chunks) ? "drifted" : null;
}

/** Applies the new span, replays the absorbed downstream ops in LOG order, and
 *  reports what changed. The drift pass runs only once every replay has
 *  settled, so each op is diffed against the final state rather than a
 *  half-replayed one. */
function applyAndReport(
  store: FieldStore,
  newSpan: readonly FieldOp[],
  replay: readonly Downstream[],
  before: OpInverse,
  table: MaterialTable,
): DriftFinding[] {
  for (const op of newSpan) applyFieldOp(store, op, table);
  const orphaned = new Set<number>();
  for (const candidate of replay) {
    const result = applyFieldOp(store, candidate.op, table);
    if (result !== null && result.dirty.size === 0)
      orphaned.add(candidate.op.id);
  }
  return replay.flatMap((candidate) => {
    const kind = findingKind(store, before, candidate, orphaned);
    if (kind === null) return [];
    return [{ opId: candidate.op.id, kind, chunks: [...candidate.chunks] }];
  });
}

/** Stamps a span with consecutive ids from `firstId`, and with `origin` when
 *  the reconfiguring caller gave one — the re-cooked span is that caller's
 *  work, whoever authored the entity. Leaves the ops otherwise untouched, and
 *  covers the placement op a `contextFree: false` generator appends, which
 *  rides the span like any other member. Conditional, never `origin:
 *  undefined`: an explicit undefined is an OWN property (`Object.hasOwn`),
 *  which would change what serializeOps writes. */
const stampSpan = (
  ops: readonly SpanOp[],
  firstId: number,
  origin?: string,
): SpanOp[] =>
  ops.map((op, i) =>
    origin === undefined
      ? { ...op, id: firstId + i }
      : { ...op, id: firstId + i, origin },
  );

/** The world-AABB chunk keys of one placement record: `position ± scale/2`.
 *  APPROXIMATION — it assumes a UNIT primitive mesh (±0.5 in local space, so
 *  world half-extent = `scale/2`) and ignores the `quat`, so a record whose mesh
 *  is larger than unit, or whose rotation tilts it past that box, can reach cells
 *  this misses. That is acceptable for the drift report, whose job is a
 *  jump-to-here list, not an exact cover. */
function recordChunks(r: PlacementRecord, cellSize: number): Set<ChunkKey> {
  const keys = new Set<ChunkKey>();
  const cc = (w: number): number => voxelChunk(worldToVoxel(w, cellSize));
  const [px, py, pz] = r.position;
  const [sx, sy, sz] = r.scale;
  for (
    let cz = cc(pz - Math.abs(sz) / 2);
    cz <= cc(pz + Math.abs(sz) / 2);
    cz++
  )
    for (
      let cy = cc(py - Math.abs(sy) / 2);
      cy <= cc(py + Math.abs(sy) / 2);
      cy++
    )
      for (
        let cx = cc(px - Math.abs(sx) / 2);
        cx <= cc(px + Math.abs(sx) / 2);
        cx++
      )
        keys.add(chunkKey(cx, cy, cz));
  return keys;
}

/** Drift finding for ONE downstream placement op (the props-drift contract,
 *  D-F3-4): a placement writes no field cells, so it never replays — instead
 *  each record's world AABB ({@link recordChunks}) is intersected with the
 *  reconfigure's `affected` set, and if any intersecting chunk's bytes MOVED
 *  (`before` vs the settled store) the op is flagged `drifted`, `chunks` = the
 *  moved intersecting keys. Null when no record's footprint moved — a prop over
 *  untouched field is not disturbed. Never `orphaned`: a placement has no field
 *  outcome to vanish. */
function placementFinding(
  store: FieldStore,
  before: OpInverse,
  op: PlacementOp,
  affected: Set<ChunkKey>,
  cellSize: number,
): DriftFinding | null {
  const moved = new Set<ChunkKey>();
  for (const record of op.records)
    for (const key of recordChunks(record, cellSize))
      if (affected.has(key) && outcomeChanged(store, before, new Set([key])))
        moved.add(key);
  if (moved.size === 0) return null;
  return { opId: op.id, kind: "drifted", chunks: [...moved] };
}

/** Drift findings for the downstream placement ops, in log order — appended
 *  AFTER the field-op findings ({@link applyAndReport}). Runs once the store has
 *  settled, so each record's footprint is diffed against the final bytes. */
function placementDrift(
  store: FieldStore,
  before: OpInverse,
  placements: readonly PlacementOp[],
  affected: Set<ChunkKey>,
  cellSize: number,
): DriftFinding[] {
  return placements.flatMap((op) => {
    const finding = placementFinding(store, before, op, affected, cellSize);
    return finding === null ? [] : [finding];
  });
}

/**
 * Re-evaluates a committed generator entity IN PLACE and replays the downstream
 * ops its change can reach (F3 spec §2.1, D-F3-2..5).
 *
 * The entity's span is spliced out of `log.ops` and replaced by a freshly
 * evaluated one taking new ids from `log.nextId`; the entity op keeps its own
 * id, so `entityId` — and every reference held to it — survives unchanged. The
 * new span stays contiguous and immediately before its entity op, the layout
 * {@link commitGenerator} establishes and this function both requires and
 * preserves.
 *
 * `changes.params` REPLACES the recorded param set wholesale — it is the
 * COMPLETE set, not a patch. There is one spelling of "the params", so there
 * are no merge semantics to reason about and no question of how to unset a
 * field; it matches the caller too (an editor session seeds a form from the
 * recorded provenance and posts the whole object back). Omit `params` to keep
 * the recorded set verbatim. `seed` and `region` fall back the same way.
 *
 * **Merge policy is not recoverable.** {@link GeneratorEntity} does not record
 * the {@link MergePolicy} the original commit used, so an omitted
 * `changes.policy` falls back to `"replace"` — a stamp committed with
 * `"keep-existing-air"` reconfigures as `"replace"` unless the caller passes the
 * policy back in. Recording it is a provenance-format change, deliberately not
 * made here.
 *
 * Replay is CULLED to the affected set (D-F3-3): the old span's chunks ∪ the new
 * evaluation's, closed transitively over the downstream ops that intersect it.
 * Ops outside it are never re-applied. An op whose mask embeds a FLOOD selection
 * reads state outside the cells it writes, so it joins the set unconditionally.
 *
 * **A `contextFree: false` generator (scatter) re-cooks against restored pre-span
 * state.** Its evaluate reads the field, so reconfiguring it re-evaluates against
 * a SCRATCH restore of its region as of BEFORE its span — the surfaces it saw at
 * commit time, including any UPSTREAM generator (a cave) reconfigured since —
 * never the live end-of-log store. The scratch is built without touching the live
 * store, so a rejecting re-cook is as atomic as any other validation failure. The
 * affected set still seeds from what the span WRITES (empty for a pure scatter),
 * never what it reads: reads create no field drift.
 *
 * **Downstream placement ops DRIFT when the field beneath them moves** (D-F3-4).
 * A placement writes no cells, so it never replays and never orphans — instead
 * each record's world AABB (`position ± scale/2`, a unit-primitive approximation)
 * is intersected with the affected set, and if any intersecting chunk's bytes
 * changed the op is flagged `drifted` (its `chunks` = the moved keys). Placement
 * findings follow the field-op findings in the returned `drift`.
 *
 * `snapshots` is OPTIONAL and purely a cost lever — the output is the same with
 * or without them, and both are verified against each other in
 * `field-maintenance.test.ts`. A {@link SnapshotRecord} at or before the span
 * start lets the rewind start there instead of at the beginning of the log; a
 * chunk without one starts from empty, which is still cheaper than the shared
 * full-prefix replay whenever the rewind can be culled at all (see
 * `restorePreState` for when it cannot). Records must belong to THIS log — a
 * record whose position sits above an edit made since it was captured is stale,
 * and only its owner can know that ({@link SnapshotRecord}). Passing a stale one
 * is SILENT: the rewind produces bytes a from-scratch replay would not, with no
 * throw and no warning, and `drift` cannot surface it either — its baseline is
 * the pre-reconfigure bytes, not a rebuild.
 *
 * **Known gap — a flood-masked downstream op can replay against the wrong
 * state.** Culling rewinds only the affected chunks; every other chunk keeps its
 * END-OF-LOG bytes. That is exact for an op whose reads are inside its own
 * bounded influence — every brush effect, every class-kind mask, every region
 * selection, and patch ops, which read nothing at all (all verified) — but a
 * FLOOD selection's read set is unbounded by construction, so
 * a replayed flood can traverse chunks that were never rewound and see edits made
 * by ops that originally ran AFTER it. Reproduced: two disconnected dirt rails; a
 * flood-material-masked paint seeded on the left rail; a bridge fill appended
 * AFTER the paint, in chunks disjoint from both the paint's and the span's.
 * Reconfiguring the generator replays the paint, whose flood now crosses the
 * bridge and paints the right rail — right-rail material reads `0` where a
 * from-scratch replay of the same log gives `1`. The op IS reported in that case
 * (it lands in `drift` as `drifted`) — but note the exact condition: the drift
 * baseline is the OLD-FINAL bytes, not a from-scratch build, so the guarantee is
 * "reported iff the new output differs from the pre-reconfigure bytes", which is
 * loud in practice rather than loud by construction. And a report cannot say the
 * new output is itself wrong: from-scratch equivalence simply does not hold for
 * such a log. The fix — forcing the affected set to the whole store when a
 * downstream op reads unboundedly — is a design decision, not made here.
 *
 * A replayed op whose outcome moved is REPORTED, never silently dropped
 * (D-F3-4): `orphaned` = the op replayed and wrote nothing at all; `drifted` =
 * the chunks it touches read differently than before the reconfigure. For a
 * bounded-read op that is loud by construction. For a flood-masked one it is
 * loud only in PRACTICE — per the gap above, the baseline is the old-final
 * bytes rather than a from-scratch build, so an op that replays against the
 * wrong state and happens to land on the same bytes reports nothing. Drift is
 * CHUNK-granular and does not attribute cause — an op is flagged when its
 * chunks changed, including when the generator itself changed them rather than
 * the op behaving differently. That is the v0 contract: a jump-to-here list of
 * places worth a human look, not a proof that an op misbehaved.
 *
 * `dirty` is the whole affected set, not just the chunks whose bytes moved:
 * a chunk restored to its pre-span state and never rewritten still needs a
 * remesh. The returned `entity` is a COPY — mutating it cannot rewrite the log.
 *
 * Pushes exactly ONE `splice` undo entry (the old span + old record + the
 * affected chunks' before/after images) and clears the redo stack. Undo and redo
 * restore those images byte-for-byte and never re-execute the span. `log.nextId`
 * is NOT rolled back by undo — ids are only ever handed out once, so the parked
 * span on the redo stack can never collide with a later op.
 *
 * `origin` is who is reconfiguring — the ACTOR OF THIS CALL, never the entity's
 * original author ({@link BrushOp.origin}). It reaches exactly what this call
 * AUTHORS: the re-cooked span ops it inserts (durable) and the `splice` entry
 * (volatile — {@link LogEntry}.origin). It does NOT reach the entity op, which
 * is spliced forward with its record updated but its authorship intact — a
 * human reconfiguring an agent's stamp owns the new span, not the agent's
 * decision to place it — and it does not reach `removed`, whose ops leave the
 * log carrying whoever wrote them. Omit it for the human's own work: absent =
 * human, and neither the ops nor the entry gains the property.
 *
 * @throws {@link Error} if no entity op carries `entityId`, the entity is
 *   `frozen` or `baked`, its recorded generator id is unknown, the log does not
 *   hold its span where the record says, the generator rejects the merged
 *   params (including a `contextFree: false` re-cook that rejects — the live
 *   store is still untouched), the evaluation is empty, or an evaluated op or
 *   placement fails
 *   {@link assertOpValid}/{@link assertPatchValid}/{@link assertPlacementsValid}
 *   — that last class arriving as `reconfigureGenerator: generator "<id>" — <the
 *   predicate's own message>` with the original on `cause`, addressed by the DEF
 *   because nobody wrote the span; a
 *   `DataCloneError` if `changes.params`/`region` — or
 *   any field the RECORD itself carries, which the spread copies forward — hold
 *   structured-clone-incompatible values. Every one of those is a VALIDATION
 *   failure and fires before the first write, leaving the store, `log.ops`,
 *   `log.nextId` and both stacks untouched. That is the guarantee: this function
 *   does not unwind, so it is atomic exactly to the extent that everything past
 *   validation cannot fail (see the note on step 2 in the body).
 */
export function reconfigureGenerator(
  store: FieldStore,
  log: OpLog,
  entityId: number,
  changes: ReconfigureChanges,
  table: MaterialTable,
  snapshots: readonly SnapshotRecord[] = [],
  origin?: string,
): { dirty: Set<ChunkKey>; entity: GeneratorEntity; drift: DriftFinding[] } {
  // 1 — locate + guards. The RECORD's own guards come before the layout check,
  // deliberately: a baked entity's span is compaction-eligible, so a compacted
  // log holds baked records whose `opSpan` names ids that no longer exist. Those
  // must report what they ARE — baked — not "the log layout is corrupt", which
  // is a different diagnosis pointing at a different (imaginary) bug.
  const { entityIdx, entityOp } = findEntityOp(
    log,
    entityId,
    "reconfigureGenerator",
  );
  const recorded = entityOp.entity;
  if (recorded.frozen === true)
    throw new Error(
      `reconfigureGenerator: entity ${entityId} is frozen — unfreeze it to edit`,
    );
  if (recorded.baked === true)
    throw new Error(
      `reconfigureGenerator: entity ${entityId} is baked — its recipe was severed`,
    );
  const def = generatorById(recorded.generator);
  const { spanStartIdx, spanOps } = verifySpanLayout(
    log,
    entityIdx,
    entityOp,
    "reconfigureGenerator",
  );

  // 2 — evaluate + validate the replacement. Every rejection the contract names
  // has fired by the end of this step but ONE: the record clone at the top of
  // step 5, which is still above the first write. Past that clone nothing is
  // unwound — not because nothing below CAN throw, but because each remaining
  // failure is unreachable:
  //   - spliceOps' range guard: discharged by verifySpanLayout in step 1.
  //   - setMaterial's palette ceiling: discharged by any table of at most
  //     MAX_PALETTE classes.
  //   - applyPatchOp's parsePatchKey, on a non-canonical chunk key carried by a
  //     downstream PATCH op — reached from BOTH restorePreState and
  //     applyAndReport. Discharged today because BOTH paths into log.ops
  //     validate the key: logApplyPatch via assertPatchValid, and the oplog
  //     decoder (parseOps, whose ops the editor pushes straight in) via
  //     assertPatchStructure. A producer that SPLICES synthesized patch ops in
  //     without either — the compaction pass — makes this reachable again, so
  //     it inherits the obligation to validate what it splices.
  // Adding a step below that can genuinely fail breaks this, and the entry
  // pushed at step 7 is the only unwind there is.
  //
  // A `contextFree: false` generator (scatter) re-cooks against a SCRATCH restore
  // of its region's PRE-SPAN state, not the live store — so it re-reads the same
  // surfaces it saw at commit time (a reconfigured cave upstream, say), and the
  // live store stays byte-untouched until validation passes. recookContext reads
  // the live store not at all (see preStateImages), so an evaluate that rejects
  // leaves everything below the first write intact, exactly as this step
  // promises.
  const provenance = mergeProvenance(recorded, changes);
  const cellSize = store.cellSize;
  const ctx =
    def.contextFree === false
      ? recookContext(
          store,
          log,
          spanStartIdx,
          provenance.region,
          table,
          snapshots,
        )
      : undefined;
  const evaluated = evaluateSpan(def, provenance, table, ctx);

  // 3 — the affected set, closed over the downstream ops that intersect it. It
  // seeds from what the span WRITES (empty for a pure scatter), never what a
  // context-reading generator READS: reads create no field drift, so the region
  // it re-cooks against is the scratch's concern (above), not the replay set's.
  // Downstream placement ops are collected separately — they write no cells, so
  // they never enter `replay`, but their props can DRIFT when the field beneath
  // them moves (the placement-drift pass in step 6).
  const { affected, replay } = closeOverDownstream(
    directlyAffected(spanOps, evaluated, cellSize),
    downstreamOf(log, entityIdx, cellSize),
  );
  const downstreamPlacements = log.ops
    .slice(entityIdx + 1)
    .filter((o): o is PlacementOp => o.kind === "placement");

  // 4 — old-final images: undo's `before` AND the drift baseline
  const before = imagesOf(store, affected);

  // 5 — splice the log BEFORE the rewind: the prefix restore reads only ops
  // BELOW spanStartIdx, which the splice leaves alone, so ordering it first
  // keeps the store and log.ops from ever disagreeing.
  const firstId = log.nextId;
  const newSpan = stampSpan(evaluated, firstId, origin);
  // Spread, don't rebuild: any field the record carries that reconfigure has no
  // opinion about (a label, a lock, a recorded policy) must SURVIVE. Rebuilding
  // field-by-field silently drops whatever is added next.
  const entity: GeneratorEntity = {
    ...recorded,
    params: provenance.params,
    seed: provenance.seed,
    region: provenance.region,
    opSpan: [firstId, firstId + newSpan.length - 1],
  };
  // The returned COPY is built HERE, above the splice, not at `return`. The
  // spread's whole purpose is carrying fields this function has no opinion
  // about, and an unknown field is exactly the one whose cloneability the type
  // system does not vouch for — cloning after the splice made a DataCloneError
  // the one failure that threw with the log already rewritten.
  const returned = structuredClone(entity);
  const removed: FieldOp[] = [...spanOps, entityOp];
  const inserted: FieldOp[] = [...newSpan, { ...entityOp, entity }];
  spliceOps(log.ops, spanStartIdx, removed.length, inserted);
  log.nextId = firstId + newSpan.length;

  // 6 — rewind the affected chunks, then re-apply forward. Field-op findings
  // come first (log order among the replayed ops), then placement findings
  // (log order among the downstream placement ops) — both diffed once the store
  // has settled.
  restorePreState(store, log, spanStartIdx, affected, table, snapshots);
  const drift = [
    ...applyAndReport(store, newSpan, replay, before, table),
    ...placementDrift(store, before, downstreamPlacements, affected, cellSize),
  ];

  // 7 — after-images + the ONE undo entry
  const after = imagesOf(store, affected);
  const entry = {
    kind: "splice" as const,
    at: spanStartIdx,
    removed,
    inserted,
    before,
    after,
  };
  log.undoStack.push(origin === undefined ? entry : { ...entry, origin });
  log.redoStack.length = 0;
  // Every write above lands in an affected chunk by construction, and a
  // restored-but-unrewritten chunk still needs a remesh — so the dirty set IS
  // the affected set, handed over rather than copied.
  return { dirty: affected, entity: returned, drift };
}

/**
 * Deletes a committed generator entity (F4.5b) — {@link reconfigureGenerator}'s
 * splice with NO replacement.
 *
 * The entity's span AND its own entity op are spliced out of `log.ops`, the
 * chunks the span wrote are rewound to their pre-span state, and the downstream
 * ops that reach those chunks are replayed on top (the same culled replay,
 * D-F3-3: the span's chunks closed transitively over the downstream ops that
 * intersect them; an op whose mask embeds a FLOOD selection joins the set
 * unconditionally). Nothing outside the affected set is re-applied.
 *
 * The result is that the log reads as though the generator had never been
 * committed, with every later edit preserved: a dig that cut through the deleted
 * stamp survives as a dig into whatever was underneath. `log.nextId` is NOT
 * rewound — no id is ever reused, so the removed span parked on the redo stack
 * can never collide with a later op.
 *
 * Other entities are untouched. Spans are located by ID, not by index, so
 * removing a contiguous block elsewhere in the array leaves every surviving
 * entity's span sitting immediately before its own entity op exactly as before.
 *
 * **Refuses a `frozen` entity** — freeze is protection against an accidental
 * edit, and deletion is the largest edit there is, so unfreeze first (unlike
 * {@link bakeGeneratorEntity}, which ignores the flag because baking is a
 * deliberate one-way action the caller is expected to confirm).
 *
 * **Refuses a `baked` entity, permanently.** A baked record's span ops are
 * plain history eligible for compaction, and `compactRuns` folds them without
 * updating the record — so a baked `opSpan` is not a claim about the log's
 * contents, and splicing by it could delete ops the entity never owned. Bake
 * is the escape hatch for retiring an entity, not a step towards deleting one.
 *
 * Takes no `snapshots` argument, unlike {@link reconfigureGenerator}: the
 * rewind is identical and the lever would work, but no caller holds records
 * today (the editor passes none to reconfigure either), so it is left off
 * rather than added speculatively.
 *
 * Pushes exactly ONE `splice` undo entry with `inserted: []` (the removed span +
 * entity op, and the affected chunks' before/after images) and clears the redo
 * stack. Undo puts the whole entity back and restores the images byte-for-byte;
 * redo re-deletes. Neither re-executes the span. `dirty` is the whole affected
 * set, not just the chunks whose bytes moved — a chunk restored to its pre-span
 * state and never rewritten still needs a remesh.
 *
 * **`dirty` can be EMPTY, and empty does not mean nothing happened.** A
 * placements-only entity (scatter) writes no field cells, so deleting it moves
 * no chunk and there is nothing to remesh — but its placement op IS gone from
 * `log.ops`, and with it every prop it placed. Props are derived from the LOG,
 * never from `dirty`: a caller that re-reads placements only when `dirty` is
 * non-empty will leave deleted props on screen.
 *
 * **No drift report** — a cost/scope choice, not an impossibility, and two real
 * signals are given up by it. An `orphaned` finding would name a downstream op
 * that replays and now writes NOTHING (a dig that only ever cut the deleted
 * stamp's masonry); step 5 discards exactly the {@link applyFieldOp} result
 * that would produce it. A placement `drifted` finding would name a downstream
 * placement op whose props are left floating when the field beneath them goes
 * (delete a cave under a scatter and every prop keeps its recorded pose over
 * air). Both are SUBSETS of the downstream ops, not "everything". Widening the
 * return to carry them is additive and non-breaking whenever a caller earns it.
 *
 * `origin` is who is deleting — the ACTOR OF THIS CALL, never the entity's
 * original author ({@link BrushOp.origin}). This verb AUTHORS no op (`inserted`
 * is empty), so unlike every other committing path it has nothing to stamp
 * durably: the value reaches the `splice` ENTRY alone ({@link LogEntry}.origin),
 * which is therefore the only record of who removed the span. The `removed` ops
 * leave the log carrying whoever wrote them. Omit it for the human's own work:
 * absent = human, and the entry gains no property.
 *
 * @throws {@link Error} if no entity op carries `entityId`, the entity is
 *   `frozen` or `baked`, or the log does not hold its span where the record
 *   says. All three are VALIDATION failures that fire before the first write,
 *   leaving the store, `log.ops` and both stacks untouched. Past validation
 *   this verb has strictly FEWER ways to fail than {@link reconfigureGenerator}
 *   — no evaluate, no record clone, and `spliceOps`' range guard is discharged
 *   by `verifySpanLayout` — so the same "does not unwind, and does not need to"
 *   guarantee holds a fortiori (see the note on step 2 in reconfigure's body
 *   for the replay-path obligations both verbs inherit).
 */
export function deleteGeneratorEntity(
  store: FieldStore,
  log: OpLog,
  entityId: number,
  table: MaterialTable,
  origin?: string,
): { dirty: Set<ChunkKey> } {
  // 1 — locate + guards, in reconfigureGenerator's order and for its reason: a
  // baked entity's span is compaction-eligible, so a compacted log holds baked
  // records whose `opSpan` names ids that no longer exist. Those must report
  // what they ARE — baked — not "the log layout is corrupt".
  const { entityIdx, entityOp } = findEntityOp(
    log,
    entityId,
    "deleteGeneratorEntity",
  );
  const recorded = entityOp.entity;
  if (recorded.frozen === true)
    throw new Error(
      `deleteGeneratorEntity: entity ${entityId} is frozen — unfreeze it to delete`,
    );
  if (recorded.baked === true)
    throw new Error(
      `deleteGeneratorEntity: entity ${entityId} is baked — its span ops are compactable history, so its recorded opSpan is no longer a claim about the log`,
    );
  const { spanStartIdx, spanOps } = verifySpanLayout(
    log,
    entityIdx,
    entityOp,
    "deleteGeneratorEntity",
  );

  // 2 — the affected set: what the span WROTE (there is no replacement to
  // union in), closed over the downstream ops that intersect it. Downstream
  // PLACEMENT ops write no cells, so they are never absorbed and never replay —
  // and unlike a reconfigure there is no drift pass to collect them for.
  const cellSize = store.cellSize;
  const { affected, replay } = closeOverDownstream(
    directlyAffected(spanOps, [], cellSize),
    downstreamOf(log, entityIdx, cellSize),
  );

  // 3 — old-final images: undo's `before`
  const before = imagesOf(store, affected);

  // 4 — splice the log BEFORE the rewind: the prefix restore reads only ops
  // BELOW spanStartIdx, which the splice leaves alone, so ordering it first
  // keeps the store and log.ops from ever disagreeing (reconfigure's ordering).
  const removed: FieldOp[] = [...spanOps, entityOp];
  spliceOps(log.ops, spanStartIdx, removed.length, []);

  // 5 — rewind the affected chunks, then replay the absorbed downstream ops in
  // LOG order. applyAndReport's loop minus the reporting: the DISCARDED
  // applyFieldOp result is precisely what an `orphaned` finding reads (an op
  // that replayed and wrote nothing). See the no-drift note in the TSDoc for
  // what that costs and why it is still the right trade here.
  restorePreState(store, log, spanStartIdx, affected, table, []);
  for (const candidate of replay) applyFieldOp(store, candidate.op, table);

  // 6 — after-images + the ONE undo entry
  const after = imagesOf(store, affected);
  const entry = {
    kind: "splice" as const,
    at: spanStartIdx,
    removed,
    inserted: [],
    before,
    after,
  };
  log.undoStack.push(origin === undefined ? entry : { ...entry, origin });
  log.redoStack.length = 0;
  // Every write above lands in an affected chunk by construction, and a
  // restored-but-unrewritten chunk still needs a remesh — so the dirty set IS
  // the affected set, handed over rather than copied.
  return { dirty: affected };
}

/** Swaps one entity op's record in place under a single `entity-update` undo
 *  entry: the op keeps its id and its position, so `entityId` and the span
 *  layout are untouched and no chunk changes. `next` must already be the log's
 *  own copy — this hands it straight to `log.ops`.
 *
 *  Every caller validates FIRST: the push and the redo clear happen together,
 *  after the last thing that can reject.
 *
 *  `origin` goes on the ENTRY only, and this is the asymmetry the entry-level
 *  field exists for. Nothing here is newly authored: the swapped-in `after` is
 *  the SAME entity op with a new record (the spread), so it keeps the entity's
 *  original author on its op-level `origin`, and `before` keeps it too. The
 *  entry, meanwhile, belongs to whoever called freeze/bake. A reader deriving
 *  entry-origin from the contained ops would therefore report the entity's
 *  author as the freezer, which is a different person. */
function updateEntityOp(
  log: OpLog,
  entityIdx: number,
  entityOp: EntityOp,
  next: GeneratorEntity,
  origin?: string,
): void {
  const after: EntityOp = { ...entityOp, entity: next };
  log.ops[entityIdx] = after;
  const entry = {
    kind: "entity-update" as const,
    opIndex: entityIdx,
    before: entityOp,
    after,
  };
  log.undoStack.push(origin === undefined ? entry : { ...entry, origin });
  log.redoStack.length = 0;
}

/**
 * Freezes or unfreezes a committed generator entity (F3 spec §2.2) — cheap,
 * reversible protection: {@link reconfigureGenerator} refuses a frozen entity
 * until it is unfrozen. Nothing else is affected; a frozen entity's span is
 * still plain history that later ops write over, and undo/redo still cross it.
 *
 * Freeze does NOT block {@link bakeGeneratorEntity}: the irreversible verb
 * ignores the flag and clears it. Freeze guards against an ACCIDENTAL edit, and
 * baking is never accidental — it is the one irreversible verb, and the caller
 * that offers it is expected to confirm it — so demanding unfreeze-then-bake
 * would add friction to a deliberate one-way action without protecting anything.
 * (It would not deadlock either: unfreezing is always available, since this verb
 * does not verify the span layout.) Freeze protects the recipe from EDITS, not
 * from retirement — a lock button wired to this verb should not be read as
 * protecting the entity from every verb.
 *
 * Takes `log` but NOT `store`, unlike {@link reconfigureGenerator}: this writes
 * only the entity RECORD, so there is no field state to change, nothing to
 * remesh, and no `dirty` set to return. That asymmetry is the contract, not an
 * oversight. For the same reason it does not verify the entity's span layout —
 * being unable to protect a corrupt entity would be the wrong failure mode (see
 * {@link findEntityOp}).
 *
 * A SETTER, not a toggle: the post-condition is "the entity's frozen state is
 * `frozen`". A redundant call — freezing what is already frozen, unfreezing
 * what is not — is therefore a well-formed request that is already satisfied,
 * and it does nothing at all: no undo entry, and critically no redo CLEAR,
 * which would otherwise destroy a live redo entry on behalf of a call that
 * changed nothing. It still returns the current record.
 *
 * That no-op is INVISIBLE in the return value: both paths hand back a record
 * whose `frozen` state is the one requested, so nothing in it distinguishes
 * "pushed an entry" from "pushed nothing". A caller that offers "undo this"
 * must compare `log.undoStack.length` across the call, or check the entity's
 * prior `frozen` state (today that means scanning `log.ops` yourself; there is
 * no public reader for an entity record by id —
 * `docs/backlog/engine-architecture/field-read-surface-gaps.md`, §"no public
 * reader") — ⌘Z after a
 * redundant call undoes whatever came before it, which is correct but is not
 * what such a prompt would be promising.
 *
 * Records exactly ONE `entity-update` undo entry per real change and clears the
 * redo stack; undo swaps the previous record back and reports an empty dirty
 * set. Unfreezing DELETES the field rather than setting it false —
 * {@link GeneratorEntity}.frozen is a literal-`true` optional, so absent is the
 * only spelling of "not frozen". The returned record is a COPY, so mutating it
 * cannot rewrite the log, and it carries any field this verb has no opinion
 * about verbatim.
 *
 * `origin` is who is freezing — the ACTOR OF THIS CALL ({@link BrushOp.origin})
 * — and it lands on the `entity-update` ENTRY only
 * ({@link LogEntry}.origin). Freezing AUTHORS nothing: the entity op keeps its
 * own op-level origin on both sides of the entry, so an agent-authored entity
 * frozen by the human yields an entry the human owns over records that still
 * name the agent. That divergence is the point — it is why the entry carries a
 * field of its own instead of a reader deriving one. A REDUNDANT call stamps
 * nothing, because it pushes no entry at all. Omit it for the human's own work:
 * absent = human.
 *
 * @throws {@link Error} if no entity op carries `entityId`, or the entity is
 *   `baked` — a severed recipe has nothing left to protect, and the flag would
 *   be unreadable state. A `DataCloneError` if the record holds
 *   structured-clone-incompatible values. Both fire before any mutation.
 */
export function setGeneratorFrozen(
  log: OpLog,
  entityId: number,
  frozen: boolean,
  origin?: string,
): GeneratorEntity {
  const { entityIdx, entityOp } = findEntityOp(
    log,
    entityId,
    "setGeneratorFrozen",
  );
  const recorded = entityOp.entity;
  if (recorded.baked === true)
    throw new Error(
      `setGeneratorFrozen: entity ${entityId} is baked — its recipe was severed`,
    );
  // Both sides normalized to a plain boolean: absent spells "not frozen".
  const alreadyInTheRequestedState = (recorded.frozen === true) === frozen;
  if (alreadyInTheRequestedState) return structuredClone(recorded);
  const next: GeneratorEntity = structuredClone(recorded);
  if (frozen) next.frozen = true;
  else delete next.frozen;
  const returned = structuredClone(next);
  updateEntityOp(log, entityIdx, entityOp, next, origin);
  return returned;
}

/**
 * Severs a committed generator entity's recipe (F3 spec §2.2, charter §2.2) —
 * the ONE irreversible verb.
 *
 * Provenance is RETAINED: the record keeps its generator id, params, seed,
 * region and `opSpan`, so history still reads back. What goes is the ability to
 * re-evaluate — {@link reconfigureGenerator} refuses a baked entity permanently
 * — and with it the protection the span enjoyed: its ops become plain history,
 * eligible for compaction. `frozen` is cleared, since a severed recipe has
 * nothing left to protect.
 *
 * **"Permanent" means no VERB reverses it.** There is no unbake, and baking
 * twice throws rather than repeating. It is still a logged mutation, so ⌘Z
 * undoes it like any other — for exactly as long as the entry sits on the undo
 * stack. Past that (the stack discarded, or a save/reload: `serializeOps`
 * writes `log.ops` only, never the stacks) the record is baked for good.
 *
 * Takes `log` but NOT `store` — see {@link setGeneratorFrozen} for why, and for
 * why the span layout is not verified. Baking is in fact the escape hatch for
 * an entity whose span IS corrupt: it retires a record that can no longer be
 * reconfigured. Note the consequence for a compactor: a baked entity's `opSpan`
 * was never re-verified, so span-based eligibility must be derived from the
 * spans of LIVE (non-baked) entities, which reconfigure does verify.
 *
 * Records exactly ONE `entity-update` undo entry and clears the redo stack;
 * undo swaps the pre-bake record back — including its `frozen` state — and
 * reports an empty dirty set, because no chunk changes. The returned record is
 * a COPY and carries any field this verb has no opinion about verbatim.
 *
 * `origin` behaves exactly as in {@link setGeneratorFrozen}: the ACTOR OF THIS
 * CALL, stamped on the `entity-update` ENTRY only, while the entity op on both
 * sides keeps its original author's op-level origin. Omit it for the human's
 * own work.
 *
 * @throws {@link Error} if no entity op carries `entityId`, or the entity is
 *   ALREADY baked. The second is deliberate rather than an idempotent no-op:
 *   this is a one-way transition, not a setter, so a second call is a category
 *   error — and logging it would push an entry whose before and after are the
 *   same record, a ⌘Z that visibly does nothing (the shape
 *   {@link assertPatchValid} rejects for the empty patch) while silencing a
 *   caller that believes it just severed a recipe. A `DataCloneError` if the
 *   record holds structured-clone-incompatible values. Both fire before any
 *   mutation.
 */
export function bakeGeneratorEntity(
  log: OpLog,
  entityId: number,
  origin?: string,
): GeneratorEntity {
  const { entityIdx, entityOp } = findEntityOp(
    log,
    entityId,
    "bakeGeneratorEntity",
  );
  const recorded = entityOp.entity;
  if (recorded.baked === true)
    throw new Error(`bakeGeneratorEntity: entity ${entityId} is already baked`);
  const next: GeneratorEntity = structuredClone(recorded);
  delete next.frozen;
  next.baked = true;
  const returned = structuredClone(next);
  updateEntityOp(log, entityIdx, entityOp, next, origin);
  return returned;
}
