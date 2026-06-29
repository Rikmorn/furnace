// packages/dungeon/tests/connect.test.ts
import { expect, test } from "bun:test";
import { quat, vec3 } from "@furnace/core/transform";
import { join, placePiece } from "../src/connect.ts";
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
