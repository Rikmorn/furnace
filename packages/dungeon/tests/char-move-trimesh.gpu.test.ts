import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { CharacterMover } from "../src/char-move.ts";
import { generateRegion } from "../src/generator.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();
const CAPSULE = { halfHeight: 0.6, radius: 0.3 };

test.skipIf(!bunWebGpuAvailable())(
  "walking across the generated chamber trimesh keeps a controlled height (no violent jitter)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const region = generateRegion({
      seed: "chamber-1",
      kind: "chamber",
      origin: [0, 0, 0],
    });
    physics.createBody(ctx, world, {
      type: "static",
      shape: {
        trimesh: {
          vertices: region.mesh.positions,
          indices: region.mesh.indices,
        },
      },
      position: [0, 0, 0],
    });
    // Spawn above the centre of the region and let gravity settle onto the sheet.
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: [0, 3, 0],
    });
    physics.step(ctx, world, 1 / 60);
    const mover = new CharacterMover(CAPSULE, body);
    let pos: [number, number, number] = [0, 3, 0];
    // settle (no horizontal input) for ~40 ticks
    for (let i = 0; i < 40; i++) {
      pos = mover.resolve(ctx, world, pos, [0, 0, 0], 1 / 60).pos;
      physics.setBodyNextKinematicTranslation(ctx, body, pos);
      physics.step(ctx, world, 1 / 60);
    }
    // now WALK with variable dt and measure the per-frame vertical jump
    const startX = pos[0];
    let maxFrameJump = 0;
    let prevY = pos[1];
    let notGroundedCount = 0;
    for (let i = 0; i < 120; i++) {
      const dt = i % 2 === 0 ? 1 / 60 : 1 / 50; // variable timestep like the live loop
      const r = mover.resolve(ctx, world, pos, [0.05, 0, 0], dt);
      pos = r.pos;
      if (!r.grounded) notGroundedCount++;
      physics.setBodyNextKinematicTranslation(ctx, body, pos);
      physics.step(ctx, world, dt);
      maxFrameJump = Math.max(maxFrameJump, Math.abs(pos[1] - prevY));
      prevY = pos[1];
    }
    // The bug (GROUND_SNAP < STEP_HEIGHT) showed up two ways while moving: a violent
    // per-frame vertical snap (~STEP_HEIGHT) and grounded flickering off most frames
    // (spurious step-up raises the body past the ground ray's reach, so it falls then
    // snaps back). Smooth terrain-following keeps both small.
    expect(Math.abs(pos[0] - startX)).toBeGreaterThan(0.5); // actually walked
    expect(maxFrameJump).toBeLessThan(0.1); // no violent vertical snap per frame
    expect(notGroundedCount).toBeLessThan(12); // stays grounded while walking flat-ish floor
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
