import { expect, test } from "bun:test";
import { _ensureShadowCasterPipeline } from "../../src/frame/shadow-map.ts";
import * as gpu from "../../src/gpu/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "caster pipeline builds (depth-only, depth32float, single-sample) and is reused",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    ctx.device.pushErrorScope("validation");
    const p1 = _ensureShadowCasterPipeline(ctx); // SYNC
    const p2 = _ensureShadowCasterPipeline(ctx); // SYNC, cached
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null);
    expect(p1).toBe(p2);
    gpu.dispose(ctx);
  },
);
