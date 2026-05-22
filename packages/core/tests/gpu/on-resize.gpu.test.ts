import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Context } from "../../src/gpu/context-types.ts";
import { createInternalState } from "../../src/gpu/internal.ts";
import { onResize } from "../../src/gpu/resize.ts";
import {
  fireResize,
  installMockResizeObserver,
} from "../_helpers/mock-resize-observer.ts";

let restoreObserver: () => void;

beforeEach(() => {
  restoreObserver = installMockResizeObserver();
});

afterEach(() => {
  restoreObserver();
});

function fakeCtx(): Context {
  const canvas = {
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
  } as HTMLCanvasElement;
  return {
    device: {} as GPUDevice,
    queue: {} as GPUQueue,
    format: "bgra8unorm" as GPUTextureFormat,
    canvas,
    pixelRatio: 1,
    _internal: createInternalState(),
  };
}

test("onResize fires when ResizeObserver reports a size change", () => {
  const ctx = fakeCtx();
  const events: { width: number; height: number }[] = [];
  onResize(ctx, (e) => {
    events.push({ width: e.width, height: e.height });
  });
  fireResize(ctx.canvas, 1024, 768);
  expect(events).toEqual([{ width: 1024, height: 768 }]);
});

test("onResize updates canvas backing-store dimensions", () => {
  const ctx = fakeCtx();
  onResize(ctx, () => {
    /* no-op */
  });
  fireResize(ctx.canvas, 1024, 768);
  expect(ctx.canvas.width).toBe(1024);
  expect(ctx.canvas.height).toBe(768);
});

test("unsubscribe removes the listener; observer disconnects when zero listeners", () => {
  const ctx = fakeCtx();
  let count = 0;
  const unsub = onResize(ctx, () => {
    count++;
  });
  fireResize(ctx.canvas, 1024, 768);
  unsub();
  fireResize(ctx.canvas, 2048, 1024);
  expect(count).toBe(1);
});

test("onResize throws on disposed context", () => {
  const ctx = fakeCtx();
  ctx._internal.disposed = true;
  expect(() =>
    onResize(ctx, () => {
      /* no-op */
    }),
  ).toThrow(/disposed/);
});
