import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { _ensureFullscreenVS } from "../../src/post/fullscreen.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "_ensureFullscreenVS returns the same module on repeat calls for one ctx",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const a = _ensureFullscreenVS(ctx);
    const b = _ensureFullscreenVS(ctx);
    expect(a).toBe(b);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "different ctxs receive distinct GPUShaderModule instances",
  async () => {
    const c1 = await makeOffscreenCanvas(64, 64);
    const c2 = await makeOffscreenCanvas(64, 64);
    const ctx1 = await gpu.requestContext(c1, { surfaceFormat: "linear" });
    const ctx2 = await gpu.requestContext(c2, { surfaceFormat: "linear" });
    const m1 = _ensureFullscreenVS(ctx1);
    const m2 = _ensureFullscreenVS(ctx2);
    expect(m1).not.toBe(m2);
    gpu.dispose(ctx1);
    gpu.dispose(ctx2);
  },
);
