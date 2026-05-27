import { afterEach, beforeEach, expect, test } from "bun:test";
import { loop } from "../../src/frame/loop.ts";
import type { Context } from "../../src/gpu/context-types.ts";
import { createInternalState } from "../../src/gpu/internal.ts";
import { type MockRaf, setupMockRaf } from "../_helpers/mock-raf.ts";

let raf: MockRaf;

function fakeCtx(): Context {
  // Cast — we only need the _internal field for disposal checks in these tests.
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

test("loop fires the callback once per advance", () => {
  const ctx = fakeCtx();
  let calls = 0;
  loop(ctx, () => {
    calls++;
  });
  raf.advance(16);
  expect(calls).toBe(1);
  raf.advance(16);
  expect(calls).toBe(2);
});

test("loop reports deltaMs based on virtual clock", () => {
  const ctx = fakeCtx();
  const deltas: number[] = [];
  loop(ctx, ({ deltaMs }) => {
    deltas.push(deltaMs);
  });
  raf.advance(16);
  raf.advance(20);
  expect(deltas).toEqual([0, 20]); // first frame has no prior reference → 0
});

test("loop caps deltaMs to maxDeltaMs (default 100)", () => {
  const ctx = fakeCtx();
  const deltas: number[] = [];
  loop(ctx, ({ deltaMs }) => {
    deltas.push(deltaMs);
  });
  raf.advance(16);
  raf.advance(500); // huge jump — should cap
  expect(deltas[1]).toBe(100);
});

test("custom maxDeltaMs is respected", () => {
  const ctx = fakeCtx();
  const deltas: number[] = [];
  loop(
    ctx,
    ({ deltaMs }) => {
      deltas.push(deltaMs);
    },
    { maxDeltaMs: 50 },
  );
  raf.advance(16);
  raf.advance(500);
  expect(deltas[1]).toBe(50);
});

test("stop() halts further callbacks", () => {
  const ctx = fakeCtx();
  let calls = 0;
  const handle = loop(ctx, () => {
    calls++;
  });
  raf.advance(16);
  handle.stop();
  raf.advance(16);
  raf.advance(16);
  expect(calls).toBe(1);
});

test("pause()/resume() halts and restarts", () => {
  const ctx = fakeCtx();
  let calls = 0;
  const handle = loop(ctx, () => {
    calls++;
  });
  raf.advance(16);
  handle.pause();
  raf.advance(16);
  raf.advance(16);
  expect(calls).toBe(1);
  handle.resume();
  raf.advance(16);
  expect(calls).toBe(2);
});

test("auto-pauses on document.visibilitychange when hidden (default)", () => {
  const ctx = fakeCtx();
  let calls = 0;
  loop(ctx, () => {
    calls++;
  });
  raf.advance(16);
  raf.setHidden(true);
  raf.advance(16);
  expect(calls).toBe(1);
  raf.setHidden(false);
  raf.advance(16);
  expect(calls).toBe(2);
});

test("pauseOnHidden: false disables auto-pause", () => {
  const ctx = fakeCtx();
  let calls = 0;
  loop(
    ctx,
    () => {
      calls++;
    },
    { pauseOnHidden: false },
  );
  raf.advance(16);
  raf.setHidden(true);
  raf.advance(16);
  expect(calls).toBe(2);
});

test("throws when called with a disposed context", () => {
  const ctx = fakeCtx();
  ctx._internal.disposed = true;
  expect(() =>
    loop(ctx, () => {
      /* no-op */
    }),
  ).toThrow(/disposed/);
});

test("loop throws when maxDeltaMs is zero", () => {
  const ctx = fakeCtx();
  expect(() =>
    loop(
      ctx,
      () => {
        /* no-op */
      },
      { maxDeltaMs: 0 },
    ),
  ).toThrow("maxDeltaMs must be a positive finite number");
});

test("loop throws when maxDeltaMs is negative", () => {
  const ctx = fakeCtx();
  expect(() =>
    loop(
      ctx,
      () => {
        /* no-op */
      },
      { maxDeltaMs: -16 },
    ),
  ).toThrow("maxDeltaMs must be a positive finite number");
});

test("loop throws when maxDeltaMs is NaN", () => {
  const ctx = fakeCtx();
  expect(() =>
    loop(
      ctx,
      () => {
        /* no-op */
      },
      { maxDeltaMs: Number.NaN },
    ),
  ).toThrow("maxDeltaMs must be a positive finite number");
});

test("loop throws when maxDeltaMs is Infinity", () => {
  const ctx = fakeCtx();
  expect(() =>
    loop(
      ctx,
      () => {
        /* no-op */
      },
      { maxDeltaMs: Number.POSITIVE_INFINITY },
    ),
  ).toThrow("maxDeltaMs must be a positive finite number");
});

test("loop accepts undefined maxDeltaMs (uses default)", () => {
  const ctx = fakeCtx();
  expect(() =>
    loop(ctx, () => {
      /* no-op */
    }),
  ).not.toThrow();
});
