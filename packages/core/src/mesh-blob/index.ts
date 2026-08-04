import { FurnaceError } from "../errors.ts";

/** Render geometry buffers for a mesh region. */
export type RenderBlock = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
};

/** Simplified collision geometry — vertices + indices (no normals/uvs needed). */
export type CollisionBlock = { vertices: Float32Array; indices: Uint32Array };

/** A self-describing binary mesh blob holding render + optional collision data. */
export type MeshBlob = { render: RenderBlock; collision?: CollisionBlock };

const MAGIC = 0x46_4d_53_48; // "FMSH"
const VERSION = 1;

const align4 = (n: number): number => (n + 3) & ~3;

type RegionLayout = { off: number; len: number };

type BlobHeader = {
  version: number;
  render: {
    vertexCount: number;
    indexCount: number;
    positions: RegionLayout;
    normals: RegionLayout;
    uvs: RegionLayout;
    indices: RegionLayout;
  };
  collision?: {
    vertexCount: number;
    indexCount: number;
    vertices: RegionLayout;
    indices: RegionLayout;
  };
};

/**
 * Encode a {@link MeshBlob} to a self-describing little-endian `ArrayBuffer`.
 *
 * Layout: `magic(4) + headerByteLen(4) + UTF-8 JSON header (padded to 4-byte
 * alignment) + 4-byte-aligned typed-array regions (render first, then optional
 * collision)`. Browser-safe: uses only `DataView`, `TextEncoder`, and typed arrays.
 */
export function encodeMeshBlob(blob: MeshBlob): ArrayBuffer {
  const regions: ArrayBufferView[] = [
    blob.render.positions,
    blob.render.normals,
    blob.render.uvs,
    blob.render.indices,
  ];
  if (blob.collision) {
    regions.push(blob.collision.vertices, blob.collision.indices);
  }

  const layout = buildLayout(regions);
  const binarySize = layout.totalBytes;

  const header: BlobHeader = {
    version: VERSION,
    render: {
      vertexCount: blob.render.positions.length / 3,
      indexCount: blob.render.indices.length,
      positions: layout.regions[0] as RegionLayout,
      normals: layout.regions[1] as RegionLayout,
      uvs: layout.regions[2] as RegionLayout,
      indices: layout.regions[3] as RegionLayout,
    },
    collision: blob.collision
      ? {
          vertexCount: blob.collision.vertices.length / 3,
          indexCount: blob.collision.indices.length,
          vertices: layout.regions[4] as RegionLayout,
          indices: layout.regions[5] as RegionLayout,
        }
      : undefined,
  };

  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const prefix = 8; // magic(4) + headerByteLen(4)
  const headerPadded = align4(headerBytes.length);
  const binStart = align4(prefix + headerPadded);
  const total = binStart + binarySize;

  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, headerBytes.length, true);
  new Uint8Array(out, prefix).set(headerBytes);

  for (let i = 0; i < regions.length; i++) {
    const r = regions[i] as ArrayBufferView;
    const l = layout.regions[i] as RegionLayout;
    new Uint8Array(out, binStart + l.off, l.len).set(
      new Uint8Array(r.buffer, r.byteOffset, r.byteLength),
    );
  }

  return out;
}

/**
 * Decode an `ArrayBuffer` produced by {@link encodeMeshBlob}.
 *
 * @throws {@link FurnaceError} if the magic number does not match.
 */
export function decodeMeshBlob(buf: ArrayBuffer): MeshBlob {
  const view = new DataView(buf);
  if (view.getUint32(0, true) !== MAGIC) {
    throw new FurnaceError("mesh-blob: bad magic (not a .fmesh buffer)");
  }

  const headerByteLen = view.getUint32(4, true);
  const prefix = 8;
  const headerBytes = new Uint8Array(buf, prefix, headerByteLen);
  const header = JSON.parse(
    new TextDecoder().decode(headerBytes),
  ) as BlobHeader;

  const headerPadded = align4(headerByteLen);
  const binStart = align4(prefix + headerPadded);

  const f32 = (r: RegionLayout): Float32Array =>
    new Float32Array(buf.slice(binStart + r.off, binStart + r.off + r.len));
  const u32 = (r: RegionLayout): Uint32Array =>
    new Uint32Array(buf.slice(binStart + r.off, binStart + r.off + r.len));

  const render: RenderBlock = {
    positions: f32(header.render.positions),
    normals: f32(header.render.normals),
    uvs: f32(header.render.uvs),
    indices: u32(header.render.indices),
  };

  if (!header.collision) {
    return { render };
  }

  const collision: CollisionBlock = {
    vertices: f32(header.collision.vertices),
    indices: u32(header.collision.indices),
  };
  return { render, collision };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type LayoutResult = { regions: RegionLayout[]; totalBytes: number };

function buildLayout(regions: ArrayBufferView[]): LayoutResult {
  const result: RegionLayout[] = [];
  let cursor = 0;
  for (const r of regions) {
    result.push({ off: cursor, len: r.byteLength });
    cursor = align4(cursor + r.byteLength);
  }
  return { regions: result, totalBytes: cursor };
}
