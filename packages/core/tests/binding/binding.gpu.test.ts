import { expect, test } from "bun:test";
import { _isDirty, _scratchOf } from "../../src/binding/binding.ts";
import * as binding from "../../src/binding/index.ts";
import { _flushDirtyBindings } from "../../src/binding/internal.ts";
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

test.skipIf(!bunWebGpuAvailable())(
  "set/setUniform write scratch; flush is lazy (no GPU write until render boundary)",
  async () => {
    const ctx = await createTestContext();
    const s = await shader.create(
      ctx,
      "@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4(0.0); }",
      { layout: { stripes: "f32", hue: "f32", softness: "f32" } },
    );
    const b = binding.create(ctx, s);
    binding.set(ctx, b, { stripes: 4, hue: 0.5 });
    binding.setUniform(ctx, b, "softness", 0.1);
    const scratch = _scratchOf(ctx, b);
    expect(scratch).not.toBeNull();
    const view = new Float32Array(scratch as ArrayBuffer);
    // stripes @ offset 0 → element index 0
    expect(view[0]).toBe(4);
    // hue @ offset 4 → element index 1
    expect(view[1]).toBeCloseTo(0.5);
    // softness @ offset 8 → element index 2
    expect(view[2]).toBeCloseTo(0.1);
    // dirty flag set before flush
    expect(_isDirty(ctx, b)).toBe(true);
    // flush simulates what frame.render does
    _flushDirtyBindings(ctx);
    // dirty flag cleared after flush
    expect(_isDirty(ctx, b)).toBe(false);
    binding.destroy(ctx, b);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "setUniform on a destroyed binding is a silent no-op (runtime-quiet)",
  async () => {
    const ctx = await createTestContext();
    const b = binding.create(ctx, { layout: { color: "vec4f" } });
    binding.destroy(ctx, b);
    expect(() =>
      binding.setUniform(ctx, b, "color", [1, 0, 0, 1]),
    ).not.toThrow();
    gpu.dispose(ctx);
  },
);
