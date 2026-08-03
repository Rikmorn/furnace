import { expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import type { Context } from "../gpu/context-types.ts";
import { createResourceManager } from "../resources/manager.ts";
import { gauge, increment, measure, startMeasurement } from "./public.ts";
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
    expect(entry.message).toContain("gauge(");
    expect(entry.message).toContain("value not finite");
    expect(ctx._internal.stats.gauges.has("x")).toBe(false);
  } finally {
    setSink(consoleSink);
  }
});

test("gauge: Infinity logs warn + no-op", () => {
  const ctx = makeMockCtx();
  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));
  try {
    gauge(ctx, "x", Number.POSITIVE_INFINITY);
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];
    if (!entry) throw new Error("unreachable: entries.length checked above");
    expect(entry.level).toBe("warn");
    expect(entry.module).toBe("stats");
    expect(entry.message).toContain("gauge(");
    expect(entry.message).toContain("value not finite");
    expect(ctx._internal.stats.gauges.has("x")).toBe(false);
  } finally {
    setSink(consoleSink);
  }
});

test("gauge: empty name logs warn + no-op", () => {
  const ctx = makeMockCtx();
  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));
  try {
    gauge(ctx, "", 10);
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];
    if (!entry) throw new Error("unreachable: entries.length checked above");
    expect(entry.level).toBe("warn");
    expect(entry.module).toBe("stats");
    expect(entry.message).toContain("gauge(");
    expect(entry.message).toContain("name must be a non-empty string");
    expect(ctx._internal.stats.gauges.size).toBe(0);
  } finally {
    setSink(consoleSink);
  }
});

test("gauge on disposed ctx: silent no-op (no log)", () => {
  const ctx = makeMockCtx(true);
  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));
  try {
    gauge(ctx, "x", 5);
    expect(entries).toHaveLength(0);
    expect(ctx._internal.stats.gauges.size).toBe(0);
  } finally {
    setSink(consoleSink);
  }
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
  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));
  try {
    increment(ctx, "x", -3);
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];
    if (!entry) throw new Error("unreachable: entries.length checked above");
    expect(entry.level).toBe("warn");
    expect(entry.module).toBe("stats");
    expect(entry.message).toContain("increment(");
    expect(entry.message).toContain("negative delta not allowed");
    expect(ctx._internal.stats.counters.get("x")).toBe(1);
  } finally {
    setSink(consoleSink);
  }
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
  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));
  try {
    m.end();
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    if (!entry) throw new Error("unreachable: entries.length checked above");
    expect(entry.level).toBe("warn");
    expect(entry.module).toBe("stats");
    expect(entry.message).toContain("startMeasurement.end");
    expect(entry.message).toContain("already ended");
  } finally {
    setSink(consoleSink);
  }
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
    expect(entry.message).toContain("increment(");
    expect(entry.message).toContain("already in use as");
    expect(ctx._internal.stats.counters.has("x")).toBe(false);
  } finally {
    setSink(consoleSink);
  }
});
