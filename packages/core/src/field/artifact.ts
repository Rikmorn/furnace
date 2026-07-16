import { encodeMeshBlob } from "@furnace/core/scene";
import {
  CHUNK_DIM,
  CHUNK_SAMPLES,
  extractFieldAprons,
  parseChunkKey,
} from "./chunks.ts";
import { meshChunkField } from "./mesher.ts";
import { skinChunkKit } from "./skin.ts";
import type {
  BrushShape,
  ChunkKey,
  ChunkMaterials,
  FieldManifest,
  FieldOp,
  FieldStore,
  MaterialTable,
  OpLog,
} from "./types.ts";
import { MAT_ROCK } from "./types.ts";

const CHUNK_MAGIC = 0x46_46_43_31; // "FFC1"
const CHUNK_FILE_VERSION = 1;
const CHUNK_HEADER_BYTES = 8; // magic(4) + version(4)

// Material file (FFM1): mirrors the chunk file's little-endian u32 header. The
// magic constant + version are what interop hinges on; encode/decode agree on
// endianness so the on-disk byte order is an internal detail.
const MAT_MAGIC = 0x46_46_4d_31; // "FFM1"
const MAT_FILE_VERSION = 1;
const MAT_HEADER_BYTES = 8; // magic(4) + version(4)
const MAT_KIND_UNIFORM = 0;
const MAT_KIND_INDEXED = 1;

/** One entry of a baked file set: a repo-relative path and its bytes/text. */
export type BakedFile = { path: string; contents: string | Uint8Array };

/**
 * Encodes one chunk's densities as a binary file: `magic(4) + version(4) +
 * 4096 Int8` samples. Int8 and Uint8 share their byte representation, so the
 * payload is copied byte-for-byte.
 */
export function encodeChunkFile(chunk: Int8Array): Uint8Array {
  const out = new Uint8Array(CHUNK_HEADER_BYTES + CHUNK_SAMPLES);
  const view = new DataView(out.buffer);
  view.setUint32(0, CHUNK_MAGIC, true);
  view.setUint32(4, CHUNK_FILE_VERSION, true);
  out.set(
    new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
    CHUNK_HEADER_BYTES,
  );
  return out;
}

/**
 * Decodes a chunk file produced by {@link encodeChunkFile}.
 *
 * @throws {@link Error} if the length, magic number, or version is wrong.
 */
