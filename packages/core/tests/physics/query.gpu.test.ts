import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as physics from "../../src/physics/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "castRay hits a static floor from above with an upward normal",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    // 10x0.2x10 cuboid floor, top face at y=0.1.
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [5, 0.1, 5] },
      position: [0, 0, 0],
    });
    physics.step(ctx, world, 1 / 60); // populate broadphase

    const hit = physics.castRay(ctx, world, {
      origin: [0, 2, 0],
      dir: [0, -1, 0],
      maxDistance: 5,
    });
    expect(hit).not.toBeNull();
    if (hit) {
      expect(hit.point[1]).toBeCloseTo(0.1, 2); // top face
      expect(hit.normal[1]).toBeGreaterThan(0.9); // points up
    }

    const miss = physics.castRay(ctx, world, {
      origin: [0, 2, 0],
      dir: [0, 1, 0], // away from the floor
      maxDistance: 5,
    });
    expect(miss).toBeNull();

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
