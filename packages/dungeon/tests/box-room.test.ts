import { expect, test } from "bun:test";
import type { Connection } from "../src/region.ts";
import { boxRoom, pillarGrid, STEP_HEIGHT } from "../src/themes/box-room.ts";

const base = {
  width: 10,
  depth: 12,
  height: 4,
  wallThick: 0.4,
  floorThick: 0.3,
  door: { side: "S" as const, offset: 0, width: 1.6, height: 2.2 },
};

test("a room has floor + ceiling + walls and a cuboid per mesh box", () => {
  const r = boxRoom(base, []);
  expect(r.meshes.length).toBeGreaterThanOrEqual(6); // floor+ceiling+2 plain walls+2 door segments(+lintel)
  expect(r.colliders.length).toBe(r.meshes.length); // 1:1 box≡cuboid
  for (const m of r.meshes) expect("box" in m.geometry).toBe(true);
});

test("the doorway leaves a gap: no collider spans the door opening at floor level", () => {
  const r = boxRoom(base, []);
  // The S wall is at z = -depth/2 - wallThick/2. A ray through the door centre at the floor
  // must find NO cuboid (the opening). We test the data: no collider contains the door centre.
  const doorCenter = [0, 0.5, -base.depth / 2 - base.wallThick / 2] as const;
  const blocked = r.colliders.some((c) => {
    const s = c.shape;
    if (!("cuboid" in s)) return false;
    const [hx, hy, hz] = s.cuboid;
    return (
      Math.abs(doorCenter[0] - c.position[0]) <= (hx as number) &&
      Math.abs(doorCenter[1] - c.position[1]) <= (hy as number) &&
      Math.abs(doorCenter[2] - c.position[2]) <= (hz as number)
    );
  });
  expect(blocked).toBe(false);
});

test("boxRoom emits one outward-facing door connection", () => {
  const r = boxRoom(base, []);
  expect(r.connections.length).toBe(1);
  const door = r.connections[0] as Connection;
  expect(door.kind).toBe("door");
  expect(door.facing).toEqual([0, 0, -1]); // S wall faces -Z outward
});

test("STEP_HEIGHT is exported and equals 0.4", () => {
  expect(STEP_HEIGHT).toBe(0.4);
});

test("pillarGrid leaves the doorway walk corridor clear", () => {
  const door = { side: "S" as const, offset: 0, width: 1.6, height: 2.2 };
  const pillars = pillarGrid({
    width: 12,
    depth: 14,
    bay: 3,
    section: 0.6,
    door,
  });
  // No pillar within (door half-width + capsule radius 0.3 + section/2 0.3) of the
  // corridor centre line x=0, for z between the door and the room centre.
  const clear = pillars.every(
    (p) => !(Math.abs(p.x) < door.width / 2 + 0.3 + 0.3 && p.z < 0),
  );
  expect(clear).toBe(true);
  expect(pillars.length).toBeGreaterThan(0);
});
