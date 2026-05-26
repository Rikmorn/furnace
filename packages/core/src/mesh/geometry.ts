import type { Context } from "../gpu/index.ts";
import {
  _registerResource,
  _unregisterResource,
  type ResourceHandle,
} from "../stats/internal.ts";
import { validateGeometryData } from "./geometry-validation.ts";
import type { Geometry, GeometryData } from "./types.ts";

const FLOATS_PER_VERTEX = 8;

// Boundary type — geometry handles stored on the Geometry object after create,
// read by destroyGeometry. Same-module write/read makes the localised cast in
// destroyGeometry the boundary mechanism.
type GeometryWithHandles = Geometry & {
  _geometryHandle: ResourceHandle;
  _vertexBufferHandle: ResourceHandle;
  _indexBufferHandle: ResourceHandle | null;
};

/**
 * Build a {@link Geometry} from raw per-vertex arrays. Packs `positions`,
 * `normals`, and `uvs` into a single interleaved vertex buffer with layout
 * `[pos.xyz, normal.xyz, uv.uv]` and a 32-byte stride (matching the layout
 * `material.create` declares). If `data.indices` is supplied, an index
 * buffer is also created.
 *
 * Allocates GPU buffers; ownership transfers to the returned `Geometry` and
 * is released by {@link destroyGeometry}.
 *
 * Setup-loud: validates `data` synchronously before touching the GPU.
 *
 * @throws FurnaceError - if `positions.length` is not a multiple of 3.
 * @throws FurnaceError - if `normals.length` does not equal `positions.length`
 *   (one `vec3` per vertex).
 * @throws FurnaceError - if `uvs.length` does not equal `(positions.length / 3) * 2`
 *   (one `vec2` per vertex).
 */
export function createGeometry(ctx: Context, data: GeometryData): Geometry {
  validateGeometryData(data);
  const vertexCount = data.positions.length / 3;

  const interleaved = packInterleaved(data, vertexCount);
  const vertexBuffer = ctx.device.createBuffer({
    size: interleaved.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  ctx.queue.writeBuffer(vertexBuffer, 0, interleaved);
  const _vertexBufferHandle = _registerResource(ctx, {
    kind: "buffer",
    bytes: interleaved.byteLength,
  });

  const indexResources = createIndexResources(ctx, data.indices);
  const _indexBufferHandle =
    indexResources.buffer !== null
      ? _registerResource(ctx, {
          kind: "buffer",
          bytes: indexResources.paddedByteLength,
        })
      : null;

  const _geometryHandle = _registerResource(ctx, { kind: "geometry" });

  const geometry: GeometryWithHandles = {
    ctx,
    vertexBuffer,
    vertexCount,
    indexBuffer: indexResources.buffer,
    indexFormat: indexResources.format,
    indexCount: indexResources.count,
    _geometryHandle,
    _vertexBufferHandle,
    _indexBufferHandle,
  };
  return geometry;
}

/**
 * Destroy a {@link Geometry}: destroy its vertex buffer (and index buffer, if
 * any) and unregister the resource handles from stats.
 *
 * Does **not** touch any {@link Mesh} that still holds this geometry — the
 * consumer owns that contract. Destroying a geometry that is still bound to
 * a live mesh will fail on the next draw with a GPU validation error.
 */
export function destroyGeometry(geometry: Geometry): void {
  // Boundary cast: geometry handles were stashed by createGeometry on the same Geometry instance; the cross-function invariant isn't expressible in the public Geometry type.
  const g = geometry as GeometryWithHandles;
  geometry.vertexBuffer.destroy();
  if (geometry.indexBuffer) geometry.indexBuffer.destroy();
  _unregisterResource(geometry.ctx, g._vertexBufferHandle);
  if (g._indexBufferHandle) {
    _unregisterResource(geometry.ctx, g._indexBufferHandle);
  }
  _unregisterResource(geometry.ctx, g._geometryHandle);
}

function packInterleaved(
  data: GeometryData,
  vertexCount: number,
): Float32Array {
  // Layout: [pos.x pos.y pos.z normal.x normal.y normal.z uv.u uv.v] per vertex.
  // Matches material's VERTEX_BUFFER_LAYOUT (32-byte stride).
  const out = new Float32Array(vertexCount * FLOATS_PER_VERTEX);
  for (let i = 0; i < vertexCount; i++) {
    const v = i * FLOATS_PER_VERTEX;
    const p = i * 3;
    const u = i * 2;
    out[v + 0] = data.positions[p] as number;
    out[v + 1] = data.positions[p + 1] as number;
    out[v + 2] = data.positions[p + 2] as number;
    out[v + 3] = data.normals[p] as number;
    out[v + 4] = data.normals[p + 1] as number;
    out[v + 5] = data.normals[p + 2] as number;
    out[v + 6] = data.uvs[u] as number;
    out[v + 7] = data.uvs[u + 1] as number;
  }
  return out;
}

type IndexResources = {
  buffer: GPUBuffer | null;
  format: GPUIndexFormat | null;
  count: number;
  paddedByteLength: number;
};

function createIndexResources(
  ctx: Context,
  indices: Uint16Array | Uint32Array | undefined,
): IndexResources {
  if (!indices) {
    return { buffer: null, format: null, count: 0, paddedByteLength: 0 };
  }
  const format: GPUIndexFormat =
    indices instanceof Uint32Array ? "uint32" : "uint16";
  // WebGPU requires writeBuffer / createBuffer sizes to be a multiple of 4 bytes.
  // Uint16 with an odd index count needs one trailing padding u16.
  const paddedByteLength = (indices.byteLength + 3) & ~3;
  const buffer = ctx.device.createBuffer({
    size: paddedByteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  if (paddedByteLength === indices.byteLength) {
    ctx.queue.writeBuffer(buffer, 0, indices);
  } else {
    const padded = new Uint8Array(paddedByteLength);
    padded.set(
      new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength),
    );
    ctx.queue.writeBuffer(buffer, 0, padded);
  }
  return { buffer, format, count: indices.length, paddedByteLength };
}
