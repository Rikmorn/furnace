import { FurnaceError } from "../errors.ts";

const DEFAULT_MAX_CATCHUP_TICKS = 8;
const MS_PER_SECOND = 1000;

/**
 * A separable fixed-timestep accumulator — the "Fix Your Timestep" clock,
 * decoupled from render-loop ownership. Advance it from inside any render loop
 * (`frame.loop`, or a shell that owns the loop and dispatches a per-scene frame
 * callback). Holds only timing state — no GPU, no `Context`, no teardown (like
 * an `Emitter`). Created by {@link fixedClock}.
 */
export type FixedClock = {
  /**
   * Accumulate `deltaMs`, invoke `onTick(dtSeconds)` once per elapsed fixed
   * step (zero or more times, capped by `maxCatchupTicks` with a
   * spiral-of-death guard), and return the interpolation `alpha ∈ [0, 1)` (the
   * sub-tick remainder ÷ `fixedDtMs`). Hot-path: trusts `deltaMs`, never throws.
   */
  advance(deltaMs: number, onTick: (dtSeconds: number) => void): number;
  /**
   * Change the fixed timestep at runtime (e.g. a live Hz control). The
   * accumulator carries over; the next {@link advance} compares against the new
   * value. Cold-path: throws {@link FurnaceError} on non-positive / non-finite
   * `fixedDtMs`.
   */
  setFixedDtMs(fixedDtMs: number): void;
  /** The current fixed timestep, in milliseconds. */
  readonly fixedDtMs: number;
};

function assertPositiveFiniteDt(fixedDtMs: number): void {
  if (!Number.isFinite(fixedDtMs) || fixedDtMs <= 0) {
    throw new FurnaceError(
      `fixedClock: fixedDtMs must be a positive finite number, got ${fixedDtMs}`,
    );
  }
}

/**
 * Create a {@link FixedClock} — a reusable fixed-step accumulator. `fixedDtMs`
 * is the simulation tick length (e.g. `1000/60` for 60 Hz); `onTick` receives
 * the equivalent in seconds. `maxCatchupTicks` (default 8) caps catch-up ticks
 * per `advance`; when it fires with work still pending the surplus accumulator
 * is discarded (preventing a stalled tab from queueing seconds of simulation).
 *
 * Pure CPU timing state — takes no `Context`, allocates no GPU resources, and
 * needs no disposal (plain GC'd object, like `events.createEmitter`'s emitter).
 *
 * @throws FurnaceError - if `fixedDtMs` is not a positive finite number, or if
 *   `maxCatchupTicks` is provided and not a positive integer.
 */
export function fixedClock(opts: {
  fixedDtMs: number;
  maxCatchupTicks?: number;
}): FixedClock {
  assertPositiveFiniteDt(opts.fixedDtMs);
  if (
    opts.maxCatchupTicks !== undefined &&
    (!Number.isInteger(opts.maxCatchupTicks) || opts.maxCatchupTicks < 1)
  ) {
    throw new FurnaceError(
      `fixedClock: maxCatchupTicks must be a positive integer if provided, got ${opts.maxCatchupTicks}`,
    );
  }
  const maxCatchupTicks = opts.maxCatchupTicks ?? DEFAULT_MAX_CATCHUP_TICKS;
  let fixedDtMs = opts.fixedDtMs;
  let accumulatorMs = 0;

  return {
    get fixedDtMs(): number {
      return fixedDtMs;
    },
    setFixedDtMs(next: number): void {
      assertPositiveFiniteDt(next);
      fixedDtMs = next;
    },
    advance(deltaMs: number, onTick: (dtSeconds: number) => void): number {
      accumulatorMs += deltaMs;
      let ticks = 0;
      while (accumulatorMs >= fixedDtMs && ticks < maxCatchupTicks) {
        onTick(fixedDtMs / MS_PER_SECOND);
        accumulatorMs -= fixedDtMs;
        ticks++;
      }
      // Spiral-of-death guard: if the cap fired with a full tick still pending,
      // discard the surplus. A naturally-drained sub-tick remainder is kept.
      if (accumulatorMs >= fixedDtMs) {
        accumulatorMs = 0;
      }
      return accumulatorMs / fixedDtMs;
    },
  };
}
