import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import { quat } from "../transform/index.ts";
import * as physics from "./index.ts";

await ensureBunWebGpu();

const HALF_SECOND_STEPS = 30; // 0.5 s at 60 Hz

test.skipIf(!bunWebGpuAvailable())(
  "a dynamic body with angularVelocity spins; without it stays put",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, 0, 0] });

    const spinner = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.5 },
      position: [0, 0, 0],
      angularVelocity: [0, Math.PI, 0], // π rad/s about Y
    });
    const still = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.5 },
      position: [5, 0, 0],
    });

    const r0 = quat.create();
    physics.getBodyRotation(ctx, spinner, r0);
    expect(r0[3]).toBeCloseTo(1, 5); // identity at start (w = 1)

    for (let i = 0; i < HALF_SECOND_STEPS; i++)
      physics.step(ctx, world, 1 / 60);

    const r1 = quat.create();
    physics.getBodyRotation(ctx, spinner, r1);
    expect(Math.abs(r1[1] as number)).toBeGreaterThan(0.1); // rotated about Y
    expect(r1[3]).toBeLessThan(0.99); // no longer identity

    const rStill = quat.create();
    physics.getBodyRotation(ctx, still, rStill);
    expect(rStill[3]).toBeCloseTo(1, 5); // unchanged — no angularVelocity

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
