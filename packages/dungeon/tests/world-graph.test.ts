import { expect, test } from "bun:test";
import type { RegionData } from "../src/region.ts";
import { validateGraph, type WorldGraph } from "../src/world-graph.ts";

function stubRegion(portals: number): RegionData {
  return {
    meshes: [],
    colliders: [],
    materials: [],
    connections: Array.from({ length: portals }, (_, i) => ({
      position: [i, 0, 0] as [number, number, number],
      facing: [0, 0, 1] as [number, number, number],
      width: 2,
      height: 3,
      kind: "door" as const,
    })),
    instances: [],
    origin: [0, 0, 0],
    bounds: { min: [-1, 0, -1], max: [1, 3, 1] },
    provenance: {
      generatorId: "dungeon",
      generatorVersion: 2,
      theme: "pillarHall",
      seed: "s",
    },
  };
}

function twoNodeGraph(): WorldGraph {
  return {
    nodes: [
      {
        id: "a",
        region: stubRegion(1),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "b", region: stubRegion(1) },
    ],
    edges: [{ a: "a", b: "b", aPortal: 0, bPortal: 0 }],
  };
}

test("valid graph passes", () => {
  expect(() => validateGraph(twoNodeGraph())).not.toThrow();
});

test("throws: duplicate node id", () => {
  const g = twoNodeGraph();
  g.nodes[1]!.id = "a";
  expect(() => validateGraph(g)).toThrow(/duplicate node id/);
});

test("throws: dangling edge endpoint and portal index", () => {
  const g1 = twoNodeGraph();
  g1.edges[0]!.b = "zzz";
  expect(() => validateGraph(g1)).toThrow(/unknown node/);
  const g2 = twoNodeGraph();
  g2.edges[0]!.bPortal = 5;
  expect(() => validateGraph(g2)).toThrow(/portal index/);
});

test("throws: portal used by two edges", () => {
  const g = twoNodeGraph();
  g.nodes.push({ id: "c", region: stubRegion(1) });
  g.edges.push({ a: "a", b: "c", aPortal: 0, bPortal: 0 }); // a portal 0 reused
  expect(() => validateGraph(g)).toThrow(/portal .* already used/);
});

test("throws: no pinned node / disconnected graph", () => {
  const g1 = twoNodeGraph();
  delete g1.nodes[0]!.pinned;
  expect(() => validateGraph(g1)).toThrow(/pinned/);
  const g2 = twoNodeGraph();
  g2.nodes.push({ id: "c", region: stubRegion(1) });
  expect(() => validateGraph(g2)).toThrow(/disconnected/);
});

test("a lone pinned obstacle node (no edges) is allowed", () => {
  const g = twoNodeGraph();
  g.nodes.push({
    id: "obstacle",
    region: stubRegion(0),
    pinned: { yaw: 0, translation: [0, 0, 0] },
  });
  expect(() => validateGraph(g)).not.toThrow();
});

test("throws: directed edges and non-walk verbs are reserved", () => {
  const g1 = twoNodeGraph();
  g1.edges[0]!.directed = true;
  expect(() => validateGraph(g1)).toThrow(/directed/);
  const g2 = twoNodeGraph();
  g2.edges[0]!.requiredVerbs = ["fly"] as unknown as "walk"[]; // deliberately invalid input
  expect(() => validateGraph(g2)).toThrow(/walk/);
  const g3 = twoNodeGraph();
  g3.edges[0]!.requiredVerbs = ["walk"];
  expect(() => validateGraph(g3)).not.toThrow();
});

function enclosureRegion(): RegionData {
  return {
    meshes: [],
    colliders: [],
    materials: [],
    connections: [
      {
        position: [0, 0, 1],
        facing: [0, 0, 1],
        width: 2,
        height: 3,
        kind: "door",
      },
    ],
    instances: [],
    origin: [0, 0, 0],
    bounds: { min: [-1, 0, -1], max: [1, 3, 1] },
    provenance: {
      generatorId: "dungeon",
      generatorVersion: 2,
      theme: "pillarHall",
      seed: "s",
    },
  };
}

test("enclosure 'open' is a legal edge annotation (validation passes it through)", () => {
  const g: WorldGraph = {
    nodes: [
      {
        id: "a",
        region: enclosureRegion(),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "b", region: enclosureRegion() },
    ],
    edges: [{ a: "a", b: "b", aPortal: 0, bPortal: 0, enclosure: "open" }],
  };
  expect(() => validateGraph(g)).not.toThrow();
});

test("validateGraph rejects an edge wired to a non-door portal (built-interface doctrine)", () => {
  const raw = enclosureRegion();
  const region: RegionData = {
    ...raw,
    connections: raw.connections.map((c) => ({
      ...c,
      kind: "tunnel-mouth" as const,
    })),
  };
  const graph: WorldGraph = {
    nodes: [
      { id: "a", region, pinned: { yaw: 0, translation: [0, 0, 0] } },
      { id: "b", region: enclosureRegion() },
    ],
    edges: [{ a: "a", b: "b", aPortal: 0, bPortal: 0 }],
  };
  expect(() => validateGraph(graph)).toThrow(/door/);
});
