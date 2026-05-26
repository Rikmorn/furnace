import { afterEach, beforeEach, expect, test } from "bun:test";
import { bindToCanvas, updateForSize } from "../../src/camera/bind.ts";
import { orthographic } from "../../src/camera/orthographic.ts";
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

test("updateForSize on orthographic camera is a no-op (Tranche A scope)", () => {
  const cam = orthographic({ left: -2, right: 2, bottom: -1, top: 1 });
  if (cam.projection.kind !== "orthographic") throw new Error("unreachable");
  const beforeLeft = cam.projection.left;
  const beforeRight = cam.projection.right;
  const beforeBottom = cam.projection.bottom;
  const beforeTop = cam.projection.top;
  cam.projDirty = false;
  updateForSize(cam, { width: 1600, height: 400 });
  expect(cam.projection.left).toBe(beforeLeft);
  expect(cam.projection.right).toBe(beforeRight);
  expect(cam.projection.bottom).toBe(beforeBottom);
  expect(cam.projection.top).toBe(beforeTop);
  expect(cam.projDirty).toBe(false);
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

test("bindToCanvas on orthographic camera applies (no-op) immediately and on resize without throwing", () => {
  // For Tranche A, orthographic dispatch is a no-op. The helper still subscribes,
  // so it remains valid to call — the bound camera just doesn't auto-update.
  // Tranche A-2 will fill in the orthographic dispatch.
  const cam = orthographic({ left: -2, right: 2, bottom: -1, top: 1 });
  if (cam.projection.kind !== "orthographic") throw new Error("unreachable");
  const before = { ...cam.projection };
  const ctx = fakeCtx(800, 600);
  const unsub = bindToCanvas(cam, ctx);
  fireResize(ctx.canvas, 1600, 400);
  expect(cam.projection.left).toBe(before.left);
  expect(cam.projection.right).toBe(before.right);
  expect(cam.projection.bottom).toBe(before.bottom);
  expect(cam.projection.top).toBe(before.top);
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
