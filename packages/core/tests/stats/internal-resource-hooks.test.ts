import { expect, test } from "bun:test";
import type { Context } from "../../src/gpu/context-types.ts";
import { createResourceManager } from "../../src/resources/manager.ts";
import {
  _recordAlloc,
  _recordDestroy,
  _recordEmission,
  _recordUncapturedError,
} from "../../src/stats/internal.ts";
import { createStatsState } from "../../src/stats/state.ts";

function makeMockCtx(disposed = false): Context {
  return {
    device: null as unknown as GPUDevice,
    queue: null as unknown as GPUQueue,
    format: "bgra8unorm" as GPUTextureFormat,
    canvas: null as unknown as HTMLCanvasElement,
    pixelRatio: 1,
    _internal: {
      disposed,
      stats: createStatsState(0),
      resources: createResourceManager(),
      ctxId: 0xffff,
    },
  } as Context;
}

test("_recordEmission: increments per-emitter counter", () => {
  const ctx = makeMockCtx();
  _recordEmission(ctx, "gpu.onResize");
  _recordEmission(ctx, "gpu.onResize");
  _recordEmission(ctx, "input.onKeyDown");
  expect(ctx._internal.stats.emissions.get("gpu.onResize")).toBe(2);
  expect(ctx._internal.stats.emissions.get("input.onKeyDown")).toBe(1);
});

test("_recordEmission on disposed ctx: silent no-op", () => {
  const ctx = makeMockCtx(true);
  _recordEmission(ctx, "x");
  expect(ctx._internal.stats.emissions.size).toBe(0);
});

test("_recordUncapturedError: increments cumulative counter; never resets at _frameStart", () => {
  const ctx = makeMockCtx();
  _recordUncapturedError(ctx);
  _recordUncapturedError(ctx);
  expect(ctx._internal.stats.uncapturedErrors).toBe(2);
});

test("_recordUncapturedError on disposed ctx: silent no-op", () => {
  const ctx = makeMockCtx(true);
  _recordUncapturedError(ctx);
  expect(ctx._internal.stats.uncapturedErrors).toBe(0);
});

test("_recordAlloc: mesh kind increments count, ignores bytes", () => {
  const ctx = makeMockCtx();
  _recordAlloc(ctx, "mesh", 0);
  expect(ctx._internal.stats.resources.counts.meshes).toBe(1);
  _recordAlloc(ctx, "mesh", 0);
  expect(ctx._internal.stats.resources.counts.meshes).toBe(2);
});

test("_recordAlloc: buffer kind adds bytes to memory.bufferBytes", () => {
  const ctx = makeMockCtx();
  _recordAlloc(ctx, "buffer", 256);
  expect(ctx._internal.stats.resources.memory.bufferBytes).toBe(256);
  _recordAlloc(ctx, "buffer", 64);
  expect(ctx._internal.stats.resources.memory.bufferBytes).toBe(320);
});

test("_recordAlloc: texture kind adds bytes to memory.textureBytes", () => {
  const ctx = makeMockCtx();
  _recordAlloc(ctx, "texture", 1024);
  expect(ctx._internal.stats.resources.memory.textureBytes).toBe(1024);
});

test("_recordDestroy: symmetric to _recordAlloc", () => {
  const ctx = makeMockCtx();
  _recordAlloc(ctx, "material", 0);
  _recordAlloc(ctx, "buffer", 128);
  _recordDestroy(ctx, "material", 0);
  _recordDestroy(ctx, "buffer", 128);
  expect(ctx._internal.stats.resources.counts.materials).toBe(0);
  expect(ctx._internal.stats.resources.memory.bufferBytes).toBe(0);
});

test("_recordAlloc on disposed ctx: silent no-op", () => {
  const ctx = makeMockCtx(true);
  _recordAlloc(ctx, "mesh", 0);
  _recordAlloc(ctx, "buffer", 256);
  expect(ctx._internal.stats.resources.counts.meshes).toBe(0);
  expect(ctx._internal.stats.resources.memory.bufferBytes).toBe(0);
});

test("_recordDestroy on disposed ctx: silent no-op", () => {
  const ctx = makeMockCtx();
  _recordAlloc(ctx, "mesh", 0);
  ctx._internal.disposed = true;
  _recordDestroy(ctx, "mesh", 0);
  // Count stays at 1 because destroy was no-op'd
  expect(ctx._internal.stats.resources.counts.meshes).toBe(1);
});
