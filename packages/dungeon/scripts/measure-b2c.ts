// packages/dungeon/scripts/measure-b2c.ts
// Placement-rate measurement harness (B2c Task 7 — MEASUREMENT GATE A, pre-dogleg).
// Run: bun packages/dungeon/scripts/measure-b2c.ts [N]
// Reports per-config rates + failure histograms + wall time. The Warframe pattern:
// thousands of automated layouts, designers (us) tune kit/search until failures vanish.
// This run has NO acceptance bar — Task 9 (post-dogleg) is where the bar applies.
import { layoutWorld } from "../src/layout.ts";
import { GENERATOR_VERSION, type RegionData } from "../src/region.ts";
import { boxRoom } from "../src/themes/box-room.ts";
import {
  DEFAULT_TOPOLOGY,
  generateWorldGraph,
  type TopologyConfig,
} from "../src/topology.ts";
import type { WorldNode } from "../src/world-graph.ts";

const N = Number(process.argv[2] ?? 40);

// INTERIM: replaced by world.ts gatehouse in Task 9 (this script then imports it).
// A minimal pinned box room presenting one door-class portal at index 0 — the anchor
// generateWorldGraph grows the whole topology from. `_seed` is unused in this interim
// helper (a plain boxRoom carries no RNG-driven variation); the param stays so Task 9's
// real gatehouse can drop in with the same call shape.
function gatehouse(_seed: string): WorldNode {
  const built = boxRoom(
    {
      width: 7,
      depth: 7,
      height: 3.2,
      wallThick: 0.3,
      floorThick: 0.3,
      doors: [{ side: "S", offset: 0, width: 2, height: 2.8 }],
    },
    [],
  );
  const region: RegionData = {
    meshes: built.meshes,
    colliders: built.colliders,
    materials: [
      { color: [0.6, 0.6, 0.62, 1], specular: [0.05, 0.05, 0.05, 8] },
    ],
    connections: built.connections,
    instances: [],
    origin: [0, 0, 0],
    bounds: built.bounds,
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      theme: "authored",
      seed: "gatehouse",
    },
  };
  return {
    id: "gatehouse",
    region,
    pinned: { yaw: 0, translation: [0, 0, 0] },
  };
}

const CONFIGS: [string, Partial<TopologyConfig>][] = [
  ["default", {}],
  ["stress-40rooms", { targetRooms: 40 }],
  ["stress-loopy", { loopChance: 0.6 }],
  ["stress-5sectors", { sectors: [5, 5] }],
];

for (const [name, cfg] of CONFIGS) {
  let ok = 0;
  const fails: string[] = [];
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const seed = `b2c-${name}-${i}`;
    try {
      layoutWorld(
        generateWorldGraph(gatehouse(seed), seed, {
          ...DEFAULT_TOPOLOGY,
          ...cfg,
        }),
        seed,
      );
      ok++;
    } catch (err) {
      fails.push(
        `${seed}: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`,
      );
    }
  }
  console.log(
    `${name}: ${ok}/${N} (${((100 * ok) / N).toFixed(1)}%) in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
  );
  for (const f of fails.slice(0, 6)) console.log(`  ${f}`);
}
