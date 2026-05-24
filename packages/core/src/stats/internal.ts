import type { Context } from "../gpu/context-types.ts";
import { tickFps } from "./fps-counter.ts";
import { pushFrameMs } from "./frame-window.ts";
import { buildSnapshot } from "./snapshot.ts";

export function _frameStart(ctx: Context): void {
  if (ctx._internal.disposed) return;
  const s = ctx._internal.stats;
  s.frameStartTime = performance.now();
  s.drawCalls = 0;
  s.triangles = 0;
  s.pipelineSwitches = 0;
  s.bindGroupSwitches = 0;
  s.emissions.clear();
}

export function _frameEnd(ctx: Context): void {
  if (ctx._internal.disposed) return;
  const s = ctx._internal.stats;
  if (s.frameStartTime === null) return; // _frameStart never fired this cycle
  const now = performance.now();
  const elapsed = now - s.frameStartTime;
  pushFrameMs(s.window, elapsed);
  tickFps(s.fps, now);
  s.frameStartTime = null;

  if (s.onFrameSubscribers.size === 0) return;
  const snap = buildSnapshot(s);
  // Snapshot the subscriber set before iterating so add-during-emit doesn't fire this cycle
  // and remove-during-emit takes effect immediately (matches events/emitter.ts pattern).
  const subs = Array.from(s.onFrameSubscribers);
  for (const sub of subs) {
    if (!s.onFrameSubscribers.has(sub)) continue;
    try {
      sub(snap);
    } catch (err) {
      console.error("[furnace/stats] onFrame subscriber threw:", err);
    }
  }
}

export function _recordDraw(ctx: Context, info: { triangles: number }): void {
  if (ctx._internal.disposed) return;
  if (!Number.isFinite(info.triangles) || info.triangles < 0) {
    console.warn(
      `[furnace/stats] _recordDraw: triangles must be finite and non-negative, got ${info.triangles}; ignored`,
    );
    return;
  }
  ctx._internal.stats.drawCalls++;
  ctx._internal.stats.triangles += info.triangles;
}

export function _recordPipelineSwitch(ctx: Context): void {
  if (ctx._internal.disposed) return;
  ctx._internal.stats.pipelineSwitches++;
}

export function _recordBindGroupSwitch(ctx: Context): void {
  if (ctx._internal.disposed) return;
  ctx._internal.stats.bindGroupSwitches++;
}
