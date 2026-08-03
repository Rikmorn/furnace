// W2 Task 10 — PROBE 1: hall INTERIOR traversal. One grid-built `pillarHall` (colonnade)
// with a south door that NO connector consumes — so the shell stays SEALED (the door is
// metadata until a connector opens its cells; D-W2-9). Baked in memory, loaded exactly as the
// game loads it (worlds index → manifest → merged doc + re-expanded voxel proxy), then the
// real CharacterMover walks four interior lanes. It converts "the hall's fine-grid voxel proxy
// collides where it renders" into a hard headless assert:
//   1. centre-aisle  — clean walk down the pillar aisle (open floor, no fine-proxy shell bug);
//   2. cross-aisle   — clean walk between two pillar rows (no wedge in the gap);
//   3. into-a-pillar — hard STOP short of a pillar (the pillar collides, no pass-through);
//   4. into-the-wall — hard STOP at the sealed south shell (the portal is metadata, not a hole).
// Geometry (placed at [0,0,0] yaw 0 → local == world; grid min [0,-0.5,0], CELL 0.5): interior
// i∈[1,10] x∈[0.5,5.5], j∈[1,7] floor-top y=0, k∈[1,16] z∈[0.5,8.5]. Colonnade pillar columns
// at grid i=4 / i=8 (world-x 2.25 / 4.25), along z at k∈{3,6,9,12,15} (world-z 1.75/3.25/4.75/
// 6.25/7.75). Central aisle (cells 5,6,7) is clear at x≈3.0. South door offset 3 → cells i∈[4,7],
// centre x=3.0 on the z=0 outer plane. Spawn (portal 0) ≈ [3.0, 1.1, 2.0].
import { expect, test } from "bun:test";
import { HALL_PRESETS } from "../src/themes/hall.ts";
import type { Vec3 } from "../src/world/region.ts";
import type { WorldSpec } from "../src/world/world-spec.ts";
import { bunWebGpuAvailable, ensureBunWebGpu } from "./_helpers/gpu-fixture.ts";
import {
  along,
  REST_OFFSET,
  runWalk,
  SPAWN_RISE,
  withLoadedWorld,
} from "./_helpers/walk-fixture.ts";

await ensureBunWebGpu();

const HALL_WORLD: WorldSpec = {
  name: "hall-probe",
  regions: [
    {
      id: "hall",
      class: "grid-built",
      algorithm: "hall",
      params: {
        ...HALL_PRESETS.pillarHall,
        doors: [{ wall: "south", offset: 3 }],
      },
      seed: "probe:hall",
      placement: { translation: [0, 0, 0], yaw: 0 },
    },
  ],
  connectors: [],
  startRegion: "hall",
};

const FLOOR_TOP = 0; // interior floor top (coarse j=0 shell spans y∈[-0.5, 0])
const REST_Y = FLOOR_TOP + REST_OFFSET; // grounded capsule-centre height (0.9 m)
const SPAWN_Y = REST_Y + SPAWN_RISE; // start a touch above rest so frame 1 settles, not teleports

const FAR_WALL_STOP = 7.0; // ~1 m short of the far (+Z) interior wall face (z=8.5)
const PILLAR: Vec3 = [2.25, REST_Y, 3.25]; // one colonnade pillar centre (grid i=4, k=6)
const SEALED_SOUTH_FACE_Z = 0.5; // solid south shell inner face (coarse k=0 spans z∈[0, 0.5])
const STOP_FRAMES = 150; // ~2.5 s driving into an obstacle — settles, then proves no creep-through
const MIN_STOP_CLEARANCE = 0.2; // must halt at least this far short of a solid centre (m)
const MIN_APPROACH = 0.2; // a stop lane must first TRAVERSE at least this far toward the obstacle
//                          (else a spawn-wedge would satisfy the "didn't pass through" assert)

// Floor/ceiling envelope shared by every lane: interior floor top y=0, ceiling top y=3.5.
const FLOOR_Y = -1;
const CEIL_Y = 4;

