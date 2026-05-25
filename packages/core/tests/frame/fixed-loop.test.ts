import { afterEach, beforeEach, expect, test } from "bun:test";
import { fixedLoop } from "../../src/frame/fixed-loop.ts";
import type { Context } from "../../src/gpu/context-types.ts";
import { createInternalState } from "../../src/gpu/internal.ts";
import { type MockRaf, setupMockRaf } from "../_helpers/mock-raf.ts";

let raf: MockRaf;

function fakeCtx(): Context {
  return {
    device: {} as GPUDevice,
    queue: {} as GPUQueue,
    format: "bgra8unorm" as GPUTextureFormat,
    canvas: {} as HTMLCanvasElement,
    pixelRatio: 1,
    _internal: createInternalState(),
  };
}

beforeEach(() => {
  raf = setupMockRaf();
});

afterEach(() => {
  raf.restore();
});

test("onTick fires at the fixed rate regardless of frame rate", () => {
  const ctx = fakeCtx();
  let ticks = 0;
  fixedLoop(ctx, {
    fixedDtMs: 16,
    onTick: () => {
      ticks++;
    },
  });
  raf.advance(0); // consume first-frame deltaMs=0
  raf.advance(16); // accumulator = 16 → 1 tick
  expect(ticks).toBe(1);
  raf.advance(48); // accumulator += 48 → 3 more ticks
  expect(ticks).toBe(4);
});

test("onTick receives dtSeconds (fixedDtMs / 1000)", () => {
  const ctx = fakeCtx();
  const dts: number[] = [];
  fixedLoop(ctx, {
    fixedDtMs: 20,
    onTick: (dt) => {
      dts.push(dt);
    },
  });
  raf.advance(0);
  raf.advance(20);
  expect(dts[0]).toBeCloseTo(0.02, 5);
});

test("onFrame fires once per RAF with alpha", () => {
  const ctx = fakeCtx();
  const alphas: number[] = [];
  fixedLoop(ctx, {
    fixedDtMs: 100,
    onTick: () => {
      /* no-op */
    },
    onFrame: ({ alpha }) => {
      alphas.push(alpha);
    },
  });
  raf.advance(0); // consume first-frame deltaMs=0 (also pushes alpha=0)
  alphas.length = 0; // drop the prime entry
  raf.advance(50); // accumulator = 50, 0 ticks, alpha = 0.5
  raf.advance(50); // accumulator = 100, 1 tick (accumulator=0), alpha = 0
  expect(alphas[0]).toBeCloseTo(0.5);
  expect(alphas[1]).toBeCloseTo(0);
});

test("maxCatchupTicks caps the inner loop", () => {
  const ctx = fakeCtx();
  let ticks = 0;
  fixedLoop(ctx, {
    fixedDtMs: 10,
    maxCatchupTicks: 3,
    onTick: () => {
      ticks++;
    },
  });
  raf.advance(0);
  raf.advance(50); // would-be 5 ticks, capped to 3
  expect(ticks).toBe(3);
});

test("when maxCatchupTicks hit, accumulator is discarded (no spiral)", () => {
  const ctx = fakeCtx();
  const alphas: number[] = [];
  fixedLoop(ctx, {
    fixedDtMs: 10,
    maxCatchupTicks: 3,
    onTick: () => {
      /* no-op */
    },
    onFrame: ({ alpha }) => {
      alphas.push(alpha);
    },
  });
  raf.advance(0);
  alphas.length = 0;
  raf.advance(50); // 5 wanted, 3 done, accumulator discarded → alpha = 0
  expect(alphas[0]).toBeCloseTo(0);
});

test("when ticks hits cap but no spiral, sub-tick remainder is preserved", () => {
  const ctx = fakeCtx();
  let tickCount = 0;
  const alphas: number[] = [];
  fixedLoop(ctx, {
    fixedDtMs: 10,
    maxCatchupTicks: 3,
    onTick: () => {
      tickCount++;
    },
    onFrame: ({ alpha }) => {
      alphas.push(alpha);
    },
  });
  raf.advance(0);
  tickCount = 0;
  alphas.length = 0;
  // delta=35ms: 3 full ticks consume 30ms; remainder 5ms < fixedDtMs so no
  // spiral. Old guard zeroed it because ticks==maxCatchupTicks; corrected
  // guard preserves it — alpha = 5/10 = 0.5.
  raf.advance(35);
  expect(tickCount).toBe(3);
  expect(alphas[0]).toBeCloseTo(0.5);
});

test("returned handle supports stop/pause/resume", () => {
  const ctx = fakeCtx();
  let ticks = 0;
  const handle = fixedLoop(ctx, {
    fixedDtMs: 16,
    onTick: () => {
      ticks++;
    },
  });
  raf.advance(0);
  raf.advance(16);
  expect(ticks).toBe(1);
  handle.pause();
  raf.advance(64);
  expect(ticks).toBe(1);
  handle.resume();
  raf.advance(16); // after resume, first frame again has deltaMs=0 (loop resets lastFrameTime)
  raf.advance(16);
  expect(ticks).toBe(2);
  handle.stop();
});
