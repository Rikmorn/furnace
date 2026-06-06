import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { _ensureSceneIntermediates } from "../../src/post/intermediate.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "hdr on → scene intermediates are rgba16float",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, {
      surfaceFormat: "linear",
      hdr: true,
    });
    const im = _ensureSceneIntermediates(ctx);
    expect(im.a.format).toBe("rgba16float");
    expect(im.b.format).toBe("rgba16float");
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "hdr off → scene intermediates stay at ctx.format (LDR unchanged)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const im = _ensureSceneIntermediates(ctx);
    expect(im.a.format).toBe(ctx.format);
    expect(im.b.format).toBe(ctx.format);
    gpu.dispose(ctx);
  },
);
