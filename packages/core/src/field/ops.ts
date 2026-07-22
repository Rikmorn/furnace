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
  LogEntry,
  MaterializedSelection,
  MaterialTable,
  OpInverse,
  OpLog,
  SmoothParams,
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

/** Per-application ceiling on {@link SmoothParams} `strength` (int8 units).
 *  {@link assertOpValid} rejects ops beyond it. Exported so tool chassis / UI
 *  can surface the valid range `[1, SMOOTH_MAX_STRENGTH]` without hardcoding
 *  it. */
export const SMOOTH_MAX_STRENGTH = 64;
/** Per-application ceiling on {@link SmoothParams} `iterations`.
 *  {@link assertOpValid} rejects ops beyond it. Exported so tool chassis / UI
 *  can surface the valid range `[1, SMOOTH_MAX_ITERATIONS]` without
 *  hardcoding it. */
export const SMOOTH_MAX_ITERATIONS = 4;

/** Smooth leg of {@link assertOpValid}: params must be PRESENT (an op record
 *  is explicit — validation never defaults them), with integer strength in
 *  [1, SMOOTH_MAX_STRENGTH], integer iterations in
 *  [1, SMOOTH_MAX_ITERATIONS], and a known mode (op records may arrive from
 *  parsed JSON, so the mode is checked at runtime too). */
function assertSmoothValid(p: SmoothParams | undefined): void {
  if (p === undefined)
    throw new Error("field op: smooth effect requires smooth params");
  if (
    !Number.isInteger(p.strength) ||
    p.strength < 1 ||
    p.strength > SMOOTH_MAX_STRENGTH
  )
    throw new Error(
      `field op: smooth strength must be an integer in [1, ${SMOOTH_MAX_STRENGTH}]`,
    );
  if (
    !Number.isInteger(p.iterations) ||
    p.iterations < 1 ||
    p.iterations > SMOOTH_MAX_ITERATIONS
  )
    throw new Error(
      `field op: smooth iterations must be an integer in [1, ${SMOOTH_MAX_ITERATIONS}]`,
    );
  if (p.mode !== "both" && p.mode !== "erode" && p.mode !== "fill")
    throw new Error(`field op: unknown smooth mode "${String(p.mode)}"`);
}

/**
 * Setup-loud per-op validation — also the replay / LLM-stream guard. Validates
 * the mask when present (class ids must exist in the table; an embedded
 * selection spec must be well-formed, so a bad op never enters the log), then
 * `hollow` when present (fill-effect only — every other effect rejects it —
 * and a positive thickness in metres). A smooth op then validates its
 * {@link SmoothParams} (present, integer strength 1..64, integer iterations
 * 1..4, known mode) and SKIPS the material leg — smooth never writes the
 * material channel, so `material` is ignored and not validated. Every other
 * effect validates the material: the class id must exist in the table, and
 * kit-class writes must be lattice-snapped boxes (kit pieces stay grid-locked
 * to the 0.5 m built-kit lattice) whose `hollow`, when present, is a multiple
 * of 0.5 m — the shell's INNER faces must land on lattice planes too.
 * Material-free, mask-free ops (plain dig) are a no-op.
 *
 * @throws {@link Error} if a class id (material, class mask, or embedded
 *   flood-material spec) is unknown, an embedded selection spec has a
 *   non-integer flood seed or an out-of-range budget, `hollow` rides a
 *   non-fill effect or is not a positive thickness, a smooth op's params are
 *   absent or out of range, or a kit-class write is not an
 *   axis-lattice-aligned box (with a lattice-multiple `hollow` when present).
 */
export function assertOpValid(op: BrushOp, table: MaterialTable): void {
  assertMaskValid(op.mask, table);
  if (op.hollow !== undefined) {
    if (op.effect !== "fill")
      throw new Error("field op: hollow is a fill-effect parameter");
    if (!(op.hollow > 0))
      throw new Error("field op: hollow must be a positive thickness (metres)");
  }
  if (op.effect === "smooth") {
    assertSmoothValid(op.smooth);
    return;
  }
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
  if (op.hollow !== undefined && !onLattice(op.hollow))
    throw new Error(
      "field op: kit-class hollow must be a multiple of 0.5 m (the shell's inner faces stay on the lattice)",
    );
}

