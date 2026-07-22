// packages/core/src/field/maintenance.ts — log hygiene over the ONE linear log:
// the op-cost readout (spec D-F3-16), semantic compaction (D-F3-6), and the
// chunk snapshot records the reconfigure restore seeds from (D-F3-7).
//
// Compaction NEVER writes the store. It rewrites `log.ops` so that a
// from-scratch replay still produces the bytes it produced before — proven per
// fold against a real replay BEFORE the originals are discarded (the discard
// guard, charter §2.3).
import {
  CHUNK_SAMPLES,
  createFieldStore,
  densityEqual,
  SOLID,
} from "./chunks.ts";
import { classAt, materialsEqual } from "./materials.ts";
import {
  applyFieldOp,
  applyPatchOp,
  assertPatchValid,
  fieldOpChunks,
  imagesOf,
  isCellLocalOp,
  PATCH_MASK_BYTES,
  restoreImages,
  spliceOps,
} from "./ops.ts";
import type {
  ChunkKey,
  ChunkMaterials,
  ChunkSnapshot,
  FieldOp,
  FieldStore,
  MaterialTable,
  OpLog,
  PatchChunk,
  PatchOp,
} from "./types.ts";

/** Live-cost readout for the op-cost meter (spec D-F3-16) — the numbers one
 *  Field-panel line needs, computed from the log alone (no store, no GPU).
 *
 *  `liveGenerators` counts entities whose recipe is INTACT, which includes the
 *  frozen ones — `frozenGenerators` is a subset of it, not a sibling bucket, and
 *  `bakedGenerators` is the disjoint remainder. `compactableOps` is what
 *  {@link compactRuns} would fold under the options the same call was given (see
 *  {@link logStats}); `undoDepth`/`redoDepth` report the history that
 *  {@link compactRuns} requires to be empty, so a caller can tell "there is
 *  nothing to fold" from "there is plenty to fold, but not yet". */
export type LogStats = {
  totalOps: number;
  liveGenerators: number;
  bakedGenerators: number;
  frozenGenerators: number;
  compactableOps: number;
  undoDepth: number;
  redoDepth: number;
};

/** What {@link compactRuns} must leave alone. `keepIds` holds op ids the CALLER
 *  still references — a drift report's `opId`s, a selected row in an op list, a
 *  pending daemon message — and those ops are excluded from every run, splitting
 *  a run in two rather than shortening it.
 *
 *  It is deliberately NOT how the undo/redo stacks are protected: those entries
 *  address `log.ops` POSITIONALLY (an `ops` entry by tail length, a `splice` by
 *  `at`, an `entity-update` by `opIndex`), so no set of ids can keep them valid
 *  across a fold. {@link compactRuns} refuses to run at all while either stack
 *  is live. */
export type CompactOptions = { keepIds: ReadonlySet<number> };

/** The default {@link CompactOptions}: nothing is pinned by the caller. */
const NO_KEPT_IDS: CompactOptions = { keepIds: new Set() };

/** Shortest run worth folding. Below it the patch's masks (two 512-byte bitsets
 *  per written chunk) cost more than the op records they replace, and the log
 *  loses per-op provenance for nothing. */
const MIN_FOLD_RUN = 4;

/** A half-open `[start, end)` window of `log.ops` — indices, never ids: they are
 *  what {@link spliceOps} takes, and they are only ever used inside the one call
 *  that computed them. */
type OpRun = { start: number; end: number };

/**
 * The op-cost readout for a log (spec D-F3-16).
 *
 * `opts` is the SAME shape {@link compactRuns} takes, and passing the caller's
 * real one is what makes `compactableOps` agree with what a fold would actually
 * remove. Omitting it reports the CEILING — eligibility computed with nothing
 * pinned — which is the right number for "how much fat is in this log", not for
 * "how much would my next compaction remove".
 *
 * `compactableOps` ignores the quiescent-history precondition {@link compactRuns}
 * enforces: it answers what is foldable about the OPS, while `undoDepth` and
 * `redoDepth` answer whether a fold may run at all. A meter showing a fat
 * `compactableOps` beside a non-zero `undoDepth` is reporting exactly that
 * situation, not lying about it.
 *
 * Pure query — nothing is mutated, and no chunk is read (the store is not even
 * a parameter).
 */
