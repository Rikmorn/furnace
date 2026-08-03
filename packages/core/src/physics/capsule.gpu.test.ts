import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import { vec3 } from "../transform/index.ts";
import * as physics from "./index.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "a dynamic capsule rests on a static cuboid ground without tunnelling",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    // Ground top at y=0.5. Capsule half-total-height = halfHeight + radius = 0.9,
    // so it rests with centre at y ≈ 0.5 + 0.9 = 1.4.
    physics.createBody(ctx, world, {
      type: "static",
      shape: { cuboid: [5, 0.5, 5] },
      position: [0, 0, 0],
    });
    const cap = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { capsule: { halfHeight: 0.6, radius: 0.3 } },
      position: [0, 3, 0],
    });

    for (let i = 0; i < 120; i++) physics.step(ctx, world, 1 / 60);

    const t = vec3.create();
    physics.getBodyTranslation(ctx, cap, t);
    expect(t[1]).toBeGreaterThan(1.1); // didn't tunnel through
    expect(t[1]).toBeLessThan(1.7); // came to rest near 1.4

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "createBody rejects a capsule with a non-finite dimension",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    expect(() =>
      physics.createBody(ctx, world, {
        type: "dynamic",
        shape: { capsule: { halfHeight: Number.NaN, radius: 0.3 } },
        position: [0, 0, 0],
      }),
    ).toThrow(/shape must be/);
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
