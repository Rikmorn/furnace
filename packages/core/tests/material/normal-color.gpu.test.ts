import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { PREMULTIPLIED_ALPHA_BLEND } from "../../src/material/blend.ts";
import * as material from "../../src/material/index.ts";
import { _resolveMaterial } from "../../src/material/internal.ts";
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
    const slot = _resolveMaterial(ctx, mat);
    expect(slot.pipeline).toBeDefined();
    expect(slot.group1).toBe(null);
    expect(slot.ownedBuffers.length).toBe(0);
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
    const slot = _resolveMaterial(ctx, mat);
    expect(slot.topology).toBe("line-list");
    expect(slot.cullMode).toBe("none");
    expect(slot.depthWrite).toBe(false);
    expect(slot.depthCompare).toBe("less-equal");
    material.destroy(ctx, mat);
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
    const opaqueSlot = _resolveMaterial(ctx, opaque);
    const blendedSlot = _resolveMaterial(ctx, blended);
    expect(blendedSlot.pipelineKey).not.toBe(opaqueSlot.pipelineKey);
    material.destroy(ctx, opaque);
    material.destroy(ctx, blended);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "normalColor: defaults when no opts passed",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const mat = await normalColor(ctx);
    const slot = _resolveMaterial(ctx, mat);
    expect(slot.topology).toBe("triangle-list");
    expect(slot.cullMode).toBe("back");
    expect(slot.depthWrite).toBe(true);
    expect(slot.depthCompare).toBe("less");
    material.destroy(ctx, mat);
    gpu.dispose(ctx);
  },
);
