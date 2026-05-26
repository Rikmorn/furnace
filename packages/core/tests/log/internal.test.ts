import { afterEach, expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import { debug, error, info, warn } from "../../src/log/internal.ts";

afterEach(() => setSink(consoleSink));

test("warn dispatches LogEntry to current sink", () => {
  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));

  warn("gpu", "test message", { key: "value" });

  expect(entries).toHaveLength(1);
  const e = entries[0];
  if (!e) throw new Error("unreachable");
  expect(e.level).toBe("warn");
  expect(e.module).toBe("gpu");
  expect(e.message).toBe("test message");
  expect(e.rest).toEqual([{ key: "value" }]);
  expect(typeof e.timestampMs).toBe("number");
  expect(Number.isFinite(e.timestampMs)).toBe(true);
});

test("error / info / debug dispatch with correct level", () => {
  const entries: LogEntry[] = [];
  setSink((e) => entries.push(e));
  error("gpu", "boom");
  info("frame", "ready");
  debug("stats", "tick");
  expect(entries.map((e) => e.level)).toEqual(["error", "info", "debug"]);
});

test("setSink(null) silences subsequent calls", () => {
  const entries: LogEntry[] = [];
  setSink((e) => entries.push(e));
  warn("gpu", "a");
  setSink(null);
  warn("gpu", "b");
  expect(entries.map((e) => e.message)).toEqual(["a"]);
});

test("setSink(consoleSink) restores explicit console routing", () => {
  const originalWarn = console.warn;
  const calls: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    setSink(null);
    warn("gpu", "silenced");
    expect(calls).toHaveLength(0);
    setSink(consoleSink);
    warn("gpu", "loud", { x: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("[furnace/gpu]");
    expect(calls[0]?.[1]).toBe("loud");
    expect(calls[0]?.[2]).toEqual({ x: 1 });
  } finally {
    console.warn = originalWarn;
  }
});

test("consoleSink maps each level to the matching console method", () => {
  const original = {
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
  };
  const calls: {
    error: unknown[][];
    warn: unknown[][];
    info: unknown[][];
    debug: unknown[][];
  } = { error: [], warn: [], info: [], debug: [] };
  console.error = (...a: unknown[]) => {
    calls.error.push(a);
  };
  console.warn = (...a: unknown[]) => {
    calls.warn.push(a);
  };
  console.info = (...a: unknown[]) => {
    calls.info.push(a);
  };
  console.debug = (...a: unknown[]) => {
    calls.debug.push(a);
  };
  try {
    setSink(consoleSink);
    error("gpu", "e");
    warn("gpu", "w");
    info("gpu", "i");
    debug("gpu", "d");
    expect(calls.error).toHaveLength(1);
    expect(calls.warn).toHaveLength(1);
    expect(calls.info).toHaveLength(1);
    expect(calls.debug).toHaveLength(1);
  } finally {
    console.error = original.error;
    console.warn = original.warn;
    console.info = original.info;
    console.debug = original.debug;
  }
});

test("throwing sink propagates to caller", () => {
  setSink(() => {
    throw new Error("sink boom");
  });
  expect(() => warn("gpu", "x")).toThrow("sink boom");
});

test("composed sink fires both branches", () => {
  const aEntries: LogEntry[] = [];
  const consoleCalls: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    consoleCalls.push(args);
  };
  try {
    setSink((entry) => {
      consoleSink(entry);
      aEntries.push(entry);
    });
    warn("gpu", "broadcast");
    expect(aEntries).toHaveLength(1);
    expect(consoleCalls).toHaveLength(1);
  } finally {
    console.warn = originalWarn;
  }
});