/** Sample-loop bounds of an op: its world bounds in samples, +1 margin per
 *  side so the surface crosses cleanly — the one margin convention shared by
 *  every effect branch. */
function opSampleBounds(
  op: BrushOp,
  h: number,
): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } {
  const { min, max } = opBounds(op);
  return {
    x0: worldToVoxel(min[0], h) - 1,
    y0: worldToVoxel(min[1], h) - 1,
    z0: worldToVoxel(min[2], h) - 1,
    x1: worldToVoxel(max[0], h) + 1,
    y1: worldToVoxel(max[1], h) + 1,
    z1: worldToVoxel(max[2], h) + 1,
  };
}

/** The per-sample mask predicate shared by every effect branch; `d` is the
 *  cell's pre-write density. */
type MaskGate = (x: number, y: number, z: number, d: number) => boolean;

/** Builds the mask gate for one application. `sel` is the op's selection mask
 *  materialized ONCE against pre-op state (null for every other mask kind), so
 *  a replayed op re-selects identically. A cell whose STORED material id is
 *  missing from `table` fails CLOSED (reachable after a catalog swap to a
 *  smaller table): the cell is skipped rather than throwing mid-application —
 *  a mid-loop throw would discard the local inverse and leave a partial
 *  mutation untracked by undo. Setup-loud id validation lives in
 *  assertMaskValid (direct table indexing); application stays total
 *  (runtime-quiet). */
