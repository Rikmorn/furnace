import { expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import { FurnaceError, FurnaceGpuError } from "../../src/gpu/errors.ts";
import * as gpu from "../../src/gpu/index.ts";
import {
  _resolveEffectPipeline,
  type EffectSlot,
} from "../../src/post/effect.ts";
import * as post from "../../src/post/index.ts";
import { _lookupEffect } from "../../src/resources/internal.ts";
import * as shader from "../../src/shader/index.ts";
import * as stats from "../../src/stats/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

const SHADER = `
@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var sceneSamp: sampler;
struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return textureSample(sceneTex, sceneSamp, in.uv);
}`;

test.skipIf(!bunWebGpuAvailable())(
  "post.create registers an effect resource; destroy releases it",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    expect(stats.snapshot(ctx).resources.effects).toBe(0);
    const e = await post.create(ctx, {
      shader: await shader.create(ctx, SHADER),
    });
    expect(stats.snapshot(ctx).resources.effects).toBe(1);
    post.destroy(ctx, e);
    expect(stats.snapshot(ctx).resources.effects).toBe(0);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "two effects with identical shader+format+blend share the cached pipeline",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    // Same shader handle → same pipeline-cache key (the key is the handle).
    const s = await shader.create(ctx, SHADER);
    const a = await post.create(ctx, { shader: s });
    const b = await post.create(ctx, { shader: s });
    const slotA = _lookupEffect<EffectSlot>(ctx, a);
    const slotB = _lookupEffect<EffectSlot>(ctx, b);
    if (slotA === null || slotB === null) {
      throw new Error("unreachable: effects were just created");
    }
    // Pipelines build lazily per target format; resolve both at ctx.format and
    // assert they share one cache entry (same key → same GPURenderPipeline).
    const varA = _resolveEffectPipeline(ctx, slotA, ctx.format);
    const varB = _resolveEffectPipeline(ctx, slotB, ctx.format);
    expect(varA.pipelineKey).toBe(varB.pipelineKey);
    expect(varA.pipeline).toBe(varB.pipeline);
    post.destroy(ctx, a);
    post.destroy(ctx, b);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "post.create on disposed ctx throws FurnaceGpuError",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    // Compile the shader BEFORE disposing so that post.create — not
    // shader.create — is the call that throws on the disposed ctx.
    const s = await shader.create(ctx, SHADER);
    gpu.dispose(ctx);
    await expect(post.create(ctx, { shader: s })).rejects.toThrow(
      FurnaceGpuError,
    );
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "post.create without shader throws FurnaceError",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    // @ts-expect-error deliberately invalid input
    await expect(post.create(ctx, {})).rejects.toThrow(FurnaceError);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "double-destroy is silent (no warn, no throw)",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const e = await post.create(ctx, {
      shader: await shader.create(ctx, SHADER),
    });
    post.destroy(ctx, e);
    const entries: LogEntry[] = [];
    setSink((entry) => entries.push(entry));
    try {
      expect(() => post.destroy(ctx, e)).not.toThrow();
      expect(entries).toHaveLength(0);
    } finally {
      setSink(consoleSink);
    }
    gpu.dispose(ctx);
  },
);
