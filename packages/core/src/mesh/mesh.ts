import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import type { Material, MaterialSlot } from "../material/types.ts";
import {
  _allocMesh,
  _destroyGeometry,
  _destroyMaterial,
  _destroyMesh,
  _lookupGeometry,
  _lookupMaterial,
  _lookupMesh,
} from "../resources/internal.ts";
import {
  _registerResource,
  _unregisterResource,
  type ResourceHandle,
} from "../stats/internal.ts";
import { mat4, quat } from "../transform/index.ts";
import type { Quat, Vec3 } from "../transform/types.ts";
import type { Geometry, GeometrySlot, Mesh, MeshSlot } from "./types.ts";

const OBJECT_UNIFORM_SIZE_BYTES = 64; // one mat4x4<f32>

/**
 * Build a {@link Mesh} that binds a {@link Geometry} to a {@link Material}.
 * Allocates the per-mesh object-uniform buffer (64 bytes for the `model`
 * `mat4x4<f32>`) and initialises the pose to position `[0,0,0]`, identity
 * rotation, scale `[1,1,1]` with `transformDirty` set so the first frame
 * writes the buffer.
 *
 * Increments the bound geometry's AND material's internal reference
 * counts. When the mesh is destroyed, both refcounts decrement; if
 * `destroyGeometry` or `material.destroy` were called while the mesh
 * still held a reference (marked-destroyed), the corresponding GPU
 * teardown runs as part of `mesh.destroy`.
 *
 * @throws FurnaceError - if `opts.geometry` or `opts.material` is
 *   null/undefined.
 * @throws FurnaceError - if `opts.geometry` is not a live handle
 *   (already destroyed, stale, or from a different context).
 * @throws FurnaceError - if `opts.material` is not a live handle
 *   (already destroyed, stale, or from a different context). Both
 *   handles are validated before either refcount is incremented, so a
 *   late material-lookup failure cannot strand the geometry refcount.
 */
