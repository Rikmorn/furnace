import { expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import type { Context } from "../../src/gpu/context-types.ts";
import {
  gauge,
  increment,
  measure,
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

test("gauge: sets and overwrites a named gauge", () => {
  const ctx = makeMockCtx();
  gauge(ctx, "x", 10);
  expect(ctx._internal.stats.gauges.get("x")).toBe(10);
  gauge(ctx, "x", 20);
  expect(ctx._internal.stats.gauges.get("x")).toBe(20);
});

test("gauge: NaN logs warn + no-op", () => {
  const ctx = makeMockCtx();
  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));
  try {
    gauge(ctx, "x", Number.NaN);
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];
    if (!entry) throw new Error("unreachable: entries.length checked above");
    expect(entry.level).toBe("warn");
    expect(entry.module).toBe("stats");
    expect(ctx._internal.stats.gauges.has("x")).toBe(false);
  } finally {
    setSink(consoleSink);
  }
});

test("gauge: Infinity logs warn + no-op", () => {
  const ctx = makeMockCtx();
  const origWarn = console.warn;
  console.warn = () => undefined;
  gauge(ctx, "x", Number.POSITIVE_INFINITY);
  console.warn = origWarn;
  expect(ctx._internal.stats.gauges.has("x")).toBe(false);
});

test("gauge: empty name logs warn + no-op", () => {
  const ctx = makeMockCtx();
  const origWarn = console.warn;
  console.warn = () => undefined;
  gauge(ctx, "", 10);
  console.warn = origWarn;
  expect(ctx._internal.stats.gauges.size).toBe(0);
});

test("gauge on disposed ctx: silent no-op (no log)", () => {
  const ctx = makeMockCtx(true);
  const origWarn = console.warn;
  let warned = false;
  console.warn = () => {
    warned = true;
  };
  gauge(ctx, "x", 5);
  console.warn = origWarn;
  expect(warned).toBe(false);
  expect(ctx._internal.stats.gauges.size).toBe(0);
});

test("increment: accumulates", () => {
  const ctx = makeMockCtx();
  increment(ctx, "x");
  increment(ctx, "x", 4);
  expect(ctx._internal.stats.counters.get("x")).toBe(5);
});

test("increment: negative by logs warn + no-op", () => {
  const ctx = makeMockCtx();
  increment(ctx, "x");
  const origWarn = console.warn;
  console.warn = () => undefined;
  increment(ctx, "x", -3);
  console.warn = origWarn;
  expect(ctx._internal.stats.counters.get("x")).toBe(1);
});

test("measure: records elapsed under the name", () => {
  const ctx = makeMockCtx();
  measure(ctx, "work", () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 1) {
      /* spin */
    }
  });
  const m = ctx._internal.stats.measures.get("work");
  expect(m).not.toBeUndefined();
  if (m === undefined) throw new Error("unreachable");
  expect(m).toBeGreaterThan(0);
});

test("measure: consumer function throwing is re-thrown; elapsed still recorded", () => {
  const ctx = makeMockCtx();
  const err = new Error("boom");
  expect(() =>
    measure(ctx, "fault", () => {
      throw err;
    }),
  ).toThrow(err);
  expect(ctx._internal.stats.measures.has("fault")).toBe(true);
});

test("startMeasurement / end: records elapsed once; second end logs warn", () => {
  const ctx = makeMockCtx();
  const m = startMeasurement(ctx, "x");
  m.end();
  expect(ctx._internal.stats.measures.has("x")).toBe(true);
  const origWarn = console.warn;
  let warned = false;
  console.warn = () => {
    warned = true;
  };
  m.end();
  console.warn = origWarn;
  expect(warned).toBe(true);
});

test("name collision across writer kinds logs warn + no-op", () => {
  const ctx = makeMockCtx();
  gauge(ctx, "x", 10);
  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));
  try {
    increment(ctx, "x");
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];
    if (!entry) throw new Error("unreachable: entries.length checked above");
    expect(entry.level).toBe("warn");
    expect(entry.module).toBe("stats");
    expect(ctx._internal.stats.counters.has("x")).toBe(false);
  } finally {
    setSink(consoleSink);
  }
});