export function logStats(
  log: OpLog,
  opts: CompactOptions = NO_KEPT_IDS,
): LogStats {
  const entities = log.ops.flatMap((op) =>
    op.kind === "entity" ? [op.entity] : [],
  );
  const baked = entities.filter((e) => e.baked === true);
  return {
    totalOps: log.ops.length,
    liveGenerators: entities.length - baked.length,
    bakedGenerators: baked.length,
    frozenGenerators: entities.filter(
      (e) => e.baked !== true && e.frozen === true,
    ).length,
    compactableOps: eligibleRuns(log, opts).reduce(
      (n, run) => n + (run.end - run.start),
      0,
    ),
    undoDepth: log.undoStack.length,
    redoDepth: log.redoStack.length,
  };
}

/** The maximal runs of foldable ops, in log order. An op is foldable when it is
 *  a BRUSH op (a patch is already compact; an entity op is provenance), it is
 *  {@link isCellLocalOp} (so absolute cell values can stand in for it), the
 *  caller has not pinned its id, and it does not belong to a LIVE generator
 *  entity's span — folding those would dissolve the span layout
 *  `reconfigureGenerator` requires. Span eligibility is derived from live
 *  (non-baked) entities only, per {@link bakeGeneratorEntity}: bake does not
 *  re-verify the span it retires, so a baked record's `opSpan` is not a claim
 *  about the log's contents. */
function eligibleRuns(log: OpLog, opts: CompactOptions): OpRun[] {
  const liveSpans = log.ops.flatMap((op) =>
    op.kind === "entity" && op.entity.baked !== true ? [op.entity.opSpan] : [],
  );
  const inLiveSpan = (id: number): boolean =>
    liveSpans.some(([first, last]) => id >= first && id <= last);
  const foldable = (op: FieldOp): boolean =>
    op.kind === "brush" &&
    isCellLocalOp(op) &&
    !opts.keepIds.has(op.id) &&
    !inLiveSpan(op.id);
  const runs: OpRun[] = [];
  let start = -1;
  // One index past the end closes a run that reaches the tail.
  for (let i = 0; i <= log.ops.length; i++) {
    const op = log.ops[i];
    if (op !== undefined && foldable(op)) {
      if (start < 0) start = i;
      continue;
    }
    if (start >= 0 && i - start >= MIN_FOLD_RUN) runs.push({ start, end: i });
    start = -1;
  }
  return runs;
}

/** Every chunk key either channel of the store carries. */
const storeKeys = (store: FieldStore): Set<ChunkKey> =>
  new Set([...store.chunks.keys(), ...store.materials.keys()]);

/** A deep copy of the whole store, through the ONE set of clone/null rules
 *  ({@link imagesOf} captures them, {@link restoreImages} applies them). */
function copyStore(src: FieldStore): FieldStore {
  const copy = createFieldStore(src.cellSize);
  restoreImages(copy, imagesOf(src, storeKeys(src)));
  return copy;
}

/** SEMANTIC whole-store equality: every chunk either store carries must read the
 *  same in both channels. Representation-independent on purpose — a patch
 *  re-creates a chunk through {@link setDensity}/`setMaterial`, which allocate
 *  and encode differently than the run being folded did, so a byte-compare would
 *  report a mismatch for identical content and abort a correct fold. */
function storesEqual(a: FieldStore, b: FieldStore): boolean {
  const keys = new Set([...storeKeys(a), ...storeKeys(b)]);
  for (const key of keys) {
    if (!densityEqual(a.chunks.get(key), b.chunks.get(key))) return false;
    if (!materialsEqual(a.materials.get(key), b.materials.get(key)))
      return false;
  }
  return true;
}

/** One chunk's slice of the `before → after` difference, or null when that chunk
 *  did not change. Cells are visited in ASCENDING bit order — the order
 *  {@link PatchChunk} defines its value arrays in, so each array is simply
 *  pushed as the sweep goes. The two channels are masked INDEPENDENTLY: a fill
 *  that only retinted already-solid rock produces a slice with an empty density
 *  mask, which is valid. */
