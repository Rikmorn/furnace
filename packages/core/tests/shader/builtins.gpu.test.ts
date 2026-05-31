import { expect, test } from "bun:test";
import * as shader from "@furnace/core/shader";
import * as stats from "@furnace/core/stats";
import * as gpu from "../../src/gpu/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

async function createTestContext() {
  const canvas = await makeOffscreenCanvas();
  return gpu.requestContext(canvas, { surfaceFormat: "linear" });
}

test.skipIf(!bunWebGpuAvailable())(
  "internal built-in shaders are shared per ctx",
  async () => {
    const ctx = await createTestContext();
    expect(await shader.unlit(ctx)).toBe(await shader.unlit(ctx));
    expect(await shader.normalColor(ctx)).toBe(await shader.normalColor(ctx));
    expect(stats.snapshot(ctx).resources.shaders).toBe(2); // each compiled once
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "built-ins are engine-owned: public destroy is a no-op",
  async () => {
    const ctx = await createTestContext();
    const a = await shader.normalColor(ctx);
    shader.destroy(ctx, a);
    expect(await shader.normalColor(ctx)).toBe(a); // still live
    expect(stats.snapshot(ctx).resources.shaders).toBe(1);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "built-in shader cache is per-ctx, not module-scope",
  async () => {
    const ctx1 = await createTestContext();
    const ctx2 = await createTestContext();
    // Each ctx compiles its own copy — handles encode their ctx id, so they differ.
    expect(await shader.unlit(ctx1)).not.toBe(await shader.unlit(ctx2));
    expect(stats.snapshot(ctx1).resources.shaders).toBe(1);
    expect(stats.snapshot(ctx2).resources.shaders).toBe(1);
    gpu.dispose(ctx1);
    gpu.dispose(ctx2);
  },
);
