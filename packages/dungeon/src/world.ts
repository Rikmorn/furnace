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
import { type LayoutBudget, type LayoutResult, layoutWorld } from "./layout.ts";
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

/** One generation attempt: a fresh topology from the derived seed, placed or failed. */
export type WorldAttempt = {
  attempt: number;
  attemptSeed: string;
  graph: WorldGraph;
} & ({ ok: true; layout: LayoutResult } | { ok: false; error: string });

/** The attempt loop as a pull-based iterator — the SINGLE owner of retry policy and
 *  seed derivation (`seed:k`). `buildWorld` drains it; the cockpit steps it between
 *  paints (cancel = stop iterating). Yields one result per attempt, ending after the
 *  first success or when `cfg.attempts` is exhausted — never retry-forever (the research
 *  doc's named anti-pattern). Placement wall-time is logged per attempt (perf is
 *  MEASURED, not gated — creaking at scale is prioritization signal). */
export function* worldAttempts(
  seed: string,
  config?: Partial<TopologyConfig>,
  budget?: Partial<LayoutBudget>,
): Generator<WorldAttempt, void, undefined> {
  const cfg: TopologyConfig = { ...DEFAULT_TOPOLOGY, ...config };
  for (let k = 0; k < cfg.attempts; k++) {
    const attemptSeed = k === 0 ? seed : `${seed}:${k}`;
    const graph = generateWorldGraph(generatorAnchor(), attemptSeed, cfg);
    try {
      const t0 = performance.now();
      const layout = layoutWorld(graph, attemptSeed, budget);
      console.info(
        `[world] seed "${seed}" attempt ${k}: ${graph.nodes.length} nodes / ${graph.edges.length} edges placed in ${(performance.now() - t0).toFixed(0)} ms`,
      );
      yield { attempt: k, attemptSeed, graph, ok: true, layout };
      return;
    } catch (err) {
      yield {
        attempt: k,
        attemptSeed,
        graph,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/** Generate + place a world with bounded derived-seed retry by draining `worldAttempts`:
 *  attempt k regenerates the whole graph from `seed:k` and re-places. First success wins;
 *  exhausting the budget throws setup-loud with every attempt's placer diagnostics. */
export function buildWorld(
  seed: string,
  config?: Partial<TopologyConfig>,
  budget?: Partial<LayoutBudget>,
): { graph: WorldGraph; layout: LayoutResult; attempt: number } {
  const failures: string[] = [];
  for (const a of worldAttempts(seed, config, budget)) {
    if (a.ok) return { graph: a.graph, layout: a.layout, attempt: a.attempt };
    failures.push(`attempt ${a.attempt} ("${a.attemptSeed}"): ${a.error}`);
  }
  throw new Error(
    `world: seed "${seed}" failed all ${failures.length} placement attempts —\n${failures.join("\n")}`,
  );
}

/** Cockpit defaults (Slice 3.1): single-sector wing at the P1 bar config. */
export const COCKPIT_CONFIG: Partial<TopologyConfig> = {
  sectors: [1, 1],
  targetRooms: 6,
  loopChance: 0.35,
  attempts: 12,
};
/** Per-attempt search budget for interactive rerolls — Task 0's measured pick (tight). */
export const COCKPIT_BUDGET: Partial<LayoutBudget> = {
  maxAttempts: 2000,
  maxRestarts: 2,
  maxSaLayoutRestarts: 1,
  maxSaMoves: 200,
  maxSaRestarts: 2,
  deadlineMs: 2000, // the Task 4 Stage-A pick; search-tier only (bakeWing strips it)
};

/** One measured row of the cockpit envelope: the single-shot success rate under
 *  COCKPIT_BUDGET (deadline included), the attempt count the cockpit runs at that
 *  size, and the projected reliability 1-(1-singleShot)^attempts the UI displays. */
export type CockpitEnvelopeRow = {
  rooms: number;
  singleShot: number;
  attempts: number;
  projected: number;
};

/** The measured cockpit envelope — knob bounds, per-size attempt counts, and the
 *  reliability line all derive from THIS table (never hand-edit a row: re-run the
 *  probe when generator constants OR `COCKPIT_BUDGET` (esp. `deadlineMs`) change —
 *  the table is measured at the current budget).
 *  Provenance: measure-b2c.ts `--envelope - - 2000`, run 2026-07-10,
 *  n=20 seeds/cell, loop=0.35, deadlineMs=2000, sequential cells, unloaded
 *  machine; rates carry ±~10pp sampling noise (e.g. the rooms 7<8 inversion).
 *  attempts = ~95%-target (TARGET_MISS 0.05), floor 4, cap = ~60 s worst case
 *  divided by the measured give-up p95 (see recommendAttempts). rooms 12 is a
 *  measured low-yield size (projected 0.693 at the ~60 s cap) — honest, not a bug. */
export const COCKPIT_ENVELOPE: readonly CockpitEnvelopeRow[] = [
  { rooms: 2, singleShot: 0.75, attempts: 4, projected: 0.996 },
  { rooms: 3, singleShot: 0.65, attempts: 4, projected: 0.985 },
  { rooms: 4, singleShot: 0.55, attempts: 4, projected: 0.959 },
  { rooms: 5, singleShot: 0.45, attempts: 6, projected: 0.972 },
  { rooms: 6, singleShot: 0.35, attempts: 7, projected: 0.951 },
  { rooms: 7, singleShot: 0.25, attempts: 11, projected: 0.958 },
  { rooms: 8, singleShot: 0.3, attempts: 9, projected: 0.96 },
  { rooms: 9, singleShot: 0.15, attempts: 19, projected: 0.954 },
  { rooms: 10, singleShot: 0.1, attempts: 24, projected: 0.92 },
  { rooms: 11, singleShot: 0.1, attempts: 24, projected: 0.92 },
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: measured probe output (1-(1-0.05)^23), coincidentally close to Math.LN2 — not a math-constant reference.
  { rooms: 12, singleShot: 0.05, attempts: 23, projected: 0.693 },
];
