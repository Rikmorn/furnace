import { expect, test } from "bun:test";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../../tests/_helpers/gpu-fixture.ts";
import * as gpu from "../gpu/index.ts";
import * as shader from "./index.ts";

await ensureBunWebGpu();

// The `lit` built-in now composes `fr_applyFog` over the Scene UBO `fog` lane.
// Compiling it proves the renamed `Scene.fog` field + the fog helper are valid
// WGSL (a malformed shader throws at compile in `shader.lit`). `surfaceFormat:
// "linear"` works around the bun-webgpu swapchain view-format mock bug.
test.skipIf(!bunWebGpuAvailable())(
  "lit shader compiles with the fog helper",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 48);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const lit = await shader.lit(ctx);
    expect(lit).toBeTruthy();
    gpu.dispose(ctx);
  },
);
