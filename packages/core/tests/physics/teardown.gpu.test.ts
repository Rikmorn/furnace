import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as physics from "../../src/physics/index.ts";
import * as resources from "../../src/resources/index.ts";
import * as stats from "../../src/stats/index.ts";
import { vec3 } from "../../src/transform/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

async function worldWithTwoBodies(ctx: Parameters<typeof physics.step>[0]) {
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  const a = physics.createBody(ctx, world, {
    type: "dynamic",
    shape: { ball: 0.5 },
    position: [0, 5, 0],
  });
  const b = physics.createBody(ctx, world, {
    type: "static",
    shape: { cuboid: [5, 0.5, 5] },
    position: [0, 0, 0],
  });
  return { world, a, b };
}

test.skipIf(!bunWebGpuAvailable())(
  "destroyWorld frees all bodies and is idempotent",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const { world } = await worldWithTwoBodies(ctx);
    expect(stats.snapshot(ctx).resources.physicsBodies).toBe(2);
    expect(stats.snapshot(ctx).resources.physicsWorlds).toBe(1);

    physics.destroyWorld(ctx, world);
    expect(stats.snapshot(ctx).resources.physicsBodies).toBe(0);
    expect(stats.snapshot(ctx).resources.physicsWorlds).toBe(0);

    physics.destroyWorld(ctx, world); // idempotent
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "destroyBody removes one body; the rest keep simulating",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const { world, a, b } = await worldWithTwoBodies(ctx);

    physics.destroyBody(ctx, b);
    expect(stats.snapshot(ctx).resources.physicsBodies).toBe(1);

    const before = vec3.create();
    physics.getBodyTranslation(ctx, a, before);
    for (let i = 0; i < 30; i++) physics.step(ctx, world, 1 / 60);
    const after = vec3.create();
    physics.getBodyTranslation(ctx, a, after);
    expect(after[1]).toBeLessThan(before[1] as number); // 'a' still falls

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "resources.disposeAll cascade frees undestroyed physics resources",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    await worldWithTwoBodies(ctx); // intentionally not destroyed

    resources.disposeAll(ctx);
    expect(stats.snapshot(ctx).resources.physicsWorlds).toBe(0);
    expect(stats.snapshot(ctx).resources.physicsBodies).toBe(0);

    gpu.dispose(ctx);
  },
);
