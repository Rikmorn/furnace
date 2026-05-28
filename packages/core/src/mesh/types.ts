import type { Context } from "../gpu/index.ts";
import type { Material } from "../material/types.ts";
import type { GeometryHandle, MeshHandle } from "../resources/handle.ts";
import type { Mat4, Quat, Vec3 } from "../transform/types.ts";

/**
 * Raw per-vertex arrays consumed by {@link createGeometry}. Layout is
 * de-interleaved: positions and normals are `vec3` per vertex (length `3N`),
 * uvs are `vec2` per vertex (length `2N`). `indices` is optional — omit for
 * non-indexed draws.
 *
 * The vertex count `N` is derived from `positions.length / 3`; `normals` and
 * `uvs` must match (validated synchronously by `createGeometry`).
 */
export type GeometryData = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices?: Uint16Array | Uint32Array;
};

/**
 * Opaque GPU geometry handle. Returned by {@link createGeometry} and the
 * built-in factories (`cubeGeometry`, `planeGeometry`). Consumers pass it
 * to `mesh.create` (potentially shared across multiple meshes) and otherwise
 * treat it as opaque. To release, call `mesh.destroyGeometry(ctx, geometry)`.
 *
 * Type-alias of {@link GeometryHandle}; consumers can use either name.
 */
export type Geometry = GeometryHandle;

/**
 * Engine-private slot data backing a {@link Geometry} handle in the
 * geometries pool. Not exported from the `@furnace/core/mesh` public
 * surface; resource-manager internals only.
 *
 * Carries refcount fields (`userCount`, `markedDestroyed`) used by the
 * Mesh→Geometry deferred-free path: `destroyGeometry` while `userCount > 0`
 * sets `markedDestroyed` and skips actual GPU teardown; the last
 * `mesh.destroy` that drops `userCount` to zero then triggers teardown.
 */
export type GeometrySlot = {
  ctx: Context;
  vertexBuffer: GPUBuffer;
  vertexCount: number;
  indexBuffer: GPUBuffer | null;
  indexFormat: GPUIndexFormat | null;
  indexCount: number;
  userCount: number;
  markedDestroyed: boolean;
  _teardown: () => void;
};

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
 * Holds the bound geometry handle, material reference (still an object
 * during the Sessions 2-4 migration window), and TRS pose. `transformDirty`
 * flags a pending model-matrix recompute; flipped by the setters and
 * cleared by `_recomputeModelIfDirty`.
 */
export type MeshSlot = {
  ctx: Context;
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
