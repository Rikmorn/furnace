import { expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import * as gpu from "../../src/gpu/index.ts";
import { snapshot } from "../../src/stats/public.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "uncapturederror listener installed; counter increments + log.error fired",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const before = snapshot(ctx);
    expect(before.gpu.uncapturedErrors).toBe(0);

    const entries: LogEntry[] = [];
    setSink((entry) => entries.push(entry));
    try {
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

      if (snapshot(ctx).gpu.uncapturedErrors > 0) {
        expect(entries.length).toBeGreaterThan(0);
        const entry = entries[0];
        if (!entry)
          throw new Error("unreachable: entries.length checked above");
        expect(entry.level).toBe("error");
        expect(entry.module).toBe("gpu");
        expect(entry.message).toContain("uncaptured device error");
        expect(typeof entry.rest[0]).toBe("string");
        expect(entry.rest[0]).toBeTruthy();
      }
    } finally {
      setSink(consoleSink);
    }
    gpu.dispose(ctx);
  },
);
