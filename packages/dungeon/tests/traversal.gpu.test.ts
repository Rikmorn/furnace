// Traversal regression / fuzz harness. Builds the FULL main.ts collider world
// (every LEVEL_BOXES cuboid + the baked-cavern voxel proxy + the buildArea wing's
// cave/vestibule/room colliders) and WALKS a capsule across it from real start
// points, asserting the invariants the 2.2.1 gate rounds kept violating: never
// permanently wedged on walkable floor, and no fall-through outside the designed
// pits. The hard lesson baked in: the bug is WALK-IN only (dropping a capsule rests
// it on top and hides the wedge), so this drives the real CharacterMover along real
// paths — not place-and-probe. Re-pointed to the 2.2.2 buildArea world (the retired
// single-kind shaft/chamber regions are gone).
import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { CharacterMover } from "../src/char-move.ts";
import { buildArea } from "../src/compose.ts";
import { LEVEL_BOXES } from "../src/level.ts";
import { bakedCavernProxy } from "../src/themes/cave.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const CAP = { halfHeight: 0.6, radius: 0.3 };
const DT = 1 / 60;
const SPEED = 3; // m/s walk speed, matching the game
// The wing origin must match main.ts's AREA_ORIGIN — the cave floor (origin.y + cave
// FLOOR_Y(-2) = 0) is flush with the authored chamber floor, and the cave hub + its
// +Z tunnel mouth sit on the x=10 axis.
const AREA_ORIGIN: [number, number, number] = [10, 2, -0.5];
const MAX_STALL = 45; // ~0.75s of zero horizontal progress = a wedge
type V3 = [number, number, number];

/** The exact collider set main.ts builds: authored cuboids + the render-only cavern's
 *  regenerated voxel proxy + every collider buildArea("wing-1") emits (cave voxels +
 *  vestibule/room cuboids). No GPU meshes — this is a collision-only harness. Kept in
 *  sync with main.ts. */
async function buildFullWorld() {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, {
    gravity: [0, -9.81, 0],
    lengthUnit: 1,
  });
  for (const b of LEVEL_BOXES)
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2] },
      position: b.center,
    });
  const cav = bakedCavernProxy("cavern-1", [0, 0, -24]);
  physics.createBody(ctx, world, {
    type: "static",
    shape: cav.proxy,
    position: cav.proxyPosition,
  });
  for (const region of buildArea("wing-1", AREA_ORIGIN))
    for (const c of region.colliders)
      physics.createBody(ctx, world, {
        type: "static",
        shape: c.shape,
        position: c.position,
      });
  return { ctx, world };
}

function disposeWorld(ctx: gpu.Context, world: physics.World) {
  physics.destroyWorld(ctx, world);
  gpu.dispose(ctx);
}

function spawn(ctx: gpu.Context, world: physics.World, at: V3) {
  const body = physics.createBody(ctx, world, {
    type: "kinematicPosition",
    shape: { capsule: CAP },
    position: at,
  });
  physics.step(ctx, world, DT);
  return { body, mover: new CharacterMover(CAP, body) };
}

/** Walk the mover from `start` along unit `dir` for `frames` ticks, stepping the world
 *  each tick. Returns the path's end position, deepest Y reached, and the longest run of
 *  consecutive no-progress (stall) frames — a wedge shows as a long stall run mid-floor. */
function walkPath(
  ctx: gpu.Context,
  world: physics.World,
  body: physics.Body,
  mover: CharacterMover,
  start: V3,
  dir: V3,
  frames: number,
): { end: V3; minY: number; maxStall: number } {
  let pos: V3 = [start[0], start[1], start[2]];
  let minY = pos[1];
  let stall = 0;
  let maxStall = 0;
  const move: V3 = [dir[0] * SPEED * DT, 0, dir[2] * SPEED * DT];
  for (let i = 0; i < frames; i++) {
    const prev = pos;
    pos = mover.resolve(ctx, world, pos, move, DT).pos;
    physics.setBodyNextKinematicTranslation(ctx, body, pos);
    physics.step(ctx, world, DT);
    minY = Math.min(minY, pos[1]);
    const advanced = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]) > 0.005;
    stall = advanced ? 0 : stall + 1;
    maxStall = Math.max(maxStall, stall);
  }
  return { end: pos, minY, maxStall };
}

/** Distance travelled along unit `dir` from `from` to `to`. */
function along(from: V3, to: V3, dir: V3): number {
  return (to[0] - from[0]) * dir[0] + (to[2] - from[2]) * dir[2];
}

