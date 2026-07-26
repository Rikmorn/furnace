import type { Context, ContextInternals } from "../gpu/context-types.ts";
import { error, warn } from "../log/internal.ts";
import { tickFps } from "./fps-counter.ts";
import { pushFrameMs } from "./frame-window.ts";
import { type ResourceKind, recordAlloc, recordDestroy } from "./resources.ts";
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
      try {
        error("stats", "onFrame subscriber threw", err);
      } catch {
        // Sink threw while logging an onFrame subscriber failure. Swallow to
        // preserve iteration over remaining subscribers.
      }
    }
  }
}

export function _recordDraw(ctx: Context, info: { triangles: number }): void {
  if (ctx._internal.disposed) return;
  if (!Number.isFinite(info.triangles) || info.triangles < 0) {
    warn("stats", "_recordDraw: triangles must be finite and non-negative", {
      value: info.triangles,
    });
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

/**
 * Record a resource alloc with stats. Single-writer API (RM-4).
 *
 * - Slot kinds (`mesh`/`material`/`geometry`/`effect`): called by the
 *   resource manager's typed wrappers (`_allocMesh`, etc.) with `bytes: 0`.
 * - Buffer/texture kinds: called by the resource module or engine-internal
 *   site that allocates the GPU resource, right after `device.createBuffer`
 *   / `device.createTexture`. `bytes` is the resource's size.
 *
 * Runtime-quiet on disposed `ctx`.
 */
export function _recordAlloc(
  ctx: ContextInternals,
  kind: ResourceKind,
  bytes: number,
): void {
  if (ctx._internal.disposed) return;
  recordAlloc(ctx._internal.stats.resources, kind, bytes);
}

/**
 * Record a resource destroy with stats. Symmetric to {@link _recordAlloc};
 * caller passes the same `bytes` value used at alloc time.
 */
export function _recordDestroy(
  ctx: ContextInternals,
  kind: ResourceKind,
  bytes: number,
): void {
  if (ctx._internal.disposed) return;
  recordDestroy(ctx._internal.stats.resources, kind, bytes);
}

export function _recordEmission(ctx: Context, name: string): void {
  if (ctx._internal.disposed) return;
  const m = ctx._internal.stats.emissions;
  m.set(name, (m.get(name) ?? 0) + 1);
}

export function _recordUncapturedError(ctx: Context): void {
  if (ctx._internal.disposed) return;
  ctx._internal.stats.uncapturedErrors++;
}

export function _recordDeviceLost(ctx: Context): void {
  if (ctx._internal.disposed) return;
  ctx._internal.stats.deviceLost = true;
}
