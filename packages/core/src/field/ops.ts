import {
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  clampInt8,
  DENSITY_SCALE,
  getDensity,
  parseChunkKey,
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
  ChunkSnapshot,
  FieldOp,
  FieldStore,
  LogEntry,
  MaterializedSelection,
  MaterialTable,
  OpInverse,
  OpLog,
  PatchChunk,
  PatchOp,
  PlacementRecord,
  SmoothParams,
} from "./types.ts";
import { MAT_ROCK } from "./types.ts";

const LATTICE = 0.5; // kit pieces stay grid-locked to the 0.5 m built-kit lattice
const EPS = 1e-6;
const onLattice = (v: number): boolean =>
  Math.abs(v / LATTICE - Math.round(v / LATTICE)) < EPS;

/** Signed distance (m) of a brush shape at a world point: >0 inside (air).
 *  The capsule leg is the standard point-to-SEGMENT distance: project onto the
 *  axis, CLAMP the parameter to [0, 1] (which is what makes the endcaps
 *  hemispherical rather than an infinite cylinder), then subtract the radius.
 *  Squared-form `Math.sqrt`, never `Math.hypot` — the sphere leg above already
 *  spells it this way, and (INFERRED, not measured here) hypot's specified
 *  overflow/underflow scaling is cost this never needs: world coords are
 *  metres. A degenerate axis (`a === b`, `ab2 === 0`) takes t = 0 and reduces
 *  to the sphere at `a`. */
function shapeSdf(s: BrushShape, x: number, y: number, z: number): number {
  if (s.kind === "sphere") {
    const dx = x - s.center[0];
    const dy = y - s.center[1];
    const dz = z - s.center[2];
    return s.radius - Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  if (s.kind === "capsule") {
    const abx = s.b[0] - s.a[0];
    const aby = s.b[1] - s.a[1];
    const abz = s.b[2] - s.a[2];
    const apx = x - s.a[0];
    const apy = y - s.a[1];
    const apz = z - s.a[2];
    const ab2 = abx * abx + aby * aby + abz * abz;
    const t =
      ab2 === 0
        ? 0
        : Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2));
    const dx = apx - abx * t;
    const dy = apy - aby * t;
    const dz = apz - abz * t;
    return s.radius - Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return Math.min(
    s.halfExtents[0] - Math.abs(x - s.center[0]),
    s.halfExtents[1] - Math.abs(y - s.center[1]),
    s.halfExtents[2] - Math.abs(z - s.center[2]),
  );
}

/** Axis-aligned world bounds of the op (its declared bounded influence). A
 *  capsule's are the AABB of BOTH endpoints grown by the radius, which is
 *  EXACT — the Minkowski sum of the segment and the ball of that radius, and
 *  the segment's own AABB is the hull of its endpoints. What changes with the
 *  sweep direction is how much of the box the capsule FILLS (a diagonal sweep
 *  fills less), not whether the box is tight; that is the same relationship a
 *  sphere has with its cube, and it is not a bounds bug. */
export function opBounds(op: BrushOp): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const s = op.shape;
  if (s.kind === "capsule") {
    const r = s.radius;
    return {
      min: [
        Math.min(s.a[0], s.b[0]) - r,
        Math.min(s.a[1], s.b[1]) - r,
        Math.min(s.a[2], s.b[2]) - r,
      ],
      max: [
        Math.max(s.a[0], s.b[0]) + r,
        Math.max(s.a[1], s.b[1]) + r,
        Math.max(s.a[2], s.b[2]) + r,
      ],
    };
  }
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

/** Capsule leg of {@link assertOpValid}: finite endpoints and a finite positive
 *  radius. The capsule is the first shape whose numbers come from TWO
 *  independent screen-space raycasts (the editor's two-click gesture), and both
 *  failure modes were MEASURED on the applier before this guard existed: a NaN
 *  endpoint makes {@link opSampleBounds} NaN, so the sample loop's `z <= z1` is
 *  false at once and the op logs, burns an id and writes nothing — a silent
 *  no-op ⌘Z (measured: dirty 0, 0.4 ms); an INFINITE radius makes those bounds
 *  ±Infinity, and `z++` off −Infinity never advances — `applyOp` was still
 *  running at an 8 s cutoff.
 *
 *  Sphere `radius` and box `halfExtents` are NOT validated here. That is a
 *  pre-existing gap, not a judgement that they are safe — the same two failures
 *  reach them (backlog `field-brush-shape-numeric-validation`). This leg is
 *  scoped to the shape this task adds.
 *
 *  @throws {@link Error} if a capsule endpoint is non-finite, or its radius is
 *    not a finite positive length. */
