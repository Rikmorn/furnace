import type { Context } from "../gpu/index.ts";
import type { Material } from "../material/types.ts";
import type { Mat4, Quat, Vec3 } from "../transform/types.ts";

export type GeometryData = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices?: Uint16Array | Uint32Array;
};

export type Geometry = {
  ctx: Context;
  vertexBuffer: GPUBuffer;
  vertexCount: number;
  indexBuffer: GPUBuffer | null;
  indexFormat: GPUIndexFormat | null;
  indexCount: number;
  // (indexCount || vertexCount) / 3 — assumes triangle-list topology.
  triangleCount: number;
};

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
  // Cached group-0 bind group per (pipeline, mesh). Rebuilt if material changes (out of scope).
  group0: GPUBindGroup | null;
  group0Pipeline: GPURenderPipeline | null;
};
