import { expect, test } from "bun:test";
import type { Context } from "../../src/gpu/context-types.ts";
import { createResourceManager } from "../../src/resources/manager.ts";
import {
  markFrameBoundary,
  onFrame,
  recordDraw,
} from "../../src/stats/public.ts";
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

test("recordDraw: increments drawCalls + triangles", () => {
  const ctx = makeMockCtx();
  recordDraw(ctx, { triangles: 5 });
  expect(ctx._internal.stats.drawCalls).toBe(1);
  expect(ctx._internal.stats.triangles).toBe(5);
});

test("recordDraw on disposed ctx: silent no-op", () => {
  const ctx = makeMockCtx(true);
  recordDraw(ctx, { triangles: 5 });
  expect(ctx._internal.stats.drawCalls).toBe(0);
});

test("markFrameBoundary: fires subscribers with snapshot + resets per-frame counters", () => {
  const ctx = makeMockCtx();
  ctx._internal.stats.drawCalls = 3;
  ctx._internal.stats.triangles = 99;
  const seen: number[] = [];
  onFrame(ctx, (s) => seen.push(s.gpu.drawCalls));
  // First boundary: starts the frame (no subscriber fire yet since frameStartTime was null)
  // Implementation calls _frameEnd then _frameStart so subscribers fire with the prior frame's snapshot.
  markFrameBoundary(ctx);
  // Counters should be reset for the new frame.
  expect(ctx._internal.stats.drawCalls).toBe(0);
  expect(ctx._internal.stats.triangles).toBe(0);
});

test("markFrameBoundary on disposed ctx: silent no-op", () => {
  const ctx = makeMockCtx(true);
  let fired = false;
  ctx._internal.stats.onFrameSubscribers.add(() => {
    fired = true;
  });
  markFrameBoundary(ctx);
  expect(fired).toBe(false);
});
