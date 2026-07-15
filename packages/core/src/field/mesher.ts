import { CHUNK_DIM } from "./chunks.ts";
import { classOf } from "./materials.ts";
import type {
  ChunkMesh,
  FieldAprons,
  FieldChunkMeshes,
  MaterialTable,
  MeshBucket,
} from "./types.ts";

const N = CHUNK_DIM + 4; // apron edge (20 samples: −2..17)
const APRON_LEN = N * N * N; // 20³ = 8000 samples per channel
const CELL_MIN = -1; // cells span samples c..c+1; c in [−1..15]
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

/** Sample value at coords (x,y,z) with x,y,z in [−2..17], for either channel
 *  (the +2 offset maps the −2 apron origin to index 0). */
const apronAt = (
  a: Int8Array | Uint8Array,
  x: number,
  y: number,
  z: number,
): number => a[x + 2 + N * (y + 2 + N * (z + 2))] as number;

/** Accumulates one per-class bucket's owned-crossing indices into the shared
 *  vertex pool; compacted into a standalone {@link ChunkMesh} at the end. */
type BucketAccum = { classId: number; backing: boolean; idx: number[] };

/**
 * Compacts one bucket's index list (referencing the shared pass-1 vertex pool)
 * into a standalone mesh: only the vertices this bucket references are kept,
 * remapped to a dense 0..k id space. Positions/normals/uvs are copied in
 * first-seen order so the returned buffers are self-contained.
 */
function compactBucket(
  positions: number[],
  normals: number[],
  uvs: number[],
  idx: number[],
): ChunkMesh {
  const remap = new Map<number, number>();
  const p: number[] = [];
  const n: number[] = [];
  const u: number[] = [];
  const out = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i] as number;
    let r = remap.get(v);
    if (r === undefined) {
      r = remap.size;
      remap.set(v, r);
      p.push(
        positions[v * 3] as number,
        positions[v * 3 + 1] as number,
        positions[v * 3 + 2] as number,
      );
      n.push(
        normals[v * 3] as number,
        normals[v * 3 + 1] as number,
        normals[v * 3 + 2] as number,
      );
      u.push(uvs[v * 2] as number, uvs[v * 2 + 1] as number);
    }
    out[i] = r;
  }
  return {
    positions: Float32Array.from(p),
    normals: Float32Array.from(n),
    uvs: Float32Array.from(u),
    indices: out,
  };
}

/**
 * Meshes one chunk from its 20³ apron pair (samples −2..17) via Surface Nets,
 * partitioning the surface into per-class buckets. Density is air-positive
 * (>0 air, <0 rock, surface at 0); each owned crossing is assigned to the
 * material class of its SOLID side (the wall's own material, not the air).
 *
 * Watertight seams come from two rules working together, unchanged from the
 * single-mesh mesher:
 * - a vertex is placed for every sign-changing cell in −1..15, so boundary
 *   vertices are duplicated at identical world positions by adjacent chunks;
 * - a crossing quad is emitted only when the crossing edge's base sample lies
 *   in this chunk's own 16³ (the ownership rule), so every crossing is emitted
 *   by exactly one chunk world-wide.
 *
 * The wider 20³ window (vs the mesher's own −1..16 reach) exists only so the
 * Task-4 skinner can share the same input; the owned-crossing rule is identical.
 * A kit-class crossing's raw Surface-Nets surface is the class's BACKING bucket
 * (`backing: true`); organic classes yield a single non-backing bucket each.
 *
 * @param aprons - 20³ density + material window ({@link extractFieldAprons}).
 * @param table - resolved material table, for the class kind (organic vs kit).
 * @param cellSize - sample spacing in metres.
 * @returns Per-class mesh buckets (empty `buckets` when the chunk is uniform).
 * @throws {@link Error} if either apron channel is not 8000 samples (20³).
 */
export function meshChunkField(
  aprons: FieldAprons,
  table: MaterialTable,
  cellSize: number,
): FieldChunkMeshes {
  // Setup-loud guard: a malformed apron would read out of bounds and mesh
  // garbage (undefined→NaN via the fixed-index casts). Throw so callers with a
  // try/catch (the editor remesh worker) get a typed failure instead.
  if (
    aprons.density.length !== APRON_LEN ||
    aprons.materials.length !== APRON_LEN
  )
    throw new Error(
      `meshChunkField: each apron channel must be ${APRON_LEN} samples (20³), got density ${aprons.density.length}, materials ${aprons.materials.length}`,
    );
  const density = aprons.density;
  const cellVert = new Int32Array(CELL_COUNT * CELL_COUNT * CELL_COUNT).fill(
    -1,
  );
  const cellIdx = (x: number, y: number, z: number): number =>
    x - CELL_MIN + CELL_COUNT * (y - CELL_MIN + CELL_COUNT * (z - CELL_MIN));

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const corners = new Array<number>(8);

  // Pass 1: one vertex per sign-changing cell (shared pool across all buckets).
  for (let z = CELL_MIN; z < CELL_MIN + CELL_COUNT; z++)
    for (let y = CELL_MIN; y < CELL_MIN + CELL_COUNT; y++)
      for (let x = CELL_MIN; x < CELL_MIN + CELL_COUNT; x++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const d = apronAt(
            density,
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

  // Pass 2: owned crossings -> quads, dispatched to per-class buckets. A
  // crossing is owned when its base sample lies in this chunk's own 16³ (0..15);
  // its owning class is the material of the SOLID side of the crossing.
  const buckets = new Map<string, BucketAccum>();
  const bucketFor = (classId: number, backing: boolean): number[] => {
    const key = `${classId}:${backing ? 1 : 0}`;
    let b = buckets.get(key);
    if (b === undefined) {
      b = { classId, backing, idx: [] };
      buckets.set(key, b);
    }
    return b.idx;
  };
  for (let z = 0; z < CHUNK_DIM; z++)
    for (let y = 0; y < CHUNK_DIM; y++)
      for (let x = 0; x < CHUNK_DIM; x++) {
        const d0 = apronAt(density, x, y, z);
        for (let a = 0; a < 3; a++) {
          const d1 = apronAt(
            density,
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

          // Owning class = the material of the crossing's SOLID sample (d<0).
          const solidIsBase = d0 < 0;
          const sx = solidIsBase ? x : x + (AXIS_X[a] as number);
          const sy = solidIsBase ? y : y + (AXIS_Y[a] as number);
          const sz = solidIsBase ? z : z + (AXIS_Z[a] as number);
          const classId = apronAt(aprons.materials, sx, sy, sz);
          const backing = classOf(table, classId).kind === "kit";
          const bucket = bucketFor(classId, backing);

          // Wind so the face points toward the air side: base air (d0 >= 0) ->
          // face −axis; base rock -> face +axis.
          if (d0 >= 0) bucket.push(v00, v01, v11, v00, v11, v10);
          else bucket.push(v00, v10, v11, v00, v11, v01);
        }
      }

  const out: MeshBucket[] = [];
  for (const b of buckets.values()) {
    if (b.idx.length === 0) continue;
    out.push({
      classId: b.classId,
      backing: b.backing,
      mesh: compactBucket(positions, normals, uvs, b.idx),
    });
  }
  return { buckets: out };
}
