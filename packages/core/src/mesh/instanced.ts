import { FurnaceError } from "../errors.ts";
import type { Geometry, GeometrySlot } from "../geometry/types.ts";
import type { Context } from "../gpu/index.ts";
import type { Material, MaterialSlot } from "../material/types.ts";
import {
  _allocInstancedMesh,
  _destroyInstancedMesh,
  _lookupGeometry,
  _lookupInstancedMesh,
  _lookupMaterial,
} from "../resources/internal.ts";
import { _recordAlloc, _recordDestroy } from "../stats/internal.ts";
import { mat4 } from "../transform/index.ts";
import {
  decrementGeometryRefcount,
  decrementMaterialRefcount,
} from "./refcount.ts";
import type { InstancedMesh, InstancedMeshSlot } from "./types.ts";

/** A 3-component number tuple used for hand-authored per-instance position. */
type Vec3Tuple = readonly [number, number, number];
/** A 4-component number tuple used for hand-authored per-instance rotation. */
type QuatTuple = readonly [number, number, number, number];
/** A 4-component number tuple used for hand-authored per-instance tint (RGBA). */
type Vec4Tuple = readonly [number, number, number, number];

const MATRIX_FLOATS = 16; // mat4x4<f32> per instance (vertex slot 1)
const TINT_FLOATS = 4; // vec4<f32> per instance (vertex slot 2)
const WHITE_TINT: Vec4Tuple = [1, 1, 1, 1];

// Module-level scratch reused by setInstanceTransform to bake one instance's
// TRS into a mat4 without per-call allocation (hot-path setter posture).
const scratchMatrix = mat4.create();
const scratchPosition = new Float32Array(3);
const scratchRotation = new Float32Array(4);
const scratchScale = new Float32Array(3);

/**
 * Build an {@link InstancedMesh}: one {@link Geometry} + {@link Material}
 * drawn `count` times in a single instanced draw call. Allocates two
 * per-instance GPU vertex buffers — `matrixBuffer` (16 floats per
 * instance, vertex slot 1) and `tintBuffer` (4 floats per instance,
 * vertex slot 2) — plus their CPU scratch. Every instance is initialised
 * to an identity transform and white tint, and the slot is marked dirty
 * so the first render flushes both buffers.
 *
 * `count` is the allocated capacity, fixed for the life of the handle;
 * the drawn prefix defaults to `count` and is adjustable with
 * {@link setInstanceCount}. The material must reference an instanced
 * shader (`shader.unlitInstanced` / `shader.litInstanced`); a non-
 * instanced material renders but ignores the per-instance buffers.
 *
 * Increments the bound geometry's AND material's internal reference
 * counts. When the instanced mesh is destroyed, both refcounts decrement;
 * if `geometry.destroy` or `material.destroy` were called while it still
 * held a reference (marked-destroyed), the corresponding GPU teardown
 * runs as part of `destroyInstanced`.
 *
 * @throws FurnaceError - if `opts.geometry` or `opts.material` is
 *   null/undefined.
 * @throws FurnaceError - if `opts.count` is not greater than zero.
 * @throws FurnaceError - if `opts.geometry` is not a live handle
 *   (already destroyed, stale, or from a different context).
 * @throws FurnaceError - if `opts.material` is not a live handle
 *   (already destroyed, stale, or from a different context). All inputs
 *   are validated before any GPU buffer is allocated or either refcount
 *   is incremented, so a late failure cannot strand a buffer or a count.
 */
