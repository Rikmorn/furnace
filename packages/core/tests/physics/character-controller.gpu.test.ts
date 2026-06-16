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
  "a character controller is created and destroyed idempotently, leaving the world clean",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });

    const controller = physics.createCharacterController(ctx, world, {
      offset: 0.01,
      up: [0, 1, 0],
      autostep: { maxHeight: 0.3, minWidth: 0.1 },
      snapToGround: 0.5,
    });

    // Idempotent destroy: two calls, no throw.
    physics.destroyCharacterController(ctx, controller);
    physics.destroyCharacterController(ctx, controller);

    // A fresh controller left undestroyed must be cleaned up by destroyWorld
    // (no leak); gpu.dispose is the leak check — a clean shutdown does not throw.
    physics.createCharacterController(ctx, world);
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "createCharacterController throws on a destroyed world",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    physics.destroyWorld(ctx, world);
    expect(() => physics.createCharacterController(ctx, world)).toThrow(
      /world handle is invalid or destroyed/,
    );
    gpu.dispose(ctx);
  },
);
