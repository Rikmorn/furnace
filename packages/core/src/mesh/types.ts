import type { Context } from "../gpu/index.ts";
import type { Material } from "../material/types.ts";
import type { GeometryHandle } from "../resources/handle.ts";
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
 * The refcount itself is wired up in Task 2.2 (Mesh migration); today
 * `userCount` stays at `0` and `destroyGeometry` always tears down
 * immediately.
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
 * Opaque mesh handle returned by {@link create}. Holds the bound geometry +
 * material plus a TRS pose (position, rotation, scale) that drives the
 * per-mesh object-uniform buffer.
 *
 * Mutate only via the provided setters (`setPosition`, `setRotation`,
 * `setScale`) — direct field writes will not flip `transformDirty` and the
 * model matrix will go stale.
 */
export type Mesh = {
  ctx: Context;
  geometry: Geometry;
  material: Material;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  modelMatrix: Mat4;
  transformDirty: boolean;
  objectBuffer: GPUBuffer;
};
