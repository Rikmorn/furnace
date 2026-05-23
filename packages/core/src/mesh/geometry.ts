import type { Context } from "../gpu/index.ts";
import { validateGeometryData } from "./geometry-validation.ts";
import type { Geometry, GeometryData } from "./types.ts";

const FLOATS_PER_VERTEX = 8;

export function createGeometry(ctx: Context, data: GeometryData): Geometry {
  validateGeometryData(data);
  const vertexCount = data.positions.length / 3;

  const interleaved = packInterleaved(data, vertexCount);
  const vertexBuffer = ctx.device.createBuffer({
    size: interleaved.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  ctx.queue.writeBuffer(vertexBuffer, 0, interleaved);

  const indexResources = createIndexResources(ctx, data.indices);

  const geometry: Geometry = {
    ctx,
    vertexBuffer,
    vertexCount,
    indexBuffer: indexResources.buffer,
    indexFormat: indexResources.format,
    indexCount: indexResources.count,
  };
  return geometry;
}

export function destroyGeometry(geometry: Geometry): void {
  geometry.vertexBuffer.destroy();
  if (geometry.indexBuffer) geometry.indexBuffer.destroy();
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
};

function createIndexResources(
  ctx: Context,
  indices: Uint16Array | Uint32Array | undefined,
): IndexResources {
  if (!indices) return { buffer: null, format: null, count: 0 };
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
  return { buffer, format, count: indices.length };
}
