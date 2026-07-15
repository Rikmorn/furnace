import { CHUNK_DIM, getDensity, parseChunkKey } from "./chunks.ts";
import type { ChunkCollider, ChunkKey, FieldStore } from "./types.ts";

/** Derives the voxel collider for one chunk: solid samples with at least one
 *  air 6-neighbor (the shell — interior rock is unreachable; missing-chunk
 *  neighbors read SOLID, matching the proven proxy "off-grid = solid" rule).
 *  Coords are LOCAL grid ints; body position = the returned `position`
 *  (corner-anchored, HALF_VOXEL = 0 — the proxy.ts convention). Returns null
 *  for chunks with no shell (uniform or unallocated). */
export function chunkColliders(
  store: FieldStore,
  key: ChunkKey,
): ChunkCollider | null {
  const chunk = store.chunks.get(key);
  if (chunk === undefined) return null;
  const [cx, cy, cz] = parseChunkKey(key);
  const bx = cx * CHUNK_DIM;
  const by = cy * CHUNK_DIM;
  const bz = cz * CHUNK_DIM;
  const coords: number[] = [];
  for (let z = 0; z < CHUNK_DIM; z++)
    for (let y = 0; y < CHUNK_DIM; y++)
      for (let x = 0; x < CHUNK_DIM; x++) {
        const gx = bx + x;
        const gy = by + y;
        const gz = bz + z;
        if (getDensity(store, gx, gy, gz) >= 0) continue; // air
        const shell =
          getDensity(store, gx + 1, gy, gz) >= 0 ||
          getDensity(store, gx - 1, gy, gz) >= 0 ||
          getDensity(store, gx, gy + 1, gz) >= 0 ||
          getDensity(store, gx, gy - 1, gz) >= 0 ||
          getDensity(store, gx, gy, gz + 1) >= 0 ||
          getDensity(store, gx, gy, gz - 1) >= 0;
        if (shell) coords.push(x, y, z);
      }
  if (coords.length === 0) return null;
  const h = store.cellSize;
  return {
    coords: Int32Array.from(coords),
    size: [h, h, h],
    position: [bx * h, by * h, bz * h],
  };
}
