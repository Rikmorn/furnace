import { expect, test } from "bun:test";
import type { RegionData, RegionMesh } from "../src/region.ts";
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

test("cave produces a mesh, a voxel collider, collar cuboids, and door connections", () => {
  const r = cave(params);
  // custom rock mesh first, then 4 collar boxes per connection
  expect(r.meshes.length).toBe(1 + 4 * r.connections.length);
  const m = r.meshes[0] as RegionMesh;
  expect("custom" in m.geometry).toBe(true);
  if ("custom" in m.geometry)
    expect(m.geometry.custom.positions.length).toBeGreaterThan(0);
  const voxels = r.colliders.filter((c) => "voxels" in c.shape);
  const cuboids = r.colliders.filter((c) => "cuboid" in c.shape);
  expect(voxels.length).toBe(1);
  expect(cuboids.length).toBe(4 * r.connections.length);
  // 1 entrance + 2..3 branch mouths — ALL collared to door-class (built-interface doctrine)
  expect(r.connections.length).toBeGreaterThanOrEqual(3);
  expect(r.connections.every((c) => c.kind === "door")).toBe(true);
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

test("every cave door faces outward in the XZ plane at the standard opening size", () => {
  const r = cave(params);
  for (const c of r.connections) {
    expect(c.kind).toBe("door");
    expect(Math.hypot(c.facing[0], c.facing[2])).toBeGreaterThan(0.5);
    expect(c.width).toBe(2);
    expect(c.height).toBe(2.8);
  }
});

// Regression (gate fix): a -X or -Z branch drives a room back into the authored level
// the wing attaches to (the level sits to the wing's -X corridor / -Z entrance sides),
// which overlapped the spawn corridor. Branches must fan ONLY into the open +X/+Z
// quadrant; -Z is the entrance alone. Verified across several seeds.
test("cave branches fan only into the open +X/+Z quadrant (never back toward the level)", () => {
  for (const seed of ["cave-1", "A", "B", "wing-1", "walk-1"]) {
    const r = cave({ ...params, seed });
    for (const c of r.connections) {
      if (c.kind !== "door") continue;
      const isEntrance = c.facing[0] === 0 && c.facing[2] === -1;
      if (isEntrance) continue;
      expect(c.facing[0] === 1 || c.facing[2] === 1).toBe(true); // +X or +Z only
    }
  }
});

test("cave bounds contain the collar boxes and a masonry material is appended", () => {
  const r = cave(params);
  const boxMeshes = r.meshes.filter((m) => "box" in m.geometry);
  expect(boxMeshes.length).toBe(4 * r.connections.length);
  const idx = boxMeshes[0]?.material as number;
  expect(idx).toBeGreaterThan(0);
  expect(boxMeshes.every((m) => m.material === idx)).toBe(true);
  expect(r.materials[idx]?.color).toEqual([0.42, 0.42, 0.45, 1]);
  for (const m of boxMeshes) {
    for (let a = 0; a < 3; a++) {
      expect(m.position[a]).toBeGreaterThanOrEqual(r.bounds.min[a]! - 3);
      expect(m.position[a]).toBeLessThanOrEqual(r.bounds.max[a]! + 3);
    }
  }
});

test("cave spires are a solid scatter layer with world-frame placements", () => {
  const region = cave({
    theme: "cave",
    seed: "spire-seed",
    origin: [10, 2, -0.5],
  });
  const spires = region.instances.find(
    (g) => g.geometry.primitive === "cylinder" && g.posture === "lit",
  );
  expect(spires).toBeDefined();
  expect(spires?.collision).toBe("solid");
  expect(spires?.placements?.length).toBe(
    (spires?.transforms.length ?? 0) / 16,
  );
  // Cave bakes WORLD transforms (offset = origin), so a placement's position equals
  // its baked mat4 translation.
  const p0 = spires?.placements?.[0];
  expect(p0?.position[0]).toBeCloseTo(spires?.transforms[12] as number, 5);
  expect(p0?.position[2]).toBeCloseTo(spires?.transforms[14] as number, 5);
});
