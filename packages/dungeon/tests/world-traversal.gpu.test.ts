// W2 Task 14 — THE GATE-WORLD PROBE. `DEFAULT_WORLD` is now the world the PLAYER walks, so this
// is the end-to-end acceptance walk over the committed default: the full collider set, built
// exactly as the game builds it (`loadWorld` against an IN-MEMORY bake, NOT a hand-picked subset
// — the 2.2.1 lesson: subset repros hide the seam wedge). WALK-IN, not drop-in: dropping a capsule
// rests it on top and hides a wedge, so every lane drives the real `CharacterMover`. The shared
// drive loop + world-loading fixture live in `_helpers/walk-fixture.ts`; the lanes below are
// gate-world-specific.
//
// What the gate world composes (both region classes, both built connector kinds):
//   hall-a (grid-built pillarHall, the spawn) --corridor-1 (stairs, +1.5 m)--> hall-b (boxRoom)
//   hall-a --bore-1 (collar-bore)--> cave-c (field-organic)
// The per-seam probes already proved each join in isolation (Task 11 collar+bore, Task 12 stairs);
// this file proves they still hold COMPOSED, on the artifact the game actually boots.
//
// Geometry (measured from the baked manifest): `corridor-1`.a = hall-a's north door [3,0,9] facing
// [0,0,1]; .b = hall-b's south door [3,1.5,15]. `bore-1`.a = hall-a's east door [6,0,4.5] facing
// [1,0,0]; .b = cave-c's mouth [14,0,4.5]. The baked spawn [3,1.1,7] sits 2 m inward of the NORTH
// door — i.e. on the CORRIDOR axis — so the corridor lanes start from it, while the bore lanes
// build their own start 2 m inward of the EAST door (on the bore axis).
//
// Lanes break EARLY inside a target HALL rather than driving to its far wall: hall-b is a boxRoom,
// only ~4 m of interior past its door plane, and these are forward lanes — walking into the far
// wall would read as a wedge and false-trip runWalk's no-stall guard. Breaking inside keeps that
// guard ARMED across the whole seam, which is this probe's primary wedge detector.
//
// All four lanes are ON-AXIS by design. Off-centre lanes into the organic cave interior trip the
// ghost-launch guard on a known cave-floor undulation — the tracked voxel-KCC-on-organic-terrain
// class, NOT a seam defect (see docs/backlog/dungeon/organic-cave-mouth-offaxis-rimride.md; the
// off-axis carve/bore seam itself is covered on-axis-adjacent by collar-bore.gpu.test.ts). Each
// lane runs in its OWN freshly-loaded world: the cave + hall dressing is shovable, so a shared
// world would let one lane displace obstacles for the next and mask that lane's real path.
import { expect, test } from "bun:test";
import type { WorldManifest } from "../src/bake.ts";
import type { Connection, Vec3 } from "../src/region.ts";
import { DEFAULT_WORLD } from "../src/world-spec.ts";
import { bunWebGpuAvailable, ensureBunWebGpu } from "./_helpers/gpu-fixture.ts";
import {
  along,
  REST_OFFSET,
  runWalk,
  SPAWN_RISE,
  WALL_HUG_ITERS,
  withLoadedWorld,
} from "./_helpers/walk-fixture.ts";

await ensureBunWebGpu();

/** How far past a target's door/mouth plane (m) a lane must advance to count as having ENTERED it. */
const ENTERED = 2;
/** Where a hall-bound lane breaks early — inside the hall, short of its far wall (see header). */
const BREAK_INSIDE_HALL = 2.5;
/** How far into the cave a bore lane drives past the mouth (the cave is deep; no far-wall risk). */
const BREAK_INSIDE_CAVE = 4;
/** Tolerance (m) around the nominal rest height (`floor + REST_OFFSET`) when asserting WHICH floor
 *  the capsule ended on. The two halls' floors are 1.5 m apart, so a tolerance under 0.75 m keeps
 *  the "stood high" and "stood low" bars disjoint: a capsule that never climbed cannot satisfy the
 *  high bar, and one still up top cannot satisfy the low bar. */
const REST_TOL = 0.4;
/** How far inward of a door a lane that cannot use the baked spawn starts (m) — inside the door's
 *  dressing-free walk lane (`DOOR_LANE_DEPTH` 3.0 m), so the start is never inside a crate. */
const INWARD_START = 2;

/** One named connector's two placed portals + its axis, from the baked manifest. `a` is the
 *  hall-side portal (facing OUTWARD toward the far end), `b` the far portal; `dir = a.facing` is
 *  the cardinal axis pointing a → b. Mirrors `stair-corridor.gpu.test.ts` / `collar-bore.gpu.test.ts`,
 *  but looks the connector up BY ID — the gate world has two, so index 0 is not a contract. */
function portalsOf(
  manifest: WorldManifest,
  id: string,
): { a: Connection; b: Connection; dir: Vec3 } {
  const c = manifest.connectors.find((k) => k.id === id);
  if (!c) throw new Error(`world-traversal: manifest has no connector ${id}`);
  return { a: c.a, b: c.b, dir: [c.a.facing[0], c.a.facing[1], c.a.facing[2]] };
}

/** A start `INWARD_START` m inside the region a portal belongs to, at rest height: step BACK along
 *  the portal's OUTWARD facing (hence `-dir`). Used by lanes the baked spawn does not serve. */
