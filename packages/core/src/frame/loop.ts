import type { Context } from "../gpu/context-types.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import { _frameEnd, _frameStart } from "../stats/internal.ts";

/**
 * Per-frame payload delivered to {@link loop}'s `onFrame` callback.
 *
 * - `elapsedMs`: time in milliseconds since the loop was started, with paused
 *   intervals excluded.
 * - `deltaMs`: time since the previous frame, capped to
 *   {@link LoopOptions.maxDeltaMs} (default 100). The cap prevents huge jumps
 *   after sleep, tab visibility changes, or breakpoint pauses.
 */
export type FrameInfo = Readonly<{
  elapsedMs: number;
  deltaMs: number;
}>;

/**
 * Handle returned by {@link loop} and `fixedLoop` for controlling a running
 * frame loop.
 *
 * `stop` tears the loop down permanently (cancels the pending RAF, removes
 * the visibilitychange listener); `pause` cancels the RAF but keeps the loop
 * resumable; `resume` re-arms RAF and reseeds the delta baseline so the first
 * post-resume frame reports `deltaMs = 0` (avoiding a one-frame catch-up
 * spike).
 *
 * The verb-family follows `engine-conventions.md` §"Disposal": `stop` for the
 * terminal teardown, `pause`/`resume` for transient suspension.
 */
export type FrameLoopHandle = Readonly<{
  stop: () => void;
  pause: () => void;
  resume: () => void;
}>;

/**
 * Options accepted by {@link loop} (and forwarded by `fixedLoop`).
 *
 * Defaults: `maxDeltaMs: 100`, `pauseOnHidden: true`.
 *
 * - `maxDeltaMs`: upper bound applied to per-frame `deltaMs`. Guards against
 *   simulation-breaking jumps when RAF stalls (tab hidden, debugger pause,
 *   system sleep).
 * - `pauseOnHidden`: when `true`, subscribes to `document.visibilitychange`
 *   and auto-pauses/resumes the loop as the tab is hidden/shown. Set `false`
 *   for headless / SSR / test contexts that have no document.
 */
export type LoopOptions = {
  maxDeltaMs?: number;
  pauseOnHidden?: boolean;
};

const DEFAULT_MAX_DELTA_MS = 100;

/**
 * Variable-timestep `requestAnimationFrame` wrapper. Calls `onFrame(info)`
 * once per RAF, brackets the callback with stats `_frameStart`/`_frameEnd`,
 * caps `deltaMs` per {@link LoopOptions.maxDeltaMs}, and optionally
 * auto-pauses on `document.hidden`.
 *
 * For deterministic simulation (physics, networking, replay), prefer
 * `fixedLoop` — `loop` is intended for visual demos with no determinism
 * requirements (see `engine-conventions.md` §"Time").
 *
 * Setup-loud per the foreground failure policy
 * (`engine-conventions.md` §"Failure policy").
 *
 * @returns A {@link FrameLoopHandle} for `stop`/`pause`/`resume` control.
 * @throws FurnaceGpuError - if `ctx` has been disposed.
 */
export function loop(
  ctx: Context,
  onFrame: (info: FrameInfo) => void,
  options: LoopOptions = {},
): FrameLoopHandle {
  if (ctx._internal.disposed) {
    throw new FurnaceGpuError("context disposed");
  }

  const maxDeltaMs = options.maxDeltaMs ?? DEFAULT_MAX_DELTA_MS;
  const pauseOnHidden = options.pauseOnHidden ?? true;

  const startTime = performance.now();
  let lastFrameTime: number | null = null;
  let totalPausedMs = 0;
  let pauseStartedAt: number | null = null;
  let rafId: number | null = null;
  let stopped = false;
  let paused = false;

  const tick = (timestampMs: number): void => {
    if (stopped || paused) return;
    const elapsedMs = timestampMs - startTime - totalPausedMs;
    const rawDelta = lastFrameTime == null ? 0 : timestampMs - lastFrameTime;
    const deltaMs = Math.min(rawDelta, maxDeltaMs);
    lastFrameTime = timestampMs;
    _frameStart(ctx);
    onFrame({ elapsedMs, deltaMs });
    _frameEnd(ctx);
    if (!stopped && !paused) {
      rafId = requestAnimationFrame(tick);
    }
  };

  const pause = (): void => {
    if (paused || stopped) return;
    paused = true;
    pauseStartedAt = performance.now();
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
  };

  const resume = (): void => {
    if (!paused || stopped) return;
    paused = false;
    if (pauseStartedAt != null) {
      totalPausedMs += performance.now() - pauseStartedAt;
      pauseStartedAt = null;
    }
    lastFrameTime = null; // reset to avoid huge delta on resume
    rafId = requestAnimationFrame(tick);
  };

  const onVisibilityChange = (): void => {
    if (typeof document === "undefined") return;
    if (document.hidden) {
      pause();
    } else {
      resume();
    }
  };

  const stop = (): void => {
    stopped = true;
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
    if (pauseOnHidden && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };

  if (pauseOnHidden && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  rafId = requestAnimationFrame(tick);

  return Object.freeze({ stop, pause, resume });
}
