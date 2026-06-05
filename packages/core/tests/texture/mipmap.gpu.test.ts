import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as texture from "../../src/texture/index.ts";
import { _mipLevelCountOf } from "../../src/texture/texture.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "mipmaps:true creates the full mip chain (mipLevelCount) with a clean error scope",
  async () => {
    const canvas = await makeOffscreenCanvas();
    // surfaceFormat:"linear" avoids the sRGB surface-format caveat documented in gpu-fixture.ts.
    // The mip render-passes also use "rgba8unorm" (linear) for the same reason: bun-webgpu
    // cannot render into srgb render targets; sRGB mip-gen is covered by the Safari gate (T11).
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    // 4x4 → floor(log2(4)) + 1 = 3 levels. (create throwing = a validation error in mip gen.)
    const tex = await texture.create(ctx, {
      data: new Uint8Array(4 * 4 * 4),
      width: 4,
      height: 4,
      colorSpace: "linear",
      mipmaps: true,
    });
    expect(_mipLevelCountOf(ctx, tex)).toBe(3);
    texture.destroy(ctx, tex);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "mipmaps omitted → single mip level",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const tex = await texture.create(ctx, {
      data: new Uint8Array(4 * 4 * 4),
      width: 4,
      height: 4,
    });
    expect(_mipLevelCountOf(ctx, tex)).toBe(1);
    texture.destroy(ctx, tex);
    gpu.dispose(ctx);
  },
);
