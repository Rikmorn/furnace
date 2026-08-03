// W2 Task 12 — the STAIR-CORRIDOR probe. Walk the player capsule from a low grid-built hall,
// UP a stair corridor, into a high hall — and back DOWN — on the FULL default collider set
// exactly as the game builds it (`loadWorld` against an IN-MEMORY bake, NOT a subset — the
// 2.2.1 lesson: subset repros hide the seam wedge). WALK-IN, not drop-in: dropping a capsule
// rests it on top and hides a riser wedge, so this drives the real CharacterMover up and down
// the treads.
//
// THE PREMISE (2.2.1: "0.25 voxel steps + 0.4 step-up proven"): the corridor's stairs are a
// FINE-grid solid fill rising STAIR_RISE (= FINE = 0.25 m) per CELL (0.5 m) of run, capped by
// tread render boxes. Walkability's STEP_HEIGHT is 0.4 m, so each riser sits BELOW the step-up
// limit and the flight should walk. TWO_HALLS' corridor is `length: 6, deltaY: 1.5` → 6 risers
// over a 12-cell run: run cells 1..6 lift 0.25 m each (z 5.5 → 8.5), then a flush 2.5 m landing
// to hall-b's door. Climbing 1.5 m in ~0.25 m increments keeps every frame's rise well under
// runWalk's MAX_FRAME_RISE (0.55) ghost-launch bar, so a clean stair walk cannot trip it.
//
// Geometry (measured from the baked TWO_HALLS manifest): connector[0] = `corr-1` (corridor).
// Its `a` is hall-a's placed north door (position [2.5, 0, 5], facing [0,0,1] OUTWARD toward
// hall-b); its `b` is hall-b's placed south door ([2.5, 1.5, 11]) — 6 m out and 1.5 m UP.
// `dir = a.facing` points hall-a → hall-b, so `along` IS the world z. The baked spawn is
// [2.5, 1.1, 3] (2 m inward of hall-a's north door), and walking +dir climbs.
//
// Lanes break EARLY inside the target hall rather than driving to its far wall: a boxRoom's
// interior is only 4 m deep past the door plane (the capsule reaches ~4.2 m in), and these are
// forward lanes, so walking into the far wall would read as a wedge and trip runWalk's no-stall
// guard. Breaking inside the hall keeps that guard ARMED across the whole climb — it is this
// probe's primary wedge detector. Each lane runs in its OWN freshly-loaded world.
import { expect, test } from "bun:test";
import type { WorldManifest } from "../src/world/bake.ts";
import type { Connection, Vec3 } from "../src/world/region.ts";
import type { WorldSpec } from "../src/world/world-spec.ts";
import { bunWebGpuAvailable, ensureBunWebGpu } from "./_helpers/gpu-fixture.ts";
import {
  along,
  REST_OFFSET,
  runWalk,
  SPAWN_RISE,
  WALL_HUG_ITERS,
  withLoadedWorld,
} from "./_helpers/walk-fixture.ts";
import { TWO_HALLS } from "./_helpers/world-fixtures.ts";

await ensureBunWebGpu();

/** How far past a hall's door plane (m) a lane must advance to count as having ENTERED it. */
const ENTERED_HALL = 2;
/** Where a lane breaks early — inside the target hall, safely short of its far wall (see header). */
const BREAK_INSIDE_HALL = 2.5;
/** Tolerance (m) around the nominal rest height (`floor + REST_OFFSET`) when asserting WHICH
 *  floor the capsule ended on. The two halls' floors are `deltaY` (1.5 m) apart, so a tolerance
 *  under 0.75 m keeps the "stood high" and "stood low" bars disjoint: a capsule that never
 *  climbed cannot satisfy the high bar, and one still up top cannot satisfy the low bar. */
const REST_TOL = 0.4;

/** The corridor's two placed portals + its axis, from the baked manifest. `a` is hall-a's north
 *  door (facing OUTWARD toward hall-b), `b` is hall-b's south door (1.5 m higher); `dir = a.facing`
 *  is the cardinal corridor axis pointing LOW hall → HIGH hall. Mirrors `world-traversal.gpu.test.ts`'s
 *  `tunnelPortals` — the corridor rides connector[0] exactly as the organic tunnel does. */
function corridorPortals(manifest: WorldManifest): {
  a: Connection;
  b: Connection;
  dir: Vec3;
} {
  const c = manifest.connectors[0];
  if (!c) throw new Error("stair-corridor: manifest has no connector");
  return { a: c.a, b: c.b, dir: [c.a.facing[0], c.a.facing[1], c.a.facing[2]] };
}

/** TWO_HALLS with a FLAT corridor (ΔY 0 → zero risers, no stair fill, no treads) — the CONTROL:
 *  it isolates the stairs as the variable, so a failure here would indict the corridor tube /
 *  door seams rather than the risers. Hall-b's derived placement follows ΔY, so it lands level. */
