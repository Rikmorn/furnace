import { expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import { FurnaceError } from "../../src/errors.ts";
import type { Context } from "../../src/gpu/context-types.ts";
import { createResourceManager } from "../../src/resources/manager.ts";
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
    _internal: {
      disposed,
      stats: createStatsState(0),
      resources: createResourceManager(),
    },
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
  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));
  try {
    const s = snapshot(ctx);
    expect(s.gpu.drawCalls).toBe(0);
    expect(entries).toHaveLength(0);
  } finally {
    setSink(consoleSink);
  }
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
  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));
  try {
    op();
    expect(entries).toHaveLength(0);
  } finally {
    setSink(consoleSink);
  }
});

// — Bad input on live ctx logs + no-ops —
test.each([
  [
    "gauge NaN",
    () => gauge(makeMockCtx(), "x", Number.NaN),
    "value not finite",
  ],
  [
    "gauge Infinity",
    () => gauge(makeMockCtx(), "x", Number.POSITIVE_INFINITY),
    "value not finite",
  ],
  [
    "gauge empty name",
    () => gauge(makeMockCtx(), "", 1),
    "name must be a non-empty string",
  ],
  [
    "increment negative",
    () => increment(makeMockCtx(), "x", -1),
    "negative delta not allowed",
  ],
  [
    "increment NaN",
    () => increment(makeMockCtx(), "x", Number.NaN),
    "delta not finite",
  ],
  [
    "recordDraw negative tris",
    () => recordDraw(makeMockCtx(), { triangles: -1 }),
    "triangles",
  ],
])("%s on live ctx: warn + no-op", (_, op, msgFragment) => {
  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));
  try {
    op();
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];
    if (!entry) throw new Error("unreachable: entries.length checked above");
    expect(entry.level).toBe("warn");
    expect(entry.module).toBe("stats");
    expect(entry.message).toContain(msgFragment);
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
