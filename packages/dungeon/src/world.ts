// packages/dungeon/src/world.ts
// The hand-written world graph: the authored level pinned as a collision phantom, the
// branching cave wing, and two cave-side ground rooms. Topology is authored; PLACEMENT
// comes out of layoutWorld — no GATE-TUNE world positions. Shared by main.ts and the
// traversal GPU harness so they can't drift.
// The 2.2.4/2.2.5a elevated showcase (upperA ramp, upperB stairs, the upperA→landing→hallA
// descending cycle) was RETIRED at the 2026-07-06 Epic 2 closure: its authored→upperA edge
// was walkable-XOR-placeable (see docs/learnings/2026-07-05-dungeon-placement-arc-postmortem.md,
// Disposition), and Epic 3's cockpit replaces hand showcases with generated content. The
// ramp/stairs/descent mechanisms stay covered by connect.test.ts / connect.gpu.test.ts fixtures.
import { create as makeRng } from "@furnace/core/rng";
import { aabbOfBoxes } from "./aabb.ts";
import { type LayoutResult, layoutWorld } from "./layout.ts";
import { CHAMBER_DOOR, LEVEL_BOXES } from "./level.ts";
import type { RegionData } from "./region.ts";
import { GENERATOR_VERSION } from "./region.ts";
import { cave } from "./themes/cave.ts";
import { greatHall } from "./themes/great-hall.ts";
import { pillarHall } from "./themes/pillar-hall.ts";
import {
  DEFAULT_TOPOLOGY,
  generateWorldGraph,
  type TopologyConfig,
} from "./topology.ts";
import type { WorldGraph, WorldNode } from "./world-graph.ts";

export const WORLD_SEED = "world-1";
/** Shipped seed — picked (B2 Task 6) as the first world-b2-N candidate that places on
 *  attempt 0 AND carries the gate content: a ≥3 m descent, an open-enclosure connector,
 *  and a capped cave bore. Re-pick by the same criteria if generator constants change. */
export const GENERATED_SEED = "world-b2-0";

/** The authored level as a pinned collision phantom: EMPTY meshes/instances (main.ts
 *  realizes the level itself, as always), but REAL colliders + bounds so the placer
 *  treats authored geometry as first-class obstacles, and the portals other pieces
 *  attach to. Single-sourced from LEVEL_BOXES — cannot drift from what main.ts builds. */
function authoredPhantom(): RegionData {
  return {
    meshes: [],
    colliders: LEVEL_BOXES.map((b) => ({
      shape: { cuboid: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2] },
      position: b.center,
    })),
    materials: [],
    connections: [CHAMBER_DOOR],
    instances: [],
    origin: [0, 0, 0],
    bounds: aabbOfBoxes(LEVEL_BOXES),
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      theme: "authored",
      seed: "authored",
    },
  };
}

/** Resolve a cave's two branch mouths by FACING (position-independent, so it survives seed
 *  changes): the +X (east) mouth deterministically anchors the loop hall; the +Z (north)
 *  mouth carries hallB. Cave mouths are collared `kind:"door"` portals (built-interface
 *  doctrine), and the entrance is ALSO a door (facing -Z), so mouths must be picked by
 *  facing, never by "first door". Setup-loud if the seed's cave lacks a distinct +X and
 *  +Z mouth. */
function caveMouths(caveRegion: RegionData): { east: number; north: number } {
  const east = caveRegion.connections.findIndex(
    (c) => c.kind === "door" && c.facing[0] === 1,
  );
  const north = caveRegion.connections.findIndex(
    (c) => c.kind === "door" && c.facing[2] === 1,
  );
  if (east < 0 || north < 0 || east === north) {
    throw new Error(
      `world: cave lacks distinct +X/+Z mouths (east=${east}, north=${north}) — pick a WORLD_SEED that yields both`,
    );
  }
  return { east, north };
}

/** Build the hand world graph. Regions generate in LOCAL frame (origin [0,0,0]) —
 *  layoutWorld owns all world placement. */
export function buildWorldGraph(seed: string): WorldGraph {
  const rng = makeRng(seed);
  const caveRegion = cave({
    theme: "cave",
    seed: rng.derive("cave").float().toString(),
    origin: [0, 0, 0],
  });
  const { east, north } = caveMouths(caveRegion);
  const hallA = pillarHall({
    theme: "pillarHall",
    seed: `${seed}-hallA`,
    origin: [0, 0, 0],
  });
  const hallB = greatHall({
    theme: "greatHall",
    seed: `${seed}-hallB`,
    origin: [0, 0, 0],
  });

  return {
    nodes: [
      {
        id: "authored",
        region: authoredPhantom(),
        pinned: { yaw: 0, translation: [0, 0, 0] },
      },
      { id: "cave", region: caveRegion, theme: "cave" },
      { id: "hallA", region: hallA, theme: "pillarHall" },
      { id: "hallB", region: hallB, theme: "greatHall" },
    ],
    edges: [
      {
        a: "authored",
        b: "cave",
        aPortal: 0,
        bPortal: 0,
        lengthRange: [7, 10],
      },
      { a: "cave", b: "hallA", aPortal: east, bPortal: 0, lengthRange: [2, 6] },
      {
        a: "cave",
        b: "hallB",
        aPortal: north,
        bPortal: 0,
        lengthRange: [2, 6],
      },
    ],
  };
}

/** The generator's pinned anchor: the authored phantom exposing the chamber door
 *  (the generated world's front door). */
function generatorAnchor(): WorldNode {
  return {
    id: "authored",
    region: authoredPhantom(),
    pinned: { yaw: 0, translation: [0, 0, 0] },
  };
}

/** Generate + place a world with bounded derived-seed retry: attempt k regenerates the
 *  whole graph from `seed:k` and re-places. First success wins; exhausting the budget
 *  throws setup-loud with every attempt's placer diagnostics (never retry-forever —
 *  the research doc's named anti-pattern). Placement wall-time is logged per attempt
 *  (perf is MEASURED, not gated — creaking at scale is prioritization signal). */
export function buildWorld(
  seed: string,
  config?: Partial<TopologyConfig>,
): { graph: WorldGraph; layout: LayoutResult; attempt: number } {
  const cfg: TopologyConfig = { ...DEFAULT_TOPOLOGY, ...config };
  const failures: string[] = [];
  for (let k = 0; k < cfg.attempts; k++) {
    const attemptSeed = k === 0 ? seed : `${seed}:${k}`;
    const graph = generateWorldGraph(generatorAnchor(), attemptSeed, cfg);
    try {
      const t0 = performance.now();
      const layout = layoutWorld(graph, attemptSeed);
      console.info(
        `[world] seed "${seed}" attempt ${k}: ${graph.nodes.length} nodes / ${graph.edges.length} edges placed in ${(performance.now() - t0).toFixed(0)} ms`,
      );
      return { graph, layout, attempt: k };
    } catch (err) {
      failures.push(
        `attempt ${k} ("${attemptSeed}"): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  throw new Error(
    `world: seed "${seed}" failed all ${cfg.attempts} placement attempts —\n${failures.join("\n")}`,
  );
}
