import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { PREMULTIPLIED_ALPHA_BLEND } from "../../src/material/blend.ts";
import * as material from "../../src/material/index.ts";
import { unlit } from "../../src/material/unlit.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "material.unlit builds a Material with the color buffer owned",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const mat = await unlit(ctx, { color: [0.5, 0.7, 0.3, 1] });
    expect(mat.pipeline).toBeDefined();
    expect(mat.group1).not.toBe(null);
    expect(mat.ownedBuffers.length).toBe(1);
    expect(mat.cullMode).toBe("back");
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "unlit: opts override topology / cullMode / depthWrite / depthCompare",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await unlit(ctx, {
      color: [0.5, 0.7, 0.3, 1],
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
  "unlit: opts.blend yields a distinct pipeline cache key",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const opaque = await unlit(ctx, { color: [1, 0, 0, 1] });
    const blended = await unlit(ctx, {
      color: [1, 0, 0, 1],
      blend: PREMULTIPLIED_ALPHA_BLEND,
    });
    expect(blended.pipelineKey).not.toBe(opaque.pipelineKey);
    material.destroy(opaque);
    material.destroy(blended);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "unlit: defaults when only color passed",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await unlit(ctx, { color: [1, 1, 1, 1] });
    expect(mat.topology).toBe("triangle-list");
    expect(mat.cullMode).toBe("back");
    expect(mat.depthWrite).toBe(true);
    expect(mat.depthCompare).toBe("less");
    material.destroy(mat);
    gpu.dispose(ctx);
  },
);
