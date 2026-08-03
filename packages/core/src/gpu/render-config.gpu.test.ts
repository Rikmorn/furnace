import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "./index.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "render-config defaults: sampleCount 1, hdr off, working format = ctx.format",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    expect(ctx._internal.sampleCount).toBe(1);
    expect(ctx._internal.hdr).toBe(false);
    expect(ctx._internal.workingColorFormat).toBe(ctx.format);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "render-config: sampleCount 4 + hdr on resolve to rgba16float working format",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, {
      surfaceFormat: "linear",
      sampleCount: 4,
      hdr: true,
    });
    expect(ctx._internal.sampleCount).toBe(4);
    expect(ctx._internal.hdr).toBe(true);
    expect(ctx._internal.workingColorFormat).toBe("rgba16float");
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "render-config: sampleCount 4 with hdr off keeps working format = ctx.format (toggles independent)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, {
      surfaceFormat: "linear",
      sampleCount: 4,
    });
    expect(ctx._internal.sampleCount).toBe(4);
    expect(ctx._internal.hdr).toBe(false);
    expect(ctx._internal.workingColorFormat).toBe(ctx.format);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "render-config: invalid sampleCount throws (only 1|4)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    await expect(
      gpu.requestContext(canvas, {
        surfaceFormat: "linear",
        sampleCount: 2 as 1,
      }),
    ).rejects.toThrow();
  },
);
