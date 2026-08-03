import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import * as physics from "./index.ts";

await ensureBunWebGpu();

const MAX_STEPS = 180; // up to 3 s at 60 Hz

test.skipIf(!bunWebGpuAvailable())(
  "drainCollisions reports a started contact when a ball lands on the ground",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const ground = physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [5, 0.5, 5] },
      position: [0, 0, 0],
    });
    const ball = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.5 },
      position: [0, 1.5, 0],
    });

    let started: physics.CollisionEvent | undefined;
    for (let i = 0; i < MAX_STEPS && started === undefined; i++) {
      physics.step(ctx, world, 1 / 60);
      started = physics.drainCollisions(ctx, world).find((e) => e.started);
    }

    expect(started).toBeDefined();
    const pair = new Set([started?.a, started?.b]);
    expect(pair.has(ball)).toBe(true);
    expect(pair.has(ground)).toBe(true);

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "drainCollisions returns [] on a stale world handle",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    physics.destroyWorld(ctx, world);
    expect(physics.drainCollisions(ctx, world)).toEqual([]);
    gpu.dispose(ctx);
  },
);
