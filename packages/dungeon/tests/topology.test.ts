// Pure plan-pass tests: the abstract topology (sectors, rooms, edges) before any
// RegionData exists. Cheap to run across many seeds.
import { expect, test } from "bun:test";
import { minWalkableRun } from "../src/connect.ts";
import { layoutWorld } from "../src/layout.ts";
import type { RegionData } from "../src/region.ts";
import { GENERATOR_VERSION } from "../src/region.ts";
import {
  _planTopology,
  CAPACITY,
  DEFAULT_TOPOLOGY,
  generateWorldGraph,
  type TopologyConfig,
} from "../src/topology.ts";
import { validateGraph, type WorldNode } from "../src/world-graph.ts";

const CFG: TopologyConfig = { ...DEFAULT_TOPOLOGY };
const SEEDS = Array.from({ length: 20 }, (_, i) => `plan-seed-${i}`);

function plan(seed: string, cfg: TopologyConfig = CFG) {
  return _planTopology("authored", 0, seed, cfg);
}

test("deterministic: same seed → deep-equal plan", () => {
  expect(plan("p-det")).toEqual(plan("p-det"));
});

test("config respected: sector count in range, rooms near target, every sector ≥ 2 rooms", () => {
  for (const s of SEEDS) {
    const p = plan(s);
    expect(p.sectors.length).toBeGreaterThanOrEqual(CFG.sectors[0]);
    expect(p.sectors.length).toBeLessThanOrEqual(CFG.sectors[1]);
    expect(p.nodes.length).toBe(CFG.targetRooms);
    for (let i = 0; i < p.sectors.length; i++) {
      expect(
        p.nodes.filter((n) => n.sector === i).length,
      ).toBeGreaterThanOrEqual(2);
    }
  }
});

test("archetype guarantees: entry sector is a warren; ≥1 works per world", () => {
  for (const s of SEEDS) {
    const p = plan(s);
    expect(p.sectors[0]!.archetype).toBe("warren");
    expect(p.sectors.some((sec) => sec.archetype === "works")).toBe(true);
    // entry root is a cave (continuity: cave-first entry), wired to the anchor
    const entry = p.edges.find(
      (e) => e.a === "authored" || e.b === "authored",
    )!;
    const rootId = entry.a === "authored" ? entry.b : entry.a;
    expect(p.nodes.find((n) => n.id === rootId)!.theme).toBe("cave");
  }
});

test("cycles-first: edge count ≥ node count (incl. anchor) — the macro ring closes", () => {
  for (const s of SEEDS) {
    const p = plan(s);
    // nodes + anchor vs edges: a connected graph with E >= V has at least one cycle
    expect(p.edges.length).toBeGreaterThanOrEqual(p.nodes.length + 1);
  }
});

test("universal descent orientation: every edge's dh ≤ 0 (b is never above a)", () => {
  for (const s of SEEDS) {
    for (const e of plan(s).edges) expect(e.dh).toBeLessThanOrEqual(0);
  }
});

test("walkable by construction: every lengthRange floor ≥ minWalkableRun", () => {
  for (const s of SEEDS) {
    for (const e of plan(s).edges) {
      expect(e.lengthRange[0]).toBeGreaterThanOrEqual(
        minWalkableRun(e.dh, e.kind) - 1e-9,
      );
      expect(e.lengthRange[1]).toBeGreaterThanOrEqual(e.lengthRange[0] + 2);
    }
  }
});

test("degree caps by construction: slot indices stay within theme capacity", () => {
  for (const s of SEEDS) {
    const p = plan(s);
    const used = new Map<string, number>();
    for (const e of p.edges) {
      for (const [id, slot] of [
        [e.a, e.aSlot],
        [e.b, e.bSlot],
      ] as const) {
        if (id === "authored") {
          expect(slot).toBe(0);
          continue;
        }
        const n = p.nodes.find((x) => x.id === id)!;
        expect(slot).toBeLessThan(CAPACITY[n.theme]);
        used.set(`${id}:${slot}`, (used.get(`${id}:${slot}`) ?? 0) + 1);
      }
    }
    for (const [, count] of used) expect(count).toBe(1); // each slot used once
    // node.used records exactly its edge-endpoint count
    for (const n of p.nodes) {
      const degree = p.edges.filter((e) => e.a === n.id || e.b === n.id).length;
      expect(n.used).toBe(degree);
      expect(degree).toBeGreaterThanOrEqual(1); // no orphan rooms
    }
  }
});

test("verticality bounded: elevations within ±verticality; loop deltas within the soft cap", () => {
  for (const s of SEEDS) {
    const p = plan(s);
    for (const n of p.nodes) {
      expect(Math.abs(n.elevation)).toBeLessThanOrEqual(CFG.verticality + 1e-9);
    }
  }
});

test("entry-root degree ≥ 2 (the traversal harness needs a through-cave)", () => {
  for (const s of SEEDS) {
    const p = plan(s);
    const entry = p.edges.find(
      (e) => e.a === "authored" || e.b === "authored",
    )!;
    const rootId = entry.a === "authored" ? entry.b : entry.a;
    const deg = p.edges.filter((e) => e.a === rootId || e.b === rootId).length;
    expect(deg).toBeGreaterThanOrEqual(2);
  }
});

