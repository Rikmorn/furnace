import { expect, test } from "bun:test";
import { loop } from "../../src/frame/loop.ts";
import * as gpu from "../../src/gpu/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";
import { setupMockRaf } from "../_helpers/mock-raf.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "frame.loop: invokes stats._frameStart/_frameEnd around onFrame",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const raf = setupMockRaf();
    try {
      let onFrameRan = false;
      const handle = loop(ctx, () => {
        onFrameRan = true;
      });
      raf.advance(16);
      raf.advance(16);
      handle.stop();
      expect(onFrameRan).toBe(true);
      expect(ctx._internal.stats.window.filled).toBeGreaterThan(0);
    } finally {
      raf.restore();
    }
    gpu.dispose(ctx);
  },
);
