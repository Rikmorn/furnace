import type { Context } from "../gpu/index.ts";
import {
  _allocGeometry,
  _destroyGeometry,
  _lookupGeometry,
} from "../resources/internal.ts";
import {
  _registerResource,
  _unregisterResource,
  type ResourceHandle,
} from "../stats/internal.ts";
import { validateGeometryData } from "./geometry-validation.ts";
import type { Geometry, GeometryData, GeometrySlot } from "./types.ts";

const FLOATS_PER_VERTEX = 8;

/**
 * Build a {@link Geometry} from raw per-vertex arrays. Packs `positions`,
 * `normals`, and `uvs` into a single interleaved vertex buffer with layout
 * `[pos.xyz, normal.xyz, uv.uv]` and a 32-byte stride (matching the layout
 * `material.create` declares). If `data.indices` is supplied, an index
 * buffer is also created.
 *
 * Returns an opaque {@link Geometry} handle. Destroy via
 * {@link destroyGeometry}. If a Mesh still references the geometry,
 * `destroyGeometry` marks it for deferred teardown; the actual GPU free
 * runs when the last referencing mesh is destroyed (refcount wiring
 * arrives with Task 2.2 — today the refcount is always zero).
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

  const slot: GeometrySlot = {
    ctx,
    vertexBuffer,
    vertexCount,
    indexBuffer: indexResources.buffer,
    indexFormat: indexResources.format,
    indexCount: indexResources.count,
    userCount: 0,
    markedDestroyed: false,
    _teardown: () =>
      geometryTeardown(
        slot,
        _geometryHandle,
        _vertexBufferHandle,
        _indexBufferHandle,
      ),
  };
  return _allocGeometry(ctx, slot);
}

function geometryTeardown(
  slot: GeometrySlot,
  geometryHandle: ResourceHandle,
  vertexHandle: ResourceHandle,
  indexHandle: ResourceHandle | null,
): void {
  slot.vertexBuffer.destroy();
  if (slot.indexBuffer) slot.indexBuffer.destroy();
  _unregisterResource(slot.ctx, vertexHandle);
  if (indexHandle) _unregisterResource(slot.ctx, indexHandle);
  _unregisterResource(slot.ctx, geometryHandle);
}

/**
 * Destroy a {@link Geometry}. If a Mesh still references it
 * (`userCount > 0`), the slot is marked-destroyed and actual GPU teardown
 * waits until the last referencing mesh is destroyed (refcount-driven
 * cascade — wired up in Task 2.2). Silent on stale or already-destroyed
 * handles (idempotent).
 */
export function destroyGeometry(ctx: Context, geometry: Geometry): void {
  const slot = _lookupGeometry<GeometrySlot>(ctx, geometry);
  if (slot === null) return;
  if (slot.userCount > 0) {
    slot.markedDestroyed = true;
    return;
  }
  _destroyGeometry<GeometrySlot>(ctx, geometry, (s) => {
    s._teardown();
  });
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
