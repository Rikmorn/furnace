import { describe, expect, test } from "bun:test";
import type { ChunkKey, ChunkMesh } from "@furnace/core/field";
import {
  applyOp,
  CHUNK_DIM,
  chunkKey,
  createFieldStore,
  extractApron,
  getDensity,
  meshChunkApron,
  parseChunkKey,
} from "@furnace/core/field";

/** Digs a sphere that straddles the (0,0,0)/(1,0,0) chunk boundary. */
function boundarySphereStore() {
  const s = createFieldStore();
  applyOp(s, {
    id: 1,
    kind: "dig",
    shape: { kind: "sphere", center: [4.0, 1.5, 1.5], radius: 1.2 },
  }); // 4.0 m = sample 16 = the +x boundary of chunk 0
  return s;
}

function meshOf(
  s: ReturnType<typeof createFieldStore>,
  key: ChunkKey,
): ChunkMesh {
  return meshChunkApron(extractApron(s, key), s.cellSize);
}

/** World-space vertex positions of a chunk mesh. */
function worldVerts(m: ChunkMesh, key: ChunkKey, cellSize: number): number[][] {
  const [cx, cy, cz] = parseChunkKey(key);
  const out: number[][] = [];
  for (let i = 0; i < m.positions.length; i += 3)
    out.push([
      (m.positions[i] as number) + cx * CHUNK_DIM * cellSize,
      (m.positions[i + 1] as number) + cy * CHUNK_DIM * cellSize,
      (m.positions[i + 2] as number) + cz * CHUNK_DIM * cellSize,
    ]);
  return out;
}

