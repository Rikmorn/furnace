// packages/core/src/field/reconfigure.ts — the three smart-object verbs, which
// share one locator over the ONE linear log.
//
// reconfigureGenerator (F3 spec §2.1, D-F3-2..5) re-evaluates a committed
// generator IN PLACE: its span is spliced out and replaced, and only the
// downstream ops whose bounded influence touches the change are replayed.
// Bounded influence is what buys that culling — the whole reason charter §2.2
// demands it.
//
// setGeneratorFrozen and bakeGeneratorEntity (§2.2) re-evaluate NOTHING. They
// swap the entity RECORD in place under one entity-update entry, touching no
// chunk and no span: protection (reversible) and severing (not).
import { createFieldStore, densityEqual } from "./chunks.ts";
import { generatorById } from "./generators.ts";
import { materialsEqual } from "./materials.ts";
import {
  applyFieldOp,
  assertOpValid,
  fieldOpChunks,
  imagesOf,
  restoreImages,
  spliceOps,
} from "./ops.ts";
import type {
  BrushOp,
  ChunkKey,
  DriftFinding,
  EntityOp,
  FieldOp,
  FieldStore,
  GeneratorDef,
  GeneratorEntity,
  MaterialTable,
  MergePolicy,
  OpInverse,
  OpLog,
} from "./types.ts";

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
 *  wrong failure mode. {@link reconfigureGenerator}, which REWRITES the span,
 *  pairs this with {@link verifySpanLayout} (as {@link locateSpan}).
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

/** Verifies the layout {@link commitGenerator} establishes and every
 *  reconfigure preserves: the span's `opSpan[1] - opSpan[0] + 1` ops sit
 *  immediately before the entity op with sequential ids, none of them an entity
 *  op of its own. Setup-loud rather than trusting a stored index — a span left
 *  stale by an earlier edit is exactly how a bad splice arises, and passing this
 *  is what makes {@link spliceOps}' own range guard unreachable from here.
 *
 *  @throws {@link Error} if the log does not hold the span where the record
 *    says. */
function verifySpanLayout(
  log: OpLog,
  entityIdx: number,
  entityOp: EntityOp,
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
      `reconfigureGenerator: entity ${entityOp.entity.entityId}'s span [${firstId}, ${lastId}] is not the ${spanLength} op(s) immediately before its entity op — the log layout is corrupt`,
    );
  return { spanStartIdx, spanOps };
}

/** {@link findEntityOp} then {@link verifySpanLayout} — what a verb that
 *  REWRITES the span needs, as one call. Only {@link reconfigureGenerator}
 *  does, which is why both legs name it in their throws. */
