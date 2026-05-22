import type { Context } from "../gpu/context-types.ts";
import { type FrameLoopHandle, loop } from "./loop.ts";

const DEFAULT_MAX_CATCHUP_TICKS = 8;

export type FixedLoopInfo = Readonly<{
  deltaMs: number;
  alpha: number;
}>;

export type FixedLoopOptions = {
  fixedDtMs: number;
  onTick: (dtSeconds: number) => void;
  onFrame?: (info: FixedLoopInfo) => void;
  maxCatchupTicks?: number;
  maxDeltaMs?: number;
  pauseOnHidden?: boolean;
};

export function fixedLoop(
  ctx: Context,
  opts: FixedLoopOptions,
): FrameLoopHandle {
  const fixedDtSeconds = opts.fixedDtMs / 1000;
  const maxCatchupTicks = opts.maxCatchupTicks ?? DEFAULT_MAX_CATCHUP_TICKS;
  let accumulator = 0;

  return loop(
    ctx,
    ({ deltaMs }) => {
      accumulator += deltaMs;
      let ticks = 0;
      while (accumulator >= opts.fixedDtMs && ticks < maxCatchupTicks) {
        opts.onTick(fixedDtSeconds);
        accumulator -= opts.fixedDtMs;
        ticks++;
      }
      if (ticks >= maxCatchupTicks) {
        // Spiral-of-death guard: discard remaining accumulator.
        accumulator = 0;
      }
      const alpha = accumulator / opts.fixedDtMs;
      opts.onFrame?.({ deltaMs, alpha });
    },
    {
      maxDeltaMs: opts.maxDeltaMs,
      pauseOnHidden: opts.pauseOnHidden,
    },
  );
}
