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
  "a dynamic cylinder rests upright on a static ground (flat base)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [5, 0.5, 5] },
      position: [0, 0, 0],
    });
    // half-height 0.5 cylinder, base sits on ground top (y=0.5) → center y≈1.0.
    const pin = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { cylinder: { halfHeight: 0.5, radius: 0.2 } },
      position: [0, 3, 0],
    });

    for (let i = 0; i < 120; i++) physics.step(ctx, world, 1 / 60);

    const t = vec3.create();
    physics.getBodyTranslation(ctx, pin, t);
    expect(t[1]).toBeGreaterThan(0.85); // didn't tunnel
    expect(t[1]).toBeLessThan(1.25); // came to rest near 1.0, upright

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "createBody throws on a non-finite cylinder dimension",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    expect(() =>
      physics.createBody(ctx, world, {
        type: "dynamic",
        shape: { cylinder: { halfHeight: Number.NaN, radius: 0.2 } },
        position: [0, 0, 0],
      }),
    ).toThrow(/shape must be/);
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
