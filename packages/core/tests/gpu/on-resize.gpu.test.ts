import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Context } from "../../src/gpu/context-types.ts";
import { _runDisposeCascade } from "../../src/gpu/dispose-cascade.ts";
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

test("early unsubscribe then dispose cascade is a safe no-op", () => {
  const ctx = fakeCtx();
  let count = 0;
  const unsub = onResize(ctx, () => {
    count++;
  });
  // Last subscriber leaves: observer torn down early, cascade callback deregistered.
  unsub();
  // The later dispose cascade must not throw or double-tear-down.
  expect(() => _runDisposeCascade(ctx)).not.toThrow();
  fireResize(ctx.canvas, 2048, 1536);
  expect(count).toBe(0);
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

test("dispose cascade disconnects the resize observer; later resize is inert", () => {
  const ctx = fakeCtx();
  let count = 0;
  onResize(ctx, () => {
    count++;
  });
  fireResize(ctx.canvas, 1024, 768);
  expect(count).toBe(1);
  expect(ctx.canvas.width).toBe(1024);

  // The resize-teardown step of gpu.dispose.
  _runDisposeCascade(ctx);

  fireResize(ctx.canvas, 2048, 1536);
  expect(count).toBe(1); // listener no longer fires
  expect(ctx.canvas.width).toBe(1024); // canvas not mutated post-dispose
});

test("dispose cascade tears down only the disposed context's resize wiring", () => {
  const ctxA = fakeCtx();
  const ctxB = fakeCtx();
  let aCount = 0;
  let bCount = 0;
  onResize(ctxA, () => {
    aCount++;
  });
  onResize(ctxB, () => {
    bCount++;
  });

  _runDisposeCascade(ctxA);

  fireResize(ctxA.canvas, 1024, 768); // A disconnected
  fireResize(ctxB.canvas, 1024, 768); // B still live
  expect(aCount).toBe(0);
  expect(bCount).toBe(1);
});
