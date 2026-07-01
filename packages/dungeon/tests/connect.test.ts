// packages/dungeon/tests/connect.test.ts
import { expect, test } from "bun:test";
import { quat, vec3 } from "@furnace/core/transform";
import { aabbOfBoxes } from "../src/aabb.ts";
import { chooseKind, join, placePiece, route } from "../src/connect.ts";
import type {
  Connection,
  RegionData,
  RegionMesh,
  Vec3,
} from "../src/region.ts";

function room(door: Connection): RegionData {
  return {
    meshes: [
      { geometry: { box: [1, 1, 1] }, material: 0, position: [2, 0, 0] },
    ],
    colliders: [{ shape: { cuboid: [0.5, 0.5, 0.5] }, position: [2, 0, 0] }],
    materials: [{ color: [1, 1, 1, 1], specular: [0, 0, 0, 8] }],
    connections: [door],
    instances: [],
    origin: [0, 0, 0],
    bounds: aabbOfBoxes([{ center: [2, 0, 0], size: [1, 1, 1] }]),
    provenance: {
      generatorId: "dungeon",
      generatorVersion: 2,
      theme: "pillarHall",
      seed: "x",
    },
  };
}

test("join seats B's portal onto A's: positions meet, facings negate (arbitrary yaw + height)", () => {
  const a: Connection = {
    position: [5, 3, -2],
    facing: [Math.cos(0.4), 0, Math.sin(0.4)],
    width: 2,
    height: 3,
    kind: "door",
  };
  const b: Connection = {
    position: [0, 0, 1],
    facing: [0, 0, 1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const placed = placePiece(room(b), join(a, b));
  const d = placed.connections[0] as Connection;
  expect(d.position[0]).toBeCloseTo(a.position[0], 5);
  expect(d.position[1]).toBeCloseTo(a.position[1], 5); // height carried
  expect(d.position[2]).toBeCloseTo(a.position[2], 5);
  expect(d.facing[0]).toBeCloseTo(-a.facing[0], 5); // facings negate
  expect(d.facing[2]).toBeCloseTo(-a.facing[2], 5);
});

test("join carries rotation onto meshes/colliders (off-axis mesh orientation = yaw)", () => {
  const a: Connection = {
    position: [0, 0, 0],
    facing: [1, 0, 0],
    width: 2,
    height: 3,
    kind: "door",
  };
  const b: Connection = {
    position: [0, 0, 1],
    facing: [0, 0, 1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const placed = placePiece(room(b), join(a, b));
  const m = placed.meshes[0] as RegionMesh;
  expect(m.rotation).toBeDefined();
  const q = quat.fromValues(
    ...(m.rotation as [number, number, number, number]),
  );
  const x = vec3.transformQuat(vec3.create(), vec3.fromValues(1, 0, 0), q);
  expect(x[0] as number).toBeCloseTo(0, 5);
  expect(x[2] as number).toBeCloseTo(1, 5); // Ry(-90°)·X̂ = [0,0,1]
});

test("join cardinal case keeps a box room axis-aligned (regression: matches extent-swap world AABB)", () => {
  const a: Connection = {
    position: [0, 0, 0],
    facing: [0, 0, -1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const b: Connection = {
    position: [0, 0, 1],
    facing: [0, 0, -1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const placed = placePiece(room(b), join(a, b));
  // The real contract: B's door seats onto A's opening at the origin.
  const d = placed.connections[0] as Connection;
  expect(d.position[0]).toBeCloseTo(0, 5);
  expect(d.position[2]).toBeCloseTo(0, 5);
  // The box stays an axis-aligned unit cube under the 180° yaw. Its local [2,0,0]
  // lands at Ry(180)·[2,0,0] + t = [-2,0,0] + [0,0,1] = [-2,0,1]: the door at local
  // [0,0,1] forces a +1 Z translation when it seats onto a.position. (Matches the old
  // compose.ts placeRoom for this fixture.)
  const m = placed.meshes[0] as RegionMesh;
  expect((m.position as Vec3)[0]).toBeCloseTo(-2, 5);
  expect((m.position as Vec3)[2]).toBeCloseTo(1, 5);
});

const P = (position: Vec3, facing: Vec3): Connection => ({
  position,
  facing,
  width: 2,
  height: 3,
  kind: "door",
});

test("chooseKind: flat→corridor, gentle climb→ramp, steep→stairs", () => {
  expect(chooseKind(0, 4)).toBe("corridor"); // Δh 0
  expect(chooseKind(1, 4)).toBe("ramp"); // 14° slope, walkable
  expect(chooseKind(4, 1)).toBe("stairs"); // ~76° — too steep for a ramp
});

test("route ramp top face is walkable (normal.y >= SLOPE_LIMIT_COS)", () => {
  const r = route(P([0, 0, 0], [1, 0, 0]), P([4, 1, 0], [-1, 0, 0]), {
    kind: "ramp",
  });
  const m = r.meshes.find((mm) => "box" in mm.geometry);
  expect(m?.rotation).toBeDefined();
  const q = quat.fromValues(
    ...(m?.rotation as [number, number, number, number]),
  );
  const up = vec3.transformQuat(vec3.create(), vec3.fromValues(0, 1, 0), q);
  expect(up[1] as number).toBeGreaterThanOrEqual(
    Math.cos((55 * Math.PI) / 180) - 1e-6,
  );
});

test("route stairs risers stay below STEP_HEIGHT", () => {
  const r = route(P([0, 0, 0], [0, 0, 1]), P([0, 2, 2], [0, 0, -1]), {
    kind: "stairs",
  });
  const stepHeights = r.colliders.map(
    (c) => (c.shape as { cuboid: Vec3 }).cuboid[1] * 2,
  );
  const sorted = [...stepHeights].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    expect((sorted[i] as number) - (sorted[i - 1] as number)).toBeLessThan(0.4);
  }
  expect(sorted[0] as number).toBeLessThan(0.4); // first riser
});

test("route corridor overlaps both endpoints (floor spans the join)", () => {
  const from = P([0, 0, 0], [0, 0, 1]);
  const to = P([0, 0, 3], [0, 0, -1]);
  const r = route(from, to);
  expect(r.provenance.theme).toBe("connector");
  const floor = r.meshes[0] as RegionMesh;
  const halfDepth = (floor.geometry as { box: Vec3 }).box[2] / 2;
  const cz = (floor.position as Vec3)[2];
  expect(cz - halfDepth).toBeLessThanOrEqual(0); // covers `from`
  expect(cz + halfDepth).toBeGreaterThanOrEqual(3); // covers `to`
});

test("route throws when a forced ramp can't satisfy the slope limit", () => {
  expect(() =>
    route(P([0, 0, 0], [1, 0, 0]), P([1, 4, 0], [-1, 0, 0]), { kind: "ramp" }),
  ).toThrow();
});

test("placePiece transforms bounds conservatively (yaw 90° + translate)", () => {
  const door: Connection = {
    position: [0, 0, 1],
    facing: [0, 0, 1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const region = room(door);
  region.bounds = { min: [-1, 0, -2], max: [1, 2, 2] };
  const placed = placePiece(region, {
    yaw: Math.PI / 2,
    translation: [10, 5, 0],
  });
  expect(placed.bounds.min[0]).toBeCloseTo(10 - 2, 5);
  expect(placed.bounds.max[0]).toBeCloseTo(10 + 2, 5);
  expect(placed.bounds.min[1]).toBeCloseTo(5, 5);
  expect(placed.bounds.max[1]).toBeCloseTo(7, 5);
  expect(placed.bounds.min[2]).toBeCloseTo(-1, 5);
  expect(placed.bounds.max[2]).toBeCloseTo(1, 5);
});
