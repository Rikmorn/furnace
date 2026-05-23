import type { Context } from "../gpu/index.ts";
import type { Material } from "../material/types.ts";
import { mat4, quat } from "../transform/index.ts";
import type { Quat, Vec3 } from "../transform/types.ts";
import type { Geometry, Mesh } from "./types.ts";

const OBJECT_UNIFORM_SIZE_BYTES = 64; // one mat4x4<f32>

export function create(
  ctx: Context,
  opts: { geometry: Geometry; material: Material },
): Mesh {
  const objectBuffer = ctx.device.createBuffer({
    size: OBJECT_UNIFORM_SIZE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const mesh = {
    ctx,
    geometry: opts.geometry,
    material: opts.material,
    position: new Float32Array([0, 0, 0]),
    rotation: quat.create(),
    scale: new Float32Array([1, 1, 1]),
    modelMatrix: mat4.create(),
    transformDirty: true,
    objectBuffer,
    group0: null,
    group0Pipeline: null,
  };
  return mesh as unknown as Mesh;
}

export function destroy(mesh: Mesh): void {
  mesh.objectBuffer.destroy();
  mesh.group0 = null;
  mesh.group0Pipeline = null;
}

export function setPosition(mesh: Mesh, position: Vec3): void {
  mesh.position[0] = position[0] as number;
  mesh.position[1] = position[1] as number;
  mesh.position[2] = position[2] as number;
  mesh.transformDirty = true;
}

export function setRotation(mesh: Mesh, rotation: Quat): void {
  mesh.rotation[0] = rotation[0] as number;
  mesh.rotation[1] = rotation[1] as number;
  mesh.rotation[2] = rotation[2] as number;
  mesh.rotation[3] = rotation[3] as number;
  mesh.transformDirty = true;
}

export function setScale(mesh: Mesh, scale: Vec3): void {
  mesh.scale[0] = scale[0] as number;
  mesh.scale[1] = scale[1] as number;
  mesh.scale[2] = scale[2] as number;
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
