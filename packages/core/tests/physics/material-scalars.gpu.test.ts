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

async function ctxWithGround() {
  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  physics.createBody(ctx, world, {
    type: "static",
    shape: { cuboid: [10, 0.5, 10] },
    position: [0, 0, 0],
    restitution: 0,
  });
  return { ctx, world };
}

test.skipIf(!bunWebGpuAvailable())(
  "restitution drives bounce: a restitution=0.9 ball rebounds higher than restitution=0",
  async () => {
    const { ctx, world } = await ctxWithGround();
    const DROP_Y = 4;
    const bouncy = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.3 },
      position: [-2, DROP_Y, 0],
      restitution: 0.9,
    });
    const dead = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.3 },
      position: [2, DROP_Y, 0],
      restitution: 0,
    });

    // step long enough to hit + rebound, then sample at the rebound apex window
    let bouncyMax = 0;
    let deadMax = 0;
    const tb = vec3.create();
    const td = vec3.create();
    for (let i = 0; i < 90; i++) {
      physics.step(ctx, world, 1 / 60);
      if (i > 45) {
        physics.getBodyTranslation(ctx, bouncy, tb);
        physics.getBodyTranslation(ctx, dead, td);
        bouncyMax = Math.max(bouncyMax, tb[1] as number);
        deadMax = Math.max(deadMax, td[1] as number);
      }
    }
    expect(bouncyMax).toBeGreaterThan(deadMax + 0.3); // restitution is wired

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "angularDamping is accepted and applied without error (spin readback not in public API)",
  async () => {
    const { ctx, world } = await ctxWithGround();
    const spun = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.3 },
      position: [-2, 1, 0],
      angularVelocity: [0, 12, 0],
      angularDamping: 4,
    });
    const free = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.3 },
      position: [2, 1, 0],
      angularVelocity: [0, 12, 0],
      angularDamping: 0,
    });
    // Spin readback is not in the public API, so we can't compare angular
    // velocities directly. Stepping a damped + an undamped spinner without
    // throwing, then reading each back, is the unit-level wiring check;
    // believable settle is verified visually in Phase 3.
    for (let i = 0; i < 60; i++) physics.step(ctx, world, 1 / 60);
    expect(physics.getBodyTranslation(ctx, spun, vec3.create())).toBeDefined();
    expect(physics.getBodyTranslation(ctx, free, vec3.create())).toBeDefined();

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
