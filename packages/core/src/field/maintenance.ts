// packages/core/src/field/maintenance.ts — log hygiene over the ONE linear log:
// the op-cost readout (spec D-F3-16) and semantic compaction (D-F3-6). The
// snapshot records the reconfigure restore seeds from are their own module
// (`snapshots.ts`, D-F3-7): they change what a rebuild COSTS, never what the log
// says, which is the opposite of what compaction does.
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
  imagesOf,
  isCellLocalOp,
  PATCH_MASK_BYTES,
  restoreImages,
  spliceOps,
} from "./ops.ts";
import type {
  ChunkKey,
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

/** The maximal runs of foldable, SAME-ORIGIN ops, in log order. An op is
 *  foldable when it is a BRUSH op (a patch is already compact; an entity op is
 *  provenance), it is {@link isCellLocalOp} (so absolute cell values can stand
 *  in for it), the caller has not pinned its id, and it does not belong to a
 *  LIVE generator entity's span — folding those would dissolve the span layout
 *  `reconfigureGenerator` requires. Span eligibility is derived from live
 *  (non-baked) entities only, per {@link bakeGeneratorEntity}: bake does not
 *  re-verify the span it retires, so a baked record's `opSpan` is not a claim
 *  about the log's contents.
 *
 *  A run additionally never spans two authors: a change of `origin` CLOSES the
 *  current run and opens the next at that op. A fold destroys per-op history, so
 *  one that merged a human's digs with an agent's would leave a single patch
 *  that can only be attributed to one of them — the squashed-commit-loses-blame
 *  failure. The boundary is enforced here rather than at the fold so
 *  {@link logStats} reports the same eligibility the fold will act on, including
 *  when a boundary starves both fragments below {@link MIN_FOLD_RUN} and the ops
 *  survive individually. */
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
  let runOrigin: string | undefined;
  // One index past the end closes a run that reaches the tail.
  for (let i = 0; i <= log.ops.length; i++) {
    const op = log.ops[i];
    if (op !== undefined && foldable(op)) {
      if (start < 0) {
        start = i;
        runOrigin = op.origin;
      } else if (op.origin !== runOrigin) {
        // Attribution boundary: this op is foldable, but by someone else. Close
        // the run here (keeping it only if it earned a fold) and start the next
        // one AT this op — no fold may merge two authors' work.
        if (i - start >= MIN_FOLD_RUN) runs.push({ start, end: i });
        start = i;
        runOrigin = op.origin;
      }
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
 *  The two `storesEqual` legs cannot fire with a correct diff — they are the
 *  assertion that keeps "correct" from being an assumption, at the one moment
 *  history is about to be destroyed. The {@link assertPatchValid} leg IS
 *  reachable through the public API: a diff carries the class ids the ops WROTE,
 *  which need not resolve in the table compaction is called with. Replay a fill
 *  of class 2 under a catalog that has since dropped it and the patch is
 *  rejected here rather than becoming an op whose material ids nothing can
 *  resolve — the same fail-closed stance `makeMaskGate` takes for a stored id
 *  missing from the table.
 *
 *  @throws {@link Error} if the patch fails {@link assertPatchValid}, or if
 *    applying it to the pre-state does not reproduce the post-state. Both name
 *    `field compaction:` and the run, so a rejection arriving at an editor's
 *    error surface without a stack frame still says where it came from. */
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
  try {
    assertPatchValid(patch, table);
  } catch (failure) {
    // classOf's "unknown class id" says nothing about compaction. Re-throw with
    // the run that produced it, keeping the original as `cause`.
    const reason = failure instanceof Error ? failure.message : String(failure);
    throw new Error(
      `field compaction: the patch folded from ${span} is not a valid op (${reason}) — nothing was discarded`,
      { cause: failure },
    );
  }
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
    // The cursor makes the scratch carry forward instead of being rebuilt per
    // run. NO op is ever applied twice: every index below `run.end` has now been
    // applied exactly once, in log order, so `scratch` holds precisely what a
    // fresh `slice(0, run.end)` replay would. Purely an optimisation over that
    // slice — it rests on nothing about the effects themselves, and `before` is
    // a true deep copy (copyStore → imagesOf → chunkImage), so the run's writes
    // below cannot reach it.
    cursor = run.end;
    const chunks = diffToPatch(before, scratch);
    verifyFold(before, scratch, chunks, table, run);
    folds.push({ run, chunks });
  }
  return folds;
}

/** The op a fold splices in, carrying the run's own author. `origin` is spread
 *  CONDITIONALLY, never written as `origin: undefined` (the `logApply` idiom): an
 *  explicit undefined is an own property, and `serializeOps` would put an author
 *  on the wire where absence is what "human" is spelled as. */
const foldPatch = (
  id: number,
  chunks: PatchChunk[],
  origin: string | undefined,
): PatchOp =>
  origin === undefined
    ? { id, kind: "patch", chunks }
    : { id, kind: "patch", chunks, origin };

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
 * The rule is strictly CONSERVATIVE, not minimal. A stack of ONLY `ops` entries
 * carries no index at all, and folding below the tail those entries cover is
 * safe — the shape "open a project, edit a little, then compact the loaded
 * prefix" is refused here for simplicity rather than for correctness. The
 * demonstration, and the two real fixes, are in
 * `docs/backlog/engine-architecture/field-log-entries-anchored-by-index.md`.
 *
 * `opts` is REQUIRED here and defaulted on {@link logStats} — deliberate
 * friction, not an oversight. Reading a stat with nothing pinned is a fair
 * question; destroying history with nothing pinned should be something the
 * caller wrote down.
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
 * **A run never spans two authors, and its patch inherits the run's `origin`.** A
 * change of `origin` closes the run and opens the next one there, so the fold of
 * a human's digs is a bare patch (absent = human) and the fold of an agent's is a
 * patch tagged with that agent. Compaction destroys per-op history; an
 * origin-blind fold would destroy the ATTRIBUTION with it — the squashed commit
 * that loses blame. The boundary can leave both fragments under `MIN_FOLD_RUN`,
 * in which case neither folds and every op survives individually; {@link logStats}
 * shares this eligibility, so `compactableOps` reports that as a 0 rather than
 * promising a fold that will not happen.
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
 * @throws {@link Error} if the undo or redo stack is non-empty; if a fold
 *   carries a material class id that `table` does not resolve — reachable
 *   whenever the catalog has shrunk since the ops were written, since a fold
 *   replays the ids the OPS recorded and `applyOp` never resolves them; or if a
 *   fold fails to reproduce its run byte-exactly ({@link verifyFold}). All three
 *   fire before the first write to `log.ops`: a failed compaction leaves the
 *   log, the store and `log.nextId` exactly as they were.
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
    // The run is uniform in origin by construction (eligibleRuns closes a run at
    // any change), so its FIRST op names the whole fold's author. Read here,
    // before any splice: these are indices into the log as it stands now.
    const runOrigin = log.ops[fold.run.start]?.origin;
    const insert: FieldOp[] =
      fold.chunks.length === 0
        ? []
        : [foldPatch(nextId++, fold.chunks, runOrigin)];
    planned.push({ run: fold.run, insert });
  }
  // Back to front: an earlier run's indices are untouched by a later splice.
  planned.reverse();
  for (const { run, insert } of planned)
    spliceOps(log.ops, run.start, run.end - run.start, insert);
  log.nextId = nextId;
  return {
    folded: folds.reduce((n, f) => n + (f.run.end - f.run.start), 0),
  };
}
