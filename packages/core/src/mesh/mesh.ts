import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import type { Material } from "../material/types.ts";
import {
  _allocMesh,
  _destroyGeometry,
  _destroyMesh,
  _lookupGeometry,
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
 * Increments the bound geometry's internal reference count. When the
 * mesh is destroyed, the refcount decrements; if `destroyGeometry` was
 * called while the mesh held the reference (marked-destroyed), the
 * geometry's actual GPU teardown runs as part of `mesh.destroy`.
 * Material refcount lands in Session 3.
 *
 * @throws FurnaceError - if `opts.geometry` or `opts.material` is
 *   null/undefined.
 * @throws FurnaceError - if `opts.geometry` is not a live handle
 *   (already destroyed, stale, or from a different context).
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
  geometrySlot.userCount += 1;
  // (material refcount lands in Session 3)

  const objectBuffer = ctx.device.createBuffer({
    size: OBJECT_UNIFORM_SIZE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const objectBufferHandle = _registerResource(ctx, {
    kind: "buffer",
    bytes: OBJECT_UNIFORM_SIZE_BYTES,
  });
  const meshHandle = _registerResource(ctx, { kind: "mesh" });

  const slot: MeshSlot = {
    ctx,
    geometry: opts.geometry,
    material: opts.material,
    position: new Float32Array([0, 0, 0]),
    rotation: quat.create(),
    scale: new Float32Array([1, 1, 1]),
    modelMatrix: mat4.create(),
    transformDirty: true,
    objectBuffer,
    _teardown: () => meshTeardown(slot, meshHandle, objectBufferHandle),
  };
  return _allocMesh(ctx, slot);
}

function meshTeardown(
  slot: MeshSlot,
  meshHandle: ResourceHandle,
  objectBufferHandle: ResourceHandle,
): void {
  slot.objectBuffer.destroy();
  _unregisterResource(slot.ctx, objectBufferHandle);
  _unregisterResource(slot.ctx, meshHandle);
  // Decrement geometry refcount; if marked-destroyed and now at zero,
  // run the deferred actual teardown.
  const geometrySlot = _lookupGeometry<GeometrySlot>(slot.ctx, slot.geometry);
  if (geometrySlot !== null) {
    geometrySlot.userCount -= 1;
    if (geometrySlot.userCount === 0 && geometrySlot.markedDestroyed) {
      geometrySlot.markedDestroyed = false;
      _destroyGeometry<GeometrySlot>(slot.ctx, slot.geometry, (s) =>
        s._teardown(),
      );
    }
  }
  // (material refcount decrement lands in Session 3)
}

/**
 * Destroy a {@link Mesh}: destroy its object-uniform buffer and unregister
 * the mesh + buffer handles from stats. Decrements the bound geometry's
 * refcount; if the geometry was marked-destroyed and the refcount hits
 * zero, the geometry's GPU teardown runs as part of this call.
 *
 * Silent on stale or already-destroyed handles (idempotent). Material
 * refcount decrement lands in Session 3.
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
export function _recomputeModelIfDirty(slot: MeshSlot): void {
  if (!slot.transformDirty) return;
  mat4.fromRotationTranslationScale(
    slot.modelMatrix,
    slot.rotation,
    slot.position,
    slot.scale,
  );
  slot.ctx.queue.writeBuffer(slot.objectBuffer, 0, slot.modelMatrix);
  slot.transformDirty = false;
}
