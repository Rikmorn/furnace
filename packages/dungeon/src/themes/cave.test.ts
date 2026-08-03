import { expect, test } from "bun:test";
import { at, expectDefined } from "../../tests/_helpers/expect.ts";
import { aabbOfBoxes } from "../world/aabb.ts";
import type { Aabb, RegionData, RegionMesh, Vec3 } from "../world/region.ts";
import { cave } from "./cave.ts";

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

// Pins the quadrant restriction on the no-`mouths` path (see `buildGraphLegacy`): branch doors
// face +X or +Z only, and -Z belongs to the hardcoded entrance bore alone. -Z is genuinely
// reserved — the entrance is carved through that wall. The -X half of the restriction is
// vestigial (it was closed off for a hand-authored level that no longer exists); this test pins
// it because the path's geometry is frozen, not because anything still needs -X shut.
// Checked across several seeds.
test("no-`mouths` cave: branch doors fan only into +X/+Z, and -Z is the entrance alone", () => {
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
      expect(m.position[a]).toBeGreaterThanOrEqual(at(r.bounds.min, a) - 3);
      expect(m.position[a]).toBeLessThanOrEqual(at(r.bounds.max, a) + 3);
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

test("explicit mouths: N usable collared doors, free cardinals, no legacy entrance", () => {
  const region = cave({
    theme: "cave",
    seed: "b2-cave-1",
    origin: [0, 0, 0],
    mouths: 3,
  });
  expect(region.connections.length).toBe(3);
  for (const c of region.connections) {
    expect(c.kind).toBe("door");
    expect(c.width).toBe(2);
    expect(c.height).toBe(2.8);
  }
  const keys = region.connections.map((c) => `${c.facing[0]},${c.facing[2]}`);
  expect(new Set(keys).size).toBe(3);
  expect(region.meshes.length).toBe(1 + 4 * 3);
});

test("capped bores: plugged, excluded from connections, prefix-stable with the open twin", () => {
  const open = cave({
    theme: "cave",
    seed: "b2-cave-2",
    origin: [0, 0, 0],
    mouths: 3,
    capped: 0,
  });
  const capped = cave({
    theme: "cave",
    seed: "b2-cave-2",
    origin: [0, 0, 0],
    mouths: 2,
    capped: 1,
  });
  expect(capped.connections.length).toBe(2);
  expect(capped.connections[0]).toEqual(at(open.connections, 0));
  expect(capped.connections[1]).toEqual(at(open.connections, 1));
  expect(capped.meshes.length).toBe(1 + 4 * 3 + 1);
  const plug = capped.colliders.find(
    (c) =>
      "cuboid" in c.shape &&
      Math.abs(c.shape.cuboid[0] - 1) < 1e-9 &&
      Math.abs(c.shape.cuboid[1] - 1.4) < 1e-9 &&
      Math.abs(c.shape.cuboid[2] - 0.6) < 1e-9,
  );
  expect(plug).toBeDefined();
  const third = at(open.connections, 2);
  const plugCollider = expectDefined(plug, "cap plug collider");
  expect(plugCollider.position[0]).toBeCloseTo(third.position[0], 6);
  expect(plugCollider.position[2]).toBeCloseTo(third.position[2], 6);
});

test("mouths+capped beyond 4 cardinals throws setup-loud", () => {
  expect(() =>
    cave({ theme: "cave", seed: "s", origin: [0, 0, 0], mouths: 3, capped: 2 }),
  ).toThrow(/cardinal/);
  expect(() =>
    cave({ theme: "cave", seed: "s", origin: [0, 0, 0], mouths: 0 }),
  ).toThrow(/mouths/);
});

// BLOCK 2 (2026-07-04): the forcing invariant for compound `envelopes`. A cave's
// `bounds` is measured 93–96% air (the whole-grid AABB), so placement Rule 1 must
// instead check `envelopes` — tight compound claim boxes over what is ACTUALLY carved.
// This property test is the gate on that claim's honesty: every voxel-proxy shell cell
// and every collar/plug masonry box must lie inside the union of `envelopes`. If it
// fails, the claim under-covers — grow the padding/extent, never weaken this test.

/** All 8 corners of an AABB. */
function corners(a: Aabb): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    pts.push([
      i & 1 ? a.max[0] : a.min[0],
      i & 2 ? a.max[1] : a.min[1],
      i & 4 ? a.max[2] : a.min[2],
    ]);
  }
  return pts;
}

