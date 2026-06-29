// Headless seam walk-probe. Builds the FULL composed collider set buildArea
// produces (cave voxels + connector cuboid + room cuboids) and WALKS the player
// capsule from inside the cave hub, out through a tunnel mouth, across the
// cave->connector->room seams, and into the room — asserting it never wedges, never
// falls through a seam, and actually enters the room. This converts the 2.2.1
// gate-only seam class (curved-wall stall / floor stall / hall<->chamber fall-through)
// into a hard headless assert. It is WALK-IN, not drop-in: dropping a capsule rests
// it on top and hides the wedge, so this drives the real CharacterMover along a path.
import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { CharacterMover } from "../src/char-move.ts";
import { attachUpperLevel, buildArea } from "../src/compose.ts";
import { LEVEL_BOXES } from "../src/level.ts";
import { MaterialCache, realizeRegion } from "../src/realize.ts";
import type { Connection, RegionData } from "../src/region.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();
const CAPSULE = { halfHeight: 0.6, radius: 0.3 };

test.skipIf(!bunWebGpuAvailable())(
  "player walks cave -> corridor -> room across a seam, no fall/stall",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    const regions = buildArea("walk-1", [0, 0, 0]);
    for (const r of regions) await realizeRegion(ctx, world, cache, r);

    const caveRegion = regions.find(
      (r) => r.provenance.theme === "cave",
    ) as RegionData;
    const mouth = (caveRegion.connections.find(
      (c) => c.kind === "tunnel-mouth" && c.facing[0] === 1,
    ) ??
      caveRegion.connections.find(
        (c) => c.kind === "tunnel-mouth" && c.facing[2] === 1,
      )) as Connection;

    // start just inside the cave hub at the floor, walk toward the mouth
    const startY =
      mouth.position[1] + CAPSULE.halfHeight + CAPSULE.radius + 0.1;
    let pos: [number, number, number] = [0, startY, 0];
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: pos,
    });
    physics.step(ctx, world, 1 / 60);
    const mover = new CharacterMover(CAPSULE, body);
    const dir = mouth.facing; // unit toward the mouth/room
    let minY = pos[1];
    let stalls = 0;
    for (let i = 0; i < 400; i++) {
      const prev = pos;
      pos = mover.resolve(
        ctx,
        world,
        pos,
        [(dir[0] * 3) / 60, 0, (dir[2] * 3) / 60],
        1 / 60,
      ).pos;
      physics.setBodyNextKinematicTranslation(ctx, body, pos);
      physics.step(ctx, world, 1 / 60);
      minY = Math.min(minY, pos[1]);
      const progressed = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]) > 0.005;
      stalls = progressed ? 0 : stalls + 1;
      expect(stalls).toBeLessThan(45); // never wedged for ~0.75s
    }
    // crossed past the mouth into the room (advanced well beyond the mouth along `dir`)
    const advanced = pos[0] * dir[0] + pos[2] * dir[2];
    const mouthAlong = mouth.position[0] * dir[0] + mouth.position[2] * dir[2];
    expect(advanced).toBeGreaterThan(mouthAlong + 2); // entered the room
    expect(minY).toBeGreaterThan(mouth.position[1] - 1); // never fell through the seam

    cache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

// --- Task 9: multi-level showcase (ramp climb + stairs + off-axis upper rooms) ---
// Two elevated rooms attach to the authored 2nd-chamber floor portals (attachUpperLevel):
// a pillarHall up a ~30° OFF-AXIS ramp and a greatHall up a cardinal stair-run. These walk
// the CharacterMover up each climb on the FULL chamber collider set + the upper level, and
// assert it actually RISES (proving arbitrary-angle + multi-height joining via `route`) and
// never wedges. The upper rooms' footprints overlap the chamber walls at climb height, so —
// like connect.gpu.test.ts's `climb` helper — we break at the landing (the final sample is
// the climbed state) rather than walking deeper into the room and into a chamber wall.
const MAX_FRAMES = 700;
const STALL_LIMIT = 45; // never wedged for ~0.75 s
const WALK_SPEED = 3; // m/s
const DT = 1 / 60;