function diffChunk(
  key: ChunkKey,
  before: FieldStore,
  after: FieldStore,
): PatchChunk | null {
  const densityBefore = before.chunks.get(key);
  const densityAfter = after.chunks.get(key);
  const materialsBefore = before.materials.get(key);
  const materialsAfter = after.materials.get(key);
  const densityMask = new Uint8Array(PATCH_MASK_BYTES);
  const materialMask = new Uint8Array(PATCH_MASK_BYTES);
  const density: number[] = [];
  const materials: number[] = [];
  for (let bit = 0; bit < CHUNK_SAMPLES; bit++) {
    // An absent chunk reads uniform SOLID / MAT_ROCK — the elision rule
    // getDensity and classAt implement, applied here to the raw arrays.
    const densityNow = densityAfter?.[bit] ?? SOLID;
    if (densityNow !== (densityBefore?.[bit] ?? SOLID)) {
      densityMask[bit >> 3] = (densityMask[bit >> 3] ?? 0) | (1 << (bit & 7));
      density.push(densityNow);
    }
    const classNow = classAt(materialsAfter, bit);
    if (classNow !== classAt(materialsBefore, bit)) {
      materialMask[bit >> 3] = (materialMask[bit >> 3] ?? 0) | (1 << (bit & 7));
      materials.push(classNow);
    }
  }
  if (density.length === 0 && materials.length === 0) return null;
  const writesMaterial = materials.length > 0;
  return {
    key,
    densityMask,
    density: Int8Array.from(density),
    materialMask: writesMaterial ? materialMask : null,
    materials: writesMaterial ? Uint8Array.from(materials) : null,
  };
}

/** The slices that turn `before` into `after`: every chunk either store carries,
 *  minus the ones that did not change. Keys are sorted so the same fold always
 *  produces the same op — a patch rides the wire byte-for-byte, and Map
 *  insertion order is an implementation detail of how the run happened to touch
 *  the field. */
function diffToPatch(before: FieldStore, after: FieldStore): PatchChunk[] {
  const keys = [...new Set([...storeKeys(before), ...storeKeys(after)])].sort();
  return keys.flatMap((key) => {
    const slice = diffChunk(key, before, after);
    return slice === null ? [] : [slice];
  });
}

/** The discard guard (charter §2.3): the synthesized patch must reproduce the
 *  run on the run's OWN pre-state, or nothing is discarded. It also discharges
 *  the obligation `reconfigureGenerator`'s step-2 comment records — a producer
 *  that splices patch ops straight into `log.ops`, bypassing `logApplyPatch`,
 *  inherits the duty to validate what it splices, or `applyPatchOp`'s
 *  chunk-key parse becomes reachable again from a later replay.
 *
 *  With a correct diff neither throw can fire; they are the assertion that keeps
 *  "correct" from being an assumption, at the one moment history is about to be
 *  destroyed.
 *
 *  @throws {@link Error} if the patch fails {@link assertPatchValid}, or if
 *    applying it to the pre-state does not reproduce the post-state. */
function verifyFold(
  before: FieldStore,
  after: FieldStore,
  chunks: PatchChunk[],
  table: MaterialTable,
  run: OpRun,
): void {
  const span = `ops [${run.start}, ${run.end})`;
  if (chunks.length === 0) {
    if (storesEqual(before, after)) return;
    throw new Error(
      `field compaction: ${span} changed the field but diffed to an EMPTY patch — nothing was discarded`,
    );
  }
  // Id 0 — the probe patch is never logged; the spliced op carries a real one.
  const patch: PatchOp = { id: 0, kind: "patch", chunks };
  assertPatchValid(patch, table);
  const check = copyStore(before);
  applyPatchOp(check, patch);
  if (storesEqual(check, after)) return;
  throw new Error(
    `field compaction: the patch folded from ${span} does not reproduce them — nothing was discarded`,
  );
}

/** One verified fold, ready to splice. */
type PlannedFold = { run: OpRun; chunks: PatchChunk[] };

/** Plans and VERIFIES every fold before any of them is applied, in ONE forward
 *  replay of the log: the scratch store walks the prefix once and each run's
 *  pre-state is copied off it in passing, instead of replaying the prefix again
 *  per run. Nothing here touches `log` or the live store, so a rejected fold
 *  leaves both exactly as they were.
 *
 *  @throws {@link Error} if any fold fails {@link verifyFold}. */
