import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import { MAX_SHADOW_CASTERS } from "./lights.ts";
import { _ensureShadowMap } from "./shadow-map.ts";

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
