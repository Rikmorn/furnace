import { describe, expect, test } from "bun:test";
import { aabbIntersects } from "../src/aabb.ts";
import type { CycleUnit } from "../src/chains.ts";
import {
  connectorSection,
  ENCLOSURE_TOP_PAD,
  LANDING_LEN,
  walkLineAt,
} from "../src/connect.ts";
import {
  _cycleTargets,
  CLEARANCE_SEGMENT,
  clearanceBoxes,
  type LayoutResult,
  layoutWorld,
} from "../src/layout.ts";
import { pairFeasible } from "../src/locus.ts";
import type { Aabb, Connection, RegionData, Vec3 } from "../src/region.ts";
import type { NodeId, WorldEdge, WorldGraph } from "../src/world-graph.ts";

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

test("LANDING_LEN >= CLEARANCE_SEGMENT so the arrival clearance segment is flat by construction", () => {
  expect(LANDING_LEN).toBeGreaterThanOrEqual(CLEARANCE_SEGMENT);
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

test("clearanceBoxes: segments flatten over the low-end landing (the lintel fix)", () => {
  const from: Connection = {
    position: [0, 2, 0],
    facing: [0, 0, 1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const to: Connection = {
    position: [0, 0, 8],
    facing: [0, 0, -1],
    width: 2,
    height: 3,
    kind: "door",
  };
  const boxes = clearanceBoxes(from, to);
  const last = boxes[boxes.length - 1] as Aabb; // z ∈ [6, 8] — the low-portal segment
  // Its top must follow walkLineAt (flat at the portal), NOT the linear profile.
  const expected =
    2 +
    Math.max(walkLineAt(-2, 8, 6), walkLineAt(-2, 8, 8)) +
    3 +
    ENCLOSURE_TOP_PAD;
  expect(last.max[1]).toBeCloseTo(expected, 5);
  // Strictly below the old linear top (2 + max(-1.5, -2) + 3 + PAD = 4.05):
  expect(last.max[1]).toBeLessThan(
    2 + -2 * (6 / 8) + 3 + ENCLOSURE_TOP_PAD + 1e-9,
  );
  // Floor side of the same fix: a mid-climb segment's floor dips BELOW the old linear
  // model — the under-reservation the fix corrects. boxes[1] is the z∈[2,4] segment
  // (CLEARANCE_SEGMENT=2, run=8 → 4 ascending-z segments); confirm via its shoulder-
  // invariant z-centre (min[2]/max[2] carry the ±w/2 cross-section pad).
  const mid = boxes[1] as Aabb;
  expect((mid.min[2] + mid.max[2]) / 2).toBeCloseTo(3, 5); // the z ∈ [2, 4] segment
  const midFloor = 2 + Math.min(walkLineAt(-2, 8, 2), walkLineAt(-2, 8, 4));
  expect(mid.min[1]).toBeCloseTo(midFloor, 5); // follows walkLineAt, not the linear run
  // Strictly below the old linear floor at that segment (2 + min(-0.5, -1.0) = 1.0):
  expect(mid.min[1]).toBeLessThan(2 + Math.min(-2 * (2 / 8), -2 * (4 / 8)));
});

test("edge enclosure styles reach the connector: default tube has a ceiling, 'open' has rails only", () => {
  const mk = (enclosure?: "open"): WorldGraph => ({
    nodes: [
      {
        id: "root",
        region: room(["N"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "far", region: room(["S"]) },
    ],
    edges: [
      enclosure
        ? {
            a: "root",
            b: "far",
            aPortal: 0,
            bPortal: 0,
            lengthRange: [3, 5],
            enclosure,
          }
        : { a: "root", b: "far", aPortal: 0, bPortal: 0, lengthRange: [3, 5] },
    ],
  });
  const tops = (g: WorldGraph): number =>
    Math.max(
      ...layoutWorld(g, "seed-1").connectors[0]!.colliders.map((c) => {
        if (!("cuboid" in c.shape)) throw new Error("expected cuboid");
        return c.position[1] + c.shape.cuboid[1];
      }),
    );
  expect(tops(mk())).toBeGreaterThan(3); // tube: ceiling band above the 3 m headroom
  expect(tops(mk("open"))).toBeLessThan(2); // open: nothing above the ~1.1 m rails
});

/** A pinned envelope-only obstacle at a fixed world AABB (door-less; blocks placements it
 *  overlaps). Mirrors the "fence" pattern in the existing tests. */
function slab(bounds: Aabb): RegionData {
  return { ...room([]), connections: [], bounds };
}

/** Anchor room with doors N + E (spec-identical) plus a slab dead ahead of N that blocks the
 *  SHORT northward placement, and two children off the anchor: childA nominally on N (short —
 *  cannot fit past the slab, must swap to E) and childB nominally on E (its nominal slot is
 *  then consumed, so it swaps to N with a LONG length that clears the slab). The final anchor
 *  bindings must be a portal permutation with no double-use. */
function swapFixture(): WorldGraph {
  return {
    nodes: [
      {
        id: "anchor",
        region: room(["N", "E"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      {
        id: "obstacle",
        region: slab({ min: [3, -0.2, 6], max: [9, 4, 11] }),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "childA", region: room(["S", "N"]) },
      { id: "childB", region: room(["S", "N"]) },
    ],
    edges: [
      { a: "anchor", b: "childA", aPortal: 0, bPortal: 0, lengthRange: [2, 4] },
      {
        a: "anchor",
        b: "childB",
        aPortal: 1,
        bPortal: 0,
        lengthRange: [8, 12],
      },
    ],
  };
}

/** pin → r0, then a 4-cycle r0 → r1 → r2 → r3 with the closing edge r3 → r0. Every room is a
 *  spec-identical 4-door box, every edge's length range is generous — the placer has full
 *  portal freedom and must embed the square (the B2 placer failed this shape post-hoc). */
function squareCycleFixture(): WorldGraph {
  const box = (): RegionData => room(["N", "S", "E", "W"]);
  const L: [number, number] = [3, 12];
  return {
    nodes: [
      {
        id: "anchor",
        region: room(["N"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "r0", region: box() },
      { id: "r1", region: box() },
      { id: "r2", region: box() },
      { id: "r3", region: box() },
    ],
    edges: [
      { a: "anchor", b: "r0", aPortal: 0, bPortal: 1, lengthRange: L },
      { a: "r0", b: "r1", aPortal: 2, bPortal: 3, lengthRange: L },
      { a: "r1", b: "r2", aPortal: 0, bPortal: 1, lengthRange: L },
      { a: "r2", b: "r3", aPortal: 3, bPortal: 2, lengthRange: L },
      { a: "r3", b: "r0", aPortal: 1, bPortal: 0, lengthRange: L }, // closing
    ],
  };
}

/** A pinned door-less slab straight ahead of the anchor's N door, a pinned anchor, and one
 *  child whose straight (yaw-0) placements clip the slab — only a YAWED seating fits, and its
 *  exact OBB clears where the conservative rotated-AABB cover would have (the B2 false-reject
 *  class the exact-OBB envelopes kill). */
function pinnedSlabFixture(): WorldGraph {
  return {
    nodes: [
      {
        id: "anchor",
        region: room(["N"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      {
        id: "wall",
        region: slab({ min: [-1.5, -0.2, 10], max: [1.5, 4, 26] }),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "child", region: room(["S", "N"]) },
    ],
    edges: [
      { a: "anchor", b: "child", aPortal: 0, bPortal: 0, lengthRange: [6, 9] },
    ],
  };
}

/** A child whose entire seating annulus is buried inside a pinned wall — unplaceable, so the
 *  placer must exhaust its restarts and throw setup-loud naming the child. */
function impossibleFixture(): WorldGraph {
  return {
    nodes: [
      {
        id: "anchor",
        region: room(["N"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      {
        id: "wall",
        region: slab({ min: [-30, -0.2, 4], max: [30, 12, 30] }),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "child", region: room(["S"]) },
    ],
    edges: [
      { a: "anchor", b: "child", aPortal: 0, bPortal: 0, lengthRange: [4, 5] },
    ],
  };
}

describe("B2c toolbox placer", () => {
  test("portal-assignment freedom: two children seat off a 2-door parent even when nominal slots collide geometrically", () => {
    const result = layoutWorld(swapFixture(), "swap-seed");
    const edges = swapFixture().edges;
    const used = new Set(
      result.edgeBindings.map((b, i) => `${edges[i]?.a}:${b.aPortal}`),
    );
    expect(used.size).toBe(result.edgeBindings.length);
    expect(result.placements.size).toBe(4);
  });

  test("forward checking: a cycle-closing edge is validated at candidate time (square cycle places)", () => {
    const result = layoutWorld(squareCycleFixture(), "square-seed");
    expect(result.placements.size).toBe(5);
    expect(result.connectors.length).toBe(5);
  });

  test("deterministic: same graph + seed → identical placements", () => {
    const a = layoutWorld(squareCycleFixture(), "det-seed");
    const b = layoutWorld(squareCycleFixture(), "det-seed");
    expect([...a.placements.entries()]).toEqual([...b.placements.entries()]);
    expect(a.edgeBindings).toEqual(b.edgeBindings);
  });

  test("pinned-obstacle seating: a generated-style piece seats beside a pinned slab (the coexistence seam)", () => {
    const result = layoutWorld(pinnedSlabFixture(), "slab-seed");
    expect(result.placements.size).toBe(3);
  });

  test("throws setup-loud with per-node diagnostics after exhausting restarts", () => {
    expect(() => layoutWorld(impossibleFixture(), "imp-seed")).toThrow(
      /could not place/,
    );
  });
});

/** Read the WORLD-frame Connection actually mated on a node under a layout result: find the
 *  node's index in graph order (= result.regions order), then read that placed region's
 *  connection at `portal`. */
function regionPortal(
  result: LayoutResult,
  g: WorldGraph,
  nodeId: NodeId,
  portal: number,
): Connection {
  const idx = g.nodes.findIndex((n) => n.id === nodeId);
  return result.regions[idx]!.connections[portal]!;
}

/** A pinned anchor plus a SIX-room ring (r0…r5, closing r5→r0), every room a spec-identical
 *  4-door box and every edge a TIGHT [3, 5] length window — tight enough that a greedy
 *  first-accept seat of a cycle member routinely overshoots the closing member's reach, so
 *  the ring only closes with in-chain repair + intersection-biased closing candidates. */
function tightRingFixture(): WorldGraph {
  const box = (): RegionData => room(["N", "S", "E", "W"]);
  const L: [number, number] = [3, 5];
  return {
    nodes: [
      {
        id: "anchor",
        region: room(["N"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "r0", region: box() },
      { id: "r1", region: box() },
      { id: "r2", region: box() },
      { id: "r3", region: box() },
      { id: "r4", region: box() },
      { id: "r5", region: box() },
    ],
    edges: [
      { a: "anchor", b: "r0", aPortal: 0, bPortal: 0, lengthRange: L },
      { a: "r0", b: "r1", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "r1", b: "r2", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "r2", b: "r3", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "r3", b: "r4", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "r4", b: "r5", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "r5", b: "r0", aPortal: 1, bPortal: 2, lengthRange: L }, // closing
    ],
  };
}

/** A pinned 2-door anchor plus TWO room-disjoint 4-cycles (a0…a3 and b0…b3), one off each
 *  anchor door — both cycles must close on a single seed. */
function twoCycleFixture(): WorldGraph {
  const box = (): RegionData => room(["N", "S", "E", "W"]);
  const L: [number, number] = [3, 7];
  return {
    nodes: [
      {
        id: "anchor",
        region: room(["N", "S"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "a0", region: box() },
      { id: "a1", region: box() },
      { id: "a2", region: box() },
      { id: "a3", region: box() },
      { id: "b0", region: box() },
      { id: "b1", region: box() },
      { id: "b2", region: box() },
      { id: "b3", region: box() },
    ],
    edges: [
      { a: "anchor", b: "a0", aPortal: 0, bPortal: 0, lengthRange: L },
      { a: "a0", b: "a1", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "a1", b: "a2", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "a2", b: "a3", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "a3", b: "a0", aPortal: 1, bPortal: 2, lengthRange: L }, // closing A
      { a: "anchor", b: "b0", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "b0", b: "b1", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "b1", b: "b2", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "b2", b: "b3", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "b3", b: "b0", aPortal: 1, bPortal: 2, lengthRange: L }, // closing B
    ],
  };
}

// CORRECTNESS / REGRESSION coverage — NOT a proof of any Task-5-only machinery. The Task-4
// placer already delivered the cycle-as-unit behaviour these lock in: `placeNode`'s forward
// checking (`forwardCheckOthers` + `commitEdges`) already enforces the two-partner
// intersection as a HARD constraint (a closing candidate that fails either edge's cone/range
// is never committed), and `placeCycle` already does in-chain repair. Task 5's
// intersection-by-filtration ordering is a result-preserving efficiency change (a stable
// partition over an unchanged candidate set), so it does NOT alter which of these pass — they
// pass with or without it. Their job is to lock in that cycles CLOSE and the intersection
// HOLDS, guarding against a future regression in either.
describe("cycle units", () => {
  test("a 6-room ring with tight length ranges closes (needs in-chain repair, not luck)", () => {
    const result = layoutWorld(tightRingFixture(), "ring-seed");
    expect(result.placements.size).toBe(7);
    expect(result.expansions.size).toBe(0); // straight closure, no dogleg needed
  });
  test("two room-disjoint cycles both close on one seed", () => {
    const result = layoutWorld(twoCycleFixture(), "two-seed");
    expect(result.placements.size).toBe(9);
  });
  test("closing-member candidates come from the two-partner intersection: the closing room's two connectors both satisfy cones and ranges", () => {
    const result = layoutWorld(tightRingFixture(), "ring-seed");
    const g = tightRingFixture();
    for (const [i, e] of g.edges.entries()) {
      const bind = result.edgeBindings[i] as {
        aPortal: number;
        bPortal: number;
      };
      const pa = regionPortal(result, g, e.a, bind.aPortal);
      const pb = regionPortal(result, g, e.b, bind.bPortal);
      expect(pairFeasible(pa, pb, e.lengthRange ?? [2, 10])).toBe(true);
    }
  });
});

/** A pinned anchor plus an EIGHT-room ring (r0…r7, closing r7→r0), every room a spec-identical
 *  4-door box, every edge a TIGHT [3, 6] window. Exercises closure steering end-to-end: the
 *  cycle placer computes octagon polygon targets (`_cycleTargets`) and biases each member's
 *  canonical seat toward its vertex. A regression guard that the ring still closes with steering
 *  ACTIVE — steering is a candidate-order bias, so it stays outcome-neutral here (see the Task 7B
 *  report: rigid 4-door boxes turn 90°±45°, so a regular octagon needs no steering to close). */
function eightRingFixture(): WorldGraph {
  const box = (): RegionData => room(["N", "S", "E", "W"]);
  const L: [number, number] = [3, 6];
  return {
    nodes: [
      {
        id: "anchor",
        region: room(["N"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "r0", region: box() },
      { id: "r1", region: box() },
      { id: "r2", region: box() },
      { id: "r3", region: box() },
      { id: "r4", region: box() },
      { id: "r5", region: box() },
      { id: "r6", region: box() },
      { id: "r7", region: box() },
    ],
    edges: [
      { a: "anchor", b: "r0", aPortal: 0, bPortal: 0, lengthRange: L },
      { a: "r0", b: "r1", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "r1", b: "r2", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "r2", b: "r3", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "r3", b: "r4", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "r4", b: "r5", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "r5", b: "r6", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "r6", b: "r7", aPortal: 1, bPortal: 0, lengthRange: L },
      { a: "r7", b: "r0", aPortal: 1, bPortal: 2, lengthRange: L }, // closing
    ],
  };
}

/** Two spec-identical 3-cycles (a0…a2 closing a2→a0, b0…b2 closing b2→b0) bridged by ONE tree
 *  edge a2→b0 with a NARROW length window — the mechanism-2 cross-unit shape. Cycle A places
 *  first (off the pin), cycle B seats b0 across the narrow bridge; if that forecloses, the
 *  blame-directed backtracker can reach BACK to re-seat cycle A. A regression guard that the
 *  bridged two-cycle graph places (the blame path is exercised but, on this small graph,
 *  outcome-neutral — pop-previous already reaches the adjacent-unit culprit; see the report). */
function crossUnitBridgeFixture(): WorldGraph {
  const box = (): RegionData => room(["N", "S", "E", "W"]);
  const C: [number, number] = [3, 6];
  const BRIDGE: [number, number] = [3, 4];
  return {
    nodes: [
      {
        id: "anchor",
        region: room(["N"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "a0", region: box() },
      { id: "a1", region: box() },
      { id: "a2", region: box() },
      { id: "b0", region: box() },
      { id: "b1", region: box() },
      { id: "b2", region: box() },
    ],
    edges: [
      { a: "anchor", b: "a0", aPortal: 0, bPortal: 0, lengthRange: C },
      { a: "a0", b: "a1", aPortal: 1, bPortal: 0, lengthRange: C },
      { a: "a1", b: "a2", aPortal: 1, bPortal: 0, lengthRange: C },
      { a: "a2", b: "a0", aPortal: 1, bPortal: 2, lengthRange: C }, // closing A
      { a: "a2", b: "b0", aPortal: 2, bPortal: 0, lengthRange: BRIDGE }, // bridge
      { a: "b0", b: "b1", aPortal: 1, bPortal: 0, lengthRange: C },
      { a: "b1", b: "b2", aPortal: 1, bPortal: 0, lengthRange: C },
      { a: "b2", b: "b0", aPortal: 1, bPortal: 2, lengthRange: C }, // closing B
    ],
  };
}

describe("closure steering + blame-directed backjumping (Task 7B)", () => {
  test("an 8-room ring with a tight closing window places (closure steering active)", () => {
    const result = layoutWorld(eightRingFixture(), "eight-seed");
    expect(result.placements.size).toBe(9);
    expect(result.connectors.length).toBe(9);
  });

  test("two 3-cycles bridged by a narrow tree edge place (blame-backjump path active)", () => {
    const result = layoutWorld(crossUnitBridgeFixture(), "bridge-seed");
    expect(result.placements.size).toBe(7);
    expect(result.connectors.length).toBe(8);
  });

  test("_cycleTargets: the polygon closes and the map is deterministic", () => {
    // A synthetic 4-member ring m0→m1→m2→m3 with the closing edge m3→m0 (edge index 3
    // first, matching deriveChains' [closing, ...treePath] ordering).
    const cyc: CycleUnit = {
      closingEdge: 3,
      edges: [3, 0, 1, 2],
      members: ["m0", "m1", "m2", "m3"],
    };
    const edges: WorldEdge[] = [
      { a: "m0", b: "m1", aPortal: 0, bPortal: 0 },
      { a: "m1", b: "m2", aPortal: 0, bPortal: 0 },
      { a: "m2", b: "m3", aPortal: 0, bPortal: 0 },
      { a: "m3", b: "m0", aPortal: 0, bPortal: 0 }, // closing
    ];
    const distances = new Map<number, number>([
      [0, 5],
      [1, 5],
      [2, 5],
      [3, 5],
    ]);
    const attach = {
      member: "m0" as NodeId,
      pos: [0, 0, 0] as Vec3,
      heading: [0, 0, 1] as Vec3,
    };
    const targets = _cycleTargets(cyc, edges, attach, 1, distances);
    expect(targets.size).toBe(4);

    // The polygon closes: EVERY ring edge — including the closing m3→m0 — has the constructed
    // step length (the walk returns to its start). If the eight/four turns did not sum to a
    // full revolution, the closing edge's length would differ.
    const order: NodeId[] = ["m0", "m1", "m2", "m3"];
    const xz = (a: Vec3, b: Vec3): number =>
      Math.hypot(a[0] - b[0], a[2] - b[2]);
    for (let k = 0; k < order.length; k++) {
      const p = targets.get(order[k]!) as Vec3;
      const q = targets.get(order[(k + 1) % order.length]!) as Vec3;
      expect(xz(p, q)).toBeCloseTo(5, 6);
    }

    // Deterministic: two identical calls return identical maps.
    const again = _cycleTargets(cyc, edges, attach, 1, distances);
    expect([...again.entries()]).toEqual([...targets.entries()]);
  });
});

/** A 3-cycle (anchor pinned, r0, r1) whose closing edge r0.N→r1.E CANNOT mate straight. r0 seats
 *  far east (a fixed 10 m arm off anchor.E) while r1 seats close north (a fixed 3 m arm off
 *  anchor.N), so the closing chord runs mostly −X — more than 60° off r0's north-facing (+Z)
 *  door: straight-infeasible by construction. The only closure is the dogleg (segment → corner
 *  room-let → segment); the generous [3, 16] closing window lets its two straight legs fit. */
function doglegClosureFixture(): WorldGraph {
  return {
    nodes: [
      {
        id: "anchor",
        region: room(["E", "N"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "r0", region: room(["W", "N"]) },
      { id: "r1", region: room(["S", "E"]) },
    ],
    edges: [
      { a: "anchor", b: "r0", aPortal: 0, bPortal: 0, lengthRange: [10, 10] },
      { a: "anchor", b: "r1", aPortal: 1, bPortal: 0, lengthRange: [3, 3] },
      { a: "r0", b: "r1", aPortal: 1, bPortal: 1, lengthRange: [3, 16] }, // closing
    ],
  };
}

describe("dogleg closure (Task 8)", () => {
  test("a cycle whose closing edge cannot route straight closes via a dogleg (corner + two segments)", () => {
    const result = layoutWorld(doglegClosureFixture(), "int-seed");
    expect(result.placements.size).toBe(3); // it places
    expect(result.expansions.size).toBe(1); // exactly one edge doglegged
    // The one expansion's three pieces are real, distinct indices into `connectors`.
    const exp = [...result.expansions.values()][0]!;
    for (const idx of [exp.segA, exp.corner, exp.segB]) {
      expect(result.connectors[idx]).toBeDefined();
    }
    expect(new Set([exp.segA, exp.corner, exp.segB]).size).toBe(3);
    // The corner is a real box room-let (walls + slabs → many colliders); the segments route.
    expect(result.connectors[exp.corner]!.colliders.length).toBeGreaterThan(4);
  });

  test("deterministic: the dogleg closure reproduces on the same seed", () => {
    const a = layoutWorld(doglegClosureFixture(), "int-seed");
    const b = layoutWorld(doglegClosureFixture(), "int-seed");
    expect([...a.placements.entries()]).toEqual([...b.placements.entries()]);
    expect([...a.expansions.entries()]).toEqual([...b.expansions.entries()]);
  });
});

/** A pinned anchor plus a TEN-room ring (r0…r9, closing r9→r0), every room a spec-identical
 *  4-door box, every edge a FIXED [4, 4] length — a rigid, near-regular decagon. The greedy +
 *  in-chain-repair + steering + restart pass CANNOT close this: a member's first-accept seat
 *  routinely forecloses a later member's facing cone, and no sequential re-seat within the
 *  greedy horizon jointly re-orients the ring. Only joint annealing over ALL members at once
 *  (repairCycleBySA) finds a closing decagon. VERIFIED during Task 8B: with the SA fallback
 *  disabled the base placer throws on `ring10-a` (`edge[fwd]:facing`); with SA it places. */
function tenRingFixture(): WorldGraph {
  const box = (): RegionData => room(["N", "S", "E", "W"]);
  const L: [number, number] = [4, 4];
  const rooms = Array.from({ length: 10 }, (_, i) => ({
    id: `r${i}`,
    region: box(),
  }));
  const ringEdges: WorldEdge[] = Array.from({ length: 9 }, (_, i) => ({
    a: `r${i}`,
    b: `r${i + 1}`,
    aPortal: 1,
    bPortal: 0,
    lengthRange: L,
  }));
  return {
    nodes: [
      {
        id: "anchor",
        region: room(["N"]),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      ...rooms,
    ],
    edges: [
      { a: "anchor", b: "r0", aPortal: 0, bPortal: 0, lengthRange: L },
      ...ringEdges,
      { a: "r9", b: "r0", aPortal: 1, bPortal: 2, lengthRange: L }, // closing
    ],
  };
}

describe("joint chain repair — SA fallback (Task 8B)", () => {
  test("a rigid 10-ring greedy+steering CANNOT close is rescued by SA annealing", () => {
    // Pre-SA (fallback disabled) this fixture throws `edge[fwd]:facing` — the greedy pass cannot
    // jointly orient the decagon. The SA repair places all 11 pieces and realizes all 11 edges.
    const result = layoutWorld(tenRingFixture(), "ring10-a");
    expect(result.placements.size).toBe(11); // anchor + 10 rooms
    expect(result.connectors.length).toBe(11); // every edge realized (straight — no dogleg)
    expect(result.expansions.size).toBe(0);
  });

  test("deterministic: the SA-rescued layout reproduces on the same seed", () => {
    const a = layoutWorld(tenRingFixture(), "ring10-a");
    const b = layoutWorld(tenRingFixture(), "ring10-a");
    expect([...a.placements.entries()]).toEqual([...b.placements.entries()]);
    expect(a.edgeBindings).toEqual(b.edgeBindings);
  });

  test("SA-rescued layout is valid: every edge mates within its cone + range", () => {
    const result = layoutWorld(tenRingFixture(), "ring10-a");
    const g = tenRingFixture();
    for (const [i, e] of g.edges.entries()) {
      const bind = result.edgeBindings[i] as {
        aPortal: number;
        bPortal: number;
      };
      const pa = regionPortal(result, g, e.a, bind.aPortal);
      const pb = regionPortal(result, g, e.b, bind.bPortal);
      expect(pairFeasible(pa, pb, e.lengthRange ?? [2, 10])).toBe(true);
    }
  });
});
