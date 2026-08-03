import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "./index.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "requestContext: ctx._internal.stats is initialized",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    expect(ctx._internal.stats).toBeDefined();
    expect(ctx._internal.stats.drawCalls).toBe(0);
    expect(ctx._internal.stats.resources.counts.meshes).toBe(0);
    expect(ctx._internal.stats.resources.counts.materials).toBe(0);
    expect(ctx._internal.stats.resources.counts.geometries).toBe(0);
    expect(ctx._internal.stats.resources.counts.effects).toBe(0);
    expect(ctx._internal.stats.resources.memory.bufferBytes).toBe(0);
    expect(ctx._internal.stats.resources.memory.textureBytes).toBe(0);
    expect(ctx._internal.stats.onFrameSubscribers.size).toBe(0);
    gpu.dispose(ctx);
  },
);