export function decodeChunkFile(bytes: Uint8Array): Int8Array {
  if (bytes.byteLength !== CHUNK_HEADER_BYTES + CHUNK_SAMPLES) {
    throw new Error(`field chunk file: bad length ${bytes.byteLength}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== CHUNK_MAGIC) {
    throw new Error("field chunk file: bad magic");
  }
  if (view.getUint32(4, true) !== CHUNK_FILE_VERSION) {
    throw new Error("field chunk file: unknown version");
  }
  return new Int8Array(
    bytes.buffer,
    bytes.byteOffset + CHUNK_HEADER_BYTES,
    CHUNK_SAMPLES,
  ).slice();
}

/**
 * Encodes one chunk's material storage as a binary file: `magic(4) + version(4)
 * + kind(1)`, then either a uniform `classId(1)` or an indexed `paletteLen(1) +
 * palette(paletteLen) + bits(1) + packed(ceil(CHUNK_SAMPLES·bits/8))`. Mirrors
 * {@link encodeChunkFile}'s little-endian u32 header; the payload matches the
 * private {@link ChunkMaterials} encoding byte-for-byte.
 */
export function encodeMaterialFile(m: ChunkMaterials): Uint8Array {
  const bodyLen =
    m.kind === "uniform"
      ? 2 // kind(1) + classId(1)
      : 3 + m.palette.length + m.packed.length; // kind + paletteLen + bits + palette + packed
  const out = new Uint8Array(MAT_HEADER_BYTES + bodyLen);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAT_MAGIC, true);
  view.setUint32(4, MAT_FILE_VERSION, true);
  if (m.kind === "uniform") {
    out[MAT_HEADER_BYTES] = MAT_KIND_UNIFORM;
    out[MAT_HEADER_BYTES + 1] = m.classId;
    return out;
  }
  let o = MAT_HEADER_BYTES;
  out[o++] = MAT_KIND_INDEXED;
  out[o++] = m.palette.length;
  out.set(m.palette, o);
  o += m.palette.length;
  out[o++] = m.bits;
  out.set(m.packed, o);
  return out;
}

/**
 * Decodes a material file produced by {@link encodeMaterialFile}.
 *
 * @throws {@link Error} if the magic number, version, or kind byte is wrong, or
 *   if the packed region is not `ceil(CHUNK_SAMPLES · bits / 8)` bytes.
 */
export function decodeMaterialFile(bytes: Uint8Array): ChunkMaterials {
  if (bytes.byteLength < MAT_HEADER_BYTES + 2) {
    throw new Error(`field material file: bad length ${bytes.byteLength}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAT_MAGIC) {
    throw new Error("field material file: bad magic");
  }
  if (view.getUint32(4, true) !== MAT_FILE_VERSION) {
    throw new Error("field material file: unknown version");
  }
  let o = MAT_HEADER_BYTES;
  const kind = bytes[o++] as number;
  if (kind === MAT_KIND_UNIFORM) {
    // Strict exact length, symmetric with the indexed branch's packed check and
    // with encodeChunkFile's decoder: a uniform file is header + kind + classId,
    // nothing more — trailing bytes mean corruption.
    if (bytes.byteLength !== MAT_HEADER_BYTES + 2) {
      throw new Error("field material file: bad uniform length");
    }
    return { kind: "uniform", classId: bytes[o] as number };
  }
  if (kind !== MAT_KIND_INDEXED) {
    throw new Error(`field material file: unknown kind ${kind}`);
  }
  const paletteLen = bytes[o++] as number;
  const palette = bytes.slice(o, o + paletteLen);
  o += paletteLen;
  const bits = bytes[o++] as number;
  const expectedPacked = Math.ceil((CHUNK_SAMPLES * bits) / 8);
  const available = bytes.byteLength - o;
  if (available !== expectedPacked) {
    throw new Error(
      `field material file: packed length ${available} != expected ${expectedPacked}`,
    );
  }
  const packed = bytes.slice(o, o + expectedPacked);
  return { kind: "indexed", palette, bits, packed };
}

/** A pre-F2 dig op literal (`kind:"dig"`) as F1 baked it — mapped to a
 *  brush/dig op on parse. */
type LegacyDigOp = { id: number; kind: "dig"; shape: BrushShape };

/** Serializes the op list (the authoring truth — brush AND entity ops) as a
 *  JSON string. */
export const serializeOps = (ops: FieldOp[]): string => JSON.stringify(ops);

/** Parses an oplog JSON string back into the op list; F1 logs (`kind:"dig"`)
 *  map forward to brush/dig ops; entity ops pass through. */
export const parseOps = (text: string): FieldOp[] =>
  (JSON.parse(text) as (FieldOp | LegacyDigOp)[]).map((o) =>
    o.kind === "dig"
      ? { id: o.id, kind: "brush", effect: "dig", shape: o.shape }
      : o,
  );

/** File-name-safe key segment ("cx,cy,cz" → "cx_cy_cz"). */
const keyToFileName = (key: ChunkKey): string => key.replaceAll(",", "_");

/** World-dir-relative density-file path for a chunk ("chunks/cx_cy_cz.bin"). */
const chunkRelPath = (key: ChunkKey): string =>
  `chunks/${keyToFileName(key)}.bin`;

/** World-dir-relative render-mesh path for one per-class bucket
 *  ("meshes/cx_cy_cz.c<classId>[b].fmesh"; a `b` suffix marks a kit BACKING
 *  bucket, e.g. `0_0_0.c2b.fmesh`). Unique per (chunk, classId, backing); the
 *  manifest entry carries the authoritative classId/backing — the name is for
 *  human legibility only. */
const meshRelPath = (
  key: ChunkKey,
  classId: number,
  backing: boolean,
): string =>
  `meshes/${keyToFileName(key)}.c${classId}${backing ? "b" : ""}.fmesh`;

/** World-dir-relative material-sibling path ("materials/cx_cy_cz.mat"). */
const materialRelPath = (key: ChunkKey): string =>
  `materials/${keyToFileName(key)}.mat`;

/** World-dir-relative kit-instance path ("kit/cx_cy_cz.json"). */
const kitRelPath = (key: ChunkKey): string => `kit/${keyToFileName(key)}.json`;

/** True when a chunk's material storage is a real non-rock presence — anything
 *  other than the uniform-{@link MAT_ROCK} default every untracked chunk already
 *  implies. Only these chunks get a baked `.mat` sibling. */
const hasMaterialPresence = (
  m: ChunkMaterials | undefined,
): m is ChunkMaterials =>
  m !== undefined && !(m.kind === "uniform" && m.classId === MAT_ROCK);

/** Full baked path of a chunk's density file ("worlds/<name>/chunks/…"). */
export const chunkFilePath = (name: string, key: ChunkKey): string =>
  `worlds/${name}/${chunkRelPath(key)}`;

/** Options for {@link bakeFieldWorld}. */
export type BakeFieldWorldOptions = {
  name: string;
  playerStart: [number, number, number];
  playerYaw: number;
};

/**
 * Bakes the full v0 artifact for a field world: a v2 manifest + one per-chunk
 * density file (authoring truth) + the oplog JSON + one `.fmesh` render mesh per
 * NON-EMPTY per-class bucket (the derived runtime bake) + a `.mat` material
 * sibling for every chunk with a real non-rock material + a `kit/*.json` for
 * every chunk holding kit pieces. The resolved `table` is embedded in the
 * manifest so the artifact is self-contained.
 *
 * Pure — returns the file set; the caller owns writing/uploading. The manifest
 * is emitted LAST so a partial write never yields a manifest referencing files
 * that were not written. Manifest `*.file` fields are relative to the world dir;
 * the returned `path`s are the full baked paths.
 *
 * @param store - the field store to bake.
 * @param log - the op log (authoring truth, serialized to `oplog.json`).
 * @param table - the resolved material table. The mesher + skinner dispatch on
 *   class via {@link classOf}, which THROWS on a class id absent from the table,
 *   so it MUST cover every material the store references.
 * @param opts - world name + runtime spawn pose.
 * @throws {@link Error} if the store references a class id absent from `table`.
 */
export function bakeFieldWorld(
  store: FieldStore,
  log: OpLog,
  table: MaterialTable,
  opts: BakeFieldWorldOptions,
): BakedFile[] {
  const files: BakedFile[] = [];
  const materials: { key: ChunkKey; file: string }[] = [];
  const kit: { key: ChunkKey; file: string }[] = [];
  const manifest: FieldManifest = {
    version: 2,
    kind: "field",
    cellSize: store.cellSize,
    playerStart: opts.playerStart,
    playerYaw: opts.playerYaw,
    chunks: [],
    meshes: [],
    materialTable: table,
  };

  for (const [key, chunk] of store.chunks) {
    manifest.chunks.push({ key, file: chunkRelPath(key) });
    files.push({
      path: chunkFilePath(opts.name, key),
      contents: encodeChunkFile(chunk),
    });

    const mat = store.materials.get(key);
    if (hasMaterialPresence(mat)) {
      const matFile = materialRelPath(key);
      materials.push({ key, file: matFile });
      files.push({
        path: `worlds/${opts.name}/${matFile}`,
        contents: encodeMaterialFile(mat),
      });
    }

    const aprons = extractFieldAprons(store, key);
    const [cx, cy, cz] = parseChunkKey(key);
    const origin: [number, number, number] = [
      cx * CHUNK_DIM * store.cellSize,
      cy * CHUNK_DIM * store.cellSize,
      cz * CHUNK_DIM * store.cellSize,
    ];
    for (const bucket of meshChunkField(aprons, table, store.cellSize)
      .buckets) {
      if (bucket.mesh.indices.length === 0) continue;
      const meshFile = meshRelPath(key, bucket.classId, bucket.backing);
      manifest.meshes.push({
        key,
        file: meshFile,
        origin,
        classId: bucket.classId,
        backing: bucket.backing,
      });
      files.push({
        path: `worlds/${opts.name}/${meshFile}`,
        contents: new Uint8Array(encodeMeshBlob({ render: bucket.mesh })),
      });
    }

    const pieces = skinChunkKit(aprons, table, store.cellSize, key);
    if (pieces.length > 0) {
      const kitFile = kitRelPath(key);
      kit.push({ key, file: kitFile });
      files.push({
        path: `worlds/${opts.name}/${kitFile}`,
        contents: JSON.stringify(pieces),
      });
    }
  }

  if (materials.length > 0) manifest.materials = materials;
  if (kit.length > 0) manifest.kit = kit;

  files.push({
    path: `worlds/${opts.name}/oplog.json`,
    contents: serializeOps(log.ops),
  });
  files.push({
    path: `worlds/${opts.name}/manifest.json`,
    contents: JSON.stringify(manifest, null, 2),
  });
  return files;
}
