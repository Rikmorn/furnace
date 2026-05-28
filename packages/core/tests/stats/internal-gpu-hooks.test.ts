import { expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "@furnace/core/log";
import type { Context } from "../../src/gpu/context-types.ts";
import { createResourceManager } from "../../src/resources/manager.ts";
import {
  _recordBindGroupSwitch,
  _recordDraw,
  _recordPipelineSwitch,
} from "../../src/stats/internal.ts";
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
      ctxId: 0xffff,
    },
  } as Context;
}

test("_recordDraw: increments drawCalls and adds triangles", () => {
  const ctx = makeMockCtx();
  _recordDraw(ctx, { triangles: 12 });
  expect(ctx._internal.stats.drawCalls).toBe(1);
  expect(ctx._internal.stats.triangles).toBe(12);
  _recordDraw(ctx, { triangles: 4 });
  expect(ctx._internal.stats.drawCalls).toBe(2);
  expect(ctx._internal.stats.triangles).toBe(16);
});

test("_recordDraw: negative triangles logs warn + no-op", () => {
  const ctx = makeMockCtx();
  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));
  try {
    _recordDraw(ctx, { triangles: -3 });
  } finally {
    setSink(consoleSink);
  }
  expect(entries.length).toBe(1);
  const entry = entries[0];
  if (!entry) throw new Error("unreachable: entries.length checked above");
  expect(entry.level).toBe("warn");
  expect(entry.module).toBe("stats");
  expect(entry.message).toBe(
    "_recordDraw: triangles must be finite and non-negative",
  );
  expect(entry.rest[0]).toEqual({ value: -3 });
  expect(ctx._internal.stats.drawCalls).toBe(0);
  expect(ctx._internal.stats.triangles).toBe(0);
});

test("_recordDraw on disposed ctx: silent no-op", () => {
  const ctx = makeMockCtx(true);
  _recordDraw(ctx, { triangles: 12 });
  expect(ctx._internal.stats.drawCalls).toBe(0);
});

test("_recordPipelineSwitch: increments", () => {
  const ctx = makeMockCtx();
  _recordPipelineSwitch(ctx);
  _recordPipelineSwitch(ctx);
  expect(ctx._internal.stats.pipelineSwitches).toBe(2);
});

test("_recordBindGroupSwitch: increments", () => {
  const ctx = makeMockCtx();
  _recordBindGroupSwitch(ctx);
  _recordBindGroupSwitch(ctx);
  _recordBindGroupSwitch(ctx);
  expect(ctx._internal.stats.bindGroupSwitches).toBe(3);
});

test("_recordPipelineSwitch / _recordBindGroupSwitch on disposed ctx: silent no-op", () => {
  const ctx = makeMockCtx(true);
  _recordPipelineSwitch(ctx);
  _recordBindGroupSwitch(ctx);
  expect(ctx._internal.stats.pipelineSwitches).toBe(0);
  expect(ctx._internal.stats.bindGroupSwitches).toBe(0);
});
