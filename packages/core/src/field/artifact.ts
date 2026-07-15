import { encodeMeshBlob } from "@furnace/core/scene";
import {
  CHUNK_DIM,
  CHUNK_SAMPLES,
  extractApron,
  parseChunkKey,
} from "./chunks.ts";
import { meshChunkApron } from "./mesher.ts";
import type {
  BrushOp,
  BrushShape,
  ChunkKey,
  FieldManifest,
  FieldStore,
  OpLog,
} from "./types.ts";

const CHUNK_MAGIC = 0x46_46_43_31; // "FFC1"
const CHUNK_FILE_VERSION = 1;
const CHUNK_HEADER_BYTES = 8; // magic(4) + version(4)

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

/** A pre-F2 dig op literal (`kind:"dig"`) as F1 baked it — mapped to a
 *  brush/dig op on parse. */
type LegacyDigOp = { id: number; kind: "dig"; shape: BrushShape };

/** Serializes the op list (the authoring truth) as a JSON string. */
export const serializeOps = (ops: BrushOp[]): string => JSON.stringify(ops);

/** Parses an oplog JSON string back into the op list; F1 logs (`kind:"dig"`)
 *  map forward to brush/dig ops. */
export const parseOps = (text: string): BrushOp[] =>
  (JSON.parse(text) as (BrushOp | LegacyDigOp)[]).map((o) =>
    o.kind === "dig"
      ? { id: o.id, kind: "brush", effect: "dig", shape: o.shape }
      : o,
  );

/** File-name-safe key segment ("cx,cy,cz" → "cx_cy_cz"). */
const keyToFileName = (key: ChunkKey): string => key.replaceAll(",", "_");

/** World-dir-relative density-file path for a chunk ("chunks/cx_cy_cz.bin"). */
const chunkRelPath = (key: ChunkKey): string =>
  `chunks/${keyToFileName(key)}.bin`;

/** World-dir-relative render-mesh path for a chunk ("meshes/cx_cy_cz.fmesh"). */
const meshRelPath = (key: ChunkKey): string =>
  `meshes/${keyToFileName(key)}.fmesh`;

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
 * density file (authoring truth) + the oplog JSON + one `.fmesh` render mesh
 * per carved chunk (the derived runtime bake).
 *
 * Pure — returns the file set; the caller owns writing/uploading. The manifest
 * is emitted last so a partial write never yields a manifest referencing files
 * that were not written. Manifest `chunks[].file` / `meshes[].file` are
 * relative to the world dir; the returned `path`s are the full baked paths.
 */
export function bakeFieldWorld(
  store: FieldStore,
  log: OpLog,
  opts: BakeFieldWorldOptions,
): BakedFile[] {
  const files: BakedFile[] = [];
  const manifest: FieldManifest = {
    version: 2,
    kind: "field",
    cellSize: store.cellSize,
    playerStart: opts.playerStart,
    playerYaw: opts.playerYaw,
    chunks: [],
    meshes: [],
  };

  for (const [key, chunk] of store.chunks) {
    manifest.chunks.push({ key, file: chunkRelPath(key) });
    files.push({
      path: chunkFilePath(opts.name, key),
      contents: encodeChunkFile(chunk),
    });

    const mesh = meshChunkApron(extractApron(store, key), store.cellSize);
    if (mesh.indices.length === 0) continue;

    const [cx, cy, cz] = parseChunkKey(key);
    const meshFile = meshRelPath(key);
    manifest.meshes.push({
      key,
      file: meshFile,
      origin: [
        cx * CHUNK_DIM * store.cellSize,
        cy * CHUNK_DIM * store.cellSize,
        cz * CHUNK_DIM * store.cellSize,
      ],
    });
    files.push({
      path: `worlds/${opts.name}/${meshFile}`,
      contents: new Uint8Array(encodeMeshBlob({ render: mesh })),
    });
  }

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