function startInwardOf(portal: Connection, dir: Vec3): Vec3 {
  return [
    portal.position[0] - dir[0] * INWARD_START,
    portal.position[1] + REST_OFFSET + SPAWN_RISE,
    portal.position[2] - dir[2] * INWARD_START,
  ];
}

/** A start `INWARD_START` m PAST a portal (into the region on its far side), at rest height. */
function startBeyond(portal: Connection, dir: Vec3): Vec3 {
  return [
    portal.position[0] + dir[0] * INWARD_START,
    portal.position[1] + REST_OFFSET + SPAWN_RISE,
    portal.position[2] + dir[2] * INWARD_START,
  ];
}

const reverse = (dir: Vec3): Vec3 => [-dir[0], -dir[1], -dir[2]];

// Lane (a): the GAME's opening walk — from the baked spawn, UP the stair corridor, into hall-b.
test.skipIf(!bunWebGpuAvailable())(
  "gate world: spawn -> UP the stair corridor -> hall-b (no wedge/launch/fall-through, climbs)",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest, loaded }) => {
      const { a, b, dir } = portalsOf(manifest, "corridor-1");
      const bAlong = along(b.position, dir);
      const res = runWalk(ctx, world, {
        start: loaded.playerStart, // the baked game spawn (2 m inside hall-a, on the corridor axis)
        dir,
        stopAlong: bAlong + BREAK_INSIDE_HALL,
        floorY: a.position[1] - 1,
        ceilY: a.position[1] + 5, // generous: the climb tops out ~2.4 m (high floor + rest)
        maxIters: WALL_HUG_ITERS, // step-ups cost horizontal progress; give the flight room
      });
      // ENTERED hall-b: advanced past its door plane along the axis.
      expect(res.advanced).toBeGreaterThan(bAlong + ENTERED);
      // CLIMBED: ended resting on the HIGH floor (~1.5 m above where it started).
      expect(res.pos[1]).toBeGreaterThan(
        b.position[1] + REST_OFFSET - REST_TOL,
      );
    });
  },
);

// Lane (b): reverse — hall-b, DOWN the stair corridor, back into hall-a.
test.skipIf(!bunWebGpuAvailable())(
  "gate world: hall-b -> DOWN the stair corridor -> hall-a (no wedge/launch/fall-through, descends)",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { a, b, dir } = portalsOf(manifest, "corridor-1");
      const revDir = reverse(dir);
      const aAlongRev = along(a.position, revDir); // hall-a's door plane along the reverse axis
      const res = runWalk(ctx, world, {
        start: startBeyond(b, dir), // 2 m inside hall-b, on the HIGH floor
        dir: revDir,
        stopAlong: aAlongRev + BREAK_INSIDE_HALL,
        floorY: a.position[1] - 1, // the LOW hall's floor is the descent's floor
        ceilY: b.position[1] + 4, // above the HIGH spawn
        maxIters: WALL_HUG_ITERS,
      });
      // ENTERED hall-a: advanced past its door plane along the reverse axis.
      expect(res.advanced).toBeGreaterThan(aAlongRev + ENTERED);
      // DESCENDED: ended resting on the LOW floor (~1.5 m below where it started).
      expect(res.pos[1]).toBeLessThan(a.position[1] + REST_OFFSET + REST_TOL);
    });
  },
);

// Lane (c): hall-a, through the CARVED east opening + the collar-bore, into cave-c. The baked spawn
// sits on the corridor axis, so this lane starts on the BORE axis instead (2 m inward of the east
// door, inside its dressing-free walk lane).
test.skipIf(!bunWebGpuAvailable())(
  "gate world: hall-a -> collar-bore -> cave-c (no wedge/launch/fall-through, enters the cave)",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { a, b, dir } = portalsOf(manifest, "bore-1");
      const bAlong = along(b.position, dir);
      const res = runWalk(ctx, world, {
        start: startInwardOf(a, dir),
        dir,
        stopAlong: bAlong + BREAK_INSIDE_CAVE, // past the mouth into the cave interior
        floorY: a.position[1] - 1,
        ceilY: a.position[1] + 4,
        maxIters: WALL_HUG_ITERS, // the bore/cave path grinds through cave dressing
      });
      // ENTERED cave-c: advanced past its mouth along the bore axis.
      expect(res.advanced).toBeGreaterThan(bAlong + ENTERED);
    });
  },
);

// Lane (d): reverse — cave-c, back through the bore + carved opening, into hall-a.
test.skipIf(!bunWebGpuAvailable())(
  "gate world: cave-c -> collar-bore -> hall-a (no wedge/launch/fall-through, enters the hall)",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { a, b, dir } = portalsOf(manifest, "bore-1");
      const revDir = reverse(dir);
      const aAlongRev = along(a.position, revDir); // the hall-door plane along the reverse axis
      const res = runWalk(ctx, world, {
        start: startBeyond(b, dir), // 2 m inside cave-c, past its mouth
        dir: revDir,
        stopAlong: aAlongRev + BREAK_INSIDE_HALL, // into hall-a's dressing-free door lane
        floorY: b.position[1] - 1,
        ceilY: b.position[1] + 4,
        maxIters: WALL_HUG_ITERS,
      });
      // ENTERED hall-a: advanced past the hall-door plane along the reverse axis.
      expect(res.advanced).toBeGreaterThan(aAlongRev + ENTERED);
    });
  },
);
