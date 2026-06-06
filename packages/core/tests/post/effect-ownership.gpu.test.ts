import { expect, test } from "bun:test";
import * as binding from "../../src/binding/index.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as post from "../../src/post/index.ts";
import { _countLive } from "../../src/resources/internal.ts";
import * as shader from "../../src/shader/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "post.destroy on a built-in tonemap frees its internal binding (no churn growth)",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      surfaceFormat: "linear",
      hdr: true,
    });
    const base = _countLive(ctx, "binding");
    for (let i = 0; i < 5; i++) {
      const tm = await post.tonemap(ctx);
      post.destroy(ctx, tm);
    }
    expect(_countLive(ctx, "binding")).toBe(base); // each destroy reclaimed its binding
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "post.destroy on bloom frees its internal params binding",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      surfaceFormat: "linear",
      hdr: true,
    });
    const base = _countLive(ctx, "binding");
    const b = await post.bloom(ctx, { intensity: 0.5 });
    expect(_countLive(ctx, "binding")).toBeGreaterThan(base); // bloom allocated its params binding
    post.destroy(ctx, b);
    expect(_countLive(ctx, "binding")).toBe(base); // destroy reclaimed it
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "post.create does NOT free a consumer-supplied binding on destroy",
  async () => {
    const ctx = await gpu.requestContext(await makeOffscreenCanvas(64, 64), {
      surfaceFormat: "linear",
    });
    const sh = await shader.create(
      ctx,
      /* wgsl */ `
      struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };
      struct P { tint: f32 };
      @group(0) @binding(0) var t: texture_2d<f32>;
      @group(0) @binding(1) var s: sampler;
      @group(1) @binding(0) var<uniform> p: P;
      @fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> { return textureSample(t, s, in.uv) * p.tint; }
    `,
      { layout: { tint: "f32" } },
    );
    const b = binding.create(ctx, sh);
    binding.set(ctx, b, { tint: 1 });
    const fx = await post.create(ctx, { shader: sh, binding: b });
    const before = _countLive(ctx, "binding");
    post.destroy(ctx, fx);
    expect(_countLive(ctx, "binding")).toBe(before); // consumer binding NOT freed by post.destroy
    binding.destroy(ctx, b); // consumer frees it
    gpu.dispose(ctx);
  },
);