function planFolds(
  log: OpLog,
  runs: readonly OpRun[],
  table: MaterialTable,
  cellSize: number,
): PlannedFold[] {
  const scratch = createFieldStore(cellSize);
  const folds: PlannedFold[] = [];
  let cursor = 0;
  for (const run of runs) {
    for (const op of log.ops.slice(cursor, run.start))
      applyFieldOp(scratch, op, table);
    const before = copyStore(scratch);
    for (const op of log.ops.slice(run.start, run.end))
      applyFieldOp(scratch, op, table);
    cursor = run.end;
    const chunks = diffToPatch(before, scratch);
    verifyFold(before, scratch, chunks, table, run);
    folds.push({ run, chunks });
  }
  return folds;
}

/** The precondition compaction cannot work around.
 *
 *  @throws {@link Error} if either stack holds an entry. */
function assertQuiescentHistory(log: OpLog): void {
  const undoDepth = log.undoStack.length;
  const redoDepth = log.redoStack.length;
  if (undoDepth === 0 && redoDepth === 0) return;
  throw new Error(
    `compactRuns: history must be quiescent — ${undoDepth} undo / ${redoDepth} redo entries still address log.ops by POSITION, which folding shifts; drop both stacks (a save/reload does) before compacting`,
  );
}

/**
 * Folds runs of plain, cell-local brush ops into one {@link PatchOp} each —
 * semantic compaction (spec D-F3-6). The log shrinks; the FIELD does not move.
 *
 * `store` is read for its `cellSize` and nothing else: no chunk of it is read
 * and none is written. Every fold is measured against a from-scratch replay of
 * the log's own prefix, so the result holds even if the live store has drifted
 * from its history — and a drift that existed before a compaction still exists,
 * unchanged, after it.
 *
 * **Requires a quiescent history: both stacks empty.** Undo entries address
 * `log.ops` POSITIONALLY — an `ops` entry undoes by peeling `entry.ops.length`
 * off the tail, a `splice` entry by index `at`, an `entity-update` entry by
 * `opIndex` — and a fold removes ops, shifting every position after it. No
 * id-based opt-out can fix that (`keepIds` pins ops, not indices), and rewriting
 * the stored indices would have to be right for every interleaving of undo,
 * redo and reconfigure. So the verb refuses instead. The natural call site
 * already satisfies it: `serializeOps` persists `log.ops` and never the stacks,
 * so a freshly loaded project has no history to invalidate — compact on open,
 * edit after.
 *
 * Eligibility (see {@link CompactOptions} for `keepIds`): a brush op with a
 * cell-local effect — `dig`, `fill`, `paint`, with any mask but a FLOOD
 * selection — that the caller has not pinned and that does not sit inside a LIVE
 * generator entity's span. `smooth` reads its neighbourhood, so it breaks a run
 * rather than joining one; patch and entity ops break runs too (a patch is
 * already compact, an entity op is the provenance a span hangs off). Only runs of
 * at least `MIN_FOLD_RUN` (4) ops fold — below that the patch's two 512-byte
 * masks per written chunk cost more than the op records they replace.
 *
 * A run whose net effect is NOTHING (masked ops that matched no cell) is removed
 * outright rather than replaced by an empty patch, which
 * {@link assertPatchValid} rejects for good reason.
 *
 * **What a fold gives up.** A patch writes ABSOLUTE cell values, so the folded
 * ops stop adapting: if an UPSTREAM generator is later reconfigured, the run
 * would have re-applied against the new state, while the patch replays the
 * outcome it recorded. That is inherent to compaction (D-F3-6) and is why
 * compaction is for history that has aged out. Folding downstream of a LIVE
 * entity is allowed and degrades exactly this — bake the entity first if its
 * reconfigure fidelity matters more than the log size. Tracked in
 * `docs/backlog/engine-architecture/field-compaction-downstream-of-live-entity.md`.
 *
 * Log-only and UNDOABLE ONLY by not having been done: no undo entry is pushed
 * (there is no stack to push onto — see the precondition) and the redo stack is
 * not cleared for the same reason. `log.nextId` advances by one per patch
 * actually inserted.
 *
 * @returns the number of ops the log no longer carries individually — the ops
 *   folded into patches PLUS the ops in runs that were removed outright.
 * @throws {@link Error} if either undo stack is non-empty, or if a fold fails to
 *   reproduce its run byte-exactly ({@link verifyFold}). Both fire before the
 *   first write to `log.ops`: a failed compaction leaves the log, the store and
 *   `log.nextId` exactly as they were.
 */
