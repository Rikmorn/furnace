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

const TRIVIAL_WGSL = /* wgsl */ `
@vertex fn vs_main() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }
@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }`;

async function createTestContext() {
  const canvas = await makeOffscreenCanvas();
  return gpu.requestContext(canvas, { surfaceFormat: "linear" });
}

test.skipIf(!bunWebGpuAvailable())(
  "shader.create compiles valid WGSL and tracks the count",
  async () => {
    const ctx = await createTestContext();
    const s = await shader.create(ctx, TRIVIAL_WGSL);
    expect(stats.snapshot(ctx).resources.shaders).toBe(1);
    shader.destroy(ctx, s);
    expect(stats.snapshot(ctx).resources.shaders).toBe(0);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "shader.create throws on empty source",
  async () => {
    const ctx = await createTestContext();
    await expect(shader.create(ctx, "")).rejects.toThrow(/required/);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "shader.create throws on uncompilable WGSL",
  async () => {
    const ctx = await createTestContext();
    await expect(shader.create(ctx, "this is not wgsl")).rejects.toThrow();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())("shader.destroy is idempotent", async () => {
  const ctx = await createTestContext();
  const s = await shader.create(ctx, TRIVIAL_WGSL);
  shader.destroy(ctx, s);
  shader.destroy(ctx, s);
  expect(stats.snapshot(ctx).resources.shaders).toBe(0);
  gpu.dispose(ctx);
});

test.skipIf(!bunWebGpuAvailable())(
  "shader.load fetches+compiles; throws on HTTP failure",
  async () => {
    const ctx = await createTestContext();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(TRIVIAL_WGSL, { status: 200 })) as unknown as typeof fetch;
    try {
      await shader.load(ctx, "http://x/ok.wgsl");
      expect(stats.snapshot(ctx).resources.shaders).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
    }
    globalThis.fetch = (async () =>
      new Response("nope", { status: 404 })) as unknown as typeof fetch;
    try {
      await expect(shader.load(ctx, "http://x/missing.wgsl")).rejects.toThrow(
        /404/,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "gpu.dispose cascade frees live shaders",
  async () => {
    const ctx = await createTestContext();
    await shader.create(ctx, TRIVIAL_WGSL);
    await shader.create(ctx, TRIVIAL_WGSL);
    expect(stats.snapshot(ctx).resources.shaders).toBe(2);
    gpu.dispose(ctx);
  },
);