const CONTAIN_EPS = 1e-6;

function pointInAabb(p: Vec3, a: Aabb): boolean {
  return (
    p[0] >= a.min[0] - CONTAIN_EPS &&
    p[0] <= a.max[0] + CONTAIN_EPS &&
    p[1] >= a.min[1] - CONTAIN_EPS &&
    p[1] <= a.max[1] + CONTAIN_EPS &&
    p[2] >= a.min[2] - CONTAIN_EPS &&
    p[2] <= a.max[2] + CONTAIN_EPS
  );
}

/** Every corner of `box` lies inside AT LEAST ONE of `envelopes` — a box may legally
 *  straddle the seam between two adjacent claim boxes, with different corners falling
 *  in different envelope boxes; this is the "contained in the UNION" test. */
function containedInUnion(box: Aabb, envelopes: Aabb[]): boolean {
  return corners(box).every((p) => envelopes.some((e) => pointInAabb(p, e)));
}

/** Reconstruct every solid voxel cell's world AABB from a region's (single, un-placed —
 *  yaw 0) voxel collider: each cell's AABB is its integer coord scaled by the voxel
 *  size and offset by the collider's position. */
function voxelCellAabbs(region: RegionData): Aabb[] {
  const collider = region.colliders.find((c) => "voxels" in c.shape);
  if (!collider || !("voxels" in collider.shape)) return [];
  const { coords, size } = collider.shape.voxels;
  const [px, py, pz] = collider.position;
  const [sx, sy, sz] = size;
  const out: Aabb[] = [];
  for (let n = 0; n < coords.length; n += 3) {
    const i = coords[n] as number;
    const j = coords[n + 1] as number;
    const k = coords[n + 2] as number;
    out.push({
      min: [px + i * sx, py + j * sy, pz + k * sz],
      max: [px + (i + 1) * sx, py + (j + 1) * sy, pz + (k + 1) * sz],
    });
  }
  return out;
}

function boxGeometry(m: RegionMesh): Vec3 {
  if (!("box" in m.geometry)) throw new Error("expected a box mesh");
  return m.geometry.box;
}

/** Every collar/plug masonry box mesh's world AABB. */
function masonryBoxAabbs(region: RegionData): Aabb[] {
  return region.meshes
    .filter((m) => "box" in m.geometry)
    .map((m) =>
      aabbOfBoxes([
        { center: m.position, size: boxGeometry(m), rotation: m.rotation },
      ]),
    );
}

function assertEnvelopesContainCarvedGeometry(r: RegionData): void {
  expect(r.envelopes).toBeDefined();
  const envelopes = r.envelopes as Aabb[];
  for (const cell of voxelCellAabbs(r)) {
    expect(containedInUnion(cell, envelopes)).toBe(true);
  }
  for (const b of masonryBoxAabbs(r)) {
    expect(containedInUnion(b, envelopes)).toBe(true);
  }
}

test("BLOCK 2: envelopes contain every voxel cell + masonry box (new path, several seeds)", () => {
  for (const seed of ["b2-env-1", "b2-env-2", "b2-env-3"]) {
    const r = cave({ theme: "cave", seed, origin: [3, -1, 5], mouths: 3 });
    assertEnvelopesContainCarvedGeometry(r);
  }
});

test("BLOCK 2: envelopes contain every voxel cell + masonry box (capped cave)", () => {
  const r = cave({
    theme: "cave",
    seed: "b2-env-capped",
    origin: [0, 0, 0],
    mouths: 2,
    capped: 1,
  });
  assertEnvelopesContainCarvedGeometry(r);
});

test("BLOCK 2: envelopes contain every voxel cell + masonry box (legacy path, several seeds)", () => {
  for (const seed of ["cave-1", "A", "B", "wing-1", "walk-1"]) {
    const r = cave({ ...params, seed });
    assertEnvelopesContainCarvedGeometry(r);
  }
});