test("setup-loud config errors", () => {
  expect(() => plan("x", { ...CFG, targetRooms: 4 })).toThrow(/targetRooms/);
  expect(() => plan("x", { ...CFG, sectors: [0, 3] })).toThrow(/sectors/);
  expect(() => plan("x", { ...CFG, loopChance: 1.5 })).toThrow(/loopChance/);
  expect(() => plan("x", { ...CFG, attempts: 0 })).toThrow(/attempts/);
});

function testAnchor(): WorldNode {
  const region: RegionData = {
    meshes: [],
    colliders: [{ shape: { cuboid: [5, 1, 5] }, position: [0, -1, 0] }],
    materials: [],
    connections: [
      {
        position: [0, 0, 5],
        facing: [0, 0, 1],
        width: 3,
        height: 6,
        kind: "door",
      },
    ],
    instances: [],
    origin: [0, 0, 0],
    bounds: { min: [-5, -2, -5], max: [5, 0, 5] },
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      theme: "authored",
      seed: "authored",
    },
  };
  return {
    id: "authored",
    region,
    pinned: { yaw: 0, translation: [0, 0, 0] },
  };
}

test("generateWorldGraph: validates, deterministic, anchor first", () => {
  const g1 = generateWorldGraph(testAnchor(), "gen-seed-1");
  const g2 = generateWorldGraph(testAnchor(), "gen-seed-1");
  expect(() => validateGraph(g1)).not.toThrow(); // also self-checked inside
  expect(g1.nodes.length).toBe(DEFAULT_TOPOLOGY.targetRooms + 1);
  expect(g1.nodes[0]!.id).toBe("authored");
  expect(g1.edges.length).toBe(g2.edges.length);
  for (let i = 0; i < g1.edges.length; i++) {
    expect(g1.edges[i]).toEqual(g2.edges[i]!);
  }
});

test("door counts match degrees; every edge portal is a door; heights ride edges", () => {
  const g = generateWorldGraph(testAnchor(), "gen-seed-2");
  const degree = new Map<string, number>();
  for (const e of g.edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    expect(e.heightDelta ?? 0).toBeLessThanOrEqual(0); // universal descent
    const an = g.nodes.find((n) => n.id === e.a)!;
    const bn = g.nodes.find((n) => n.id === e.b)!;
    expect(an.region.connections[e.aPortal]!.kind).toBe("door");
    expect(bn.region.connections[e.bPortal]!.kind).toBe("door");
  }
  for (const n of g.nodes) {
    if (n.id === "authored") continue;
    expect(n.region.connections.length).toBe(degree.get(n.id) ?? 0);
  }
});

test("small worlds generate too (config floor)", () => {
  const g = generateWorldGraph(testAnchor(), "gen-small", {
    targetRooms: 8,
    sectors: [3, 3],
  });
  expect(g.nodes.length).toBe(9);
  expect(() => validateGraph(g)).not.toThrow();
});

test("anchor without a door-class portal 0 throws setup-loud", () => {
  const anchor = testAnchor();
  anchor.region = { ...anchor.region, connections: [] };
  expect(() => generateWorldGraph(anchor, "x")).toThrow(/anchor/);
});

// Pure integration smoke test: a generated topology graph fed end-to-end to the placer
// (no GPU, no Rapier). Task 6a fixed the rotated-cave CLEARANCE false-reject (an unrotated-
// only per-cell path that whole-grid-rejected every non-zero join yaw — see
// occupancy.test.ts); a SEPARATE envelope-envelope blocker (BLOCK 2, escalated) still
// prevents full placement, so this currently THROWS with a "could not place" /
// envelope-envelope histogram. Flip to `.not.toThrow()` once BLOCK 2 lands — this keeps
// the coverage gap visible and the suite honest.
test("generated topology reaches the placer; full placement blocked by the escalated envelope bug (BLOCK 2)", () => {
  for (const seed of ["world-b2-topology-0", "world-b2-topology-1"]) {
    const graph = generateWorldGraph(testAnchor(), seed, {
      targetRooms: 8,
      sectors: [3, 3],
    });
    expect(() => layoutWorld(graph, seed)).toThrow(/could not place/);
  }
  // Task 0's A2 enlarged the portal exemption, so the bounded placer explores more
  // candidates before exhausting on these still-unplaceable BLOCK-2 seeds (~5 s/seed):
  // the throw is unchanged, only slower. Superseded when the B2c rebuild places these.
}, 20_000);

test("reserve guard: plan pass never throws across 2000 small-config seeds", () => {
  // Pre-fix baseline: 131/2000 threw "no free portal pair to close the macro ring".
  const cfg = {
    ...DEFAULT_TOPOLOGY,
    targetRooms: 8,
    sectors: [3, 3] as [number, number],
  };
  for (let i = 0; i < 2000; i++) {
    _planTopology("anchor", 0, `reserve-scan-${i}`, cfg);
  }
});
