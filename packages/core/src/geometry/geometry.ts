import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import {
  _allocGeometry,
  _destroyGeometry,
  _lookupGeometry,
} from "../resources/internal.ts";
import { _recordAlloc, _recordDestroy } from "../stats/internal.ts";
import { computeBounds } from "./bounds.ts";
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
 * Returns an opaque {@link Geometry} handle. Destroy via {@link destroy}.
 * If a Mesh still references the geometry, `destroy` marks it for deferred
 * teardown; the actual GPU free runs when the last referencing mesh is
 * destroyed (`mesh.create` increments the refcount, `mesh.destroy`
 * decrements it).
 *
 * Setup-loud: validates `data` synchronously before touching the GPU.
 *
 * @throws FurnaceError - if `positions.length` is not a multiple of 3.
 * @throws FurnaceError - if `normals.length` does not equal `positions.length`
 *   (one `vec3` per vertex).
 * @throws FurnaceError - if `uvs.length` does not equal `(positions.length / 3) * 2`
 *   (one `vec2` per vertex).
 * @throws FurnaceError - if `opts.retainForCollision` is `true` but
 *   `data.indices` is absent (a trimesh collider requires an index buffer).
 */
export function create(
  ctx: Context,
  data: GeometryData,
  opts?: { retainForCollision?: boolean },
): Geometry {
  validateGeometryData(data);
  // Compute (and validate) retained collision indices BEFORE any GPU allocation,
  // so the retainForCollision-without-indices throw can't leak a half-built geometry.
  const collisionIndices = opts?.retainForCollision
    ? toU32Indices(data.indices)
    : undefined;
  const vertexCount = data.positions.length / 3;
  const bounds = computeBounds(data.positions);

  const interleaved = packInterleaved(data, vertexCount);
  const vertexBuffer = ctx.device.createBuffer({
    size: interleaved.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  ctx.queue.writeBuffer(vertexBuffer, 0, interleaved);
  const vertexBytes = interleaved.byteLength;
  _recordAlloc(ctx, "buffer", vertexBytes);

  const indexResources = createIndexResources(ctx, data.indices);
  const indexBytes =
    indexResources.buffer !== null ? indexResources.paddedByteLength : 0;
  if (indexBytes > 0) {
    _recordAlloc(ctx, "buffer", indexBytes);
  }

  const slot: GeometrySlot = {
    vertexBuffer,
    vertexCount,
    indexBuffer: indexResources.buffer,
    indexFormat: indexResources.format,
    indexCount: indexResources.count,
    boundsMin: bounds.min,
    boundsMax: bounds.max,
    userCount: 0,
    markedDestroyed: false,
    _teardown: () => geometryTeardown(ctx, slot, vertexBytes, indexBytes),
    collision: collisionIndices
      ? { vertices: data.positions, indices: collisionIndices }
      : undefined,
  };
  return _allocGeometry(ctx, slot);
}

function geometryTeardown(
  ctx: Context,
  slot: GeometrySlot,
  vertexBytes: number,
  indexBytes: number,
): void {
  slot.vertexBuffer.destroy();
  if (slot.indexBuffer) slot.indexBuffer.destroy();
  _recordDestroy(ctx, "buffer", vertexBytes);
  if (indexBytes > 0) {
    _recordDestroy(ctx, "buffer", indexBytes);
  }
}

/**
 * Destroy a {@link Geometry}. If a Mesh still references it
 * (`userCount > 0`), the slot is marked-destroyed and actual GPU teardown
 * waits until the last referencing mesh is destroyed (refcount-driven
 * cascade). Silent on stale or already-destroyed handles (idempotent).
 */
export function destroy(ctx: Context, geometry: Geometry): void {
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

/** Coerce optional index data to Uint32 for physics trimesh; require indices
 *  when retaining for collision (a trimesh collider needs an index buffer). */
function toU32Indices(
  indices: Uint16Array | Uint32Array | undefined,
): Uint32Array {
  if (!indices) {
    throw new FurnaceError(
      "geometry.create: retainForCollision requires indexed geometry (data.indices)",
    );
  }
  return indices instanceof Uint32Array ? indices : Uint32Array.from(indices);
}

/**
 * The retained CPU collision arrays (positions + u32 indices) for a geometry
 * built with `{ retainForCollision: true }`, or `null` if none were retained
 * (or the handle is stale). Feed these to a physics `trimesh` collider.
 *
 * @param ctx - The GPU context that owns the geometry.
 * @param geometry - The geometry handle to query.
 * @returns The retained `{ vertices, indices }` arrays, or `null`.
 */
export function getCollisionData(
  ctx: Context,
  geometry: Geometry,
): { vertices: Float32Array; indices: Uint32Array } | null {
  const slot = _lookupGeometry<GeometrySlot>(ctx, geometry);
  if (slot === null) return null;
  return slot.collision ?? null;
}
