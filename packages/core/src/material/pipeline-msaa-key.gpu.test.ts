import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import { makeUnlitMaterial } from "../../tests/_helpers/unlit-material.ts";
import * as gpu from "../gpu/index.ts";
import { vec4 } from "../transform/index.ts";
import { _resolveMaterial } from "./internal.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "two identical materials under sampleCount 4 share one cached pipeline (per-ctx cache)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, {
      surfaceFormat: "linear",
      sampleCount: 4,
    });
    const a = await makeUnlitMaterial(ctx, vec4.fromValues(1, 0, 0, 1));
    const b = await makeUnlitMaterial(ctx, vec4.fromValues(0, 1, 0, 1));
    expect(_resolveMaterial(ctx, a.material).pipeline).toBe(
      _resolveMaterial(ctx, b.material).pipeline,
    );
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "material pipeline builds without validation error under sampleCount 4 + hdr (descriptor smoke)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, {
      surfaceFormat: "linear",
      sampleCount: 4,
      hdr: true,
    });
    ctx.device.pushErrorScope("validation");
    const { material } = await makeUnlitMaterial(
      ctx,
      vec4.fromValues(1, 1, 1, 1),
    );
    // touching the pipeline forces the cache build to have completed
    expect(_resolveMaterial(ctx, material).pipeline).toBeDefined();
    const err = await ctx.device.popErrorScope();
    expect(err).toBeNull(); // pipeline targeting rgba16float + multisample count 4 must validate cleanly
    gpu.dispose(ctx);
  },
);
