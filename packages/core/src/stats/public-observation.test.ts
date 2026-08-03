import { expect, test } from "bun:test";
import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/context-types.ts";
import { createResourceManager } from "../resources/manager.ts";
import { _frameEnd, _frameStart } from "./internal.ts";
import { get, onFrame, snapshot } from "./public.ts";
import { createStatsState } from "./state.ts";

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

test("snapshot: live ctx returns a populated snapshot", () => {
  const ctx = makeMockCtx();
  ctx._internal.stats.drawCalls = 7;
  const s = snapshot(ctx);
  expect(s.gpu.drawCalls).toBe(7);
});

test("snapshot on disposed ctx: returns ZERO_SNAPSHOT", () => {
  const ctx = makeMockCtx(true);
  ctx._internal.stats.drawCalls = 7;
  const s = snapshot(ctx);
  expect(s.gpu.drawCalls).toBe(0);
});

test("get: built-in path returns typed value", () => {
  const ctx = makeMockCtx();
  ctx._internal.stats.drawCalls = 3;
  expect(get(ctx, "gpu.drawCalls")).toBe(3);
});

test("get: unregistered custom path returns null", () => {
  const ctx = makeMockCtx();
  expect(get(ctx, "custom.notRegistered")).toBeNull();
});

test("get: registered custom path returns its value", () => {
  const ctx = makeMockCtx();
  ctx._internal.stats.gauges.set("npcCount", 42);
  expect(get(ctx, "custom.npcCount")).toBe(42);
});

test("get on disposed ctx: returns null for any path", () => {
  const ctx = makeMockCtx(true);
  expect(get(ctx, "frame.fps")).toBeNull();
  expect(get(ctx, "gpu.drawCalls")).toBeNull();
});

test("onFrame: subscriber fires on _frameEnd with current snapshot", () => {
  const ctx = makeMockCtx();
  const seen: number[] = [];
  const unsub = onFrame(ctx, (s) => seen.push(s.gpu.drawCalls));
  ctx._internal.stats.drawCalls = 5;
  _frameStart(ctx);
  _frameEnd(ctx);
  expect(seen.length).toBe(1);
  unsub();
  _frameStart(ctx);
  _frameEnd(ctx);
  expect(seen.length).toBe(1);
});

test("onFrame: throws on disposed ctx", () => {
  const ctx = makeMockCtx(true);
  expect(() => onFrame(ctx, () => undefined)).toThrow(FurnaceError);
  expect(() => onFrame(ctx, () => undefined)).toThrow(/disposed/);
});
