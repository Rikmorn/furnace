import type { Context } from "../gpu/context-types.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import { _frameEnd, _frameStart } from "../stats/internal.ts";

export type FrameInfo = Readonly<{
  elapsedMs: number;
  deltaMs: number;
}>;

export type FrameLoopHandle = Readonly<{
  stop: () => void;
  pause: () => void;
  resume: () => void;
}>;

export type LoopOptions = {
  maxDeltaMs?: number;
  pauseOnHidden?: boolean;
};

const DEFAULT_MAX_DELTA_MS = 100;

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