export function createInstanced(
  ctx: Context,
  opts: { geometry: Geometry; material: Material; count: number },
): InstancedMesh {
  if (opts.geometry == null) {
    throw new FurnaceError("mesh.createInstanced: geometry is required");
  }
  if (opts.material == null) {
    throw new FurnaceError("mesh.createInstanced: material is required");
  }
  if (!(opts.count > 0)) {
    throw new FurnaceError("mesh.createInstanced: count must be > 0");
  }
  const geometrySlot = _lookupGeometry<GeometrySlot>(ctx, opts.geometry);
  if (geometrySlot === null) {
    throw new FurnaceError(
      "mesh.createInstanced: geometry handle is invalid or destroyed",
    );
  }
  const materialSlot = _lookupMaterial<MaterialSlot>(ctx, opts.material);
  if (materialSlot === null) {
    throw new FurnaceError(
      "mesh.createInstanced: material handle is invalid or destroyed",
    );
  }
  geometrySlot.userCount += 1;
  materialSlot.userCount += 1;

  const count = opts.count;
  const matrices = new Float32Array(MATRIX_FLOATS * count);
  const tints = new Float32Array(TINT_FLOATS * count);
  const identity = mat4.create();
  for (let i = 0; i < count; i++) {
    matrices.set(identity, i * MATRIX_FLOATS);
    tints.set(WHITE_TINT, i * TINT_FLOATS);
  }

  const matrixBuffer = ctx.device.createBuffer({
    size: matrices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  _recordAlloc(ctx, "buffer", matrices.byteLength);
  const tintBuffer = ctx.device.createBuffer({
    size: tints.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  _recordAlloc(ctx, "buffer", tints.byteLength);

  const slot: InstancedMeshSlot = {
    geometry: opts.geometry,
    material: opts.material,
    count,
    drawCount: count,
    matrices,
    tints,
    matrixBuffer,
    tintBuffer,
    dirty: true,
    _teardown: () => instancedTeardown(ctx, slot),
  };
  return _allocInstancedMesh(ctx, slot);
}

function instancedTeardown(ctx: Context, slot: InstancedMeshSlot): void {
  slot.matrixBuffer.destroy();
  slot.tintBuffer.destroy();
  _recordDestroy(ctx, "buffer", slot.matrices.byteLength);
  _recordDestroy(ctx, "buffer", slot.tints.byteLength);
  decrementGeometryRefcount(ctx, slot.geometry);
  decrementMaterialRefcount(ctx, slot.material);
}

/**
 * Bake instance `i`'s model matrix from a TRS pose and stage it for the
 * next render flush. Composes `T(position) * R(rotation) * S(scale)` into
 * the per-instance matrix array and marks the slot dirty.
 *
 * Precondition: `scale` is a single uniform scalar applied to all three
 * axes — non-uniform per-axis scale is not supported by this setter (use
 * {@link setInstanceMatrices} to upload an arbitrary matrix). `rotation`
 * must be a unit-length quaternion; a non-unit quaternion produces a
 * sheared matrix.
 *
 * Hot-path setter — no input validation. `i` is not bounds-checked; an
 * out-of-range index writes past the instance it names (or throws on a
 * typed-array range error). Silent no-op on stale or destroyed handles.
 */
export function setInstanceTransform(
  ctx: Context,
  im: InstancedMesh,
  i: number,
  position: Vec3Tuple,
  rotation: QuatTuple,
  scale: number,
): void {
  const slot = _lookupInstancedMesh<InstancedMeshSlot>(ctx, im);
  if (slot === null) return;
  scratchPosition.set(position);
  scratchRotation.set(rotation);
  scratchScale.fill(scale);
  mat4.fromRotationTranslationScale(
    scratchMatrix,
    scratchRotation,
    scratchPosition,
    scratchScale,
  );
  slot.matrices.set(scratchMatrix, i * MATRIX_FLOATS);
  slot.dirty = true;
}

/**
 * Set instance `i`'s tint (RGBA) and mark the slot dirty for the next
 * render flush. The tint is multiplied with the material's base color in
 * the instanced shader.
 *
 * Hot-path setter — no input validation. `i` is not bounds-checked.
 * Silent no-op on stale or destroyed handles.
 */
export function setInstanceTint(
  ctx: Context,
  im: InstancedMesh,
  i: number,
  color: Vec4Tuple,
): void {
  const slot = _lookupInstancedMesh<InstancedMeshSlot>(ctx, im);
  if (slot === null) return;
  slot.tints.set(color, i * TINT_FLOATS);
  slot.dirty = true;
}

/**
 * Bulk-replace the per-instance model matrices from a packed Float32Array
 * (16 floats per instance, row-major mat4) and mark the slot dirty. Copies
 * up to the slot's capacity (`16 * count` floats); a longer source is
 * truncated, a shorter source leaves the trailing instances unchanged.
 *
 * For uploading a scatter buffer in one call instead of per-instance
 * {@link setInstanceTransform}. Hot-path setter — no input validation.
 * Silent no-op on stale or destroyed handles.
 */
export function setInstanceMatrices(
  ctx: Context,
  im: InstancedMesh,
  matrices: Float32Array,
): void {
  const slot = _lookupInstancedMesh<InstancedMeshSlot>(ctx, im);
  if (slot === null) return;
  slot.matrices.set(matrices.subarray(0, slot.matrices.length));
  slot.dirty = true;
}

/**
 * Set the drawn instance prefix: the next render draws instances
 * `[0, n)` and skips the rest, without reallocating the buffers. Lets a
 * consumer grow and shrink the visible population up to the fixed
 * capacity established at construction.
 *
 * Silent no-op on stale or destroyed handles. On a live handle the count
 * is validated.
 *
 * @throws FurnaceError - if `n` is outside `[0, count]` (the capacity
 *   fixed by {@link createInstanced}).
 */
export function setInstanceCount(
  ctx: Context,
  im: InstancedMesh,
  n: number,
): void {
  const slot = _lookupInstancedMesh<InstancedMeshSlot>(ctx, im);
  if (slot === null) return;
  if (n < 0 || n > slot.count) {
    throw new FurnaceError("setInstanceCount: n out of [0, count]");
  }
  slot.drawCount = n;
}

/**
 * Destroy an {@link InstancedMesh}: destroy both per-instance GPU buffers
 * and record their byte release in stats. Decrements the bound geometry's
 * AND material's refcounts; if either was marked-destroyed and its
 * refcount hits zero, that resource's GPU teardown runs as part of this
 * call.
 *
 * Silent on stale or already-destroyed handles (idempotent).
 */
export function destroyInstanced(ctx: Context, im: InstancedMesh): void {
  _destroyInstancedMesh<InstancedMeshSlot>(ctx, im, (s) => s._teardown());
}

/**
 * Upload the per-instance matrix and tint scratch to their GPU buffers
 * when `dirty`, then clear the flag. Called by `frame.render` per
 * instanced draw; takes an {@link InstancedMeshSlot} directly (not a
 * handle) because the caller already resolved the slot for this draw.
 * Engine-internal — exported for the render path and tests, not part of
 * the public consumer surface.
 */
export function _flushInstancedIfDirty(
  ctx: Context,
  slot: InstancedMeshSlot,
): void {
  if (!slot.dirty) return;
  ctx.queue.writeBuffer(slot.matrixBuffer, 0, slot.matrices);
  ctx.queue.writeBuffer(slot.tintBuffer, 0, slot.tints);
  slot.dirty = false;
}
