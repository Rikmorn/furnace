import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import * as shader from "../../src/shader/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "instanced built-in shaders compile and report instanced:true",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const li = await shader.litInstanced(ctx);
    const ui = await shader.unlitInstanced(ctx);
    expect(li).toBeDefined();
    expect(ui).toBeDefined();
    expect(shader._instancedOf(ctx, li)).toBe(true);
    expect(shader._instancedOf(ctx, ui)).toBe(true);
    const plain = await shader.lit(ctx);
    expect(shader._instancedOf(ctx, plain)).toBe(false);
    gpu.dispose(ctx);
  },
);
