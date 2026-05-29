import type { Geometry } from "../geometry/types.ts";
import type { Material } from "../material/types.ts";
import type { MeshHandle } from "../resources/handle.ts";
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
  transformDirty: boolean;
  objectBuffer: GPUBuffer;
  _teardown: () => void;
};