function locateSpan(
  log: OpLog,
  entityId: number,
): {
  entityIdx: number;
  entityOp: EntityOp;
  spanStartIdx: number;
  spanOps: FieldOp[];
} {
  const { entityIdx, entityOp } = findEntityOp(
    log,
    entityId,
    "reconfigureGenerator",
  );
  return {
    entityIdx,
    entityOp,
    ...verifySpanLayout(log, entityIdx, entityOp),
  };
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
 *  last leg of a reconfigure that can throw.
 *
 *  @throws {@link Error} if the generator rejects the params, evaluates to an
 *    empty span, or emits an op {@link assertOpValid} rejects. */
function evaluateSpan(
  def: GeneratorDef,
  provenance: Provenance,
  table: MaterialTable,
): BrushOp[] {
  const ops = def.evaluate(
    provenance.params,
    provenance.seed,
    provenance.region,
    table,
    provenance.policy,
  );
  if (ops.length === 0)
    throw new Error(
      `reconfigureGenerator: generator "${def.id}" evaluated to an empty op span`,
    );
  for (const op of ops) assertOpValid(op, table);
  return ops;
}

/** The chunks the replacement disturbs directly: the old span's bounded
 *  influence ∪ the new evaluation's. */
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

/** Rebuilds the affected chunks' state as of BEFORE log position `pos` and
 *  copies ONLY those chunks back — every other chunk in the store is left
 *  exactly as it is.
 *
 *  Three phases, in order: seed a scratch store, replay the prefix into it,
 *  copy the affected chunks across. The scratch starts PRISTINE and replays the
 *  whole prefix (measured by P-F3-2 and accepted for F3a); a snapshot record
 *  changes only the first two lines — what the scratch is seeded with and where
 *  the replay starts. */
function restorePreState(
  store: FieldStore,
  log: OpLog,
  pos: number,
  affected: Set<ChunkKey>,
  table: MaterialTable,
): void {
  const scratch = createFieldStore(store.cellSize);
  for (const op of log.ops.slice(0, pos)) applyFieldOp(scratch, op, table);
  restoreImages(store, imagesOf(scratch, affected));
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

/** Stamps a span with consecutive ids from `firstId`, leaving the ops otherwise
 *  untouched. */
const stampSpan = (ops: readonly BrushOp[], firstId: number): BrushOp[] =>
  ops.map((op, i) => ({ ...op, id: firstId + i }));

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
 * @throws {@link Error} if no entity op carries `entityId`, the entity is
 *   `frozen` or `baked`, its recorded generator id is unknown, the log does not
 *   hold its span where the record says, the generator rejects the merged
 *   params, the evaluation is empty, or an evaluated op fails
 *   {@link assertOpValid}; a `DataCloneError` if `changes.params`/`region` — or
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
): { dirty: Set<ChunkKey>; entity: GeneratorEntity; drift: DriftFinding[] } {
  // 1 — locate + guards
  const { entityIdx, entityOp, spanStartIdx, spanOps } = locateSpan(
    log,
    entityId,
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
  const provenance = mergeProvenance(recorded, changes);
  const evaluated = evaluateSpan(def, provenance, table);

  // 3 — the affected set, closed over the downstream ops that intersect it
  const cellSize = store.cellSize;
  const { affected, replay } = closeOverDownstream(
    directlyAffected(spanOps, evaluated, cellSize),
    downstreamOf(log, entityIdx, cellSize),
  );

  // 4 — old-final images: undo's `before` AND the drift baseline
  const before = imagesOf(store, affected);

  // 5 — splice the log BEFORE the rewind: the prefix restore reads only ops
  // BELOW spanStartIdx, which the splice leaves alone, so ordering it first
  // keeps the store and log.ops from ever disagreeing.
  const firstId = log.nextId;
  const newSpan = stampSpan(evaluated, firstId);
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

  // 6 — rewind the affected chunks, then re-apply forward
  restorePreState(store, log, spanStartIdx, affected, table);
  const drift = applyAndReport(store, newSpan, replay, before, table);

  // 7 — after-images + the ONE undo entry
  const after = imagesOf(store, affected);
  log.undoStack.push({
    kind: "splice",
    at: spanStartIdx,
    removed,
    inserted,
    before,
    after,
  });
  log.redoStack.length = 0;
  // Every write above lands in an affected chunk by construction, and a
  // restored-but-unrewritten chunk still needs a remesh — so the dirty set IS
  // the affected set, handed over rather than copied.
  return { dirty: affected, entity: returned, drift };
}

/** Swaps one entity op's record in place under a single `entity-update` undo
 *  entry: the op keeps its id and its position, so `entityId` and the span
 *  layout are untouched and no chunk changes. `next` must already be the log's
 *  own copy — this hands it straight to `log.ops`.
 *
 *  Every caller validates FIRST: the push and the redo clear happen together,
 *  after the last thing that can reject. */
function updateEntityOp(
  log: OpLog,
  entityIdx: number,
  entityOp: EntityOp,
  next: GeneratorEntity,
): void {
  const after: EntityOp = { ...entityOp, entity: next };
  log.ops[entityIdx] = after;
  log.undoStack.push({
    kind: "entity-update",
    opIndex: entityIdx,
    before: entityOp,
    after,
  });
  log.redoStack.length = 0;
}

/**
 * Freezes or unfreezes a committed generator entity (F3 spec §2.2) — cheap,
 * reversible protection: {@link reconfigureGenerator} refuses a frozen entity
 * until it is unfrozen. Nothing else is affected; a frozen entity's span is
 * still plain history that later ops write over, and undo/redo still cross it.
 *
 * Freeze does NOT block {@link bakeGeneratorEntity}: the irreversible verb
 * ignores the flag and clears it, because baking is the escape hatch for an
 * entity that can no longer be reconfigured. Freeze protects the recipe from
 * EDITS, not from retirement — a lock button wired to this verb should not be
 * read as protecting the entity from every verb.
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
 * prior `frozen` state — ⌘Z after a redundant call undoes whatever came before
 * it, which is correct but is not what such a prompt would be promising.
 *
 * Records exactly ONE `entity-update` undo entry per real change and clears the
 * redo stack; undo swaps the previous record back and reports an empty dirty
 * set. Unfreezing DELETES the field rather than setting it false —
 * {@link GeneratorEntity}.frozen is a literal-`true` optional, so absent is the
 * only spelling of "not frozen". The returned record is a COPY, so mutating it
 * cannot rewrite the log, and it carries any field this verb has no opinion
 * about verbatim.
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
  updateEntityOp(log, entityIdx, entityOp, next);
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
  updateEntityOp(log, entityIdx, entityOp, next);
  return returned;
}