export function create(
  ctx: Context,
  opts: { geometry: Geometry; material: Material },
): Mesh {
  if (opts.geometry == null) {
    throw new FurnaceError("mesh.create: geometry is required");
  }
  if (opts.material == null) {
    throw new FurnaceError("mesh.create: material is required");
  }
  const geometrySlot = _lookupGeometry<GeometrySlot>(ctx, opts.geometry);
  if (geometrySlot === null) {
    throw new FurnaceError(
      "mesh.create: geometry handle is invalid or destroyed",
    );
  }
  const materialSlot = _lookupMaterial<MaterialSlot>(ctx, opts.material);
  if (materialSlot === null) {
    throw new FurnaceError(
      "mesh.create: material handle is invalid or destroyed",
    );
  }
  geometrySlot.userCount += 1;
  materialSlot.userCount += 1;

  const objectBuffer = ctx.device.createBuffer({
    size: OBJECT_UNIFORM_SIZE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const objectBufferHandle = _registerResource(ctx, {
    kind: "buffer",
    bytes: OBJECT_UNIFORM_SIZE_BYTES,
  });

  const slot: MeshSlot = {
    geometry: opts.geometry,
    material: opts.material,
    position: new Float32Array([0, 0, 0]),
    rotation: quat.create(),
    scale: new Float32Array([1, 1, 1]),
    modelMatrix: mat4.create(),
    transformDirty: true,
    objectBuffer,
    _teardown: () => meshTeardown(ctx, slot, objectBufferHandle),
  };
  return _allocMesh(ctx, slot);
}

function meshTeardown(
  ctx: Context,
  slot: MeshSlot,
  objectBufferHandle: ResourceHandle,
): void {
  slot.objectBuffer.destroy();
  _unregisterResource(ctx, objectBufferHandle);
  decrementGeometryRefcount(ctx, slot.geometry);
  decrementMaterialRefcount(ctx, slot.material);
}

function decrementGeometryRefcount(ctx: Context, geometry: Geometry): void {
  const geometrySlot = _lookupGeometry<GeometrySlot>(ctx, geometry);
  if (geometrySlot === null) return;
  geometrySlot.userCount -= 1;
  if (geometrySlot.userCount === 0 && geometrySlot.markedDestroyed) {
    geometrySlot.markedDestroyed = false;
    _destroyGeometry<GeometrySlot>(ctx, geometry, (s) => s._teardown());
  }
}

function decrementMaterialRefcount(ctx: Context, material: Material): void {
  const materialSlot = _lookupMaterial<MaterialSlot>(ctx, material);
  if (materialSlot === null) return;
  materialSlot.userCount -= 1;
  if (materialSlot.userCount === 0 && materialSlot.markedDestroyed) {
    materialSlot.markedDestroyed = false;
    _destroyMaterial<MaterialSlot>(ctx, material, (s) => s._teardown());
  }
}

/**
 * Destroy a {@link Mesh}: destroy its object-uniform buffer and unregister
 * the mesh + buffer handles from stats. Decrements the bound geometry's
 * AND material's refcounts; if either was marked-destroyed and its
 * refcount hits zero, that resource's GPU teardown runs as part of this
 * call.
 *
 * Silent on stale or already-destroyed handles (idempotent).
 */
export function destroy(ctx: Context, mesh: Mesh): void {
  _destroyMesh<MeshSlot>(ctx, mesh, (s) => s._teardown());
}

/**
 * Set the mesh's position. Mutates the slot's pose in place; flips
 * `transformDirty` so the next frame writes the object-uniform buffer.
 *
 * Hot-path setter — no input validation (see `engine-conventions.md`
 * §"Failure policy"). Components must be finite; non-finite components
 * propagate to the per-mesh object uniform buffer and corrupt the model
 * matrix used by every vertex shader for this mesh until a finite value
 * is written. Silent no-op on stale or destroyed handles.
 */
export function setPosition(ctx: Context, mesh: Mesh, position: Vec3): void {
  const slot = _lookupMesh<MeshSlot>(ctx, mesh);
  if (slot === null) return;
  slot.position.set(position);
  slot.transformDirty = true;
}

/**
 * Set the mesh's rotation quaternion. Mutates the slot's pose in place;
 * flips `transformDirty`.
 *
 * Hot-path setter — no input validation. Components must be finite;
 * non-finite components propagate to the per-mesh object uniform
 * buffer and the resulting model matrix is degenerate until a finite
 * value is written. Pass a unit-length quaternion (`quat.create()`
 * for identity, or `quat.normalize` first); a non-unit quaternion
 * produces a non-orthonormal model matrix with implicit shear. Silent
 * no-op on stale or destroyed handles.
 */
export function setRotation(ctx: Context, mesh: Mesh, rotation: Quat): void {
  const slot = _lookupMesh<MeshSlot>(ctx, mesh);
  if (slot === null) return;
  slot.rotation.set(rotation);
  slot.transformDirty = true;
}

/**
 * Set the mesh's scale. Mutates the slot's pose in place; flips
 * `transformDirty`.
 *
 * Hot-path setter — no input validation. Components must be finite;
 * non-finite components propagate to the per-mesh object uniform
 * buffer and corrupt the model matrix used by every vertex shader for
 * this mesh until a finite value is written. Silent no-op on stale or
 * destroyed handles.
 */
export function setScale(ctx: Context, mesh: Mesh, scale: Vec3): void {
  const slot = _lookupMesh<MeshSlot>(ctx, mesh);
  if (slot === null) return;
  slot.scale.set(scale);
  slot.transformDirty = true;
}

/**
 * Swap the {@link Material} bound to a live {@link Mesh}. The previous
 * material's refcount is decremented; if that drops it to zero and
 * `material.destroy` had already been called on it, the deferred GPU
 * teardown runs as part of this call. The new material's refcount is
 * incremented symmetrically.
 *
 * Validate-first: the new material handle is looked up BEFORE the slot's
 * reference is swapped or any refcount is touched, so a stale or invalid
 * new-material handle cannot strand the previous material's refcount.
 * No-op when the new material is the same handle already bound — does
 * not touch either refcount.
 *
 * Use for swap-on-resize / picture-in-picture flows where a live mesh
 * needs to point at a freshly-rebuilt material (e.g. a new off-screen
 * texture's binding) without recreating the mesh. The render path looks
 * up the bound material per draw, so mid-frame swaps are safe — no
 * pipeline-cache invalidation is required.
 *
 * Silent no-op on stale or destroyed mesh handles (matches the other
 * mesh setters).
 *
 * @throws FurnaceError - if `newMaterial` is null/undefined.
 * @throws FurnaceError - if `newMaterial` is not a live handle (already
 *   destroyed, stale, or from a different context). The previous
 *   material's refcount is unchanged on this path.
 */
export function setMaterial(
  ctx: Context,
  mesh: Mesh,
  newMaterial: Material,
): void {
  if (newMaterial == null) {
    throw new FurnaceError("mesh.setMaterial: material is required");
  }
  const meshSlot = _lookupMesh<MeshSlot>(ctx, mesh);
  if (meshSlot === null) return;
  if (meshSlot.material === newMaterial) return;
  const newMaterialSlot = _lookupMaterial<MaterialSlot>(ctx, newMaterial);
  if (newMaterialSlot === null) {
    throw new FurnaceError(
      "mesh.setMaterial: material handle is invalid or destroyed",
    );
  }
  const oldMaterial = meshSlot.material;
  meshSlot.material = newMaterial;
  newMaterialSlot.userCount += 1;
  decrementMaterialRefcount(ctx, oldMaterial);
}

/**
 * Read the mesh's position into `out`. Out-param convention matches the
 * `transform/*` math primitives; returns `out` for fluent chaining.
 *
 * Hot-path getter — no input validation. Returns `out` unchanged on
 * stale or destroyed handles.
 */
export function getPosition(ctx: Context, mesh: Mesh, out: Vec3): Vec3 {
  const slot = _lookupMesh<MeshSlot>(ctx, mesh);
  if (slot === null) return out;
  out.set(slot.position);
  return out;
}

/**
 * Read the mesh's rotation quaternion into `out`. Out-param convention
 * matches the `transform/*` math primitives; returns `out` for fluent
 * chaining.
 *
 * Hot-path getter — no input validation. Returns `out` unchanged on
 * stale or destroyed handles.
 */
export function getRotation(ctx: Context, mesh: Mesh, out: Quat): Quat {
  const slot = _lookupMesh<MeshSlot>(ctx, mesh);
  if (slot === null) return out;
  out.set(slot.rotation);
  return out;
}

/**
 * Read the mesh's scale into `out`. Out-param convention matches the
 * `transform/*` math primitives; returns `out` for fluent chaining.
 *
 * Hot-path getter — no input validation. Returns `out` unchanged on
 * stale or destroyed handles.
 */
export function getScale(ctx: Context, mesh: Mesh, out: Vec3): Vec3 {
  const slot = _lookupMesh<MeshSlot>(ctx, mesh);
  if (slot === null) return out;
  out.set(slot.scale);
  return out;
}

/**
 * Recomputes the model matrix from TRS and writes the object uniform buffer
 * when `transformDirty`. Called by `frame.render` per draw; takes a
 * {@link MeshSlot} directly (not a handle) because the caller already
 * resolved the slot for this draw call. Engine-internal — exported so
 * tests can drive it directly without going through a frame.
 */
export function _recomputeModelIfDirty(ctx: Context, slot: MeshSlot): void {
  if (!slot.transformDirty) return;
  mat4.fromRotationTranslationScale(
    slot.modelMatrix,
    slot.rotation,
    slot.position,
    slot.scale,
  );
  ctx.queue.writeBuffer(slot.objectBuffer, 0, slot.modelMatrix);
  slot.transformDirty = false;
}
