import { expect, test } from "bun:test";
import { aabbIntersects } from "../src/aabb.ts";
import { connectorSection, ENCLOSURE_TOP_PAD } from "../src/connect.ts";
import { clearanceBoxes, layoutWorld } from "../src/layout.ts";
import type { Connection, RegionData, Vec3 } from "../src/region.ts";
import type { WorldGraph } from "../src/world-graph.ts";

/** A simple room: 8×3×8 solid-walled box with doors on given sides (door at wall centre,
 *  floor y=0). Solids = one collider per wall so clearance tests have real geometry. */
function room(sides: ("N" | "S" | "E" | "W")[]): RegionData {
  const FACING: Record<string, Vec3> = {
    N: [0, 0, 1],
    S: [0, 0, -1],
    E: [1, 0, 0],
    W: [-1, 0, 0],
  };
  const connections: Connection[] = sides.map((s) => ({
    position: [FACING[s]![0] * 4, 0, FACING[s]![2] * 4] as Vec3,
    facing: FACING[s] as Vec3,
    width: 2,
    height: 3,
    kind: "door" as const,
  }));
  return {
    meshes: [],
    colliders: [
      { shape: { cuboid: [4, 0.1, 4] }, position: [0, -0.1, 0] }, // floor
    ],
    materials: [],
    connections,
    instances: [],
    origin: [0, 0, 0],
    bounds: { min: [-4, -0.2, -4], max: [4, 3, 4] },
    provenance: {
      generatorId: "dungeon",
      generatorVersion: 2,
      theme: "pillarHall",
      seed: "s",
    },
  };
}

