import { expect, test } from "bun:test";
import * as binding from "../../src/binding/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as shader from "../../src/shader/index.ts";
import * as stats from "../../src/stats/index.ts";
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
  "binding.create from a shader tracks the count and destroy decrements it",
  async () => {
    const ctx = await createTestContext();
    const s = await shader.create(
      ctx,
      "@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4(0.0); }",
      { layout: { stripes: "f32", hue: "f32", softness: "f32" } },
    );
    const before = stats.snapshot(ctx).resources.bindings;
    const b = binding.create(ctx, s);
    expect(stats.snapshot(ctx).resources.bindings).toBe(before + 1);
    binding.destroy(ctx, b);
    expect(stats.snapshot(ctx).resources.bindings).toBe(before);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "binding.create from opts { layout } returns a defined handle and destroy works",
  async () => {
    const ctx = await createTestContext();
    const b = binding.create(ctx, { layout: { color: "vec4f" } });
    expect(b).toBeDefined();
    binding.destroy(ctx, b);
    expect(stats.snapshot(ctx).resources.bindings).toBe(0);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "binding.create from a shader with no layout throws (setup-loud)",
  async () => {
    const ctx = await createTestContext();
    const nc = await shader.normalColor(ctx);
    expect(() => binding.create(ctx, nc)).toThrow();
    gpu.dispose(ctx);
  },
);
