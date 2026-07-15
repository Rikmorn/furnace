import {
  chunkKey,
  DENSITY_SCALE,
  getDensity,
  setDensity,
  voxelChunk,
  worldToVoxel,
} from "./chunks.ts";
import type { ChunkKey, DigOp, FieldStore, OpInverse, OpLog } from "./types.ts";

const clampInt8 = (v: number): number =>
  Math.max(-127, Math.min(127, Math.round(v)));

/** Signed distance (m) of the op's shape at a world point: >0 inside (air). */
function shapeSdf(op: DigOp, x: number, y: number, z: number): number {
  const s = op.shape;
  if (s.kind === "sphere") {
    const dx = x - s.center[0];
    const dy = y - s.center[1];
    const dz = z - s.center[2];
    return s.radius - Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return Math.min(
    s.halfExtents[0] - Math.abs(x - s.center[0]),
    s.halfExtents[1] - Math.abs(y - s.center[1]),
    s.halfExtents[2] - Math.abs(z - s.center[2]),
  );
}

/** Axis-aligned world bounds of the op (its declared bounded influence). */
export function opBounds(op: DigOp): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const s = op.shape;
  const r: [number, number, number] =
    s.kind === "sphere"
      ? [s.radius, s.radius, s.radius]
      : [s.halfExtents[0], s.halfExtents[1], s.halfExtents[2]];
  return {
    min: [s.center[0] - r[0], s.center[1] - r[1], s.center[2] - r[2]],
    max: [s.center[0] + r[0], s.center[1] + r[1], s.center[2] + r[2]],
  };
}

/** Applies a dig op: density := max(density, quantize(sdf)) over the op's
 *  bounds (+1 sample margin so the surface crosses cleanly). Returns the
 *  dirty chunk set and the chunk-keyed inverse (pre-image of every touched
 *  chunk — the undo unit). */
export function applyOp(
  store: FieldStore,
  op: DigOp,
): { dirty: Set<ChunkKey>; inverse: OpInverse } {
  const { min, max } = opBounds(op);
  const h = store.cellSize;
  const x0 = worldToVoxel(min[0], h) - 1;
  const y0 = worldToVoxel(min[1], h) - 1;
  const z0 = worldToVoxel(min[2], h) - 1;
  const x1 = worldToVoxel(max[0], h) + 1;
  const y1 = worldToVoxel(max[1], h) + 1;
  const z1 = worldToVoxel(max[2], h) + 1;
  const dirty = new Set<ChunkKey>();
  const inverse: OpInverse = new Map();
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const sdf = shapeSdf(op, x * h, y * h, z * h);
        const d = clampInt8(sdf * DENSITY_SCALE);
        const old = getDensity(store, x, y, z);
        if (d <= old) continue;
        const key = chunkKey(voxelChunk(x), voxelChunk(y), voxelChunk(z));
        if (!inverse.has(key)) {
          const existing = store.chunks.get(key);
          inverse.set(
            key,
            existing ? Int8Array.from(existing) : new Int8Array(0),
          );
        }
        setDensity(store, x, y, z, d);
        dirty.add(key);
      }
  return { dirty, inverse };
}

/** Creates an empty op log. */
export function createOpLog(): OpLog {
  return { ops: [], undoStack: [], redoStack: [], nextId: 1 };
}

/** Applies an op through the log (assigns the id, records the inverse,
 *  clears redo). Returns the dirty chunk set. */
export function logApply(
  store: FieldStore,
  log: OpLog,
  op: DigOp,
): Set<ChunkKey> {
  const stamped: DigOp = { ...op, id: log.nextId++ };
  const { dirty, inverse } = applyOp(store, stamped);
  log.ops.push(stamped);
  log.undoStack.push({ op: stamped, inverse });
  log.redoStack.length = 0;
  return dirty;
}

/** Undoes the last op by restoring its chunk pre-images. Returns the dirty
 *  chunk set (empty when there is nothing to undo). */
export function undo(store: FieldStore, log: OpLog): Set<ChunkKey> {
  const entry = log.undoStack.pop();
  if (entry === undefined) return new Set();
  const dirty = new Set<ChunkKey>();
  for (const [key, pre] of entry.inverse) {
    if (pre.length === 0) store.chunks.delete(key);
    else store.chunks.set(key, Int8Array.from(pre));
    dirty.add(key);
  }
  log.ops.pop();
  log.redoStack.push(entry.op);
  return dirty;
}

/** Redoes the most recently undone op by re-applying it (deterministic). */
export function redo(store: FieldStore, log: OpLog): Set<ChunkKey> {
  const op = log.redoStack.pop();
  if (op === undefined) return new Set();
  const { dirty, inverse } = applyOp(store, op);
  log.ops.push(op);
  log.undoStack.push({ op, inverse });
  return dirty;
}
