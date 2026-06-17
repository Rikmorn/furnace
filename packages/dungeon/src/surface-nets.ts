import type { Field } from "./field.ts";

export type MeshData = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
};

export type GridConfig = {
  min: [number, number, number];
  cellSize: number;
  dims: [number, number, number]; // number of cells per axis
};

// The 12 edges of a cube as [cornerA, cornerB], corners indexed by (x|y<<1|z<<2).
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

/** Mesh the 0-isosurface of `field` over the grid via naive Surface Nets. */
export function surfaceNets(field: Field, grid: GridConfig): MeshData {
  const [nx, ny, nz] = grid.dims;
  const { cellSize: h } = grid;
  const [ox, oy, oz] = grid.min;
  const wx = nx + 1;
  const wy = ny + 1;
  // Sample the field at every grid corner.
  const sample = new Float32Array(wx * wy * (nz + 1));
  const sidx = (i: number, j: number, k: number): number =>
    i + wx * (j + wy * k);
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        sample[sidx(i, j, k)] = field(ox + i * h, oy + j * h, oz + k * h);
      }
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  // Vertex index per cell (-1 = no vertex). Cells indexed like corners.
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const cidx = (i: number, j: number, k: number): number =>
    i + nx * (j + ny * k);

  const grad = (x: number, y: number, z: number): [number, number, number] => {
    const e = h * 0.5;
    const gx = field(x + e, y, z) - field(x - e, y, z);
    const gy = field(x, y + e, z) - field(x, y - e, z);
    const gz = field(x, y, z + e) - field(x, y, z - e);
    const len = Math.hypot(gx, gy, gz) || 1;
    // Field is air-positive, so the outward (rock→air) surface normal is +gradient.
    return [gx / len, gy / len, gz / len];
  };

  // Pass 1: place one vertex per sign-changing cell.
  const corners = new Array<number>(8);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [dx, dy, dz] = CORNER[c] as [number, number, number];
          const v = sample[sidx(i + dx, j + dy, k + dz)] as number;
          corners[c] = v;
          if (v > 0) mask |= 1 << c; // >0 = air
        }
        if (mask === 0 || mask === 0xff) continue; // wholly rock or wholly air
        // Average the zero-crossings along the 12 edges (local cell coords).
        let cxq = 0;
        let cyq = 0;
        let czq = 0;
        let count = 0;
        for (const [a, b] of CUBE_EDGES) {
          const sa = corners[a] as number;
          const sb = corners[b] as number;
          if (sa > 0 === sb > 0) continue;
          const t = sa / (sa - sb); // crossing param along a→b
          const [ax, ay, az] = CORNER[a] as [number, number, number];
          const [bx, by, bz] = CORNER[b] as [number, number, number];
          cxq += ax + (bx - ax) * t;
          cyq += ay + (by - ay) * t;
          czq += az + (bz - az) * t;
          count++;
        }
        const vx = ox + (i + cxq / count) * h;
        const vy = oy + (j + cyq / count) * h;
        const vz = oz + (k + czq / count) * h;
        cellVert[cidx(i, j, k)] = positions.length / 3;
        positions.push(vx, vy, vz);
        const n = grad(vx, vy, vz);
        normals.push(n[0], n[1], n[2]);
      }
    }
  }

  // Pass 2: for each cell, emit quads on the 3 axis edges that flip sign,
  // connecting the 4 cells sharing that edge.
  const emitQuad = (
    v0: number,
    v1: number,
    v2: number,
    v3: number,
    flip: boolean,
  ): void => {
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return;
    // Winding chosen so the air-facing side (toward the player inside the cave) is
    // the front face; the gradient normals already point that way. Flipped from the
    // naive form after the visual gate showed inside-out (back-face-culled) walls.
    if (flip) {
      indices.push(v0, v3, v2, v0, v2, v1);
    } else {
      indices.push(v0, v1, v2, v0, v2, v3);
    }
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v = cellVert[cidx(i, j, k)] as number;
        if (v < 0) continue;
        const s0 = sample[sidx(i, j, k)] as number;
        // +x edge
        if (
          i > 0 &&
          j > 0 &&
          k > 0 &&
          s0 > 0 !== (sample[sidx(i + 1, j, k)] as number) > 0
        ) {
          // flip winding by which side the current cell is on (s0 > 0 = air).
          emitQuad(
            v,
            cellVert[cidx(i, j - 1, k)] as number,
            cellVert[cidx(i, j - 1, k - 1)] as number,
            cellVert[cidx(i, j, k - 1)] as number,
            s0 > 0,
          );
        }
        // +y edge
        if (
          i > 0 &&
          j > 0 &&
          k > 0 &&
          s0 > 0 !== (sample[sidx(i, j + 1, k)] as number) > 0
        ) {
          emitQuad(
            v,
            cellVert[cidx(i, j, k - 1)] as number,
            cellVert[cidx(i - 1, j, k - 1)] as number,
            cellVert[cidx(i - 1, j, k)] as number,
            s0 > 0,
          );
        }
        // +z edge
        if (
          i > 0 &&
          j > 0 &&
          k > 0 &&
          s0 > 0 !== (sample[sidx(i, j, k + 1)] as number) > 0
        ) {
          emitQuad(
            v,
            cellVert[cidx(i - 1, j, k)] as number,
            cellVert[cidx(i - 1, j - 1, k)] as number,
            cellVert[cidx(i, j - 1, k)] as number,
            s0 > 0,
          );
        }
      }
    }
  }

  // Planar UVs (world XZ) — good enough for the lit stone look; triplanar later.
  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let vtx = 0; vtx < positions.length / 3; vtx++) {
    uvs[vtx * 2] = (positions[vtx * 3] as number) * 0.25;
    uvs[vtx * 2 + 1] = (positions[vtx * 3 + 2] as number) * 0.25;
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs,
    indices: new Uint32Array(indices),
  };
}
