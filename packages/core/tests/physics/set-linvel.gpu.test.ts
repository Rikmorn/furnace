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

test.skipIf(!bunWebGpuAvailable())(
  "setBodyLinearVelocity kicks a resting body along the given direction",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, 0, 0] });
    const ball = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.2 },
      position: [0, 0, 0],
    });

    physics.setBodyLinearVelocity(ctx, ball, [0, 0, -5]);
    for (let i = 0; i < 30; i++) physics.step(ctx, world, 1 / 60);

    const t = vec3.create();
    physics.getBodyTranslation(ctx, ball, t);
    expect(t[2]).toBeLessThan(-2); // moved ~-2.5 along -Z

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setBodyLinearVelocity is a silent no-op on a destroyed body",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, 0, 0] });
    const ball = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.2 },
      position: [0, 0, 0],
    });
    physics.destroyBody(ctx, ball);
    expect(() =>
      physics.setBodyLinearVelocity(ctx, ball, [0, 0, -5]),
    ).not.toThrow();

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