// Lane 1 — centre aisle: from the spawn, walk +Z down the clear aisle to the far wall.
test.skipIf(!bunWebGpuAvailable())(
  "centre-aisle lane: clean walk +Z down the pillar aisle, advances the hall length",
  async () => {
    await withLoadedWorld(HALL_WORLD, ({ ctx, world, loaded }) => {
      const res = runWalk(ctx, world, {
        start: loaded.playerStart, // [3.0, ~1.1, 2.0] — 2 m inward of the south door, on the aisle
        dir: [0, 0, 1],
        stopAlong: FAR_WALL_STOP,
        floorY: FLOOR_Y,
        ceilY: CEIL_Y,
      });
      // Walked most of the aisle length (past z≈6) with no wedge/launch/fall-through.
      expect(res.advanced).toBeGreaterThan(6);
    });
  },
);

// Lane 2 — cross aisle: at a pillar-free z (between the z=3.25 and z=4.75 pillars), walk +X
// across the aisle through the i=4 pillar column's gap.
test.skipIf(!bunWebGpuAvailable())(
  "cross-aisle lane: clean walk +X between the pillar rows, no wedge",
  async () => {
    await withLoadedWorld(HALL_WORLD, ({ ctx, world }) => {
      const res = runWalk(ctx, world, {
        start: [1.5, SPAWN_Y, 4.0], // west side, clear of any pillar at z=4.0
        dir: [1, 0, 0],
        stopAlong: 4.0, // ~x=4.0, having crossed the i=4 column at a pillar-free z
        floorY: FLOOR_Y,
        ceilY: CEIL_Y,
      });
      expect(res.advanced).toBeGreaterThan(3.5); // crossed the aisle cleanly
    });
  },
);

// Lane 3 — into a pillar: from ~1 m short on the pillar's z-line, walk +X straight into it.
// The pillar must collide (a hard stop short of its centre), not let the capsule pass through.
test.skipIf(!bunWebGpuAvailable())(
  "into-a-pillar lane: mover stops short of the pillar centre, no pass-through",
  async () => {
    await withLoadedWorld(HALL_WORLD, ({ ctx, world }) => {
      const dir: Vec3 = [1, 0, 0]; // approach from the -X side, on the pillar's z-line
      const spawnAlong = PILLAR[0] - 1.0; // 1 m short of the pillar along +X
      const res = runWalk(ctx, world, {
        start: [spawnAlong, SPAWN_Y, PILLAR[2]],
        dir,
        floorY: FLOOR_Y,
        ceilY: CEIL_Y,
        maxIters: STOP_FRAMES,
        expectStop: true,
      });
      // Actually walked toward the pillar (not wedged at spawn)…
      expect(res.advanced).toBeGreaterThan(spawnAlong + MIN_APPROACH);
      // …then halted short of the pillar centre (a pass-through would overshoot it).
      expect(along(PILLAR, dir) - res.advanced).toBeGreaterThan(
        MIN_STOP_CLEARANCE,
      );
    });
  },
);

// Lane 4 — into the sealed door wall: from the spawn (inside the door footprint), walk -Z at
// the sealed south shell. The portal is metadata; the shell stays SOLID (D-W2-9's teeth) — the
// mover must stop before the shell inner face, never passing through to z<0.
test.skipIf(!bunWebGpuAvailable())(
  "into-the-sealed-door-wall lane: mover stops at the solid south shell, no pass-through",
  async () => {
    await withLoadedWorld(HALL_WORLD, ({ ctx, world, loaded }) => {
      const spawnZ = loaded.playerStart[2]; // ≈ 2.0, inside the sealed door's footprint
      const res = runWalk(ctx, world, {
        start: loaded.playerStart, // [3.0, ~1.1, 2.0] — squarely in the sealed door's footprint
        dir: [0, 0, -1],
        floorY: FLOOR_Y,
        ceilY: CEIL_Y,
        maxIters: STOP_FRAMES,
        expectStop: true,
      });
      // Actually advanced toward the wall (walked −Z, not wedged at spawn)…
      expect(res.pos[2]).toBeLessThan(spawnZ - MIN_APPROACH);
      // …but never entered the shell (z stays clear of the 0.5 m inner face, let alone z<0).
      expect(res.pos[2]).toBeGreaterThan(SEALED_SOUTH_FACE_Z);
    });
  },
);
