import { expect, test } from "bun:test";
import { MAX_SHADOW_CASTERS } from "../../src/frame/lights.ts";
import { _ensureShadowMap } from "../../src/frame/shadow-map.ts";
import * as gpu from "../../src/gpu/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "shadow map is one array texture with MAX_SHADOW_CASTERS layers + a comparison sampler, reused across calls",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    ctx.device.pushErrorScope("validation");
    const a = _ensureShadowMap(ctx);
    const b = _ensureShadowMap(ctx);
    const err = await ctx.device.popErrorScope();
    expect(err).toBe(null); // probe passed -> assert clean creation
    expect(a.texture).toBe(b.texture); // reused
    expect(a.layerViews.length).toBe(MAX_SHADOW_CASTERS);
    expect(a.comparisonSampler).toBeTruthy();
    expect(a.arrayView).toBeTruthy();
    gpu.dispose(ctx);
  },
);
