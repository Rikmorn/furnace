import { expect, test } from "bun:test";
import type { Context } from "../gpu/context-types.ts";
import { createResourceManager } from "../resources/manager.ts";
import { createStatsState } from "../stats/state.ts";
import { createEmitter } from "./emitter.ts";

function makeMockCtx(): Context {
  return {
    device: null as unknown as GPUDevice,
    queue: null as unknown as GPUQueue,
    format: "bgra8unorm" as GPUTextureFormat,
    canvas: null as unknown as HTMLCanvasElement,
    pixelRatio: 1,
    _internal: {
      disposed: false,
      stats: createStatsState(0),
      resources: createResourceManager(),
      ctxId: 0xffff,
    },
  } as Context;
}

test("createEmitter without ctx/name: untracked (snap.events.perEmitter stays empty)", () => {
  const ctx = makeMockCtx();
  const e = createEmitter<number>();
  e.emit(1);
  e.emit(2);
  expect(ctx._internal.stats.emissions.size).toBe(0);
});

test("createEmitter(ctx, name): emissions are counted under name", () => {
  const ctx = makeMockCtx();
  const e = createEmitter<number>(ctx, "test.emitter");
  e.emit(1);
  e.emit(2);
  e.emit(3);
  expect(ctx._internal.stats.emissions.get("test.emitter")).toBe(3);
});

test("createEmitter(ctx, name): existing subscriber semantics preserved (snapshot iteration + catch)", () => {
  const ctx = makeMockCtx();
  const e = createEmitter<number>(ctx, "x");
  const seen: number[] = [];
  e.on(() => {
    seen.push(1);
    throw new Error("first");
  });
  e.on(() => {
    seen.push(2);
  });
  const origErr = console.error;
  let errCalls = 0;
  console.error = () => {
    errCalls++;
  };
  e.emit(42);
  console.error = origErr;
  expect(seen).toEqual([1, 2]);
  expect(errCalls).toBe(1);
  expect(ctx._internal.stats.emissions.get("x")).toBe(1);
});