/** Realize the authored chamber colliders + the multi-level showcase, spawn the capsule on
 *  a floor portal at `from`, and walk it along `dir` up a climb of horizontal `run` to a
 *  room sitting `height` above. Returns whether it reached the landing (advanced past `run`
 *  AND rose well above spawn) plus the climb metrics. */
async function climbUpper(
  from: [number, number, number],
  dir: [number, number, number],
  run: number,
  height: number,
): Promise<{
  reachedTop: boolean;
  maxY: number;
  maxStall: number;
  startY: number;
}> {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  const cache = new MaterialCache(ctx);
  for (const b of LEVEL_BOXES) {
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2] },
      position: b.center,
    });
  }
  const realized: Awaited<ReturnType<typeof realizeRegion>>[] = [];
  for (const r of attachUpperLevel("wing-1")) {
    realized.push(await realizeRegion(ctx, world, cache, r));
  }

  const startY = CAPSULE.halfHeight + CAPSULE.radius + 0.2;
  let pos: [number, number, number] = [from[0], startY, from[2]];
  const body = physics.createBody(ctx, world, {
    type: "kinematicPosition",
    shape: { capsule: CAPSULE },
    position: pos,
  });
  physics.step(ctx, world, DT);
  const mover = new CharacterMover(CAPSULE, body);
  let maxStall = 0;
  let stall = 0;
  let maxY = pos[1];
  let reachedTop = false;
  for (let i = 0; i < MAX_FRAMES; i++) {
    const prev = pos;
    pos = mover.resolve(
      ctx,
      world,
      pos,
      [dir[0] * WALK_SPEED * DT, 0, dir[2] * WALK_SPEED * DT],
      DT,
    ).pos;
    physics.setBodyNextKinematicTranslation(ctx, body, pos);
    physics.step(ctx, world, DT);
    maxY = Math.max(maxY, pos[1]);
    const progressed = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]) > 0.005;
    stall = progressed ? 0 : stall + 1;
    maxStall = Math.max(maxStall, stall);
    // Reached the landing: advanced past the connector exit along `dir` AND risen well above
    // spawn. Break before walking deeper into the upper room (its footprint overlaps the
    // chamber walls at climb height).
    const advanced = (pos[0] - from[0]) * dir[0] + (pos[2] - from[2]) * dir[2];
    if (advanced >= run && pos[1] > startY + height * 0.5) {
      reachedTop = true;
      break;
    }
  }
  for (const r of realized) r.destroy();
  cache.destroy();
  physics.destroyWorld(ctx, world);
  gpu.dispose(ctx);
  return { reachedTop, maxY, maxStall, startY };
}