const FLAT_TWO_HALLS: WorldSpec = {
  ...TWO_HALLS,
  name: "two-halls-flat",
  connectors: TWO_HALLS.connectors.map((c) => ({
    ...c,
    params: { ...c.params, deltaY: 0 },
  })),
};

// Lane 1 (THE PREMISE): low hall → UP the stairs → high hall, from the baked game spawn.
test.skipIf(!bunWebGpuAvailable())(
  "hall-a -> UP the stair corridor -> hall-b: no wedge/launch/fall-through, climbs into the high hall",
  async () => {
    await withLoadedWorld(TWO_HALLS, ({ ctx, world, manifest, loaded }) => {
      const { a, b, dir } = corridorPortals(manifest);
      const bAlong = along(b.position, dir);
      const res = runWalk(ctx, world, {
        start: loaded.playerStart, // baked game spawn (2 m inside hall-a, on the door axis)
        dir,
        stopAlong: bAlong + BREAK_INSIDE_HALL,
        floorY: a.position[1] - 1,
        ceilY: a.position[1] + 5, // generous: the climb tops out ~2.4 m (high floor + rest)
        maxIters: WALL_HUG_ITERS, // step-ups cost horizontal progress; give the flight room
      });
      // ENTERED hall-b: advanced past its door plane along the axis.
      expect(res.advanced).toBeGreaterThan(bAlong + ENTERED_HALL);
      // CLIMBED: ended resting on the HIGH floor (~1.5 m above where it started).
      expect(res.pos[1]).toBeGreaterThan(
        b.position[1] + REST_OFFSET - REST_TOL,
      );
    });
  },
);

// Lane 2 (reverse): high hall → DOWN the stairs → low hall.
// NOTE — this lane has NO descent teeth: with the stair collision fill removed the capsule simply
// FALLS the 1.5 m and this lane still passes. The harness has an upward `MAX_FRAME_RISE` bar and a
// `minY` fall-through envelope, but no step-DOWN bar by design. So lane 2 proves only
// no-wedge / no-launch / no-fall-through on the reverse path; the CLIMB lane above is what proves
// the risers are actually walkable (verified: neutering `fillColumn` makes the climb lane wedge).
test.skipIf(!bunWebGpuAvailable())(
  "hall-b -> DOWN the stair corridor -> hall-a: no wedge/launch/fall-through, descends into the low hall",
  async () => {
    await withLoadedWorld(TWO_HALLS, ({ ctx, world, manifest }) => {
      const { a, b, dir } = corridorPortals(manifest);
      const revDir: Vec3 = [-dir[0], -dir[1], -dir[2]];
      // Spawn ~2 m inside hall-b (along +dir past its door), raised to rest height on the HIGH floor.
      const start: Vec3 = [
        b.position[0] + dir[0] * 2,
        b.position[1] + REST_OFFSET + SPAWN_RISE,
        b.position[2] + dir[2] * 2,
      ];
      const aAlongRev = along(a.position, revDir); // hall-a's door plane along the reverse axis
      const res = runWalk(ctx, world, {
        start,
        dir: revDir,
        stopAlong: aAlongRev + BREAK_INSIDE_HALL,
        floorY: a.position[1] - 1, // the LOW hall's floor is the descent's floor
        ceilY: b.position[1] + 4, // above the HIGH spawn
        maxIters: WALL_HUG_ITERS,
      });
      // ENTERED hall-a: advanced past its door plane along the reverse axis.
      expect(res.advanced).toBeGreaterThan(aAlongRev + ENTERED_HALL);
      // DESCENDED: ended resting on the LOW floor (~1.5 m below where it started).
      expect(res.pos[1]).toBeLessThan(a.position[1] + REST_OFFSET + REST_TOL);
    });
  },
);

// Lane 3 (CONTROL): the same walk through a FLAT corridor (ΔY 0). Isolates the risers as the
// variable — if lanes 1/2 wedge but this walks, the stairs are the cause, not the tube.
test.skipIf(!bunWebGpuAvailable())(
  "flat-corridor control (deltaY 0): hall-a -> corridor -> hall-b walks clean",
  async () => {
    await withLoadedWorld(
      FLAT_TWO_HALLS,
      ({ ctx, world, manifest, loaded }) => {
        const { a, b, dir } = corridorPortals(manifest);
        const bAlong = along(b.position, dir);
        const res = runWalk(ctx, world, {
          start: loaded.playerStart,
          dir,
          stopAlong: bAlong + BREAK_INSIDE_HALL,
          floorY: a.position[1] - 1,
          ceilY: a.position[1] + 5,
          maxIters: WALL_HUG_ITERS,
        });
        // ENTERED hall-b, and (flat) stayed on the SAME floor it started on.
        expect(res.advanced).toBeGreaterThan(bAlong + ENTERED_HALL);
        expect(res.pos[1]).toBeLessThan(a.position[1] + REST_OFFSET + REST_TOL);
      },
    );
  },
);