test("chain layout: three rooms place with zero envelope overlap, deterministic", () => {
  const g: WorldGraph = {
    nodes: [
      {
        id: "root",
        region: room(["N"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "mid", region: room(["S", "N"]) },
      { id: "end", region: room(["S"]) },
    ],
    edges: [
      { a: "root", b: "mid", aPortal: 0, bPortal: 0, lengthRange: [2, 4] },
      { a: "mid", b: "end", aPortal: 1, bPortal: 0, lengthRange: [2, 4] },
    ],
  };
  const r1 = layoutWorld(g, "seed-1");
  const r2 = layoutWorld(g, "seed-1");
  expect(r1.placements.get("end")).toEqual(r2.placements.get("end") as never); // deterministic
  expect(r1.regions.length).toBe(3);
  expect(r1.connectors.length).toBe(2);
  for (let i = 0; i < r1.regions.length; i++) {
    for (let j = i + 1; j < r1.regions.length; j++) {
      expect(aabbIntersects(r1.regions[i]!.bounds, r1.regions[j]!.bounds)).toBe(
        false,
      );
    }
  }
});

test("vertical edge: heightDelta places the room higher and emits a climbing connector", () => {
  const g: WorldGraph = {
    nodes: [
      {
        id: "root",
        region: room(["N"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "up", region: room(["S"]) },
    ],
    edges: [
      {
        a: "root",
        b: "up",
        aPortal: 0,
        bPortal: 0,
        lengthRange: [8, 12],
        heightDelta: 5,
      },
    ],
  };
  const r = layoutWorld(g, "seed-1");
  expect(r.placements.get("up")?.translation[1]).toBeCloseTo(5, 5);
  expect(r.connectors[0]!.colliders.length).toBeGreaterThan(0);
});

test("loop: the closing edge is checked and its connector emitted", () => {
  const g: WorldGraph = {
    nodes: [
      {
        id: "root",
        region: room(["N", "E"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "b", region: room(["S", "E"]) },
      { id: "c", region: room(["W", "S"]) },
    ],
    edges: [
      { a: "root", b: "b", aPortal: 0, bPortal: 0, lengthRange: [2, 6] },
      { a: "root", b: "c", aPortal: 1, bPortal: 1, lengthRange: [2, 6] },
      { a: "b", b: "c", aPortal: 1, bPortal: 0, lengthRange: [2, 8] },
    ],
  };
  const r = layoutWorld(g, "seed-1");
  expect(r.connectors.length).toBe(3); // tree edges + the closing edge
});

test("impossible graph throws with diagnostics (never silent overlap)", () => {
  const fence = (dx: number, dz: number): RegionData => ({
    ...room([]),
    connections: [],
    bounds: { min: [dx - 20, -0.2, dz - 20], max: [dx + 20, 6, dz + 20] },
  });
  const g: WorldGraph = {
    nodes: [
      {
        id: "root",
        region: room(["N"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      {
        id: "wallN",
        region: fence(0, 0),
        pinned: { yaw: 0, translation: [0, 0, 24] },
      },
      { id: "b", region: room(["S"]) },
    ],
    edges: [
      { a: "root", b: "b", aPortal: 0, bPortal: 0, lengthRange: [2, 10] },
    ],
  };
  expect(() => layoutWorld(g, "seed-1")).toThrow(/could not place|attempts/);
  try {
    layoutWorld(g, "seed-1");
  } catch (e) {
    expect(e instanceof Error && e.message).toContain("b"); // names the failing node
  }
});

test("backtracking: a crowded first choice is revised and layout still succeeds", () => {
  const g: WorldGraph = {
    nodes: [
      {
        id: "root",
        region: room(["N"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      {
        // A pinned keep-out box beside the +Z axis: it overlaps the SHORT (len≈2)
        // placement's envelope — forcing the placer to revise — while a straight yaw-0
        // corridor to a LONGER placement still routes clear of it (a box directly
        // astride the only portal would be unroutable, not a backtracking case).
        id: "obstacle",
        region: {
          ...room([]),
          connections: [],
          bounds: { min: [2, -0.2, 6], max: [8, 3, 14] },
        },
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "mid", region: room(["S"]) },
    ],
    edges: [
      { a: "root", b: "mid", aPortal: 0, bPortal: 0, lengthRange: [2, 30] },
    ],
  };
  const r = layoutWorld(g, "seed-1");
  const placed = r.regions.find((x) => x === r.regions[2]) ?? r.regions[2]!;
  expect(
    aabbIntersects(placed.bounds, { min: [2, -0.2, 6], max: [8, 3, 14] }),
  ).toBe(false);
});

test("backtracking: an ANCESTOR is popped and re-placed to satisfy a descendant", () => {
  // A root → A → B chain plus a pinned fence spanning the whole northward sector in front of
  // A's north door. With A at its CANONICAL placement (yaw-0, straight north), B's entire
  // candidate fan (every length × yaw) lands inside the fence envelope — B is unplaceable no
  // matter what B tries. The ONLY way to succeed is to pop back to the already-placed A and
  // re-seat it at a yawed candidate that aims A's north door (and hence B) off-axis, clear of
  // the fence. This exercises the cross-frame stack-pop path, not a single-node candidate retry.
  const g: WorldGraph = {
    nodes: [
      {
        id: "root",
        region: room(["N"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "A", region: room(["S", "N"]) },
      { id: "B", region: room(["S"]) },
      {
        id: "fence",
        region: {
          ...room([]),
          connections: [],
          bounds: { min: [-11, -0.2, 18], max: [11, 6, 34] },
        },
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
    ],
    edges: [
      // root→A length is fixed so A's only free variable is yaw (its door aim); the fence
      // blocks B unless A yaws. A→B is a long arm so a modest A yaw swings B well clear.
      { a: "root", b: "A", aPortal: 0, bPortal: 0, lengthRange: [4, 4] },
      { a: "A", b: "B", aPortal: 1, bPortal: 0, lengthRange: [8, 12] },
    ],
  };
  const r = layoutWorld(g, "seed-1");
  expect(r.placements.size).toBe(4); // all nodes placed — the pop succeeded, not threw
  expect(r.regions.length).toBe(4);
  for (let i = 0; i < r.regions.length; i++) {
    for (let j = i + 1; j < r.regions.length; j++) {
      expect(aabbIntersects(r.regions[i]!.bounds, r.regions[j]!.bounds)).toBe(
        false,
      );
    }
  }
});

test("clearanceBoxes: tops padded by ENCLOSURE_TOP_PAD above the climbing headroom line", () => {
  const from: Connection = {
    position: [0, 0, 0],
    facing: [0, 0, 1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const to: Connection = {
    position: [0, 2, 6],
    facing: [0, 0, -1],
    width: 2,
    height: 2.5,
    kind: "door",
  };
  const boxes = clearanceBoxes(from, to);
  expect(boxes.length).toBeGreaterThan(1); // segmented along the climb
  const top = Math.max(...boxes.map((b) => b.max[1]));
  expect(top).toBeCloseTo(2 + 3 + ENCLOSURE_TOP_PAD, 5); // to.y + headroom + pad
  const halfW = Math.max(...boxes.map((b) => b.max[0]));
  expect(halfW).toBeCloseTo(connectorSection(from, to).width / 2, 5); // same footprint authority
});
