import type { ChunkKey, FieldStore } from "./types.ts";

/** Samples per chunk edge. */
export const CHUNK_DIM = 16;
/** Samples per chunk (16³). */
export const CHUNK_SAMPLES = CHUNK_DIM * CHUNK_DIM * CHUNK_DIM;
/** Default sample spacing (m) — matches the proven collision resolution. */
export const DEFAULT_CELL_SIZE = 0.25;
/** Density quantization: stored int8 = clamp(round(metres * DENSITY_SCALE)). */
export const DENSITY_SCALE = 32;
/** Uniform rock (the value of every sample in an unallocated chunk). */
export const SOLID = -127;
/** Fully open air. */
export const AIR = 127;

/** Builds the key of the chunk holding chunk coords (cx,cy,cz). */
export const chunkKey = (cx: number, cy: number, cz: number): ChunkKey =>
  `${cx},${cy},${cz}`;

/** Parses a chunk key back to chunk coords. */
export function parseChunkKey(key: ChunkKey): [number, number, number] {
  const parts = key.split(",");
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** Floor-division of a sample coordinate to its chunk coordinate. */
export const voxelChunk = (v: number): number => Math.floor(v / CHUNK_DIM);

/** Creates an empty (all-solid, zero-allocation) field. */
export function createFieldStore(
  cellSize: number = DEFAULT_CELL_SIZE,
): FieldStore {
  return { cellSize, chunks: new Map(), materials: new Map() };
}

const localIndex = (x: number, y: number, z: number): number => {
  const lx = x - voxelChunk(x) * CHUNK_DIM;
  const ly = y - voxelChunk(y) * CHUNK_DIM;
  const lz = z - voxelChunk(z) * CHUNK_DIM;
  return lx + CHUNK_DIM * (ly + CHUNK_DIM * lz);
};

/** Density at sample (x,y,z); unallocated chunks read as SOLID. */
export function getDensity(
  store: FieldStore,
  x: number,
  y: number,
  z: number,
): number {
  const chunk = store.chunks.get(
    chunkKey(voxelChunk(x), voxelChunk(y), voxelChunk(z)),
  );
  if (chunk === undefined) return SOLID;
  return chunk[localIndex(x, y, z)] as number;
}

/** Writes density at sample (x,y,z), allocating the chunk (solid-filled) on
 *  first touch. Returns the chunk's key (the dirty unit). */
export function setDensity(
  store: FieldStore,
  x: number,
  y: number,
  z: number,
  d: number,
): ChunkKey {
  const key = chunkKey(voxelChunk(x), voxelChunk(y), voxelChunk(z));
  let chunk = store.chunks.get(key);
  if (chunk === undefined) {
    chunk = new Int8Array(CHUNK_SAMPLES).fill(SOLID);
    store.chunks.set(key, chunk);
  }
  chunk[localIndex(x, y, z)] = d;
  return key;
}

/** Copies samples [-1..16]³ of the chunk (18³, neighbors supplying the
 *  border planes) — the mesher's input window. */
export function extractApron(store: FieldStore, key: ChunkKey): Int8Array {
  const [cx, cy, cz] = parseChunkKey(key);
  const N = CHUNK_DIM + 2;
  const out = new Int8Array(N * N * N);
  const bx = cx * CHUNK_DIM;
  const by = cy * CHUNK_DIM;
  const bz = cz * CHUNK_DIM;
  let i = 0;
  for (let z = -1; z <= CHUNK_DIM; z++)
    for (let y = -1; y <= CHUNK_DIM; y++)
      for (let x = -1; x <= CHUNK_DIM; x++) {
        out[i++] = getDensity(store, bx + x, by + y, bz + z);
      }
  return out;
}

/** World position of a sample index along one axis. */
export const sampleToWorld = (v: number, cellSize: number): number =>
  v * cellSize;

/** Sample index containing a world position along one axis. */
export const worldToVoxel = (w: number, cellSize: number): number =>
  Math.floor(w / cellSize);
