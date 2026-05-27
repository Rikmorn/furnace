import { expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import * as gpu from "../../src/gpu/index.ts";
import { _ensureSceneIntermediates } from "../../src/post/intermediate.ts";
import * as stats from "../../src/stats/index.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

test.skipIf(!bunWebGpuAvailable())(
  "_ensureSceneIntermediates allocates two textures lazily on first call",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 32);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const before = stats.snapshot(ctx).memory.textureBytes;
    const im = _ensureSceneIntermediates(ctx);
    expect(im.aView).toBeDefined();
    expect(im.bView).toBeDefined();
    expect(im.sampler).toBeDefined();
    const after = stats.snapshot(ctx).memory.textureBytes;
    // Each color intermediate is width*height*4 bytes; we added 2.
    expect(after - before).toBe(64 * 32 * 4 * 2);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "_ensureSceneIntermediates returns the same handles on repeat calls",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 32);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    const im1 = _ensureSceneIntermediates(ctx);
    const im2 = _ensureSceneIntermediates(ctx);
    expect(im2).toBe(im1);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "canvas resize replaces intermediates and updates textureBytes",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 32);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    _ensureSceneIntermediates(ctx);
    // Mutate the canvas dimensions to simulate resize.
    (ctx.canvas as unknown as { width: number }).width = 128;
    (ctx.canvas as unknown as { height: number }).height = 64;
    const im2 = _ensureSceneIntermediates(ctx);
    expect(im2.width).toBe(128);
    expect(im2.height).toBe(64);
    const bytes = stats.snapshot(ctx).memory.textureBytes;
    expect(bytes).toBe(128 * 64 * 4 * 2);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "dispose with intermediates allocated does not warn (self-registered teardown)",
  async () => {
    const canvas = await makeOffscreenCanvas(64, 32);
    const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
    _ensureSceneIntermediates(ctx);
    const entries: LogEntry[] = [];
    setSink((entry) => entries.push(entry));
    try {
      gpu.dispose(ctx);
    } finally {
      setSink(consoleSink);
    }
    expect(entries.length).toBe(0);
  },
);