test.skipIf(!bunWebGpuAvailable())(
  "cave-hub fuzz: lanes on the +Z tunnel axis walk out of the hub without wedging",
  async () => {
    const { ctx, world } = await buildFullWorld();
    // The cave +Z branch mouth sits on the x=AREA_ORIGIN.x (=10) axis; the bore radius
    // (TUNNEL_R 1.6) gives a clear walkable lane within ~1m of the axis. Lanes farther
    // out hit the solid hub wall (a legitimate stop, not a wedge) — so the fuzz set is
    // the three central lanes that have a real floor path through the mouth.
    const HUB_CZ = AREA_ORIGIN[2]; // hub centred on the area origin XZ
    const CAVE_FLOOR_Y = 0; // origin.y(2) + cave FLOOR_Y(-2)
    const SPAWN_Y = CAVE_FLOOR_Y + CAP.halfHeight + CAP.radius + 0.1;
    const dir: V3 = [0, 0, 1];
    for (const x of [9.5, 10, 10.5]) {
      const start: V3 = [x, SPAWN_Y, HUB_CZ];
      const { body, mover } = spawn(ctx, world, start);
      const { end, minY, maxStall } = walkPath(
        ctx,
        world,
        body,
        mover,
        start,
        dir,
        300,
      );
      // Never wedged mid-floor; cleared the hub + entered the tunnel (well past the
      // hub front wall ~3m ahead); never fell through the floor.
      expect(maxStall).toBeLessThan(MAX_STALL);
      expect(along(start, end, dir)).toBeGreaterThan(8);
      expect(minY).toBeGreaterThan(-1);
      physics.destroyBody(ctx, body);
    }
    disposeWorld(ctx, world);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "level<->wing seam: walk from the authored 2nd chamber through the doorway into the cave",
  async () => {
    // Unique vs area-traversal (which omits LEVEL_BOXES): this crosses the authored
    // cuboid floor -> the wing's voxel/cuboid colliders at the z=-4 doorway. The 2nd
    // chamber floor is solid (x[5,15] z[-16,-4], y0); the south wall has a doorway gap
    // at x[8.5,11.5] centred on the wing entrance (world x=10, z=-4). Walking +Z from
    // inside the chamber must cross the seam into the cave hub with no wedge / fall-through.
    const { ctx, world } = await buildFullWorld();
    const dir: V3 = [0, 0, 1];
    const start: V3 = [10, CAP.halfHeight + CAP.radius + 0.2, -8]; // inside the chamber, on its floor
    const { body, mover } = spawn(ctx, world, start);
    const { end, minY, maxStall } = walkPath(
      ctx,
      world,
      body,
      mover,
      start,
      dir,
      300,
    );
    expect(maxStall).toBeLessThan(MAX_STALL);
    // Crossed the z=-4 doorway and continued into the cave hub (well past the seam).
    expect(end[2]).toBeGreaterThan(0);
    // Never fell through the chamber floor or the seam (floor sits at world y=0).
    expect(minY).toBeGreaterThan(-1);
    physics.destroyBody(ctx, body);
    disposeWorld(ctx, world);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "no fall-through: a downward-ray grid over the authored 2nd-chamber floor always hits solid",
  async () => {
    // The Phase-A gate-bug class was a MISSING floor box (a fall-through hole). Cast a
    // grid of downward rays across the authored 2nd-chamber floor (x[6,14], z[-15,-5])
    // and assert every ray hits a solid surface that is not below the floor — i.e. the
    // floor is present everywhere (no hole). Real obstacles ABOVE the floor (pillars,
    // the fallen slab, the branch-overlap ceiling) are legitimately hit at >0 height;
    // the invariant is only that nothing falls through to the grotto/void (point.y > -1).
    const { ctx, world } = await buildFullWorld();
    physics.step(ctx, world, DT); // init the broad-phase before queries
    const voids: string[] = [];
    for (let x = 6; x <= 14.001; x += 1)
      for (let z = -15; z <= -5.001; z += 1) {
        const hit = physics.castRay(ctx, world, {
          origin: [x, 5, z],
          dir: [0, -1, 0],
          maxDistance: 16,
        });
        if (hit === null || hit.point[1] < -1)
          voids.push(`(${x},${z})=${hit ? hit.point[1].toFixed(2) : "VOID"}`);
      }
    expect(voids).toEqual([]);
    disposeWorld(ctx, world);
  },
);
