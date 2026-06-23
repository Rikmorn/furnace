import { expect, test } from "bun:test";
import type { RegionCollider, RegionData, RegionMesh } from "../src/region.ts";
import { cave } from "../src/themes/cave.ts";

const params = {
  theme: "cave" as const,
  seed: "cave-1",
  origin: [0, 0, 0] as [number, number, number],
};

/** The custom-mesh vertex positions of a region's first mesh (asserting the
 *  expected `custom` geometry shape — a meaningful guard, not dead code). */
function customPositions(r: RegionData): Float32Array {
  const geo = r.meshes[0]?.geometry;
  if (!geo || !("custom" in geo)) throw new Error("expected a custom mesh");
  return geo.custom.positions;
}

test("cave produces a non-empty mesh, a voxel collider, and connections", () => {
  const r = cave(params);
  expect(r.meshes.length).toBe(1);
  const m = r.meshes[0] as RegionMesh;
  expect("custom" in m.geometry).toBe(true);
  if ("custom" in m.geometry)
    expect(m.geometry.custom.positions.length).toBeGreaterThan(0);
  expect(r.colliders.length).toBe(1);
  expect("voxels" in (r.colliders[0] as RegionCollider).shape).toBe(true);
  // 1 entrance + 2..3 branch-end connections
  expect(r.connections.length).toBeGreaterThanOrEqual(3);
  expect(r.connections.some((c) => c.kind === "tunnel-mouth")).toBe(true);
});

test("cave is deterministic for a fixed seed", () => {
  const a = cave(params),
    b = cave(params);
  const pa = customPositions(a),
    pb = customPositions(b);
  expect(Array.from(pa)).toEqual(Array.from(pb));
  expect(a.connections).toEqual(b.connections);
});

test("a different seed yields a different cave", () => {
  const a = cave({ ...params, seed: "A" });
  const b = cave({ ...params, seed: "B" });
  expect(customPositions(a).length).not.toBe(customPositions(b).length);
});

test("every tunnel-mouth connection faces outward in the XZ plane", () => {
  const r = cave(params);
  for (const c of r.connections) {
    if (c.kind !== "tunnel-mouth") continue;
    expect(Math.hypot(c.facing[0], c.facing[2])).toBeGreaterThan(0.5); // a real lateral direction
    expect(c.width).toBeGreaterThanOrEqual(0.7);
  }
});
