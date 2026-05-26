import type { Context } from "../gpu/index.ts";
import type { Material } from "../material/types.ts";
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
 * Opaque GPU geometry handle returned by {@link createGeometry} and the
 * built-in factories (`cubeGeometry`, `planeGeometry`). Consumers pass it to
 * `mesh.create` (potentially shared across multiple meshes) and otherwise
 * treat it as opaque.
 *
 * Triangle count is not stored on `Geometry` — it is derived per draw inside
 * `frame.render` from `mesh.material.topology`.
 */
export type Geometry = {
  ctx: Context;
  vertexBuffer: GPUBuffer;
  vertexCount: number;
  indexBuffer: GPUBuffer | null;
  indexFormat: GPUIndexFormat | null;
  indexCount: number;
};

/**
 * Opaque mesh handle returned by {@link create} and the convenience factories
 * (`cube`, `plane`). Holds the bound geometry + material plus a TRS pose
 * (position, rotation, scale) that drives the per-mesh object-uniform buffer.
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
