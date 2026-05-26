import { expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import { FurnaceError } from "../../src/errors.ts";
import type { Context } from "../../src/gpu/context-types.ts";
import {
  frameBoundary,
  gauge,
  get,
  increment,
  measure,
  onFrame,
  recordDraw,
  snapshot,
  startMeasurement,
} from "../../src/stats/public.ts";
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

// — Setup is loud on disposed —
test("onFrame on disposed: throws", () => {
  const ctx = makeMockCtx(true);
  expect(() => onFrame(ctx, () => undefined)).toThrow(FurnaceError);
});

// — Runtime reads are quiet on disposed —
test("snapshot on disposed: returns zero snapshot, silent", () => {
  const ctx = makeMockCtx(true);
  const origWarn = console.warn;
  const origErr = console.error;
  let logged = false;
  console.warn = () => {
    logged = true;
  };
  console.error = () => {
    logged = true;
  };
  const s = snapshot(ctx);
  console.warn = origWarn;
  console.error = origErr;
  expect(s.gpu.drawCalls).toBe(0);
  expect(logged).toBe(false);
});

test("get on disposed: returns null, silent", () => {
  const ctx = makeMockCtx(true);
  expect(get(ctx, "frame.fps")).toBeNull();
});

// — Runtime writes silent on disposed —
test.each([
  ["gauge", () => gauge(makeMockCtx(true), "x", 1)],
  ["increment", () => increment(makeMockCtx(true), "x")],
  ["recordDraw", () => recordDraw(makeMockCtx(true), { triangles: 1 })],
  ["frameBoundary", () => frameBoundary(makeMockCtx(true))],
])("%s on disposed: silent no-op", (_, op) => {
  const origWarn = console.warn;
  const origErr = console.error;
  let logged = false;
  console.warn = () => {
    logged = true;
  };
  console.error = () => {
    logged = true;
  };
  op();
  console.warn = origWarn;
  console.error = origErr;
  expect(logged).toBe(false);
});

// — Bad input on live ctx logs + no-ops —
test.each([
  ["gauge NaN", () => gauge(makeMockCtx(), "x", Number.NaN)],
  ["gauge Infinity", () => gauge(makeMockCtx(), "x", Number.POSITIVE_INFINITY)],
  ["gauge empty name", () => gauge(makeMockCtx(), "", 1)],
  ["increment negative", () => increment(makeMockCtx(), "x", -1)],
  ["increment NaN", () => increment(makeMockCtx(), "x", Number.NaN)],
  [
    "recordDraw negative tris",
    () => recordDraw(makeMockCtx(), { triangles: -1 }),
  ],
])("%s on live ctx: warn + no-op", (_, op) => {
  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));
  try {
    op();
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];
    if (!entry) throw new Error("unreachable: entries.length checked above");
    expect(entry.level).toBe("warn");
    expect(entry.module).toBe("stats");
  } finally {
    setSink(consoleSink);
  }
});

// — Consumer-wrapping behavior: measure re-throws —
test("measure: consumer fn throw is re-thrown with elapsed recorded", () => {
  const ctx = makeMockCtx();
  const err = new Error("boom");
  expect(() =>
    measure(ctx, "x", () => {
      throw err;
    }),
  ).toThrow(err);
  expect(ctx._internal.stats.measures.has("x")).toBe(true);
});

// — startMeasurement.end() idempotent —
test("startMeasurement: double end logs warn", () => {
  const ctx = makeMockCtx();
  const m = startMeasurement(ctx, "x");
  m.end();
  const origWarn = console.warn;
  let warned = false;
  console.warn = () => {
    warned = true;
  };
  m.end();
  console.warn = origWarn;
  expect(warned).toBe(true);
});
