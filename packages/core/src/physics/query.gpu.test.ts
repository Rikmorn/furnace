import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import * as physics from "./index.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "castRay hits a static floor from above with an upward normal",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    // 10x0.2x10 cuboid floor, top face at y=0.1.
    const floor = physics.createBody(ctx, world, {
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
      expect(hit.body).toBe(floor); // resolves the body that was hit
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

test.skipIf(!bunWebGpuAvailable())(
  "castShape sweeps a capsule into a wall and returns toi + a normal opposing travel",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    // A wall (thin cuboid) at x=2, spanning the path.
    const wall = physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [0.1, 2, 2] },
      position: [2, 0, 0],
    });
    physics.step(ctx, world, 1 / 60);

    const hit = physics.castShape(ctx, world, {
      shape: { capsule: { halfHeight: 0.6, radius: 0.3 } },
      position: [0, 0, 0],
      dir: [1, 0, 0],
      maxDistance: 5,
    });
    expect(hit).not.toBeNull();
    if (hit) {
      // capsule radius 0.3 hits the wall face at x=1.9 (2 - 0.1), from x=0 → toi ≈ 1.6
      expect(hit.toi).toBeGreaterThan(1.2);
      expect(hit.toi).toBeLessThan(1.8);
      expect(hit.normal[0]).toBeLessThan(-0.5); // surface normal opposes +x travel
      expect(hit.body).toBe(wall); // resolves the body that was hit
    }

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
