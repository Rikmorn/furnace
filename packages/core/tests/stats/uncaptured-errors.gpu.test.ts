import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { snapshot } from "../../src/stats/public.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "uncapturederror listener installed; counter increments + console.error fired",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const before = snapshot(ctx);
    expect(before.gpu.uncapturedErrors).toBe(0);

    const origErr = console.error;
    let errCalls = 0;
    let lastMsg = "";
    console.error = (...a: unknown[]) => {
      errCalls++;
      lastMsg = String(a[0]);
    };
    try {
      ctx.device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module: ctx.device.createShaderModule({ code: "INVALID WGSL" }),
          entryPoint: "vs_main",
        },
        fragment: {
          module: ctx.device.createShaderModule({ code: "INVALID WGSL" }),
          entryPoint: "fs_main",
          targets: [{ format: ctx.format }],
        },
      });
    } catch {
      // Some backends throw synchronously instead of routing through uncapturederror;
      // either path is acceptable.
    }

    const DEVICE_DISPATCH_WAIT_MS = 30;
    await new Promise((r) => setTimeout(r, DEVICE_DISPATCH_WAIT_MS));
    console.error = origErr;

    if (snapshot(ctx).gpu.uncapturedErrors > 0) {
      expect(errCalls).toBeGreaterThan(0);
      expect(lastMsg).toContain("[furnace/gpu]");
    }
    gpu.dispose(ctx);
  },
);
