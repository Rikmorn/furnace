// packages/core/src/field/snapshots.ts — chunk snapshot records (spec D-F3-7):
// captured on a budget, consumed by the reconfigure restore to start a rebuild
// part-way through the log instead of at op 0.
//
// The whole module is a COST lever. Nothing here changes what the field ends up
// holding — `restoreSeeds` plans a shorter route to bytes the full-prefix replay
// would produce anyway, and refuses to plan at all where the shorter route would
// not be exact.
import { fieldOpChunks, imagesOf, isCellLocalOp } from "./ops.ts";
import type {
  ChunkKey,
  ChunkMaterials,
  ChunkSnapshot,
  FieldOp,
  FieldStore,
  OpLog,
} from "./types.ts";

/** Absent in both channels — the image of a chunk the store does not carry, and
 *  equally the state of EVERY chunk before op 0 (nothing exists yet). Serves as
 *  both the "no such chunk" capture in {@link captureDueSnapshots} and the free
 *  starting point {@link restoreSeeds} falls back to. */
const EMPTY_IMAGE: ChunkSnapshot = { density: null, materials: null };

/** One chunk's two channels as of a log POSITION — the state produced by
 *  `log.ops[0 .. position)`, in the same null-means-absent spelling
 *  {@link ChunkSnapshot} uses. Written by {@link captureDueSnapshots}; read by
 *  the reconfigure restore, which replays forward from it instead of from
 *  pristine.
 *
 *  A record is bound to the log that produced it. Any edit BELOW its `position`
 *  — an undo, a reconfigure's splice, a compaction fold — invalidates it, and
 *  nothing in the record detects that: `position` is a bare number with no tie
 *  to the log it was taken from. **A stale record is used SILENTLY.** The
 *  restore rebuilds the chunk from bytes that log position no longer produces,
 *  and nothing reports it — no throw, no warning, and a reconfigure's `drift`
 *  cannot attribute it, because drift compares against the pre-reconfigure bytes
 *  rather than a from-scratch replay. The owner of the record list is therefore
 *  responsible for dropping records at or after any edit position, the same way
 *  it is responsible for persisting them
 *  (`docs/backlog/engine-architecture/field-snapshot-record-lifecycle.md`). */
export type SnapshotRecord = {
  key: ChunkKey;
  position: number;
  density: Int8Array | null;
  materials: ChunkMaterials | null;
};

/**
 * The adaptive snapshot sweep (spec D-F3-7): captures the CURRENT state of every
 * chunk whose replay tail — the ops written since that chunk's newest record —
 * has grown past `tailBudgetOps`, and returns those captures. A chunk nobody has
 * touched since its last record is never re-captured, and a chunk with no record
 * at all counts its tail from the start of the log.
 *
 * A pure QUERY over `store`, `log` and `records`: it mutates none of them, and
 * in particular does not append to `records`. The caller decides where the list
 * lives (memory, a sibling file per D-F3-7), how it is merged, and when it is
 * pruned. Every record in one sweep carries the same `position` —
 * `log.ops.length`, the state the store is in right now.
 *
 * **The captured channels are COPIES, not views** (via `imagesOf`, the same
 * clone rules undo images use). A record does not track the chunk it came from:
 * later edits to that chunk leave it describing the moment it was taken, which
 * is exactly what makes it usable as a replay starting point — and exactly why a
 * record outliving an edit BELOW its position is silently wrong
 * ({@link SnapshotRecord}).
 *
 * The tail is counted from {@link fieldOpChunks}, which over-approximates a
 * brush op's written chunks, so a chunk can be snapshotted slightly early. That
 * is the safe direction: a record is never captured late.
 *
 * @throws {@link Error} if `tailBudgetOps` is not a positive integer — a zero or
 *   fractional budget would snapshot every chunk on every sweep.
 */
export function captureDueSnapshots(
  store: FieldStore,
  log: OpLog,
  records: readonly SnapshotRecord[],
  tailBudgetOps: number,
): SnapshotRecord[] {
  if (!Number.isInteger(tailBudgetOps) || tailBudgetOps < 1)
    throw new Error(
      `captureDueSnapshots: tail budget must be a positive integer (got ${tailBudgetOps})`,
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
 * `pos` is a log POSITION and must satisfy `0 <= pos <= log.ops.length`; it is
 * trusted, not checked (the one caller derives it from a verified span layout).
 * Out of range it does not throw — it silently plans against a window that is
 * empty or clamped by `Array.prototype.slice`.
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