function assertCapsuleValid(shape: BrushShape): void {
  if (shape.kind !== "capsule") return;
  const finite = (v: [number, number, number]): boolean =>
    v.every((n) => Number.isFinite(n));
  if (!finite(shape.a) || !finite(shape.b))
    throw new Error("field op: capsule endpoints must be three finite numbers");
  if (!Number.isFinite(shape.radius) || shape.radius <= 0)
    throw new Error(
      "field op: capsule radius must be a finite positive length (metres)",
    );
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
 * of 0.5 m — the shell's INNER faces must land on lattice planes too. A CAPSULE
 * shape validates its own numbers up front, whatever the effect
 * ({@link assertCapsuleValid}), and is rejected outright for a kit class by the
 * same non-box clause a sphere hits. Material-free, mask-free ops (plain dig)
 * are otherwise a no-op.
 *
 * @throws {@link Error} if a class id (material, class mask, or embedded
 *   flood-material spec) is unknown, an embedded selection spec has a
 *   non-integer flood seed or an out-of-range budget, `hollow` rides a
 *   non-fill effect or is not a positive thickness, a capsule shape has a
 *   non-finite endpoint or a non-positive/non-finite radius, a smooth op's
 *   params are absent or out of range, or a kit-class write is not an
 *   axis-lattice-aligned box (with a lattice-multiple `hollow` when present).
 */
export function assertOpValid(op: BrushOp, table: MaterialTable): void {
  assertMaskValid(op.mask, table);
  assertCapsuleValid(op.shape);
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

/** One chunk's two-channel image, deep-copied out of the store. A null channel
 *  marks an ABSENT map entry (unallocated density = uniform SOLID; no material
 *  record = uniform {@link MAT_ROCK}), which {@link restoreImages} restores by
 *  deleting the entry. The ONE place these clone/null rules live. */
function chunkImage(store: FieldStore, key: ChunkKey): ChunkSnapshot {
  const density = store.chunks.get(key);
  const materials = store.materials.get(key);
  return {
    density: density ? Int8Array.from(density) : null,
    materials: materials ? cloneChunkMaterials(materials) : null,
  };
}

/** Snapshots a chunk's BOTH channels into the inverse once, before the op's
 *  first write to that chunk (idempotent per key). */
function snapshot(store: FieldStore, inverse: OpInverse, key: ChunkKey): void {
  if (inverse.has(key)) return;
  inverse.set(key, chunkImage(store, key));
}

/** Full CURRENT images of `keys` — the {@link restoreImages} input shape,
 *  captured eagerly instead of lazily on first write (the `splice` entry's
 *  `before`/`after` pair, which must cover chunks a replay may leave
 *  untouched). Deliberately NOT on the public field index, like
 *  {@link spliceOps}: in-core producer surface. */
export function imagesOf(
  store: FieldStore,
  keys: Iterable<ChunkKey>,
): OpInverse {
  const images: OpInverse = new Map();
  for (const key of keys) images.set(key, chunkImage(store, key));
  return images;
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
  // boundary and reaches full strength only in the deep interior. A capsule's
  // is its radius — the sphere case, and right for the same reason: the radius
  // IS the distance from the axis to the boundary, so the sweep's LENGTH must
  // not enter the falloff (it would make a long tunnel smooth harder than a
  // short one at the same wall distance).
  const sdfRef =
    op.shape.kind === "sphere" || op.shape.kind === "capsule"
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

/** Mask bytes per {@link PatchChunk} slice: one bit per chunk sample (512).
 *  Kept off the public field index even though the patch surface around it
 *  ({@link PatchChunk}, {@link PatchOp}, {@link applyPatchOp},
 *  {@link logApplyPatch}, {@link assertPatchValid}) is all public: the value is
 *  derivable from the exported {@link CHUNK_SAMPLES}, so publishing it would
 *  give the format constant a second home to drift from. */
export const PATCH_MASK_BYTES = CHUNK_SAMPLES / 8;

/** The normalized "writes no material" value array, so the write loop carries
 *  no per-cell null check. Never read: its mask is normalized to null too. */
const NO_MATERIALS = new Uint8Array(0);

/** Set bits in a mask — the length a slice's matching value array must have. */
function popcount(mask: Uint8Array): number {
  let n = 0;
  for (const byte of mask) {
    let b = byte;
    while (b !== 0) {
      n += b & 1;
      b >>= 1;
    }
  }
  return n;
}

/** One mask byte, or 0 for an absent mask / an index past its end. */
const maskByte = (mask: Uint8Array | null, i: number): number =>
  mask === null ? 0 : (mask[i] ?? 0);

/** Chunk-key parse for patch slices. {@link parseChunkKey} is TOTAL — a
 *  malformed key yields NaNs, and a NaN chunk origin would silently write to a
 *  garbage chunk — so patch demands the CANONICAL encoding: three integers that
 *  round-trip through {@link chunkKey} (which also rules out two spellings of
 *  the same chunk defeating the duplicate-key check). Kept local to patch
 *  rather than hardening `parseChunkKey`, whose failure policy is public
 *  surface with unrelated callers.
 *
 *  @throws {@link Error} if `key` is not a canonical chunk key. */
function parsePatchKey(key: ChunkKey): [number, number, number] {
  const [cx, cy, cz] = parseChunkKey(key);
  const canonical =
    Number.isInteger(cx) &&
    Number.isInteger(cy) &&
    Number.isInteger(cz) &&
    chunkKey(cx, cy, cz) === key;
  if (!canonical) throw new Error(`field patch: malformed chunk key "${key}"`);
  return [cx, cy, cz];
}

/** Masked material cells in a slice — 0 when it writes no material. */
const materialCells = (c: PatchChunk): number =>
  c.materialMask === null ? 0 : popcount(c.materialMask);

/** Material leg of {@link assertPatchStructure} for one slice: a present
 *  `materialMask` needs the right byte length and a non-null `materials` of
 *  exactly its popcount; an absent one forbids `materials`. The ids themselves
 *  are NOT resolved here — that is the table-dependent half, in
 *  {@link assertPatchValid}. */
function assertPatchMaterialsStructure(c: PatchChunk): void {
  if (c.materialMask === null) {
    if (c.materials !== null)
      throw new Error(
        `field patch: materials present without materialMask (chunk "${c.key}")`,
      );
    return;
  }
  if (c.materialMask.length !== PATCH_MASK_BYTES)
    throw new Error(
      `field patch: materialMask must be ${PATCH_MASK_BYTES} bytes (chunk "${c.key}")`,
    );
  if (c.materials === null)
    throw new Error(
      `field patch: materialMask is set but materials is null (chunk "${c.key}")`,
    );
  const cells = materialCells(c);
  if (c.materials.length !== cells)
    throw new Error(
      `field patch: materials length ${c.materials.length} != materialMask popcount ${cells} (chunk "${c.key}")`,
    );
}

/** Per-slice leg of {@link assertPatchStructure}. */
function assertPatchChunkStructure(c: PatchChunk): void {
  if (c.densityMask.length !== PATCH_MASK_BYTES)
    throw new Error(
      `field patch: densityMask must be ${PATCH_MASK_BYTES} bytes (chunk "${c.key}")`,
    );
  const densityCells = popcount(c.densityMask);
  if (c.density.length !== densityCells)
    throw new Error(
      `field patch: density length ${c.density.length} != densityMask popcount ${densityCells} (chunk "${c.key}")`,
    );
  assertPatchMaterialsStructure(c);
  if (densityCells + materialCells(c) === 0)
    throw new Error(`field patch: chunk "${c.key}" masks no cells`);
}

/**
 * The TABLE-INDEPENDENT half of {@link assertPatchValid}: everything a patch's
 * SHAPE must satisfy, with no opinion on what its material ids mean. Split out
 * for the oplog decoder (`parseOps` in `artifact.ts`), which reconstructs
 * slices from an untrusted file and has no {@link MaterialTable} to hand —
 * without it a truncated payload would become a plausible-looking op. Kept off
 * the public field index for the {@link PATCH_MASK_BYTES} reason: in-core
 * producer surface, and external producers already have the full check.
 *
 * @throws {@link Error} if the op has no slices, a chunk key is malformed or
 *   duplicated, a mask is not {@link PATCH_MASK_BYTES} bytes, a value array's
 *   length does not match its mask's popcount (including `materials` present
 *   without `materialMask` or vice versa), or a slice masks no cells.
 */
export function assertPatchStructure(op: PatchOp): void {
  if (op.chunks.length === 0)
    throw new Error("field patch: op writes no chunks");
  const seen = new Set<ChunkKey>();
  for (const c of op.chunks) {
    parsePatchKey(c.key);
    if (seen.has(c.key))
      throw new Error(`field patch: duplicate chunk key "${c.key}"`);
    seen.add(c.key);
    assertPatchChunkStructure(c);
  }
}

/**
 * Setup-loud patch validation — the {@link assertOpValid} analogue, and the
 * same replay / stream guard. Each slice must carry a CANONICAL chunk key
 * (unique across the op: one slice per chunk, so every cell has exactly one
 * value and the inverse's one-snapshot-per-chunk rule is unambiguous),
 * {@link PATCH_MASK_BYTES}-sized masks, value arrays exactly as long as their
 * own mask's popcount, and material ids that resolve in `table`. A slice that
 * masks NO cells is rejected: a patch's declared chunks are its written chunks
 * (see {@link fieldOpChunks}), and an empty slice would over-declare.
 *
 * A patch with NO slices is rejected too — the {@link commitGenerator} stance
 * that a mutation verb must actually mutate. Logged, it would burn an id, clear
 * the redo stack and push an undo entry that reverts nothing: a ⌘Z that
 * visibly does nothing.
 *
 * Kit class ids are ACCEPTED: the lattice rule in {@link assertOpValid}
 * constrains a box SHAPE, and a patch has no shape — its cells are already
 * resolved (typically by compacting a lattice-valid fill).
 *
 * @throws {@link Error} for anything {@link assertPatchStructure} rejects, or
 *   if a material class id is unknown to `table`. Structure is checked FIRST,
 *   across every slice, so a patch with both kinds of fault reports the
 *   structural one.
 */
export function assertPatchValid(op: PatchOp, table: MaterialTable): void {
  assertPatchStructure(op);
  for (const c of op.chunks)
    for (const id of c.materials ?? []) classOf(table, id); // unknown id throws
}

/** Max deviation of `|q|²` from 1 that still counts as a unit quaternion — the
 *  slack a producer's normalization rounding is allowed.
 *
 *  Shared with `placement-collision.ts`, which re-checks it on the rasterizer's
 *  own inputs: one definition of "unit" across every place a placement quat is
 *  trusted. In-core only, like `densityEqual` — not on the public field index. */
export const QUAT_NORM_TOLERANCE = 1e-3;

/**
 * Setup-loud placement validation — the {@link assertOpValid}/
 * {@link assertPatchValid} analogue for a {@link PlacementOp}'s records, and the
 * same replay / stream guard. Records may arrive from a parsed oplog, so every
 * field is checked at runtime. Each record needs a non-empty `archetypeId`,
 * finite `position` and `scale`, a `quat` whose squared norm is within
 * {@link QUAT_NORM_TOLERANCE} of 1 (orientation bakes in at placement time — a
 * non-unit quat is a producer bug, not something to silently re-normalize), and
 * an integer `variantIndex >= 0`. Shape (array lengths, primitive types) is the
 * decoder's job on the parse path ({@link PlacementRecord} is typed on the
 * commit path); this validates the VALUES.
 *
 * @throws {@link Error} if any record has an empty `archetypeId`, a non-finite
 *   `position`/`scale`, a `quat` that is not unit-length, or a `variantIndex`
 *   that is not a non-negative integer.
 */
export function assertPlacementsValid(
  records: readonly PlacementRecord[],
): void {
  for (const r of records) {
    if (r.archetypeId.length === 0)
      throw new Error(
        "field placement: archetypeId must be a non-empty string",
      );
    if (!r.position.every((n) => Number.isFinite(n)))
      throw new Error("field placement: position must be three finite numbers");
    if (!r.scale.every((n) => Number.isFinite(n)))
      throw new Error("field placement: scale must be three finite numbers");
    const [qx, qy, qz, qw] = r.quat;
    const norm2 = qx * qx + qy * qy + qz * qz + qw * qw;
    if (!Number.isFinite(norm2) || Math.abs(norm2 - 1) > QUAT_NORM_TOLERANCE)
      throw new Error(
        `field placement: quat must be unit-length (|q|² = ${norm2}, tolerance ${QUAT_NORM_TOLERANCE})`,
      );
    if (!Number.isInteger(r.variantIndex) || r.variantIndex < 0)
      throw new Error(
        "field placement: variantIndex must be a non-negative integer",
      );
  }
}

/** Writes one slice's masked cells absolutely, snapshotting the chunk before
 *  the first write. The two value arrays are consumed in ascending bit order,
 *  each advancing only on ITS OWN mask's bits, and each falls back to a defined
 *  value (`0` density, {@link MAT_ROCK} material) if it runs short of its mask
 *  — {@link assertPatchValid} rejects that shape, and inside the applier a
 *  wrong VALUE in a correctly declared and snapshotted cell (which undo still
 *  restores) beats a mid-slice throw that would strand a partial write.
 *
 *  The material channel is normalized ONCE, up front: a slice missing EITHER
 *  half of the pair writes no material at all (validation rejects that shape
 *  too), so neither loop below carries a null check. */
function writePatchChunk(
  store: FieldStore,
  c: PatchChunk,
  origin: [number, number, number],
  dirty: Set<ChunkKey>,
  inverse: OpInverse,
): void {
  const [cx, cy, cz] = origin;
  const density = c.density;
  const materials = c.materials ?? NO_MATERIALS;
  const materialMask = c.materials === null ? null : c.materialMask;
  let di = 0;
  let mi = 0;
  let touched = false;
  for (let byte = 0; byte < PATCH_MASK_BYTES; byte++) {
    const dByte = maskByte(c.densityMask, byte);
    const mByte = maskByte(materialMask, byte);
    if ((dByte | mByte) === 0) continue;
    if (!touched) {
      // Once per slice, on its first set mask byte. The slice is dirtied
      // WITHOUT comparing values first — deliberately unlike the brush effects
      // (`getMaterial(...) !== mat` and friends), which skip no-op writes. It
      // is what makes a validated patch's dirty set EXACTLY fieldOpChunks(op),
      // the exactness reconfigure and compaction both rest on. A patch that
      // happens to rewrite identical bytes costs one redundant remesh: that is
      // the price of the invariant, not an oversight to optimise away.
      snapshot(store, inverse, c.key);
      dirty.add(c.key);
      touched = true;
    }
    for (let b = 0; b < 8; b++) {
      const dSet = ((dByte >> b) & 1) === 1;
      const mSet = ((mByte >> b) & 1) === 1;
      if (!dSet && !mSet) continue;
      const bit = byte * 8 + b;
      const x = cx * CHUNK_DIM + (bit % CHUNK_DIM);
      const y = cy * CHUNK_DIM + (Math.floor(bit / CHUNK_DIM) % CHUNK_DIM);
      const z = cz * CHUNK_DIM + Math.floor(bit / (CHUNK_DIM * CHUNK_DIM));
      if (dSet) setDensity(store, x, y, z, density[di++] ?? 0);
      if (mSet) setMaterial(store, x, y, z, materials[mi++] ?? MAT_ROCK);
    }
  }
}

/** Applies a patch op: ABSOLUTE writes to exactly the masked cells, and nothing
 *  else — the op reads no surrounding state, so re-applying it to any store
 *  produces the same bytes (the byte-exact-replay property compaction and
 *  procedural emission both rest on). Same return contract as {@link applyOp}:
 *  the dirty chunk set plus the two-channel inverse (the undo unit).
 *
 *  Every slice's key is parsed BEFORE the first write — the ONE malformation
 *  this bare applier refuses rather than trusts, because a NaN chunk origin
 *  writes OUTSIDE the op's declared influence, into a chunk the inverse (keyed
 *  by the slice's own key) never snapshotted: unbounded, un-undoable
 *  corruption. Mask/value-length mismatches are trusted instead — they only
 *  mis-value a declared, snapshotted cell (see {@link writePatchChunk}).
 *
 *  @throws {@link Error} if a slice's chunk key is not canonical, with the
 *    store untouched rather than half-applied ({@link logApplyPatch} validates
 *    first via {@link assertPatchValid}, so logged ops never throw here). */
export function applyPatchOp(
  store: FieldStore,
  op: PatchOp,
): { dirty: Set<ChunkKey>; inverse: OpInverse } {
  const slices = op.chunks.map((c) => ({ c, origin: parsePatchKey(c.key) }));
  const dirty = new Set<ChunkKey>();
  const inverse: OpInverse = new Map();
  for (const { c, origin } of slices)
    writePatchChunk(store, c, origin, dirty, inverse);
  return { dirty, inverse };
}

/** The chunks an op may WRITE — its bounded influence, chunk-quantized. Entity
 *  ops write nothing. A patch DECLARES its chunks and writes all of them
 *  (validation rejects empty slices), so its set is exact. A brush op's set is
 *  derived from its sample bounds (+1 margin per side, the applier's own loop
 *  bounds) and is therefore a superset: cells its effect guards or `mask`
 *  reject are counted in. */
export function fieldOpChunks(op: FieldOp, cellSize: number): Set<ChunkKey> {
  if (op.kind === "entity") return new Set();
  if (op.kind === "placement") return new Set(); // explicit instances, no cells
  if (op.kind === "patch") return new Set(op.chunks.map((c) => c.key));
  const { x0, y0, z0, x1, y1, z1 } = opSampleBounds(op, cellSize);
  const keys = new Set<ChunkKey>();
  for (let cz = voxelChunk(z0); cz <= voxelChunk(z1); cz++)
    for (let cy = voxelChunk(y0); cy <= voxelChunk(y1); cy++)
      for (let cx = voxelChunk(x0); cx <= voxelChunk(x1); cx++)
        keys.add(chunkKey(cx, cy, cz));
  return keys;
}

/** True when an op's effect on any cell depends ONLY on that cell's own
 *  pre-state and the op's own record — never on a neighbouring cell, and never
 *  on state outside the chunks it writes.
 *
 *  Verified member by member against the appliers above. `dig`, `fill` and
 *  `paint` read the sample's own density and material and nothing else; the
 *  `solid-only` and class-kind masks read that same sample too
 *  ({@link makeMaskGate}); a REGION selection is a pure position predicate
 *  (`materializeSelection` copies its bounds without touching the store). A
 *  {@link PatchOp} reads nothing at all, and entity + placement ops write
 *  nothing at all (both cell-local via the non-brush guard).
 *  The two members that are NOT cell-local: `smooth`, whose 3³ kernel reads the
 *  neighbourhood (which crosses into adjacent chunks at a chunk's rim), and a
 *  FLOOD selection, whose read set is unbounded by construction.
 *
 *  Two callers rest on this. Compaction folds only cell-local runs — an op that
 *  reads context cannot be replaced by absolute cell values without baking that
 *  context in (spec D-F3-6, "smooth breaks a run"). And the snapshot-seeded
 *  restore replays one chunk at a time into a scratch store where every OTHER
 *  chunk is missing, which is sound exactly for cell-local ops. Deliberately NOT
 *  on the public field index, like {@link spliceOps}: in-core replay surface. */
export function isCellLocalOp(op: FieldOp): boolean {
  if (op.kind !== "brush") return true;
  if (op.effect === "smooth") return false;
  const mask = op.mask;
  if (mask === undefined || mask.kind !== "selection") return true;
  return mask.selection.kind === "region";
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

/** Validates then applies a whole op list through the log as ONE undo entry —
 *  the {@link logApply} analogue for a gesture that commits several ops but must
 *  undo as a single ⌘Z. Every op is validated ({@link assertOpValid}) BEFORE the
 *  first is applied, so a mid-list rejection mutates nothing — not the store,
 *  the log, the stacks, or the id counter. Ids stamp sequentially in list order
 *  onto COPIES of the records, so a caller reusing its op objects never finds
 *  them rewritten. The recorded inverse keeps the FIRST pre-image per chunk (the
 *  {@link redo} replay convention, shared with `reapplyOps`), so undo restores
 *  pre-group bytes even where ops overlap. An empty list is a no-op: no entry is
 *  pushed and the redo stack survives — a phantom history step would cost a real
 *  one.
 *
 *  What this does NOT buy is a transaction. The all-or-nothing guarantee covers
 *  VALIDATION only: an op that passes {@link assertOpValid} and then throws out
 *  of the APPLIER (`assertOpValid` does not check every shape number, so an
 *  unbuildable shape reaches pass 2) leaves the earlier ops' writes sitting in
 *  the store with no entry describing them — exactly what a per-op
 *  {@link logApply} loop would leave. The log's id space is kept whole across
 *  that failure (ids commit only once the apply pass finishes, the
 *  `commitGenerator` posture), but the store is not rolled back. A group buys
 *  ONE undo entry, not atomicity.
 *
 *  @returns the union of the ops' dirty chunk sets.
 *  @throws {@link Error} if any op fails {@link assertOpValid} — before any
 *    mutation. */
export function logApplyGroup(
  store: FieldStore,
  log: OpLog,
  ops: BrushOp[],
  table: MaterialTable,
): Set<ChunkKey> {
  if (ops.length === 0) return new Set();
  // Pass 1 — validate the WHOLE list before any write.
  for (const op of ops) assertOpValid(op, table);
  // Pass 2 — apply. Ids come from a LOCAL counter committed only once the pass
  // completes (the `commitGenerator` posture): an applier throw leaves the
  // log's id space gapless rather than burning the ids it got as far as.
  let nextId = log.nextId;
  const dirty = new Set<ChunkKey>();
  const inverse: OpInverse = new Map();
  const stamped: BrushOp[] = [];
  for (const op of ops) {
    const s: BrushOp = { ...op, id: nextId++ };
    const r = applyOp(store, s, table);
    for (const key of r.dirty) dirty.add(key);
    for (const [key, pre] of r.inverse)
      if (!inverse.has(key)) inverse.set(key, pre);
    stamped.push(s);
  }
  log.nextId = nextId;
  // Loop push, not spread: spread hits JS-engine argument-count ceilings
  // (~65k in JSC) on mega commit spans — the `reapplyOps` convention.
  for (const s of stamped) log.ops.push(s);
  log.undoStack.push({ kind: "ops", ops: stamped, inverse });
  log.redoStack.length = 0;
  return dirty;
}

/** Deep copy of one patch slice — the log's own buffers (see
 *  {@link logApplyPatch}). */
const clonePatchChunk = (c: PatchChunk): PatchChunk => ({
  key: c.key,
  densityMask: Uint8Array.from(c.densityMask),
  density: Int8Array.from(c.density),
  materialMask:
    c.materialMask === null ? null : Uint8Array.from(c.materialMask),
  materials: c.materials === null ? null : Uint8Array.from(c.materials),
});

/** Validates then applies a patch op through the log — the {@link logApply}
 *  analogue (assigns the id, records the two-channel inverse, clears redo).
 *  Returns the dirty chunk set.
 *
 *  The slices are CLONED (masks and value arrays both) before the first store
 *  write, the {@link commitGenerator} provenance posture: the log owns its copy
 *  of the record, so a caller reusing scratch buffers across patches — the
 *  natural shape for a compactor or a procedural emitter — can never rewrite
 *  history and desynchronise replay from the live store.
 *
 *  @throws {@link Error} if `op` fails {@link assertPatchValid} — before any
 *    mutation of the store, the log, or the id counter. */
export function logApplyPatch(
  store: FieldStore,
  log: OpLog,
  op: PatchOp,
  table: MaterialTable,
): Set<ChunkKey> {
  assertPatchValid(op, table);
  const stamped: PatchOp = {
    id: log.nextId++,
    kind: "patch",
    chunks: op.chunks.map(clonePatchChunk),
  };
  const { dirty, inverse } = applyPatchOp(store, stamped);
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
      `spliceOps: invalid span [${at}, ${at + deleteCount}) for ${ops.length} ops`,
    );
  const tail = ops.slice(at + deleteCount);
  ops.length = at;
  for (const op of insert) ops.push(op);
  for (const op of tail) ops.push(op);
}

/** Guards an `entity-update` entry's target the way {@link spliceOps} guards a
 *  span, and for the same reason: `opIndex` is a STORED value, and the bare
 *  `ops[opIndex] = …` it protects corrupts the log SILENTLY in three
 *  directions. Measured before this guard existed: index 5000 on a 1-op log
 *  grew `ops` to 5001 entries with 4999 holes and reported an empty dirty set;
 *  index −1 installed a non-index string property nothing ever reads back. The
 *  KIND clause covers the third: swapping an entity record over a brush op
 *  deletes that op and duplicates the record — same object, same id, twice —
 *  which survives into replay, serialization and bake.
 *
 *  Under the LIFO rule the index is correct by construction (a splice below it
 *  on the stack is undone FIRST, restoring the layout the index was taken in),
 *  so this is reachable only for a hand-built entry — both stacks are public
 *  and mutable, the caveat {@link spliceOps}' guard carries too.
 *
 *  The `< ops.length` bound is DELIBERATELY not separately tested, and is not
 *  dead either. It is the upper bound mirroring {@link spliceOps}'
 *  `at + deleteCount <= ops.length`; on a plain array the kind clause happens to
 *  reject every index past the end too, because the read is `undefined`. Pulling
 *  the two apart needs an entity op reachable at an out-of-range index, and the
 *  ONLY route is a poisoned prototype — `defineProperty` grows `length`, and
 *  truncating `length` deletes the element. No code path, no deserializer
 *  (`parseOps` builds a fresh array) and no browser API produces that state, so
 *  it is left untested rather than faked, the stance the empty-evaluation guard
 *  in `reconfigure.ts` already takes. Do not delete the clause as dead, and do
 *  not write the fixture. The `>= 0` and integer clauses ARE separately tested:
 *  a stray non-index property is what an unguarded write of that shape installs,
 *  which is reachable.
 *
 *  @throws {@link Error} if `opIndex` is not an in-range integer or does not
 *    address an entity op. */
function assertEntityUpdateTarget(ops: FieldOp[], opIndex: number): void {
  const targetsAnEntityOp =
    Number.isInteger(opIndex) &&
    opIndex >= 0 &&
    opIndex < ops.length &&
    ops[opIndex]?.kind === "entity";
  if (!targetsAnEntityOp)
    throw new Error(
      `entity-update: index ${opIndex} does not address an entity op in ${ops.length} ops (found "${ops[opIndex]?.kind ?? "nothing"}")`,
    );
}

/** Undoes the last log entry and moves it to the redo stack. An `ops` entry
 *  reverts its WHOLE op list (one ⌘Z per commit) by restoring the list's chunk
 *  pre-images and peeling the tail; a `splice` entry puts the removed span back
 *  at its index and restores the affected chunks' `before` images (bytes — the
 *  span is never re-executed); an `entity-update` entry swaps the entity op's
 *  previous record back in and touches no chunks. Returns the dirty chunk set
 *  (empty when there is nothing to undo or the entry touched no chunks).
 *
 *  @throws {@link Error} if a `splice` entry's span is invalid for the current
 *    `log.ops` (see {@link spliceOps}) or an `entity-update` entry's `opIndex`
 *    does not address an entity op (see {@link assertEntityUpdateTarget}) —
 *    `log.ops`, the store and both stacks are left untouched, and the entry
 *    stays on the undo stack. Reachable only for a hand-built entry:
 *    `log.undoStack` is public and mutable. */
export function undo(store: FieldStore, log: OpLog): Set<ChunkKey> {
  const entry = log.undoStack.at(-1);
  if (entry === undefined) return new Set();
  // Revert first, move the entry second: spliceOps validates before it writes,
  // so a malformed splice entry throws with both stacks, `log.ops` and the
  // store untouched rather than stranding an entry on the wrong stack.
  const dirty = revertEntry(store, log, entry);
  log.undoStack.pop();
  // ONE transfer per pop, in ONE place. The WHOLE entry moves across — the
  // deliberate price of symmetric stacks (splice/entity-update need their
  // records to replay forward). An `ops` entry's inverse therefore sits unread
  // on the redo stack until a redo pops it or the next mutation clears it: peak
  // memory is unchanged (the undo stack already held it), but memory that used
  // to be released at undo no longer is.
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
      assertEntityUpdateTarget(log.ops, entry.opIndex);
      log.ops[entry.opIndex] = entry.before;
      return new Set();
  }
}

/** Redoes the most recently undone entry and moves it — or, for `ops`, a
 *  freshly captured equivalent — back to the undo stack. An `ops` entry is
 *  re-applied by re-executing its BRUSH and PATCH members in order (entity ops
 *  never touch the field) — deterministic, and already validated at first
 *  apply, so no re-validation; `table` resolves class-kind masks during
 *  re-application. `splice` and `entity-update` entries are replayed from their
 *  records instead: the span goes back in at its index with the `after` images
 *  restored byte-for-byte, and the entity record is swapped forward again.
 *
 *  @throws {@link Error} if a `splice` entry's span is invalid for the current
 *    `log.ops` (see {@link spliceOps}) or an `entity-update` entry's `opIndex`
 *    does not address an entity op (see {@link assertEntityUpdateTarget}) —
 *    `log.ops`, the store and both stacks are left untouched, and the entry
 *    stays on the redo stack. Reachable only for a hand-built entry:
 *    `log.redoStack` is public and mutable. */
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
      assertEntityUpdateTarget(log.ops, entry.opIndex);
      log.ops[entry.opIndex] = entry.after;
      return { entry, dirty: new Set() };
  }
}

/** Executes ONE op of any kind, or returns null for a kind that touches no
 *  field state (entity ops). Total over {@link FieldOp}, so a new member fails
 *  to type-check until it declares how it applies — the ONE dispatch every
 *  replay path (redo, reconfigure's prefix restore and downstream replay) goes
 *  through, so that totality guarantee is never duplicated. Deliberately NOT on
 *  the public field index, like {@link spliceOps}: in-core replay surface. */
export function applyFieldOp(
  store: FieldStore,
  op: FieldOp,
  table: MaterialTable,
): { dirty: Set<ChunkKey>; inverse: OpInverse } | null {
  switch (op.kind) {
    case "brush":
      return applyOp(store, op, table);
    case "patch":
      return applyPatchOp(store, op);
    case "entity":
      return null;
    case "placement":
      return null;
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
    const r = applyFieldOp(store, op, table);
    if (r === null) continue;
    for (const key of r.dirty) dirty.add(key);
    for (const [key, pre] of r.inverse)
      if (!inverse.has(key)) inverse.set(key, pre);
  }
  // Loop push, not spread: spread hits JS-engine argument-count ceilings
  // (~65k in JSC) on mega commit spans.
  for (const op of ops) log.ops.push(op);
  return { dirty, inverse };
}
