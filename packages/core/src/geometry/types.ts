import type { GeometryHandle } from "../resources/handle.ts";
import type { Vec3 } from "../transform/types.ts";

/**
 * Raw per-vertex arrays consumed by {@link create}. Layout is
 * de-interleaved: positions and normals are `vec3` per vertex (length `3N`),
 * uvs are `vec2` per vertex (length `2N`). `indices` is optional — omit for
 * non-indexed draws.
 *
 * The vertex count `N` is derived from `positions.length / 3`; `normals` and
 * `uvs` must match (validated synchronously by `create`).
 */
export type GeometryData = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices?: Uint16Array | Uint32Array;
};

/**
 * Opaque GPU geometry handle. Returned by {@link create} and the
 * built-in factories (`cube`, `plane`). Consumers pass it to `mesh.create`
 * (potentially shared across multiple meshes) and otherwise treat it as
 * opaque. To release, call `geometry.destroy(ctx, geometry)`.
 *
 * Type-alias of {@link GeometryHandle}; consumers can use either name.
 */
export type Geometry = GeometryHandle;

/**
 * Engine-private slot data backing a {@link Geometry} handle in the
 * geometries pool. Not exported from the `@furnace/core/geometry` public
 * surface; resource-manager internals only.
 *
 * Carries refcount fields (`userCount`, `markedDestroyed`) used by the
 * Mesh→Geometry deferred-free path: `destroy` while `userCount > 0`
 * sets `markedDestroyed` and skips actual GPU teardown; the last
 * `mesh.destroy` that drops `userCount` to zero then triggers teardown.
 */
export type GeometrySlot = {
  vertexBuffer: GPUBuffer;
  vertexCount: number;
  indexBuffer: GPUBuffer | null;
  indexFormat: GPUIndexFormat | null;
  indexCount: number;
  boundsMin: Vec3;
  boundsMax: Vec3;
  userCount: number;
  markedDestroyed: boolean;
  _teardown: () => void;
  /** Retained CPU copy (positions + u32 indices) for building a physics
   *  trimesh collider from this geometry. Set only when `create` is called
   *  with `{ retainForCollision: true }`; undefined otherwise. */
  collision?: { vertices: Float32Array; indices: Uint32Array };
};