test.skipIf(!bunWebGpuAvailable())(
  "player climbs the off-axis ramp to the upper room",
  async () => {
    // dir mirrors attachUpperLevel's aDir (RAMP_OFF_AXIS_DEG off −Z, NORTH-WEST); from = its fromA.
    const yaw = (30 * Math.PI) / 180;
    const dir: [number, number, number] = [-Math.sin(yaw), 0, -Math.cos(yaw)];
    const RAMP_RUN = 16; // mirrors compose.ts CLIMB_RUN
    const RAMP_HEIGHT = 13.4; // mirrors compose.ts CLIMB_HEIGHT
    const r = await climbUpper([10, 0, -9.6], dir, RAMP_RUN, RAMP_HEIGHT);
    expect(r.reachedTop).toBe(true); // climbed the whole ramp, never fell off
    expect(r.maxY).toBeGreaterThan(r.startY + RAMP_HEIGHT * 0.6); // rose most of the height
    expect(r.maxStall).toBeLessThan(STALL_LIMIT);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "player climbs the cardinal stairs to the upper room",
  async () => {
    const dir: [number, number, number] = [1, 0, 0]; // mirrors attachUpperLevel's bDir; from = fromB
    const STAIR_RUN = 12; // mirrors compose.ts STAIR_RUN
    const STAIR_HEIGHT = 10; // mirrors compose.ts STAIR_HEIGHT
    const r = await climbUpper([7, 0, -6], dir, STAIR_RUN, STAIR_HEIGHT);
    expect(r.reachedTop).toBe(true);
    expect(r.maxY).toBeGreaterThan(r.startY + STAIR_HEIGHT * 0.6);
    expect(r.maxStall).toBeLessThan(STALL_LIMIT);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "player walks into greatHall and climbs onto the dais platform",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);
    const regions = buildArea("walk-1", [0, 0, 0]);
    for (const r of regions) await realizeRegion(ctx, world, cache, r);

    const ghRegion = regions.find(
      (r) => r.provenance.theme === "greatHall",
    ) as RegionData;
    // The placed greatHall's door is its real entrance. The player walks from the cave hub
    // INTO the room — i.e. OPPOSITE the door's outward facing. (placePiece sets a placed
    // region's origin generically to xf(local origin), so we key off the door connection,
    // not origin, which also survives the Task-7 room gap.)
    const ghDoor = ghRegion.connections.find(
      (c) => c.kind === "door",
    ) as Connection;

    // capsule rest height on flat floor at mouth Y
    const flatFloorRestY =
      ghDoor.position[1] + CAPSULE.halfHeight + CAPSULE.radius;
    const startY = flatFloorRestY + 0.1;
    let pos: [number, number, number] = [0, startY, 0];
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: pos,
    });
    physics.step(ctx, world, 1 / 60);
    const mover = new CharacterMover(CAPSULE, body);
    // toward the room = opposite the door's outward facing
    const dir: [number, number, number] = [
      -ghDoor.facing[0],
      0,
      -ghDoor.facing[2],
    ];
    const mouthAlong =
      ghDoor.position[0] * dir[0] + ghDoor.position[2] * dir[2];
    // platTop ∈ [0.3, 0.8); 0.25 m is a robust threshold that any seed must reach
    const DAIS_RISE_THRESHOLD = 0.25;
    let minY = pos[1];
    let stalls = 0;
    let climbedDais = false;
    // greatHall depth up to ~31 m; walk at 3 m/s for 900 iterations (15 s) to
    // reach and climb onto the dais at the far end. Break early once the dais is
    // confirmed so the player does not continue into the far wall.
    for (let i = 0; i < 900; i++) {
      const prev = pos;
      pos = mover.resolve(
        ctx,
        world,
        pos,
        [(dir[0] * 3) / 60, 0, (dir[2] * 3) / 60],
        1 / 60,
      ).pos;
      physics.setBodyNextKinematicTranslation(ctx, body, pos);
      physics.step(ctx, world, 1 / 60);
      minY = Math.min(minY, pos[1]);
      const progressed = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]) > 0.005;
      stalls = progressed ? 0 : stalls + 1;
      expect(stalls).toBeLessThan(45); // never wedged for ~0.75s
      // stop as soon as we confirm the dais has been climbed — avoids walking into the far wall.
      // Guard with "past mouthAlong + 5" so cave/connector terrain variation cannot trigger this early.
      const depthNow = pos[0] * dir[0] + pos[2] * dir[2];
      if (
        depthNow > mouthAlong + 5 &&
        pos[1] > flatFloorRestY + DAIS_RISE_THRESHOLD
      ) {
        climbedDais = true;
        break;
      }
    }
    // entered the room (advanced past the mouth)
    const advanced = pos[0] * dir[0] + pos[2] * dir[2];
    expect(advanced).toBeGreaterThan(mouthAlong + 2);
    // climbed onto the dais: Y rose above flat-floor rest height
    expect(climbedDais).toBe(true);
    // never fell through the floor
    expect(minY).toBeGreaterThan(ghDoor.position[1] - 1);

    cache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