export function compactRuns(
  store: FieldStore,
  log: OpLog,
  table: MaterialTable,
  opts: CompactOptions,
): { folded: number } {
  assertQuiescentHistory(log);
  const runs = eligibleRuns(log, opts);
  if (runs.length === 0) return { folded: 0 };
  // Everything above this line can throw; everything below cannot. planFolds
  // verifies every fold against a real replay before a single op is spliced.
  const folds = planFolds(log, runs, table, store.cellSize);
  let nextId = log.nextId;
  const planned: { run: OpRun; insert: FieldOp[] }[] = [];
  for (const fold of folds) {
    const insert: FieldOp[] =
      fold.chunks.length === 0
        ? []
        : [{ id: nextId++, kind: "patch", chunks: fold.chunks }];
    planned.push({ run: fold.run, insert });
  }
  // Back to front: an earlier run's indices are untouched by a later splice.
  for (const { run, insert } of [...planned].reverse())
    spliceOps(log.ops, run.start, run.end - run.start, insert);
  log.nextId = nextId;
  return {
    folded: folds.reduce((n, f) => n + (f.run.end - f.run.start), 0),
  };
}

/** One chunk's two channels as of a log POSITION — the state produced by
 *  `log.ops[0 .. position)`, in the same null-means-absent spelling
 *  {@link ChunkSnapshot} uses. Written by {@link maintainSnapshots}; read by the
 *  reconfigure restore, which replays forward from it instead of from pristine.
 *
 *  A record is bound to the log that produced it: any edit BELOW its `position`
 *  — an undo, a reconfigure's splice, a compaction fold — invalidates it, and
 *  nothing in the record detects that. The owner of the record list is
 *  responsible for dropping records at or after an edit position, the same way
 *  it is responsible for persisting them. */
export type SnapshotRecord = {
  key: ChunkKey;
  position: number;
  density: Int8Array | null;
  materials: ChunkMaterials | null;
};

/**
 * The adaptive snapshot sweep (spec D-F3-7): captures the CURRENT state of every
 * chunk whose replay tail — the ops written since that chunk's newest record —
 * has grown past `tailBudgetOps`. A chunk nobody has touched since its last
 * record is never re-captured, and a chunk with no record at all counts its tail
 * from the start of the log.
 *
 * The captured records are RETURNED, not appended: this reads `records` and
 * never mutates it, so the caller decides where the list lives (memory, a
 * sibling file per D-F3-7) and when to prune it. Every record in one sweep
 * carries the same `position` — `log.ops.length`, the state the store is in
 * right now.
 *
 * The tail is counted from {@link fieldOpChunks}, which over-approximates a
 * brush op's written chunks, so a chunk can be snapshotted slightly early. That
 * is the safe direction: a record is never captured late.
 *
 * @throws {@link Error} if `tailBudgetOps` is not a positive integer — a
 *   zero or fractional budget would snapshot every chunk on every sweep.
 */
export function maintainSnapshots(
  store: FieldStore,
  log: OpLog,
  records: readonly SnapshotRecord[],
  tailBudgetOps: number,
): SnapshotRecord[] {
  if (!Number.isInteger(tailBudgetOps) || tailBudgetOps < 1)
    throw new Error(
      `maintainSnapshots: tail budget must be a positive integer (got ${tailBudgetOps})`,
    );
  const newest = new Map<ChunkKey, number>();
  for (const record of records)
    newest.set(
      record.key,
      Math.max(newest.get(record.key) ?? 0, record.position),
    );
  const tails = new Map<ChunkKey, number>();
  for (const [index, op] of log.ops.entries())
    for (const key of fieldOpChunks(op, store.cellSize)) {
      if (index < (newest.get(key) ?? 0)) continue;
      tails.set(key, (tails.get(key) ?? 0) + 1);
    }
  const position = log.ops.length;
  const captured: SnapshotRecord[] = [];
  for (const [key, tail] of tails) {
    if (tail <= tailBudgetOps) continue;
    const image = imagesOf(store, [key]).get(key) ?? EMPTY_IMAGE;
    captured.push({ key, position, ...image });
  }
  return captured;
}

