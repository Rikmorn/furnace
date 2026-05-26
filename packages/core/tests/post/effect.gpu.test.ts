import { beforeEach, expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import { FurnaceError, FurnaceGpuError } from "../../src/gpu/errors.ts";
import * as gpu from "../../src/gpu/index.ts";
import * as post from "../../src/post/index.ts";
import { _pipelineCache } from "../../src/post/pipeline-cache.ts";
import * as stats from "../../src/stats/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

beforeEach(() => {
  _pipelineCache.resetForTests();
});

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
    const e = await post.create(ctx, { shader: SHADER });
    expect(stats.snapshot(ctx).resources.effects).toBe(1);
    post.destroy(e);
    expect(stats.snapshot(ctx).resources.effects).toBe(0);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "two effects with identical shader+format+blend share the cached pipeline",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const a = await post.create(ctx, { shader: SHADER });
    const b = await post.create(ctx, { shader: SHADER });
    expect(a.pipelineKey).toBe(b.pipelineKey);
    expect(a.pipeline).toBe(b.pipeline);
    post.destroy(a);
    post.destroy(b);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "post.create on disposed ctx throws FurnaceGpuError",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    gpu.dispose(ctx);
    await expect(post.create(ctx, { shader: SHADER })).rejects.toThrow(
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
  "double-destroy routes a structured warn entry via log helper",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 64);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const e = await post.create(ctx, { shader: SHADER });
    post.destroy(e);
    const entries: LogEntry[] = [];
    setSink((entry) => entries.push(entry));
    try {
      post.destroy(e);
      expect(entries).toHaveLength(1);
      const entry = entries[0];
      if (!entry) throw new Error("unreachable: entries.length checked above");
      expect(entry.level).toBe("warn");
      expect(entry.module).toBe("post");
      expect(entry.message).toBe("effect already destroyed");
    } finally {
      setSink(consoleSink);
    }
    gpu.dispose(ctx);
  },
);
