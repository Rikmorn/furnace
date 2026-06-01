import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as physics from "../../src/physics/index.ts";
import { vec3 } from "../../src/transform/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const STEPS_PER_SECOND = 60;

function stepOneSecond(
  world: physics.World,
  ctx: Parameters<typeof physics.step>[0],
) {
  for (let i = 0; i < STEPS_PER_SECOND; i++) physics.step(ctx, world, 1 / 60);
}

test.skipIf(!bunWebGpuAvailable())(
  "a dynamic body free-falls under gravity",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const START_Y = 10;
    const ball = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.5 },
      position: [0, START_Y, 0],
    });

    stepOneSecond(world, ctx);

    const t = vec3.create();
    physics.getBodyTranslation(ctx, ball, t);
    const drop = START_Y - (t[1] as number);
    expect(drop).toBeGreaterThan(4.5); // analytic ½·g·t² = 4.905
    expect(drop).toBeLessThan(5.3);

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a static body does not move under gravity",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    const ground = physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [5, 0.5, 5] },
      position: [0, 0, 0],
    });

    stepOneSecond(world, ctx);

    const t = vec3.create();
    physics.getBodyTranslation(ctx, ground, t);
    expect(t[1]).toBeCloseTo(0, 5);

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "a dynamic body rests on a static cuboid ground",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    // Ground top surface at y=0.5; a ball of radius 0.5 rests at center y≈1.0.
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [5, 0.5, 5] },
      position: [0, 0, 0],
    });
    const ball = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.5 },
      position: [0, 3, 0],
    });

    for (let i = 0; i < 2 * STEPS_PER_SECOND; i++)
      physics.step(ctx, world, 1 / 60);

    const t = vec3.create();
    physics.getBodyTranslation(ctx, ball, t);
    expect(t[1]).toBeGreaterThan(0.85); // didn't tunnel through
    expect(t[1]).toBeLessThan(1.3); // came to rest near 1.0

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "createBody throws on an unknown body type",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    expect(() =>
      physics.createBody(ctx, world, {
        // @ts-expect-error deliberately invalid type
        type: "floaty",
        shape: { ball: 1 },
        position: [0, 0, 0],
      }),
    ).toThrow(/unknown body type/);
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
