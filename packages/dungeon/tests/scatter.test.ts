import { expect, test } from "bun:test";
import { create as makeRng } from "@furnace/core/rng";
import { buildArea } from "../src/compose.ts";
import { _sampleSurface, meshSurface } from "../src/scatter.ts";
import type { MeshData } from "../src/surface-nets.ts";

test("composed regions carry an instances array (empty until themes populate)", () => {
  const regions = buildArea("seed-x", [0, 0, 0]);
  for (const r of regions) expect(Array.isArray(r.instances)).toBe(true);
});

// Two triangles forming a unit quad on y=0, plus a 9x-area quad offset in +x.
const md: MeshData = {
  positions: new Float32Array([
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    1,
    0,
    1, // small quad (verts 0-3), area 1
    2,
    0,
    0,
    5,
    0,
    0,
    2,
    0,
    3,
    5,
    0,
    3, // big quad (verts 4-7), 3x3 = area 9
  ]),
  normals: new Float32Array(24).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), // all +Y
  uvs: new Float32Array(16),
  indices: new Uint32Array([0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6]),
};

test("sampleSurface is deterministic and area-weighted, points on surface", () => {
  const a = _sampleSurface(meshSurface(md), 400, makeRng("s"));
  const b = _sampleSurface(meshSurface(md), 400, makeRng("s"));
  expect(a.map((p) => p.position.join(","))).toEqual(
    b.map((p) => p.position.join(",")),
  ); // determinism
  for (const s of a) expect(Math.abs(s.position[1])).toBeLessThan(1e-6); // y≈0 plane (on-surface)
  const inBig = a.filter((s) => s.position[0] >= 2).length;
  expect(inBig / a.length).toBeGreaterThan(0.8); // ~9/10 of total area is the big quad
});
