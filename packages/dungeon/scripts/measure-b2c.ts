// packages/dungeon/scripts/measure-b2c.ts
// Placement-rate measurement harness (B2c Task 7 — MEASUREMENT GATE A, pre-dogleg).
// Three modes:
//   bun packages/dungeon/scripts/measure-b2c.ts [N]        — per-config rate sweep (N seeds)
//   bun packages/dungeon/scripts/measure-b2c.ts --frontier  — the per-sector capacity frontier
//   bun packages/dungeon/scripts/measure-b2c.ts --retry     — the P1 retry-backed effective-rate probe
// Reports per-config rates + failure histograms + wall time. The Warframe pattern:
// thousands of automated layouts, designers (us) tune kit/search until failures vanish.
// The --frontier mode (Task 9A) measures the largest per-sector room count that places at
// ≥90%, feeding SECTOR_ROOM_CAP — the clamp the hierarchical placer's inner solve relies on.
import type { ShapeDescriptor } from "@furnace/core/physics";
import { aabbOfBoxes } from "../src/aabb.ts";
import { layoutWorld } from "../src/layout.ts";
import {
  GENERATOR_VERSION,
  type RegionCollider,
  type RegionData,
  type RegionMesh,
  type Vec3,
} from "../src/region.ts";
import { boxRoom } from "../src/themes/box-room.ts";
import {
  DEFAULT_TOPOLOGY,
  generateWorldGraph,
  type TopologyConfig,
} from "../src/topology.ts";
import { buildWorld } from "../src/world.ts";
import type { WorldNode } from "../src/world-graph.ts";

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

// A thin (~0.4 m deep) masonry doorway frame presenting ONE door-class portal at
// connections[0] — jambs + lintel + sill around a 2.0 × 2.8 opening, portal seated at
// mid-depth (the "portal sits at the centre of its wall's thickness" convention). This
// PROTOTYPES Task 9C's real per-sector gateFrame: a room attaches to it exactly as it
// will attach to a sector gateway, so the --frontier rate measures true per-sector demand.
// `_seed` is unused — the frame geometry is fixed (representative, not RNG-varied).
function gateFrameAnchor(_seed: string): WorldNode {
  const OPENING_W = 2.0;
  const OPENING_H = 2.8;
  const JAMB = 0.4; // jamb thickness (X) and lintel/sill thickness (Y)
  const DEPTH = 0.4; // frame depth (Z)
  const frameTop = OPENING_H + JAMB; // 3.2
  const jambX = OPENING_W / 2 + JAMB / 2; // jamb centre X
  const outerW = OPENING_W + 2 * JAMB; // full frame width

  const boxes: { center: Vec3; size: Vec3 }[] = [
    { center: [-jambX, frameTop / 2, 0], size: [JAMB, frameTop, DEPTH] }, // left jamb
    { center: [jambX, frameTop / 2, 0], size: [JAMB, frameTop, DEPTH] }, // right jamb
    {
      center: [0, OPENING_H + JAMB / 2, 0],
      size: [OPENING_W, JAMB, DEPTH],
    }, // lintel
    { center: [0, -JAMB / 2, 0], size: [outerW, JAMB, DEPTH] }, // sill
  ];

  const meshes: RegionMesh[] = boxes.map((b) => ({
    geometry: { box: b.size },
    material: 0,
    position: b.center,
  }));
  const colliders: RegionCollider[] = boxes.map((b) => ({
    shape: {
      cuboid: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2],
    } as ShapeDescriptor,
    position: b.center,
  }));

  const region: RegionData = {
    meshes,
    colliders,
    materials: [
      { color: [0.6, 0.6, 0.62, 1], specular: [0.05, 0.05, 0.05, 8] },
    ],
    connections: [
      {
        position: [0, 0, 0],
        facing: [0, 0, 1],
        width: OPENING_W,
        height: OPENING_H,
        kind: "door",
      },
    ],
    instances: [],
    origin: [0, 0, 0],
    bounds: aabbOfBoxes(boxes),
    provenance: {
      generatorId: "dungeon",
      generatorVersion: GENERATOR_VERSION,
      theme: "authored",
      seed: "gateframe",
    },
  };
  return {
    id: "gateframe",
    region,
    pinned: { yaw: 0, translation: [0, 0, 0] },
  };
}

// Bracketed downward to R=2 (MIN_ROOMS_PER_SECTOR) because the per-sector frontier fell
// below the original {4,6,8,10,12} floor (see the 2026-07-05 measurement in the commit /
// task report): even R=2 (cave + 1 room) places at only ~67-92% single-shot.
const FRONTIER_ROOMS = [2, 3, 4, 6, 8, 10, 12];
const FRONTIER_LOOPS = [0, 0.35];
const FRONTIER_SEEDS = 12;

/** Measure one frontier cell: FRONTIER_SEEDS single-sector seeds at (rooms, loop), each a
 *  single-shot `generateWorldGraph` → `layoutWorld` (no buildWorld retry). Returns the
 *  success count and up to 3 example failures. */
