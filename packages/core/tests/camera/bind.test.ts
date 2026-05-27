import { afterEach, beforeEach, expect, test } from "bun:test";
import { bindToCanvas, updateForSize } from "../../src/camera/bind.ts";
import { policy } from "../../src/camera/fit-policy.ts";
import { getBounds, orthographic } from "../../src/camera/orthographic.ts";
import { perspective } from "../../src/camera/perspective.ts";
import type { Camera } from "../../src/camera/types.ts";
import type { Context } from "../../src/gpu/context-types.ts";
import { createInternalState } from "../../src/gpu/internal.ts";
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

function fakeCtx(width = 800, height = 600): Context {
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
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

// --- updateForSize -------------------------------------------------------

test("updateForSize on perspective camera updates aspect", () => {
  const cam = perspective({ aspect: 1 });
  if (cam.projection.kind !== "perspective") throw new Error("unreachable");
  expect(cam.projection.aspect).toBe(1);
  updateForSize(cam, { width: 1600, height: 800 });
  expect(cam.projection.aspect).toBe(2);
  expect(cam.projDirty).toBe(true);
});

test("updateForSize: orthographic stretch preserves bounds literally", () => {
  const cam = orthographic({
    fitPolicy: policy.stretch({ left: -2, right: 2, bottom: -1, top: 1 }),
  });
  if (cam.projection.kind !== "orthographic") throw new Error("unreachable");
  updateForSize(cam, { width: 1600, height: 400 });
  expect(cam.projection.left).toBe(-2);
  expect(cam.projection.right).toBe(2);
  expect(cam.projection.bottom).toBe(-1);
  expect(cam.projection.top).toBe(1);
  expect(cam.projDirty).toBe(true);
});

test("updateForSize: orthographic preserve-height derives bounds from canvas aspect", () => {
  const cam = orthographic({ fitPolicy: policy.preserveHeight(2) });
  updateForSize(cam, { width: 1600, height: 900 });
  const b = getBounds(cam);
  expect(b.top).toBeCloseTo(1);
  expect(b.bottom).toBeCloseTo(-1);
  expect(b.right).toBeCloseTo(16 / 9);
  expect(b.left).toBeCloseTo(-16 / 9);
});

test("updateForSize: orthographic preserve-height with bottom-left anchor", () => {
  const cam = orthographic({
    fitPolicy: policy.preserveHeight(2, { x: 0, y: 0 }),
  });
  updateForSize(cam, { width: 200, height: 100 });
  const b = getBounds(cam);
  expect(b.left).toBe(0);
  expect(b.right).toBe(4);
  expect(b.bottom).toBe(0);
  expect(b.top).toBe(2);
});

test("updateForSize: orthographic preserve-width mirrors preserve-height", () => {
  const cam = orthographic({ fitPolicy: policy.preserveWidth(4) });
  updateForSize(cam, { width: 200, height: 100 });
  const b = getBounds(cam);
  expect(b.left).toBeCloseTo(-2);
  expect(b.right).toBeCloseTo(2);
  expect(b.bottom).toBeCloseTo(-1);
  expect(b.top).toBeCloseTo(1);
});

test("updateForSize updates cam._lastSize", () => {
  const cam = orthographic({ fitPolicy: policy.preserveHeight(2) });
  updateForSize(cam, { width: 800, height: 600 });
  expect(cam._lastSize).toEqual({ width: 800, height: 600 });
});

test("updateForSize throws on non-finite width", () => {
  const cam = perspective({ aspect: 1 });
  expect(() => updateForSize(cam, { width: Number.NaN, height: 600 })).toThrow(
    /finite/,
  );
});

test("updateForSize throws on zero height", () => {
  const cam = perspective({ aspect: 1 });
  expect(() => updateForSize(cam, { width: 800, height: 0 })).toThrow(
    /positive/,
  );
});

test("updateForSize throws on negative width", () => {
  const cam = perspective({ aspect: 1 });
  expect(() => updateForSize(cam, { width: -100, height: 600 })).toThrow(
    /positive/,
  );
});

test("updateForSize throws on null camera", () => {
  expect(() =>
    updateForSize(null as unknown as Camera, { width: 800, height: 600 }),
  ).toThrow(/null/);
});

// --- bindToCanvas --------------------------------------------------------

test("bindToCanvas applies updateForSize once immediately on call", () => {
  const cam = perspective({ aspect: 1 });
  if (cam.projection.kind !== "perspective") throw new Error("unreachable");
  const ctx = fakeCtx(1600, 800);
  expect(cam.projection.aspect).toBe(1);
  const unsub = bindToCanvas(cam, ctx);
  expect(cam.projection.aspect).toBe(2);
  unsub();
});

test("bindToCanvas updates aspect on subsequent resize events", () => {
  const cam = perspective({ aspect: 1 });
  if (cam.projection.kind !== "perspective") throw new Error("unreachable");
  const ctx = fakeCtx(800, 600);
  const unsub = bindToCanvas(cam, ctx);
  fireResize(ctx.canvas, 1200, 300);
  expect(cam.projection.aspect).toBe(4);
  unsub();
});

test("bindToCanvas unsubscribe stops further updates", () => {
  const cam = perspective({ aspect: 1 });
  if (cam.projection.kind !== "perspective") throw new Error("unreachable");
  const ctx = fakeCtx(800, 600);
  const unsub = bindToCanvas(cam, ctx);
  unsub();
  fireResize(ctx.canvas, 1600, 400);
  // aspect stays at the value applied on bind (800/600 = 4/3)
  expect(cam.projection.aspect).toBeCloseTo(800 / 600);
});

test("bindToCanvas unsubscribe is idempotent", () => {
  const cam = perspective({ aspect: 1 });
  const ctx = fakeCtx(800, 600);
  const unsub = bindToCanvas(cam, ctx);
  unsub();
  expect(() => unsub()).not.toThrow();
});

test("bindToCanvas throws on disposed context", () => {
  const cam = perspective({ aspect: 1 });
  const ctx = fakeCtx();
  ctx._internal.disposed = true;
  expect(() => bindToCanvas(cam, ctx)).toThrow(/disposed/);
});

test("bindToCanvas: orthographic preserve-height updates bounds on bind and on resize", () => {
  const cam = orthographic({ fitPolicy: policy.preserveHeight(2) });
  if (cam.projection.kind !== "orthographic") throw new Error("unreachable");
  const ctx = fakeCtx(800, 600);
  const unsub = bindToCanvas(cam, ctx);
  expect(cam.projection.top).toBeCloseTo(1);
  expect(cam.projection.right).toBeCloseTo(4 / 3);
  fireResize(ctx.canvas, 1600, 400);
  expect(cam.projection.right).toBeCloseTo(4);
  expect(cam.projection.top).toBeCloseTo(1);
  unsub();
});

test("bindToCanvas: orthographic stretch ignores resize aspect", () => {
  const cam = orthographic({
    fitPolicy: policy.stretch({ left: -2, right: 2, bottom: -1, top: 1 }),
  });
  if (cam.projection.kind !== "orthographic") throw new Error("unreachable");
  const ctx = fakeCtx(800, 600);
  const unsub = bindToCanvas(cam, ctx);
  fireResize(ctx.canvas, 1600, 400);
  expect(cam.projection.left).toBe(-2);
  expect(cam.projection.right).toBe(2);
  expect(cam.projection.bottom).toBe(-1);
  expect(cam.projection.top).toBe(1);
  unsub();
});

test("bindToCanvas throws on null camera", () => {
  const ctx = fakeCtx();
  expect(() => bindToCanvas(null as unknown as Camera, ctx)).toThrow(/null/);
});

test("bindToCanvas throws on null context", () => {
  const cam = perspective({ aspect: 1 });
  expect(() => bindToCanvas(cam, null as unknown as Context)).toThrow(/null/);
});
