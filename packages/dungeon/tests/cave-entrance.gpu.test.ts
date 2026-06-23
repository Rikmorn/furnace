// Entrance walk-probe. The area-traversal probe starts INSIDE the cave hub and walks
// OUT toward a branch — it never tests the -Z entrance, so it missed that the hub's
// -Z wall was solid rock (an invisible wall: the rendered backface is culled, but the
// voxels block the player). This probe builds JUST the cave, stands the player on an
// authored approach floor OUTSIDE the -Z entrance, and walks +Z INTO the hub, asserting
// it crosses the entrance plane (never wedged on a solid wall, never fell through the
// seam). It FAILS on the pre-fix solid-wall cave and PASSES once the entrance bore is
// carved. WALK-IN, not drop-in: dropping a capsule rests it on top and hides a wedge.
import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { CharacterMover } from "../src/char-move.ts";
import { MaterialCache, realizeRegion } from "../src/realize.ts";
import type { Connection } from "../src/region.ts";
import { cave } from "../src/themes/cave.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();
const CAPSULE = { halfHeight: 0.6, radius: 0.3 };

test.skipIf(!bunWebGpuAvailable())(
  "player walks IN through the cave entrance, no solid-wall block / no fall",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const cache = new MaterialCache(ctx);

    const region = cave({
      theme: "cave",
      seed: "entrance-1",
      origin: [0, 0, 0],
    });
    await realizeRegion(ctx, world, cache, region);

    const entrance = region.connections.find(
      (c) => c.facing[2] === -1,
    ) as Connection;
    // The cave floor is at world y = origin.y + FLOOR_Y = -2. Lay a flat authored
    // approach floor on the -Z (chamber) side of the entrance so the player has ground
    // to stand on OUTSIDE the cave (its top at y = -2, coplanar with the cave floor).
    const FLOOR_TOP = entrance.position[1]; // = -2
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [3, 0.1, 3] },
      position: [
        entrance.position[0],
        FLOOR_TOP - 0.1,
        entrance.position[2] - 3,
      ],
    });

    // Stand the capsule just OUTSIDE the entrance on the approach floor and walk +Z
    // (the negation of the entrance's outward facing) straight into the hub.
    const startY = FLOOR_TOP + CAPSULE.halfHeight + CAPSULE.radius + 0.1;
    let pos: [number, number, number] = [
      entrance.position[0],
      startY,
      entrance.position[2] - 2,
    ];
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: pos,
    });
    physics.step(ctx, world, 1 / 60);
    const mover = new CharacterMover(CAPSULE, body);
    const dir: [number, number, number] = [0, 0, 1]; // +Z, into the hub

    let minY = pos[1];
    let stalls = 0;
    for (let i = 0; i < 300; i++) {
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
      expect(stalls).toBeLessThan(45); // never wedged against a wall for ~0.75s
    }

    // Entered the hub: advanced well past the entrance plane along +Z.
    expect(pos[2]).toBeGreaterThan(entrance.position[2] + 2);
    // Never fell through the floor/seam.
    expect(minY).toBeGreaterThan(FLOOR_TOP - 1);

    cache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
