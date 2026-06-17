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
  "a dynamic ball rests on a static trimesh floor (does not fall through)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    // A 10x10 quad in the XZ plane at y=0: 4 verts, 2 triangles.
    const vertices = new Float32Array([-5, 0, -5, 5, 0, -5, 5, 0, 5, -5, 0, 5]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    physics.createBody(ctx, world, {
      type: "static",
      shape: { trimesh: { vertices, indices } },
      position: [0, 0, 0],
    });
    const ball = physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.5 },
      position: [0, 5, 0],
    });
    for (let i = 0; i < 240; i++) physics.step(ctx, world, 1 / 60);
    const pos = physics.getBodyTranslation(ctx, ball, vec3.create());
    expect(pos[1]).toBeGreaterThan(0.4); // came to rest ~ radius above the floor
    expect(pos[1]).toBeLessThan(0.8);
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);
