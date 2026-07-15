import { CHUNK_DIM } from "./chunks.ts";
import type { ChunkMesh } from "./types.ts";

const N = CHUNK_DIM + 2; // apron edge (18 samples: -1..16)
const CELL_MIN = -1; // cells span samples c..c+1; c in [-1..15]
const CELL_COUNT = CHUNK_DIM + 1; // 17 cells per axis

// Flat endpoint pairs for the 12 cube edges (was a [number,number][]; flattened
// so the pass-1 edge loop indexes plain arrays instead of allocating an iterator
// + destructuring a tuple each step). Same 12 edges, same order.
const CUBE_EDGE_A = new Int8Array([0, 1, 2, 0, 4, 5, 6, 4, 0, 1, 2, 3]);
const CUBE_EDGE_B = new Int8Array([1, 3, 3, 2, 5, 7, 7, 6, 4, 5, 6, 7]);

// Flat per-axis corner offsets (was a [number,number,number][]; flattened so the
// hot loops read CORNER_{X,Y,Z}[c] instead of destructuring CORNER[c] per
// iteration). Same 8 corners in the same order.
const CORNER_X = new Int8Array([0, 1, 0, 1, 0, 1, 0, 1]);
const CORNER_Y = new Int8Array([0, 0, 1, 1, 0, 0, 1, 1]);
const CORNER_Z = new Int8Array([0, 0, 0, 0, 1, 1, 1, 1]);

// Flat axis unit vectors (was a [number,number,number][]). Same 3 axes.
const AXIS_X = new Int8Array([1, 0, 0]);
const AXIS_Y = new Int8Array([0, 1, 0]);
const AXIS_Z = new Int8Array([0, 0, 1]);

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
          const d = apronAt(
            apron,
            x + (CORNER_X[c] as number),
            y + (CORNER_Y[c] as number),
            z + (CORNER_Z[c] as number),
          );
          corners[c] = d;
          if (d >= 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 0xff) continue;

        let vx = 0;
        let vy = 0;
        let vz = 0;
        let n = 0;
        for (let e = 0; e < 12; e++) {
          const a = CUBE_EDGE_A[e] as number;
          const b = CUBE_EDGE_B[e] as number;
          const da = corners[a] as number;
          const db = corners[b] as number;
          if (da >= 0 === db >= 0) continue;
          const t = da / (da - db);
          const ax = CORNER_X[a] as number;
          const ay = CORNER_Y[a] as number;
          const az = CORNER_Z[a] as number;
          vx += ax + ((CORNER_X[b] as number) - ax) * t;
          vy += ay + ((CORNER_Y[b] as number) - ay) * t;
          vz += az + ((CORNER_Z[b] as number) - az) * t;
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
          const d = corners[c] as number;
          gx += d * ((CORNER_X[c] as number) === 1 ? 1 : -1);
          gy += d * ((CORNER_Y[c] as number) === 1 ? 1 : -1);
          gz += d * ((CORNER_Z[c] as number) === 1 ? 1 : -1);
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
          const d1 = apronAt(
            apron,
            x + (AXIS_X[a] as number),
            y + (AXIS_Y[a] as number),
            z + (AXIS_Z[a] as number),
          );
          if (d0 >= 0 === d1 >= 0) continue;

          // The four cells sharing this edge (p offset by the two axes ⟂ a).
          const a1 = (a + 1) % 3;
          const a2 = (a + 2) % 3;
          const ex = AXIS_X[a1] as number;
          const ey = AXIS_Y[a1] as number;
          const ez = AXIS_Z[a1] as number;
          const fx = AXIS_X[a2] as number;
          const fy = AXIS_Y[a2] as number;
          const fz = AXIS_Z[a2] as number;
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
