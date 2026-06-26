import type { Geometry } from "../geometry/types.ts";
import type { Material } from "../material/types.ts";
import type { InstancedMeshHandle, MeshHandle } from "../resources/handle.ts";
import type { Mat4, Quat, Vec3 } from "../transform/types.ts";

/**
 * Opaque mesh handle. Returned by {@link create} and holds a reference
 * to the bound geometry + material plus a TRS pose. Pass to setters
 * (`setPosition`, `setRotation`, `setScale`) or `frame.render` along
 * with `ctx`.
 *
 * Type-alias of {@link MeshHandle}; consumers can use either name.
 */
export type Mesh = MeshHandle;

/**
 * Engine-private slot data backing a {@link Mesh} handle in the meshes
 * pool. Not exported from the `@furnace/core/mesh` public surface.
 *
 * Holds the bound geometry and material handles plus a TRS pose.
 * `transformDirty` flags a pending model-matrix recompute; flipped by
 * the setters and cleared by `_recomputeModelIfDirty`. The Mesh→Geometry
 * and Mesh→Material refcounts are managed by `mesh.create` /
 * `mesh.destroy` (the slot here only holds the handles).
 */
export type MeshSlot = {
  geometry: Geometry;
  material: Material;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  modelMatrix: Mat4;
  normalMatrix: Mat4;
  transformDirty: boolean;
  objectBuffer: GPUBuffer;
  _teardown: () => void;
};

/**
 * Opaque instanced-mesh handle. Returned by {@link createInstanced} and
 * holds a reference to one bound geometry + material drawn `count` times
 * in a single draw call, each instance carrying its own baked model
 * matrix and tint. Pass to the per-instance setters
 * (`setInstanceTransform`, `setInstanceTint`, `setInstanceMatrices`,
 * `setInstanceCount`) or `frame.render` along with `ctx`.
 *
 * Requires an instanced shader/material (`shader.unlitInstanced` /
 * `shader.litInstanced`): the pipeline reads the per-instance model
 * matrix (vertex buffer slot 1) and tint (slot 2). Instance capacity
 * (`count`) is fixed at construction; the drawn prefix is adjustable via
 * `setInstanceCount`.
 *
 * Type-alias of {@link InstancedMeshHandle}; consumers can use either name.
 */
export type InstancedMesh = InstancedMeshHandle;

/**
 * Engine-private slot data backing an {@link InstancedMesh} handle in the
 * instanced-meshes pool. Not exported from the `@furnace/core/mesh`
 * public surface (re-exported only via `mesh/instanced.ts` for the render
 * path).
 *
 * Holds the bound geometry and material handles plus two parallel CPU
 * scratch arrays — `matrices` (16 floats per instance, baked model
 * matrices) and `tints` (4 floats per instance, default white) — mirrored
 * to the GPU `matrixBuffer` (vertex slot 1) and `tintBuffer` (vertex slot
 * 2). `count` is the allocated capacity (fixed); `drawCount` is the
 * drawn prefix (`<= count`). `dirty` flags pending CPU→GPU upload, set by
 * the setters and cleared by `_flushInstancedIfDirty`. The
 * InstancedMesh→Geometry and InstancedMesh→Material refcounts are managed
 * by `createInstanced` / `destroyInstanced` (the slot here only holds the
 * handles).
 */
export type InstancedMeshSlot = {
  geometry: Geometry;
  material: Material;
  count: number;
  drawCount: number;
  matrices: Float32Array;
  tints: Float32Array;
  matrixBuffer: GPUBuffer;
  tintBuffer: GPUBuffer;
  dirty: boolean;
  _teardown: () => void;
};
