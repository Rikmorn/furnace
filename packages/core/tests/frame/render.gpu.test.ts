import { expect, test } from "bun:test";
import * as camera from "../../src/camera/index.ts";
import { _frameRenderInternals } from "../../src/frame/render.ts";
import * as gpu from "../../src/gpu/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "_ensureDepthTexture creates a depth texture matching the canvas size",
  async () => {
    const canvas = await makeOffscreenCanvas(640, 480);
    const ctx = await gpu.requestContext(canvas);
    const entry = _frameRenderInternals._ensureDepthTexture(ctx);
    expect(entry.width).toBe(640);
    expect(entry.height).toBe(480);
    expect(entry.view).toBeDefined();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_ensureCameraBuffer is stable across calls and writes viewProjection",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const cam = camera.perspective({});
    const b1 = _frameRenderInternals._ensureCameraBuffer(ctx, cam);
    const b2 = _frameRenderInternals._ensureCameraBuffer(ctx, cam);
    expect(b2).toBe(b1);
    gpu.dispose(ctx);
  },
);