describe("chunked surface nets", () => {
  test("an all-solid chunk meshes to nothing", () => {
    const s = createFieldStore();
    // allocate a chunk without opening any air
    applyOp(s, {
      id: 1,
      kind: "dig",
      shape: { kind: "sphere", center: [100, 100, 100], radius: 0.5 },
    });
    const m = meshOf(s, chunkKey(0, 0, 0));
    expect(m.indices.length).toBe(0);
  });

  test("a dug sphere yields a closed-ish shell with inward-air normals", () => {
    const s = createFieldStore();
    applyOp(s, {
      id: 1,
      kind: "dig",
      shape: { kind: "sphere", center: [2, 2, 2], radius: 1.2 },
    });
    const m = meshOf(s, chunkKey(0, 0, 0));
    expect(m.indices.length).toBeGreaterThan(0);
    expect(m.positions.length / 3).toBe(m.normals.length / 3);
    // Every normal points toward the cavity center (air side).
    for (let i = 0; i < m.positions.length; i += 3) {
      const px = m.positions[i] as number;
      const py = m.positions[i + 1] as number;
      const pz = m.positions[i + 2] as number;
      const toCenter = [2 - px, 2 - py, 2 - pz];
      const dot =
        (m.normals[i] as number) * (toCenter[0] as number) +
        (m.normals[i + 1] as number) * (toCenter[1] as number) +
        (m.normals[i + 2] as number) * (toCenter[2] as number);
      expect(dot).toBeGreaterThan(0);
    }
  });

  test("WINDING: triangle face normals (from index order) point air-side", () => {
    // Guards face orientation, which vertex-normal tests can't: those normals
    // come from the gradient and are independent of triangle index order, so a
    // flipped winding renders the cave inside-out yet passes every other test.
    const s = createFieldStore();
    applyOp(s, {
      id: 1,
      kind: "dig",
      shape: { kind: "sphere", center: [2, 2, 2], radius: 1.2 },
    });
    const m = meshOf(s, chunkKey(0, 0, 0));
    const center = [2, 2, 2] as const;
    let checked = 0;
    for (let t = 0; t < m.indices.length; t += 3) {
      const i0 = (m.indices[t] as number) * 3;
      const i1 = (m.indices[t + 1] as number) * 3;
      const i2 = (m.indices[t + 2] as number) * 3;
      const v0 = [
        m.positions[i0] as number,
        m.positions[i0 + 1] as number,
        m.positions[i0 + 2] as number,
      ];
      const v1 = [
        m.positions[i1] as number,
        m.positions[i1 + 1] as number,
        m.positions[i1 + 2] as number,
      ];
      const v2 = [
        m.positions[i2] as number,
        m.positions[i2 + 1] as number,
        m.positions[i2 + 2] as number,
      ];
      // Geometric face normal from winding order: (v1 - v0) x (v2 - v0).
      const e1 = [
        (v1[0] as number) - (v0[0] as number),
        (v1[1] as number) - (v0[1] as number),
        (v1[2] as number) - (v0[2] as number),
      ];
      const e2 = [
        (v2[0] as number) - (v0[0] as number),
        (v2[1] as number) - (v0[1] as number),
        (v2[2] as number) - (v0[2] as number),
      ];
      const nx =
        (e1[1] as number) * (e2[2] as number) -
        (e1[2] as number) * (e2[1] as number);
      const ny =
        (e1[2] as number) * (e2[0] as number) -
        (e1[0] as number) * (e2[2] as number);
      const nz =
        (e1[0] as number) * (e2[1] as number) -
        (e1[1] as number) * (e2[0] as number);
      const nlen = Math.hypot(nx, ny, nz);
      if (nlen < 1e-9) continue; // skip degenerate triangles (there should be none)
      // Face centroid -> cavity center is the air direction for a dug sphere.
      const gx =
        ((v0[0] as number) + (v1[0] as number) + (v2[0] as number)) / 3;
      const gy =
        ((v0[1] as number) + (v1[1] as number) + (v2[1] as number)) / 3;
      const gz =
        ((v0[2] as number) + (v1[2] as number) + (v2[2] as number)) / 3;
      const dot =
        nx * (center[0] - gx) + ny * (center[1] - gy) + nz * (center[2] - gz);
      expect(dot).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("SEAM: quad count across two chunks equals the analytic crossing count", () => {
    const s = boundarySphereStore();
    const keys = [chunkKey(0, 0, 0), chunkKey(1, 0, 0)];
    let quads = 0;
    for (const k of keys) quads += meshOf(s, k).indices.length / 6;
    // Count sign-changing sample edges whose base sample is owned by either chunk.
    let crossings = 0;
    for (const k of keys) {
      const [cx, cy, cz] = parseChunkKey(k);
      for (let z = 0; z < CHUNK_DIM; z++)
        for (let y = 0; y < CHUNK_DIM; y++)
          for (let x = 0; x < CHUNK_DIM; x++) {
            const gx = cx * CHUNK_DIM + x;
            const gy = cy * CHUNK_DIM + y;
            const gz = cz * CHUNK_DIM + z;
            const d0 = getDensity(s, gx, gy, gz);
            for (const [dx, dy, dz] of [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ] as const) {
              const d1 = getDensity(s, gx + dx, gy + dy, gz + dz);
              if ((d0 < 0 && d1 >= 0) || (d0 >= 0 && d1 < 0)) crossings++;
            }
          }
    }
    // NOTE: crossings counted over these two chunks only — the sphere is
    // sized to stay inside them (radius 1.2 around x=4.0 spans x 2.8..5.2 m,
    // chunks 0..1 span 0..8 m; y/z well inside chunk 0 row).
    expect(quads).toBe(crossings);
  });

  test("SEAM: boundary vertices are duplicated at identical positions", () => {
    const s = boundarySphereStore();
    const a = worldVerts(
      meshOf(s, chunkKey(0, 0, 0)),
      chunkKey(0, 0, 0),
      s.cellSize,
    );
    const b = worldVerts(
      meshOf(s, chunkKey(1, 0, 0)),
      chunkKey(1, 0, 0),
      s.cellSize,
    );
    // Chunk 0's boundary-cell vertices (world x near 4.0) must appear in b.
    const nearBoundary = a.filter(
      (v) => Math.abs((v[0] as number) - 4.0) < 0.25,
    );
    expect(nearBoundary.length).toBeGreaterThan(0);
    for (const v of nearBoundary) {
      const match = b.some(
        (w) =>
          Math.abs((w[0] as number) - (v[0] as number)) < 1e-5 &&
          Math.abs((w[1] as number) - (v[1] as number)) < 1e-5 &&
          Math.abs((w[2] as number) - (v[2] as number)) < 1e-5,
      );
      expect(match).toBe(true);
    }
  });
});