function makeMaskGate(
  store: FieldStore,
  table: MaterialTable,
  mask: BrushMask | undefined,
  sel: MaterializedSelection | null,
): MaskGate {
  return (x, y, z, d) => {
    if (mask === undefined) return true;
    if (mask.kind === "solid-only") return d < 0;
    if (mask.kind === "selection")
      return sel !== null && selectionHas(sel, x, y, z, store.cellSize);
    const cls = table.classes[getMaterial(store, x, y, z)];
    if (cls === undefined) return false;
    if (mask.kind === "organic-only") return cls.kind === "organic";
    if (mask.kind === "kit-only") return cls.kind === "kit";
    return cls.id === mask.classId;
  };
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
 *  ambient rock the fill leaves unchanged); a `hollow` fill SKIPS samples
 *  deeper than `hollow` metres inside the shape — non-destructive: the deep
 *  interior is never written, so existing air stays air and existing rock
 *  stays rock ({@link BrushOp}.hollow). `paint` retints solid cells inside
 *  the shape, `smooth` relaxes the density channel toward its local 3³ mean
 *  inside the shape (density only — never the material channel; see
 *  {@link SmoothParams}). `op.mask` filters cells cross-cuttingly after each
 *  effect's own guards — `table` resolves the class-kind masks (a cell whose
 *  stored material id is missing from `table` fails the mask CLOSED — skipped,
 *  never a mid-application throw), and a selection mask is materialized ONCE
 *  against pre-op state (before smooth's first iteration), so a replayed op
 *  re-selects identically. Returns the dirty chunk set and the two-channel
 *  inverse (the undo unit).
 *
 *  @throws {@link Error} if a mask embeds an invalid selection spec or a
 *    smooth op lacks its `smooth` params ({@link logApply} validates first via
 *    {@link assertOpValid}, so logged ops never throw here). */
export function applyOp(
  store: FieldStore,
  op: BrushOp,
  table: MaterialTable,
): { dirty: Set<ChunkKey>; inverse: OpInverse } {
  const h = store.cellSize;
  const { x0, y0, z0, x1, y1, z1 } = opSampleBounds(op, h);
  const dirty = new Set<ChunkKey>();
  const inverse: OpInverse = new Map();
  const mat = op.material ?? MAT_ROCK;
  // Materialize a selection mask ONCE, before any write — the flood evaluates
  // against pre-op state, so replay re-selects the same cells deterministically.
  const sel =
    op.mask?.kind === "selection"
      ? materializeSelection(store, op.mask.selection)
      : null;
  const maskPasses = makeMaskGate(store, table, op.mask, sel);
  if (op.effect === "smooth") {
    applySmooth(store, op, dirty, inverse, maskPasses);
    return { dirty, inverse };
  }
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
          // hollow: shell-band fill — deep-interior samples (beyond `hollow`
          // of the surface) are skipped outright, NEVER dug (non-destructive)
          if (op.hollow !== undefined && sdf > op.hollow) continue;
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
        } else if (op.effect === "paint") {
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

/** 3³ box-blur kernel size (samples per neighborhood). */
const NEIGHBORHOOD = 27;

/** Smooth branch of {@link applyOp}: a double-buffered 3³ box blur of the
 *  density channel over the shape's interior (`sdf > 0`; the +1-margin ring is
 *  read, never written). Each iteration refills one region+margin snapshot
 *  buffer and reads from it while writes go to the store — order-independent
 *  within an iteration (the determinism-friendly convolution shape). Kernel
 *  reads never leave the buffered region: writes are interior-only
 *  ([x0+1, x1−1] per axis), so every ±1 kernel reach lands inside [x0, x1].
 *  The per-sample delta is clamped to ±strength, scaled by an SDF falloff
 *  toward the shape boundary (the thin-wall-erosion guard); `erode` keeps only
 *  density-raising deltas (toward air), `fill` only density-lowering ones.
 *  Writes quantize via clampInt8's round-to-nearest — the store-wide
 *  convention (never Int8Array truncation), which preserves the mode
 *  monotonicity and the integer strength bound exactly. NEVER touches the
 *  material channel. */
function applySmooth(
  store: FieldStore,
  op: BrushOp,
  dirty: Set<ChunkKey>,
  inverse: OpInverse,
  maskPasses: MaskGate,
): void {
  const p = op.smooth;
  if (p === undefined)
    throw new Error("field op: smooth effect requires smooth params");
  const h = store.cellSize;
  const { x0, y0, z0, x1, y1, z1 } = opSampleBounds(op, h);
  const nx = x1 - x0 + 1;
  const ny = y1 - y0 + 1;
  const nz = z1 - z0 + 1;
  // Falloff reference: the shape's smallest half-dimension, so cap → 0 at the
  // boundary and reaches full strength only in the deep interior.
  const sdfRef =
    op.shape.kind === "sphere"
      ? op.shape.radius
      : Math.min(
          op.shape.halfExtents[0],
          op.shape.halfExtents[1],
          op.shape.halfExtents[2],
        );
  // One buffer for all iterations (refilled per iteration). Every read the
  // write loop performs stays inside it: writes span [x0+1, x1−1] per axis, so
  // kernel reach ±1 lands in [x0, x1] exactly.
  const buf = new Int8Array(nx * ny * nz);
  const at = (x: number, y: number, z: number): number =>
    buf[x - x0 + nx * (y - y0 + ny * (z - z0))] as number;
  for (let iter = 0; iter < p.iterations; iter++) {
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          buf[x - x0 + nx * (y - y0 + ny * (z - z0))] = getDensity(
            store,
            x,
            y,
            z,
          );
    for (let z = z0 + 1; z <= z1 - 1; z++)
      for (let y = y0 + 1; y <= y1 - 1; y++)
        for (let x = x0 + 1; x <= x1 - 1; x++) {
          const sdf = shapeSdf(op.shape, x * h, y * h, z * h);
          if (sdf <= 0) continue;
          const cur = at(x, y, z);
          if (!maskPasses(x, y, z, cur)) continue;
          let sum = 0;
          for (let dz = -1; dz <= 1; dz++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++)
                sum += at(x + dx, y + dy, z + dz);
          let delta = sum / NEIGHBORHOOD - cur;
          if (p.mode === "erode") delta = Math.max(0, delta);
          if (p.mode === "fill") delta = Math.min(0, delta);
          const cap = p.strength * Math.min(1, sdf / sdfRef);
          delta = Math.max(-cap, Math.min(cap, delta));
          const nd = clampInt8(cur + delta);
          if (nd === cur) continue;
          const key = chunkKey(voxelChunk(x), voxelChunk(y), voxelChunk(z));
          snapshot(store, inverse, key);
          setDensity(store, x, y, z, nd);
          dirty.add(key);
        }
  }
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
  log.undoStack.push({ kind: "ops", ops: [stamped], inverse });
  log.redoStack.length = 0;
  return dirty;
}

/** **Escape hatch.** Writes chunk images straight into the store, BOTH channels
 *  per key: a null channel deletes the store's entry (the chunk was unallocated
 *  / had no material record when the image was taken), a non-null one is copied
 *  in. Mutates `store`; the images are left untouched, so the same map can be
 *  restored repeatedly (undo → redo → undo).
 *
 *  There is NO log coupling: this writes bytes and nothing else. The CALLER
 *  owns keeping `log` consistent with what it wrote — restoring images without
 *  the matching `log.ops` change desynchronises the store from its replay
 *  history, and nothing downstream detects it (a re-bake from the log silently
 *  produces different bytes). The managed path is {@link undo}/{@link redo};
 *  reach for this only when driving the store and the log together yourself.
 *
 *  @returns the keys the restore touched — the caller's dirty set. */
export function restoreImages(
  store: FieldStore,
  images: OpInverse,
): Set<ChunkKey> {
  const dirty = new Set<ChunkKey>();
  for (const [key, pre] of images) {
    if (pre.density === null) store.chunks.delete(key);
    else store.chunks.set(key, Int8Array.from(pre.density));
    if (pre.materials === null) store.materials.delete(key);
    else store.materials.set(key, cloneChunkMaterials(pre.materials));
    dirty.add(key);
  }
  return dirty;
}

/** `Array.prototype.splice` without arguments-spread: `ops.splice(at, n,
 *  ...insert)` hits JS-engine argument-count ceilings (~65k in JSC) on the
 *  mega spans a generator can emit. Mutates `ops` in place.
 *
 *  Cold path (at most one call per user gesture — undo/redo, reconfigure,
 *  compaction), so the span is VALIDATED, not trusted: callers derive
 *  `at`/`deleteCount` from stored values like an entity's `opSpan`, and a span
 *  left stale by an earlier edit is exactly how an out-of-range value arises.
 *  Unlike `Array.prototype.splice` there is no clamping and no count-from-the-
 *  end: every out-of-range span throws rather than silently mangling the log
 *  (untrapped, a negative `deleteCount` DUPLICATES ops — same object, same id,
 *  twice in the log — which survives into replay, serialization and bake).
 *
 *  @throws {@link Error} if `at` or `deleteCount` is not a non-negative
 *    integer, or `[at, at + deleteCount)` runs past the end of `ops`. */
export function spliceOps(
  ops: FieldOp[],
  at: number,
  deleteCount: number,
  insert: FieldOp[],
): void {
  const spanInRange =
    Number.isInteger(at) &&
    Number.isInteger(deleteCount) &&
    at >= 0 &&
    deleteCount >= 0 &&
    at + deleteCount <= ops.length;
  if (!spanInRange)
    throw new Error(
      `spliceOps: span [${at}, ${at + deleteCount}) out of range for ${ops.length} ops`,
    );
  const tail = ops.slice(at + deleteCount);
  ops.length = at;
  for (const op of insert) ops.push(op);
  for (const op of tail) ops.push(op);
}

/** Undoes the last log entry and moves it to the redo stack. An `ops` entry
 *  reverts its WHOLE op list (one ⌘Z per commit) by restoring the list's chunk
 *  pre-images and peeling the tail; a `splice` entry puts the removed span back
 *  at its index and restores the affected chunks' `before` images (bytes — the
 *  span is never re-executed); an `entity-update` entry swaps the entity op's
 *  previous record back in and touches no chunks. Returns the dirty chunk set
 *  (empty when there is nothing to undo or the entry touched no chunks). */
export function undo(store: FieldStore, log: OpLog): Set<ChunkKey> {
  const entry = log.undoStack.at(-1);
  if (entry === undefined) return new Set();
  // Revert first, move the entry second: spliceOps validates before it writes,
  // so a malformed splice entry throws with both stacks and the store untouched
  // rather than stranding an entry on the wrong stack.
  const dirty = revertEntry(store, log, entry);
  log.undoStack.pop();
  // ONE transfer per pop, in ONE place. The WHOLE entry moves across — the
  // deliberate price of symmetric stacks (splice/entity-update need their
  // records to replay forward). An `ops` entry's inverse therefore sits unread
  // on the redo stack until the next mutation clears it: peak memory is
  // unchanged (the undo stack already held it), but memory that used to be
  // released at undo no longer is.
  log.redoStack.push(entry);
  return dirty;
}

/** Reverts one entry off the store + `log.ops`, leaving the stacks to
 *  {@link undo}. Mirror of {@link replayEntry}; every kind is total, so a new
 *  {@link LogEntry} member fails to type-check until it is handled here. */
function revertEntry(
  store: FieldStore,
  log: OpLog,
  entry: LogEntry,
): Set<ChunkKey> {
  switch (entry.kind) {
    case "ops":
      log.ops.length -= entry.ops.length;
      return restoreImages(store, entry.inverse);
    case "splice":
      spliceOps(log.ops, entry.at, entry.inserted.length, entry.removed);
      return restoreImages(store, entry.before);
    case "entity-update":
      log.ops[entry.opIndex] = entry.before;
      return new Set();
  }
}

/** Redoes the most recently undone entry and moves it — or, for `ops`, a
 *  freshly captured equivalent — back to the undo stack. An `ops` entry is
 *  re-applied by re-executing its BRUSH members in order (entity ops never
 *  touch the field) — deterministic, and already validated at first apply, so
 *  no re-validation; `table` resolves class-kind masks during re-application.
 *  `splice` and `entity-update` entries are replayed from their records
 *  instead: the span goes back in at its index with the `after` images restored
 *  byte-for-byte, and the entity record is swapped forward again. */
export function redo(
  store: FieldStore,
  log: OpLog,
  table: MaterialTable,
): Set<ChunkKey> {
  const popped = log.redoStack.at(-1);
  if (popped === undefined) return new Set();
  // Replay first, move the entry second — same reason as undo.
  const replayed = replayEntry(store, log, popped, table);
  log.redoStack.pop();
  // ONE transfer per pop, in ONE place: a future entry kind cannot type-check
  // its way into silently losing a redo step.
  log.undoStack.push(replayed.entry);
  return replayed.dirty;
}

/** Replays one entry forward onto the store + `log.ops`, leaving the stacks to
 *  {@link redo}. Returns the entry {@link redo} must push onto the undo stack:
 *  the SAME object for the byte-restoring kinds, and for `ops` a fresh entry
 *  over the same op list, because re-execution recaptures the inverse against
 *  current state. */
function replayEntry(
  store: FieldStore,
  log: OpLog,
  entry: LogEntry,
  table: MaterialTable,
): { entry: LogEntry; dirty: Set<ChunkKey> } {
  switch (entry.kind) {
    case "ops": {
      const { dirty, inverse } = reapplyOps(store, log, entry.ops, table);
      return { entry: { kind: "ops", ops: entry.ops, inverse }, dirty };
    }
    case "splice":
      spliceOps(log.ops, entry.at, entry.removed.length, entry.inserted);
      return { entry, dirty: restoreImages(store, entry.after) };
    case "entity-update":
      log.ops[entry.opIndex] = entry.after;
      return { entry, dirty: new Set() };
  }
}

/** Re-executes an undone op list and re-appends it to the tail of `log.ops`.
 *  Per-op inverses merge first-touch-wins, so the returned inverse holds each
 *  chunk's earliest pre-image (the pre-list state). */
function reapplyOps(
  store: FieldStore,
  log: OpLog,
  ops: FieldOp[],
  table: MaterialTable,
): { dirty: Set<ChunkKey>; inverse: OpInverse } {
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
  return { dirty, inverse };
}
