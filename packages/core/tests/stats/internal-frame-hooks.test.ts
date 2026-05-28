import { expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import type { Context } from "../../src/gpu/context-types.ts";
import { createResourceManager } from "../../src/resources/manager.ts";
import { _frameEnd, _frameStart } from "../../src/stats/internal.ts";
import { createStatsState } from "../../src/stats/state.ts";

// Minimal mock ctx for pure-logic stats tests — only the fields stats touches.
function makeMockCtx(now = 0): Context {
  return {
    device: null as unknown as GPUDevice,
    queue: null as unknown as GPUQueue,
    format: "bgra8unorm" as GPUTextureFormat,
    canvas: null as unknown as HTMLCanvasElement,
    pixelRatio: 1,
    _internal: {
      disposed: false,
      stats: createStatsState(now),
      resources: createResourceManager(),
      ctxId: 0xffff,
    },
  } as Context;
}

test("_frameStart: records frameStartTime and resets per-frame counters", () => {
  const ctx = makeMockCtx();
  ctx._internal.stats.drawCalls = 5;
  ctx._internal.stats.triangles = 999;
  ctx._internal.stats.pipelineSwitches = 2;
  ctx._internal.stats.bindGroupSwitches = 4;
  ctx._internal.stats.emissions.set("gpu.onResize", 3);
  _frameStart(ctx);
  expect(ctx._internal.stats.frameStartTime).not.toBeNull();
  expect(ctx._internal.stats.drawCalls).toBe(0);
  expect(ctx._internal.stats.triangles).toBe(0);
  expect(ctx._internal.stats.pipelineSwitches).toBe(0);
  expect(ctx._internal.stats.bindGroupSwitches).toBe(0);
  expect(ctx._internal.stats.emissions.size).toBe(0);
});

test("_frameStart on disposed ctx: silent no-op", () => {
  const ctx = makeMockCtx();
  ctx._internal.disposed = true;
  ctx._internal.stats.drawCalls = 5;
  _frameStart(ctx);
  expect(ctx._internal.stats.drawCalls).toBe(5);
  expect(ctx._internal.stats.frameStartTime).toBeNull();
});

test("_frameEnd: pushes frame ms to window + fires subscribers with snapshot", async () => {
  const ctx = makeMockCtx();
  _frameStart(ctx);
  await new Promise((r) => setTimeout(r, 10)); // ~10ms delay so frame ms is measurable
  const seen: number[] = [];
  ctx._internal.stats.onFrameSubscribers.add((snap) =>
    seen.push(snap.frame.ms.last),
  );
  _frameEnd(ctx);
  expect(seen.length).toBe(1);
  expect(seen[0]).toBeGreaterThan(0);
  expect(ctx._internal.stats.window.filled).toBe(1);
});

test("_frameEnd: subscriber throw is caught + iteration continues", () => {
  const ctx = makeMockCtx();
  _frameStart(ctx);
  const seen: string[] = [];
  ctx._internal.stats.onFrameSubscribers.add(() => {
    seen.push("a");
    throw new Error("bad");
  });
  ctx._internal.stats.onFrameSubscribers.add(() => {
    seen.push("b");
  });
  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));
  try {
    _frameEnd(ctx);
  } finally {
    setSink(consoleSink);
  }
  expect(seen).toEqual(["a", "b"]);
  expect(entries.length).toBe(1);
  const entry = entries[0];
  if (!entry) throw new Error("unreachable: entries.length checked above");
  expect(entry.level).toBe("error");
  expect(entry.module).toBe("stats");
  expect(entry.message).toBe("onFrame subscriber threw");
  const thrown = entry.rest[0];
  if (!(thrown instanceof Error))
    throw new Error("unreachable: rest[0] not Error");
  expect(thrown.message).toBe("bad");
});

test("_frameEnd: subscriber throw + throwing sink: iteration still continues", () => {
  const ctx = makeMockCtx();
  _frameStart(ctx);
  const seen: string[] = [];
  ctx._internal.stats.onFrameSubscribers.add(() => {
    seen.push("a");
    throw new Error("subscriber boom");
  });
  ctx._internal.stats.onFrameSubscribers.add(() => {
    seen.push("b");
  });
  setSink(() => {
    throw new Error("sink boom");
  });
  try {
    // Even with both a throwing subscriber AND a throwing sink, _frameEnd
    // must not propagate and remaining subscribers must fire.
    expect(() => _frameEnd(ctx)).not.toThrow();
  } finally {
    setSink(consoleSink);
  }
  expect(seen).toEqual(["a", "b"]);
});

test("_frameEnd on disposed ctx: silent no-op", () => {
  const ctx = makeMockCtx();
  ctx._internal.disposed = true;
  let fired = false;
  ctx._internal.stats.onFrameSubscribers.add(() => {
    fired = true;
  });
  _frameEnd(ctx);
  expect(fired).toBe(false);
});
