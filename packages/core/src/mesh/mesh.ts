import type { Context } from "../gpu/index.ts";
import type { Material } from "../material/types.ts";
import {
  _registerResource,
  _unregisterResource,
  type ResourceHandle,
} from "../stats/internal.ts";
import { mat4, quat } from "../transform/index.ts";
import type { Quat, Vec3 } from "../transform/types.ts";
import type { Geometry, Mesh } from "./types.ts";

const OBJECT_UNIFORM_SIZE_BYTES = 64; // one mat4x4<f32>

// Boundary type — mesh handles stored on the Mesh object after create,
// read by destroy. Same-module write/read makes the localised cast in
// destroy the boundary mechanism.
type MeshWithHandles = Mesh & {
  _meshHandle: ResourceHandle;
  _objectBufferHandle: ResourceHandle;
};

/**
 * Build a {@link Mesh} that binds a {@link Geometry} to a {@link Material}.
 * Allocates the per-mesh object-uniform buffer (64 bytes for the `model`
 * `mat4x4<f32>`) and initialises the pose to position `[0,0,0]`, identity
 * rotation, scale `[1,1,1]` with `transformDirty` set so the first frame
 * writes the buffer.
 *
 * The geometry and material are stored by reference — `mesh.destroy` does
 * not destroy either. A single geometry/material pair may be shared across
 * many meshes.
 */
export function create(
  ctx: Context,
  opts: { geometry: Geometry; material: Material },
): Mesh {
  const objectBuffer = ctx.device.createBuffer({
    size: OBJECT_UNIFORM_SIZE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const _objectBufferHandle = _registerResource(ctx, {
    kind: "buffer",
    bytes: OBJECT_UNIFORM_SIZE_BYTES,
  });
  const _meshHandle = _registerResource(ctx, { kind: "mesh" });

  const mesh: MeshWithHandles = {
    ctx,
    geometry: opts.geometry,
    material: opts.material,
    position: new Float32Array([0, 0, 0]),
    rotation: quat.create(),
    scale: new Float32Array([1, 1, 1]),
    modelMatrix: mat4.create(),
    transformDirty: true,
    objectBuffer,
    _meshHandle,
    _objectBufferHandle,
  };
  return mesh;
}

/**
 * Destroy a {@link Mesh}: destroy its object-uniform buffer and unregister
 * the mesh + buffer handles from stats.
 *
 * Does **not** destroy `mesh.geometry` or `mesh.material` — both may be
 * shared with other meshes. Call `mesh.destroyGeometry` and `material.destroy`
 * separately when those resources have no other owners.
 */
export function destroy(mesh: Mesh): void {
  // Boundary cast: mesh handles were stashed by create on the same Mesh instance; the cross-function invariant isn't expressible in the public Mesh type.
  const m = mesh as MeshWithHandles;
  mesh.objectBuffer.destroy();
  _unregisterResource(mesh.ctx, m._objectBufferHandle);
  _unregisterResource(mesh.ctx, m._meshHandle);
}

/**
 * Set the mesh's position. Mutates `mesh` in place; flips `transformDirty`.
 */
export function setPosition(mesh: Mesh, position: Vec3): void {
  mesh.position.set(position);
  mesh.transformDirty = true;
}

/**
 * Set the mesh's rotation quaternion. Mutates `mesh` in place; flips `transformDirty`.
 */
export function setRotation(mesh: Mesh, rotation: Quat): void {
  mesh.rotation.set(rotation);
  mesh.transformDirty = true;
}

/**
 * Set the mesh's scale. Mutates `mesh` in place; flips `transformDirty`.
 */
export function setScale(mesh: Mesh, scale: Vec3): void {
  mesh.scale.set(scale);
  mesh.transformDirty = true;
}

/**
 * Recomputes the model matrix from TRS and writes the object uniform buffer
 * when `transformDirty`. Called by `frame.render` per draw; exported with the
 * `_` prefix so tests can drive it directly without going through a frame.
 */
export function _recomputeModelIfDirty(mesh: Mesh): void {
  if (!mesh.transformDirty) return;
  mat4.fromRotationTranslationScale(
    mesh.modelMatrix,
    mesh.rotation,
    mesh.position,
    mesh.scale,
  );
  mesh.ctx.queue.writeBuffer(mesh.objectBuffer, 0, mesh.modelMatrix);
  mesh.transformDirty = false;
}
