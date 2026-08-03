import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import { _ensureShadowCasterPipeline } from "./shadow-map.ts";

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
