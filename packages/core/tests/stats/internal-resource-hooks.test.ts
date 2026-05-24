import { expect, test } from "bun:test";
import type { Context } from "../../src/gpu/context-types.ts";
import {
  _recordEmission,
  _recordUncapturedError,
  _registerResource,
  _unregisterResource,
} from "../../src/stats/internal.ts";
import { createStatsState } from "../../src/stats/state.ts";

function makeMockCtx(disposed = false): Context {
  return {
    device: null as unknown as GPUDevice,
    queue: null as unknown as GPUQueue,
    format: "bgra8unorm" as GPUTextureFormat,
    canvas: null as unknown as HTMLCanvasElement,
    pixelRatio: 1,
    _internal: { disposed, stats: createStatsState(0) },
  } as Context;
}

test("_registerResource / _unregisterResource: mesh kind", () => {
  const ctx = makeMockCtx();
  const handle = _registerResource(ctx, { kind: "mesh" });
  expect(ctx._internal.stats.resources.counts.meshes).toBe(1);
  _unregisterResource(ctx, handle);
  expect(ctx._internal.stats.resources.counts.meshes).toBe(0);
});

test("_registerResource: buffer kind tracks bytes", () => {
  const ctx = makeMockCtx();
  _registerResource(ctx, { kind: "buffer", bytes: 256 });
  expect(ctx._internal.stats.resources.memory.bufferBytes).toBe(256);
});

test("_registerResource on disposed ctx: returns a no-op handle (does not register)", () => {
  const ctx = makeMockCtx(true);
  const handle = _registerResource(ctx, { kind: "buffer", bytes: 512 });
  expect(ctx._internal.stats.resources.memory.bufferBytes).toBe(0);
  expect(ctx._internal.stats.resources.entries.size).toBe(0);
  _unregisterResource(ctx, handle);
  expect(ctx._internal.stats.resources.memory.bufferBytes).toBe(0);
});

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
