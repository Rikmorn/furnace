import { CHUNK_DIM } from "./chunks.ts";
import type { ChunkMesh } from "./types.ts";

const N = CHUNK_DIM + 2; // apron edge (18 samples: -1..16)
const CELL_MIN = -1; // cells span samples c..c+1; c in [-1..15]
const CELL_COUNT = CHUNK_DIM + 1; // 17 cells per axis

const CUBE_EDGES: [number, number][] = [
  [0, 1],
  [1, 3],
  [2, 3],
  [0, 2],
  [4, 5],
  [5, 7],
  [6, 7],
  [4, 6],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

const CORNER: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];

const AXES: [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Density at sample coords (x,y,z) with x,y,z in [-1..16]. */
const apronAt = (a: Int8Array, x: number, y: number, z: number): number =>
  a[x + 1 + N * (y + 1 + N * (z + 1))] as number;

/**
 * Meshes one chunk from its 18³ apron (samples −1..16) via Surface Nets,
 * returning chunk-LOCAL vertex positions (metres). Density is air-positive
 * (>0 air, <0 rock, surface at 0).
 *
 * Watertight seams come from two rules working together:
 * - a vertex is placed for every sign-changing cell in −1..15, so boundary
 *   vertices are duplicated at identical world positions by adjacent chunks;
 * - a crossing quad is emitted only when the crossing edge's base sample lies
 *   in this chunk's own 16³ (the 3-of-6 ownership rule), so every crossing is
 *   emitted by exactly one chunk world-wide.
 *
 * @param apron - 18³ density window (`extractApron` output) for one chunk.
 * @param cellSize - sample spacing in metres.
 * @returns Positions/normals/uvs/indices for the chunk (empty when uniform).
 */
export function meshChunkApron(apron: Int8Array, cellSize: number): ChunkMesh {
  const cellVert = new Int32Array(CELL_COUNT * CELL_COUNT * CELL_COUNT).fill(
    -1,
  );
  const cellIdx = (x: number, y: number, z: number): number =>
    x - CELL_MIN + CELL_COUNT * (y - CELL_MIN + CELL_COUNT * (z - CELL_MIN));

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const corners = new Array<number>(8);

  // Pass 1: one vertex per sign-changing cell.
  for (let z = CELL_MIN; z < CELL_MIN + CELL_COUNT; z++)
    for (let y = CELL_MIN; y < CELL_MIN + CELL_COUNT; y++)
      for (let x = CELL_MIN; x < CELL_MIN + CELL_COUNT; x++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [ox, oy, oz] = CORNER[c] as [number, number, number];
          const d = apronAt(apron, x + ox, y + oy, z + oz);
          corners[c] = d;
          if (d >= 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 0xff) continue;

        let vx = 0;
        let vy = 0;
        let vz = 0;
        let n = 0;
        for (const [a, b] of CUBE_EDGES) {
          const da = corners[a] as number;
          const db = corners[b] as number;
          if (da >= 0 === db >= 0) continue;
          const t = da / (da - db);
          const [ax, ay, az] = CORNER[a] as [number, number, number];
          const [bx, by, bz] = CORNER[b] as [number, number, number];
          vx += ax + (bx - ax) * t;
          vy += ay + (by - ay) * t;
          vz += az + (bz - az) * t;
          n++;
        }
        vx /= n;
        vy /= n;
        vz /= n;

        // Gradient of an air-positive field points into air, so +gradient is
        // the outward (rock→air) normal.
        let gx = 0;
        let gy = 0;
        let gz = 0;
        for (let c = 0; c < 8; c++) {
          const [ox, oy, oz] = CORNER[c] as [number, number, number];
          const d = corners[c] as number;
          gx += d * (ox === 1 ? 1 : -1);
          gy += d * (oy === 1 ? 1 : -1);
          gz += d * (oz === 1 ? 1 : -1);
        }
        const glen = Math.hypot(gx, gy, gz) || 1;

        cellVert[cellIdx(x, y, z)] = positions.length / 3;
        const px = (x + vx) * cellSize;
        const py = (y + vy) * cellSize;
        const pz = (z + vz) * cellSize;
        positions.push(px, py, pz);
        normals.push(gx / glen, gy / glen, gz / glen);
        uvs.push(px, pz);
      }

  // Pass 2: owned crossings -> quads. A crossing is owned when its base sample
  // lies in this chunk's own 16³ (0..15).
  const indices: number[] = [];
  for (let z = 0; z < CHUNK_DIM; z++)
    for (let y = 0; y < CHUNK_DIM; y++)
      for (let x = 0; x < CHUNK_DIM; x++) {
        const d0 = apronAt(apron, x, y, z);
        for (let a = 0; a < 3; a++) {
          const [dx, dy, dz] = AXES[a] as [number, number, number];
          const d1 = apronAt(apron, x + dx, y + dy, z + dz);
          if (d0 >= 0 === d1 >= 0) continue;

          // The four cells sharing this edge (p offset by the two axes ⟂ a).
          const [ex, ey, ez] = AXES[(a + 1) % 3] as [number, number, number];
          const [fx, fy, fz] = AXES[(a + 2) % 3] as [number, number, number];
          const v00 = cellVert[
            cellIdx(x - ex - fx, y - ey - fy, z - ez - fz)
          ] as number;
          const v01 = cellVert[cellIdx(x - ex, y - ey, z - ez)] as number;
          const v10 = cellVert[cellIdx(x - fx, y - fy, z - fz)] as number;
          const v11 = cellVert[cellIdx(x, y, z)] as number;
          if (v00 < 0 || v01 < 0 || v10 < 0 || v11 < 0) continue;

          // Wind so the face points toward the air side: base air (d0 >= 0) ->
          // face −axis; base rock -> face +axis.
          if (d0 >= 0) indices.push(v00, v01, v11, v00, v11, v10);
          else indices.push(v00, v10, v11, v00, v11, v01);
        }
      }

  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
  };
}
