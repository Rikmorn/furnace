import { expect, test } from "bun:test";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { CharacterMover } from "../src/agent/char-move.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();
const CAPSULE = { halfHeight: 0.6, radius: 0.3 };

test.skipIf(!bunWebGpuAvailable())(
  "resolve steps up a 0.3m ledge but is blocked by a 1.0m wall",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    // ground floor (top y=0)
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [10, 0.5, 10] },
      position: [0, -0.5, 0],
    });
    // a 0.3m-high step block starting at x=1 (top y=0.3)
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [5, 0.15, 5] },
      position: [6, 0.15, 0],
    });
    const body = physics.createBody(ctx, world, {
      type: "kinematicPosition",
      shape: { capsule: CAPSULE },
      position: [0, 0.9, 0],
    });
    physics.step(ctx, world, 1 / 60);

    const mover = new CharacterMover(CAPSULE, body);
    let pos: [number, number, number] = [0, 0.9, 0];
    // Walk +x toward the step for 80 ticks.
    for (let i = 0; i < 80; i++) {
      const r = mover.resolve(ctx, world, pos, [0.06, 0, 0], 1 / 60);
      pos = r.pos;
      physics.setBodyNextKinematicTranslation(ctx, body, pos);
      physics.step(ctx, world, 1 / 60);
    }
    expect(pos[0]).toBeGreaterThan(1.2); // climbed onto the step (didn't stall at x≈1)
    expect(pos[1]).toBeGreaterThan(1.0); // foot now ~0.3 higher (0.9 + 0.3)

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
