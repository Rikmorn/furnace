import type { Context } from "../gpu/context-types.ts";
import { FurnaceError } from "../gpu/errors.ts";
import { type FrameLoopHandle, loop } from "./loop.ts";

const DEFAULT_MAX_CATCHUP_TICKS = 8;

/**
 * Per-frame payload delivered to {@link fixedLoop}'s `onFrame` callback.
 *
 * - `deltaMs`: raw RAF delta (capped by `LoopOptions.maxDeltaMs`), same as
 *   `FrameInfo.deltaMs`.
 * - `alpha`: `accumulator / fixedDtMs`, in `[0, 1)`. Pass this to
 *   `vec3.lerp` / `quat.slerp` to interpolate between the previous-tick and
 *   current-tick state at render time. See
 *   `docs/reference/fixed-step-interpolation.md` for the consumer recipe.
 */
export type FixedLoopInfo = Readonly<{
  deltaMs: number;
  alpha: number;
}>;

/**
 * Options accepted by {@link fixedLoop}.
 *
 * - `fixedDtMs`: simulation tick length in milliseconds (e.g. `1000/60`
 *   ≈ 16.67 for 60 Hz). `onTick` receives the equivalent in seconds.
 * - `onTick(dtSeconds)`: deterministic simulation step. Runs **zero or more**
 *   times per RAF, depending on how much real time has accumulated since the
 *   last frame. `dtSeconds = fixedDtMs / 1000`, identical every call.
 * - `onFrame(info)`: optional render-time hook. Runs **once per RAF** after
 *   all due ticks have completed. Receives the interpolation `alpha` for
 *   render-time state lerp/slerp.
 * - `maxCatchupTicks`: spiral-of-death guard. Caps the number of catch-up
 *   ticks per RAF (default 8). When the cap fires with work still pending,
 *   any surplus accumulator is **discarded** rather than carried — preventing
 *   a stalled tab from queueing seconds of simulation at recovery time.
 *   Naturally-drained sub-tick remainders are preserved (that's what feeds
 *   `alpha`).
 * - `maxDeltaMs` / `pauseOnHidden`: forwarded to the underlying `loop`.
 */
export type FixedLoopOptions = {
  fixedDtMs: number;
  onTick: (dtSeconds: number) => void;
  onFrame?: (info: FixedLoopInfo) => void;
  maxCatchupTicks?: number;
  maxDeltaMs?: number;
  pauseOnHidden?: boolean;
};

/**
 * Fix-Your-Timestep accumulator wrapping {@link loop}. Use for simulation,
 * physics, networking, replay — anywhere determinism matters.
 *
 * On each RAF the loop accumulates real elapsed milliseconds, runs
 * `opts.onTick(dtSeconds)` repeatedly while the accumulator covers a full
 * tick, then fires `opts.onFrame({ deltaMs, alpha })` once with the
 * sub-tick remainder as `alpha ∈ [0, 1)` for render-time interpolation.
 *
 * Spiral-of-death is guarded by `maxCatchupTicks` (default 8): if the cap
 * fires with work still pending, surplus accumulator is discarded rather
 * than carried into subsequent frames. See
 * `docs/reference/fixed-step-interpolation.md` for the consumer recipe and
 * `engine-conventions.md` §"Time" for the engine posture.
 *
 * @returns A {@link FrameLoopHandle} for `stop`/`pause`/`resume` control
 *   (the same handle type `loop` returns — `fixedLoop` is a thin wrapper).
 * @throws FurnaceError - if `fixedDtMs` is not a positive finite number,
 *   or if `maxCatchupTicks` is provided and not a positive integer.
 * @throws FurnaceGpuError - propagated from the wrapped `loop` if `ctx` has
 *   been disposed.
 */
export function fixedLoop(
  ctx: Context,
  opts: FixedLoopOptions,
): FrameLoopHandle {
  if (!Number.isFinite(opts.fixedDtMs) || opts.fixedDtMs <= 0) {
    throw new FurnaceError(
      `fixedLoop: fixedDtMs must be a positive finite number, got ${opts.fixedDtMs}`,
    );
  }
  if (
    opts.maxCatchupTicks !== undefined &&
    (!Number.isInteger(opts.maxCatchupTicks) || opts.maxCatchupTicks < 1)
  ) {
    throw new FurnaceError(
      `fixedLoop: maxCatchupTicks must be a positive integer if provided, got ${opts.maxCatchupTicks}`,
    );
  }
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
      // Spiral-of-death guard: if the tick cap fired with work still pending,
      // discard the surplus. Naturally-drained sub-tick remainders are preserved.
      if (accumulator >= opts.fixedDtMs) {
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