/** Absent in both channels — the image of a chunk the store does not carry, and
 *  equally the state of EVERY chunk before op 0 (nothing exists yet), which is
 *  the free starting point {@link restoreSeeds} falls back to. */
const EMPTY_IMAGE: ChunkSnapshot = { density: null, materials: null };

/** A per-chunk plan for rebuilding its state as of a log position: the state to
 *  start from, plus the ops that must replay onto it, in log order. */
export type RestoreSeed = { image: ChunkSnapshot; ops: readonly FieldOp[] };

/**
 * Plans, per requested chunk, how to rebuild it as of log position `pos` WITHOUT
 * replaying the whole prefix: start from the newest usable {@link
 * SnapshotRecord} at or before `pos` — or from the pristine empty state at
 * position 0, which every chunk has for free — and replay only the ops in that
 * window which touch the chunk.
 *
 * A chunk is planned only when EVERY op in its window that touches it is
 * {@link isCellLocalOp}. That is what lets the caller replay those ops into a
 * scratch store holding this chunk ALONE: a cell-local op's effect on a cell
 * depends on that cell and the op record, so the missing neighbourhood cannot
 * change the answer. One smooth op — or one flood-masked op — over the chunk in
 * that window disqualifies it, and it is left OUT of the result for the caller
 * to rebuild the slow way. A record therefore buys two things: fewer ops to
 * replay, and a window short enough that an old smooth op falls out of it.
 *
 * Each window starts at ITS OWN chunk's record, never at the earliest one: that
 * is what keeps a record's window as short as the record made it. It also keeps
 * the result independent of whether re-applying an op the record already
 * contains happens to be idempotent — it is for today's four brush effects, all
 * of which are pointwise clamp/set operators, but that is a property of the
 * current effect set, not a rule a future op kind inherits.
 *
 * Records for chunks outside `keys`, and records ahead of `pos`, are ignored, so
 * a caller may hand over its whole list. The returned images are the RECORDS'
 * own arrays — `restoreImages` copies them into a store, so a record is never
 * aliased into one, but a caller that mutates them corrupts its own snapshots.
 *
 * Deliberately NOT on the public field index: in-core restore surface, consumed
 * by `reconfigureGenerator`, which owns the decision of whether the plan is
 * worth executing (see its `restorePreState`).
 */
export function restoreSeeds(
  log: OpLog,
  pos: number,
  keys: Iterable<ChunkKey>,
  records: readonly SnapshotRecord[],
  cellSize: number,
): Map<ChunkKey, RestoreSeed> {
  type Candidate = { position: number; image: ChunkSnapshot; ops: FieldOp[] };
  const candidates = new Map<ChunkKey, Candidate>();
  for (const key of keys)
    candidates.set(key, { position: 0, image: EMPTY_IMAGE, ops: [] });
  for (const record of records) {
    const current = candidates.get(record.key);
    if (current === undefined || record.position > pos) continue;
    if (record.position <= current.position) continue;
    candidates.set(record.key, {
      position: record.position,
      image: { density: record.density, materials: record.materials },
      ops: [],
    });
  }
  if (candidates.size === 0) return new Map();
  const from = [...candidates.values()].reduce(
    (lowest, candidate) => Math.min(lowest, candidate.position),
    pos,
  );
  for (const [offset, op] of log.ops.slice(from, pos).entries()) {
    const index = from + offset;
    const cellLocal = isCellLocalOp(op);
    for (const key of fieldOpChunks(op, cellSize)) {
      const candidate = candidates.get(key);
      if (candidate === undefined || index < candidate.position) continue;
      if (cellLocal) candidate.ops.push(op);
      else candidates.delete(key);
    }
  }
  return new Map(
    [...candidates].map(([key, candidate]) => [
      key,
      { image: candidate.image, ops: candidate.ops },
    ]),
  );
}
