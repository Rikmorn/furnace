import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "requestContext: ctx._internal.stats is initialized",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    expect(ctx._internal.stats).toBeDefined();
    expect(ctx._internal.stats.drawCalls).toBe(0);
    expect(ctx._internal.stats.resources.entries.size).toBe(0);
    expect(ctx._internal.stats.onFrameSubscribers.size).toBe(0);
    gpu.dispose(ctx);
  },
);
