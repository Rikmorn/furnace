import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import { setupMockRaf } from "../../tests/_helpers/mock-raf.ts";
import * as gpu from "../gpu/index.ts";
import { loop } from "./loop.ts";

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
