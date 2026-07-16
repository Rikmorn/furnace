import {
  chunkKey,
  DENSITY_SCALE,
  getDensity,
  setDensity,
  voxelChunk,
  worldToVoxel,
} from "./chunks.ts";
import {
  classOf,
  cloneChunkMaterials,
  getMaterial,
  setMaterial,
} from "./materials.ts";
import {
  assertSelectionSpecValid,
  materializeSelection,
  selectionHas,
} from "./selection.ts";
import type {
  BrushMask,
  BrushOp,
  BrushShape,
  ChunkKey,
  FieldOp,
  FieldStore,
  MaterialTable,
  OpInverse,
  OpLog,
} from "./types.ts";
import { MAT_ROCK } from "./types.ts";

const clampInt8 = (v: number): number =>
  Math.max(-127, Math.min(127, Math.round(v)));

const LATTICE = 0.5; // kit pieces stay grid-locked to the 0.5 m built-kit lattice
const EPS = 1e-6;
const onLattice = (v: number): boolean =>
  Math.abs(v / LATTICE - Math.round(v / LATTICE)) < EPS;

/** Signed distance (m) of a brush shape at a world point: >0 inside (air). */
function shapeSdf(s: BrushShape, x: number, y: number, z: number): number {
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
export function opBounds(op: BrushOp): {
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

/** Mask leg of {@link assertOpValid}: class-mask ids (and an embedded
 *  flood-material spec's class id) must resolve in the table; embedded
 *  selection specs must pass assertSelectionSpecValid. Throws carry "field op
 *  mask" context so a bad mask id is distinguishable from a bad
 *  `op.material` (whose classOf throw says "material table"). */
function assertMaskValid(
  mask: BrushMask | undefined,
  table: MaterialTable,
): void {
  if (mask === undefined) return;
  if (mask.kind === "class") {
    if (table.classes[mask.classId] === undefined)
      throw new Error(`field op mask: unknown class id ${mask.classId}`);
    return;
  }
  if (mask.kind === "selection") {
    assertSelectionSpecValid(mask.selection);
    if (
      mask.selection.kind === "flood-material" &&
      table.classes[mask.selection.classId] === undefined
    )
      throw new Error(
        `field op mask: unknown selection class id ${mask.selection.classId}`,
      );
  }
}

/**
 * Setup-loud per-op validation — also the replay / LLM-stream guard. Validates
 * the mask when present (class ids must exist in the table; an embedded
 * selection spec must be well-formed, so a bad op never enters the log), then
 * the material: the class id must exist in the table, and kit-class writes
 * must be lattice-snapped boxes (kit pieces stay grid-locked to the 0.5 m
 * built-kit lattice). Material-free, mask-free ops (plain dig) are a no-op.
 *
 * @throws {@link Error} if a class id (material, class mask, or embedded
 *   flood-material spec) is unknown, an embedded selection spec has a
 *   non-integer flood seed or an out-of-range budget, or a kit-class write is
 *   not an axis-lattice-aligned box.
 */
export function assertOpValid(op: BrushOp, table: MaterialTable): void {
  assertMaskValid(op.mask, table);
  if (op.material === undefined) return;
  const cls = classOf(table, op.material); // throws "unknown class id" (setup-loud)
  if (cls.kind !== "kit") return;
  if (op.shape.kind !== "box")
    throw new Error(
      "field op: kit-class writes require a box shape (kit stays grid-locked)",
    );
  const { center, halfExtents } = op.shape;
  for (let a = 0; a < 3; a++) {
    const lo = (center[a] as number) - (halfExtents[a] as number);
    const hi = (center[a] as number) + (halfExtents[a] as number);
    if (!onLattice(lo) || !onLattice(hi))
      throw new Error("field op: kit-class box must sit on the 0.5 m lattice");
  }
}

/** Snapshots a chunk's BOTH channels into the inverse once, before the op's
 *  first write to that chunk (idempotent per key). */
function snapshot(store: FieldStore, inverse: OpInverse, key: ChunkKey): void {
  if (inverse.has(key)) return;
  const density = store.chunks.get(key);
  const materials = store.materials.get(key);
  inverse.set(key, {
    density: density ? Int8Array.from(density) : null,
    materials: materials ? cloneChunkMaterials(materials) : null,
  });
}

/** Narrows a {@link FieldOp} to a brush op — the only member {@link applyOp}
 *  executes; entity ops record provenance and never touch the field. */
export const isBrushOp = (op: FieldOp): op is BrushOp => op.kind === "brush";

/** Applies a brush op over its bounds (+1 sample margin so the surface crosses
 *  cleanly). `dig` opens air (`density := max(density, quantize(sdf))`), `fill`
 *  solidifies (`density := min(density, quantize(-sdf))`) AND writes the
 *  material on solid interior cells (cells solid after the fill — including
 *  ambient rock the fill leaves unchanged), `paint` retints solid cells inside
 *  the shape. `op.mask` filters cells cross-cuttingly after each effect's own
 *  guards — `table` resolves the class-kind masks (a cell whose stored
 *  material id is missing from `table` fails the mask CLOSED — skipped, never
 *  a mid-application throw), and a selection mask is materialized ONCE against
 *  pre-op state, so a replayed op re-selects identically. Returns the dirty
 *  chunk set and the two-channel inverse (the undo unit).
 *
 *  @throws {@link Error} if a mask embeds an invalid selection spec
 *    ({@link logApply} validates first via {@link assertOpValid}, so logged
 *    ops never throw here). */
export function applyOp(
  store: FieldStore,
  op: BrushOp,
  table: MaterialTable,
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
  const mat = op.material ?? MAT_ROCK;
  // Materialize a selection mask ONCE, before any write — the flood evaluates
  // against pre-op state, so replay re-selects the same cells deterministically.
  const sel =
    op.mask?.kind === "selection"
      ? materializeSelection(store, op.mask.selection)
      : null;
  // One mask gate shared by every effect branch; `d` is the cell's pre-write
  // density.
  const maskPasses = (x: number, y: number, z: number, d: number): boolean => {
    const m = op.mask;
    if (m === undefined) return true;
    if (m.kind === "solid-only") return d < 0;
    if (m.kind === "selection")
      return sel !== null && selectionHas(sel, x, y, z, store.cellSize);
    // Fail CLOSED on a cell whose STORED material id is missing from `table`
    // (reachable after a catalog swap to a smaller table): skip the cell
    // rather than throw mid-application — a mid-loop throw would discard the
    // local inverse and leave a partial mutation untracked by undo. Setup-loud
    // classOf stays in assertMaskValid; applyOp is total (runtime-quiet).
    const cls = table.classes[getMaterial(store, x, y, z)];
    if (cls === undefined) return false;
    if (m.kind === "organic-only") return cls.kind === "organic";
    if (m.kind === "kit-only") return cls.kind === "kit";
    return cls.id === m.classId;
  };
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const sdf = shapeSdf(op.shape, x * h, y * h, z * h);
        const d = getDensity(store, x, y, z);
        if (op.effect === "dig") {
          const nd = clampInt8(sdf * DENSITY_SCALE);
          if (nd <= d) continue;
          if (!maskPasses(x, y, z, d)) continue;
          const key = chunkKey(voxelChunk(x), voxelChunk(y), voxelChunk(z));
          snapshot(store, inverse, key);
          setDensity(store, x, y, z, nd);
          dirty.add(key);
        } else if (op.effect === "fill") {
          const nd = clampInt8(-sdf * DENSITY_SCALE);
          const writeD = nd < d;
          const solidAfter = Math.min(d, nd) < 0;
          const writeM =
            sdf > 0 && solidAfter && getMaterial(store, x, y, z) !== mat;
          if (!writeD && !writeM) continue;
          if (!maskPasses(x, y, z, d)) continue;
          const key = chunkKey(voxelChunk(x), voxelChunk(y), voxelChunk(z));
          snapshot(store, inverse, key);
          if (writeD) setDensity(store, x, y, z, nd);
          if (writeM) setMaterial(store, x, y, z, mat);
          dirty.add(key);
        } else {
          // paint: material only, on solid cells inside the shape (no-op on air)
          if (sdf <= 0 || d >= 0) continue;
          if (op.material === undefined) continue;
          if (getMaterial(store, x, y, z) === op.material) continue;
          if (!maskPasses(x, y, z, d)) continue;
          const key = chunkKey(voxelChunk(x), voxelChunk(y), voxelChunk(z));
          snapshot(store, inverse, key);
          setMaterial(store, x, y, z, op.material);
          dirty.add(key);
        }
      }
  return { dirty, inverse };
}

/** Creates an empty op log. */
export function createOpLog(): OpLog {
  return { ops: [], undoStack: [], redoStack: [], nextId: 1 };
}

/** Validates then applies an op through the log (assigns the id, records the
 *  two-channel inverse, clears redo). Returns the dirty chunk set. */
export function logApply(
  store: FieldStore,
  log: OpLog,
  op: BrushOp,
  table: MaterialTable,
): Set<ChunkKey> {
  assertOpValid(op, table);
  const stamped: BrushOp = { ...op, id: log.nextId++ };
  const { dirty, inverse } = applyOp(store, stamped, table);
  log.ops.push(stamped);
  log.undoStack.push({ ops: [stamped], inverse });
  log.redoStack.length = 0;
  return dirty;
}

/** Undoes the last undo entry — its WHOLE op list (one ⌘Z per commit) — by
 *  restoring both channels of its chunk pre-images (or deleting the entry when
 *  a channel's pre-image was null). Returns the dirty chunk set (empty when
 *  there is nothing to undo or the entry touched no chunks). */
export function undo(store: FieldStore, log: OpLog): Set<ChunkKey> {
  const entry = log.undoStack.pop();
  if (entry === undefined) return new Set();
  const dirty = new Set<ChunkKey>();
  for (const [key, pre] of entry.inverse) {
    if (pre.density === null) store.chunks.delete(key);
    else store.chunks.set(key, Int8Array.from(pre.density));
    if (pre.materials === null) store.materials.delete(key);
    else store.materials.set(key, cloneChunkMaterials(pre.materials));
    dirty.add(key);
  }
  log.ops.length -= entry.ops.length;
  log.redoStack.push(entry.ops);
  return dirty;
}

/** Redoes the most recently undone op list by re-applying its BRUSH members in
 *  order (entity ops never touch the field) — deterministic; already validated
 *  at first apply, so no re-validation. `table` resolves class-kind masks
 *  during re-application. Per-op inverses merge first-touch-wins (the earliest
 *  pre-image of each chunk is the entry's pre-image). */
export function redo(
  store: FieldStore,
  log: OpLog,
  table: MaterialTable,
): Set<ChunkKey> {
  const ops = log.redoStack.pop();
  if (ops === undefined) return new Set();
  const dirty = new Set<ChunkKey>();
  const inverse: OpInverse = new Map();
  for (const op of ops) {
    if (!isBrushOp(op)) continue;
    const r = applyOp(store, op, table);
    for (const key of r.dirty) dirty.add(key);
    for (const [key, pre] of r.inverse)
      if (!inverse.has(key)) inverse.set(key, pre);
  }
  // Loop push, not spread: spread hits JS-engine argument-count ceilings
  // (~65k in JSC) on mega commit spans.
  for (const op of ops) log.ops.push(op);
  log.undoStack.push({ ops, inverse });
  return dirty;
}
