import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { PREMULTIPLIED_ALPHA_BLEND } from "../../src/material/blend.ts";
import * as material from "../../src/material/index.ts";
import { normalColor } from "../../src/material/normal-color.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "material.normalColor builds a Material with no group-1",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat = await normalColor(ctx);
    expect(mat.pipeline).toBeDefined();
    expect(mat.group1).toBe(null);
    expect(mat.ownedBuffers.length).toBe(0);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "normalColor: opts override topology / cullMode / depthWrite / depthCompare",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await normalColor(ctx, {
      topology: "line-list",
      cullMode: "none",
      depthWrite: false,
      depthCompare: "less-equal",
    });
    expect(mat.topology).toBe("line-list");
    expect(mat.cullMode).toBe("none");
    expect(mat.depthWrite).toBe(false);
    expect(mat.depthCompare).toBe("less-equal");
    material.destroy(mat);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "normalColor: opts.blend yields a distinct pipeline cache key",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const opaque = await normalColor(ctx);
    const blended = await normalColor(ctx, {
      blend: PREMULTIPLIED_ALPHA_BLEND,
    });
    expect(blended.pipelineKey).not.toBe(opaque.pipelineKey);
    material.destroy(opaque);
    material.destroy(blended);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "normalColor: defaults when no opts passed",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await normalColor(ctx);
    expect(mat.topology).toBe("triangle-list");
    expect(mat.cullMode).toBe("back");
    expect(mat.depthWrite).toBe(true);
    expect(mat.depthCompare).toBe("less");
    material.destroy(mat);
    gpu.dispose(ctx);
  },
);