function measureCell(
  rooms: number,
  loop: number,
): { ok: number; failMsgs: string[] } {
  let ok = 0;
  const failMsgs: string[] = [];
  for (let i = 0; i < FRONTIER_SEEDS; i++) {
    const seed = `frontier-${rooms}-${loop}-${i}`;
    const cfg: TopologyConfig = {
      ...DEFAULT_TOPOLOGY,
      sectors: [1, 1],
      targetRooms: rooms,
      loopChance: loop,
    };
    try {
      layoutWorld(generateWorldGraph(gateFrameAnchor(seed), seed, cfg), seed);
      ok++;
    } catch (err) {
      if (failMsgs.length < 3) {
        failMsgs.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
  return { ok, failMsgs };
}

/** Sweep single-sector configs (no macro ring — cycles come only from intra-sector loops)
 *  over targetRooms × loopChance, measuring the per-sector placement frontier that feeds
 *  SECTOR_ROOM_CAP. Prints a machine-parseable `CELL …` line per cell (so the sweep can be
 *  split across parallel processes) plus up to 3 example failures; run unfiltered it also
 *  renders the readable rate grid. `roomFilter`/`loopFilter` restrict to a single cell. */
function runFrontier(roomFilter?: number, loopFilter?: number): void {
  const rooms = roomFilter !== undefined ? [roomFilter] : FRONTIER_ROOMS;
  const loops = loopFilter !== undefined ? [loopFilter] : FRONTIER_LOOPS;
  const results = new Map<string, number>(); // `${R}|${L}` → ok count
  const t0 = performance.now();
  for (const R of rooms) {
    for (const L of loops) {
      const { ok, failMsgs } = measureCell(R, L);
      results.set(`${R}|${L}`, ok);
      const pct = ((100 * ok) / FRONTIER_SEEDS).toFixed(1);
      console.log(
        `CELL rooms=${R} loop=${L} ok=${ok} n=${FRONTIER_SEEDS} pct=${pct}`,
      );
      for (const m of failMsgs) {
        console.log(`  FAIL rooms=${R} loop=${L}: ${m.slice(0, 200)}`);
      }
    }
  }
  console.log(`Wall time: ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  if (roomFilter === undefined && loopFilter === undefined) {
    console.log(
      `\nFrontier grid — single-sector, ${FRONTIER_SEEDS} seeds/cell (rows = targetRooms, cols = loopChance)\n`,
    );
    const header = `  rooms │ ${FRONTIER_LOOPS.map((l) => `loop=${l.toFixed(2)}`).join(" │ ")}`;
    console.log(header);
    console.log(`  ${"─".repeat(header.length - 2)}`);
    for (const R of FRONTIER_ROOMS) {
      const cells = FRONTIER_LOOPS.map((L) => {
        const ok = results.get(`${R}|${L}`) ?? 0;
        const pct = ((100 * ok) / FRONTIER_SEEDS).toFixed(1);
        return `${pct.padStart(5)}% (${ok}/${FRONTIER_SEEDS})`;
      });
      console.log(`  ${String(R).padStart(5)} │ ${cells.join(" │ ")}`);
    }
  }
}

const CONFIGS: [string, Partial<TopologyConfig>][] = [
  ["default", {}],
  ["stress-40rooms", { targetRooms: 40 }],
  ["stress-loopy", { loopChance: 0.6 }],
  ["stress-5sectors", { sectors: [5, 5] }],
];

/** Per-config rate sweep over N seeds (the original Gate-A harness). */
function runConfigs(n: number): void {
  for (const [name, cfg] of CONFIGS) {
    let ok = 0;
    const fails: string[] = [];
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
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
      `${name}: ${ok}/${n} (${((100 * ok) / n).toFixed(1)}%) in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
    );
    for (const f of fails.slice(0, 6)) console.log(`  ${f}`);
  }
}

const RETRY_ROOMS = [6, 8, 12];
const RETRY_SEEDS = 20;

/** P1 probe (Epic 3 spec §4): retry-backed effective success + wall-clock at cockpit
 *  configs. REPORTS numbers; the stop condition (p95 > 5 s or rate < 80% @6 rooms)
 *  is judged by the orchestrator, not this script. */
function runRetry(): void {
  for (const rooms of RETRY_ROOMS) {
    let ok = 0;
    const times: number[] = [];
    for (let i = 0; i < RETRY_SEEDS; i++) {
      const t0 = performance.now();
      try {
        buildWorld(`p1-${rooms}-${i}`, {
          sectors: [1, 1],
          targetRooms: rooms,
          attempts: 3,
        });
        ok++;
      } catch {
        // counted as a miss; time still recorded (cost of failure matters)
      }
      times.push(performance.now() - t0);
    }
    const sorted = [...times].sort((a, b) => a - b);
    const p = (q: number) =>
      sorted[
        Math.min(sorted.length - 1, Math.floor(q * sorted.length))
      ]?.toFixed(0);
    console.log(
      `RETRY rooms=${rooms} ok=${ok}/${RETRY_SEEDS} (${((100 * ok) / RETRY_SEEDS).toFixed(0)}%) p50=${p(0.5)}ms p95=${p(0.95)}ms`,
    );
  }
}

if (process.argv[2] === "--frontier") {
  // Optional single-cell restriction for parallel collection: --frontier <rooms> <loop>.
  const roomFilter =
    process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
  const loopFilter =
    process.argv[4] !== undefined ? Number(process.argv[4]) : undefined;
  runFrontier(roomFilter, loopFilter);
} else if (process.argv[2] === "--retry") {
  runRetry();
} else {
  runConfigs(Number(process.argv[2] ?? 40));
}
