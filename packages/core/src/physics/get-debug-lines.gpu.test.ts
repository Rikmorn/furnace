import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import * as physics from "./index.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "getDebugLines returns a well-formed line-list for a world's colliders",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    physics.createBody(ctx, world, {
      type: "dynamic",
      shape: { ball: 0.5 },
      position: [0, 1, 0],
    });
    physics.step(ctx, world, 1 / 60);

    const lines = physics.getDebugLines(ctx, world);
    expect(lines.vertices.length).toBeGreaterThan(0);
    // Each line = two points × three floats = 6 floats; each point also carries
    // an RGBA colour = 4 floats. Vertex count must agree across both buffers.
    expect(lines.vertices.length % 6).toBe(0);
    expect(lines.colors.length % 8).toBe(0);
    expect(lines.vertices.length / 3).toBe(lines.colors.length / 4);

    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "getDebugLines returns empty buffers on a stale world",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
    physics.destroyWorld(ctx, world);

    const lines = physics.getDebugLines(ctx, world);
    expect(lines.vertices.length).toBe(0);
    expect(lines.colors.length).toBe(0);

    gpu.dispose(ctx);
  },
);
