import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/context-types.ts";
import { warn } from "../log/internal.ts";
import type { Path, PathValue } from "./path.ts";
import { buildSnapshot, type Snapshot } from "./snapshot.ts";
import { ZERO_SNAPSHOT } from "./zero-snapshot.ts";

export type { Path, PathValue } from "./path.ts";
export type { Snapshot } from "./snapshot.ts";

/**
 * Build and return a frozen {@link Snapshot} of the current frame's
 * instrumentation (FPS, frame-time stats, GPU counters, resource counts,
 * memory totals, per-emitter event counts, and consumer customs).
 *
 * Runtime-quiet: returns the all-zeros snapshot (`ZERO_SNAPSHOT`) on a
 * disposed `ctx` rather than throwing. See `engine-conventions.md`
 * §"Failure policy".
 *
 * A new object is allocated per call; consumers that read every frame
 * should prefer {@link onFrame} (single shared snapshot per frame) or
 * {@link get} (typed dotted-path lookup) over polling.
 */
export function snapshot(ctx: Context): Snapshot {
  if (ctx._internal.disposed) return ZERO_SNAPSHOT;
  return buildSnapshot(ctx._internal.stats);
}

/**
 * Subscribe to per-frame {@link Snapshot} delivery. The callback is fired
 * once per frame from `_frameEnd` (the close of {@link frameBoundary} or
 * `frame.loop`'s frame) with a single shared frozen snapshot.
 *
 * Setup-loud: throws on a disposed `ctx` because subscribing to a context
 * that will never fire again is a programming error, not a runtime no-op.
 *
 * Returns an unsubscribe function (idempotent — safe to call once or
 * never). Call in dispose paths.
 *
 * @throws FurnaceError - `ctx` is disposed.
 */
export function onFrame(ctx: Context, fn: (s: Snapshot) => void): () => void {
  if (ctx._internal.disposed) {
    throw new FurnaceError("stats.onFrame: context is disposed");
  }
  ctx._internal.stats.onFrameSubscribers.add(fn);
  return () => {
    ctx._internal.stats.onFrameSubscribers.delete(fn);
  };
}

/**
 * Typed dotted-path lookup into a fresh {@link Snapshot}. `path` is
 * statically constrained by `Path<Snapshot>` to valid keys (e.g.
 * `"frame.fps"`, `"gpu.drawCalls"`, `"memory.total"`).
 *
 * Runtime-quiet: returns `null` on a disposed `ctx` or when an
 * intermediate segment is missing (e.g. `custom.someName` before that
 * name has been set), rather than throwing.
 *
 * Builds a fresh snapshot per call. For per-frame consumption prefer
 * {@link onFrame}; for whole-snapshot access prefer {@link snapshot}.
 */
export function get<P extends Path<Snapshot>>(
  ctx: Context,
  path: P,
): PathValue<Snapshot, P> | null {
  if (ctx._internal.disposed) return null;
  const snap = buildSnapshot(ctx._internal.stats);
  // Walk the dotted path. Untyped at runtime; the type signature constrains call sites.
  const parts = path.split(".");
  let cur: unknown = snap;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return null;
    // Boundary cast: runtime string traversal of the Snapshot object graph; Path<Snapshot> ensures structural validity at the call site.
    cur = (cur as Record<string, unknown>)[p];
  }
  if (cur === undefined) return null;
  // Boundary cast: returning runtime-traversed value as the statically-resolved PathValue<Snapshot, P>; the Path<Snapshot> constraint is the invariant.
  return cur as PathValue<Snapshot, P>;
}

/**
 * Handle returned by {@link startMeasurement}. Calling `end()` records the
 * elapsed `performance.now()` delta under the measurement's name into
 * `Snapshot.custom`. Calling `end()` more than once routes a warning to
 * the engine log helper (see `@furnace/core/log`) at `warn` level and
 * no-ops; never throws.
 */
export type Measurement = Readonly<{ end: () => void }>;

const NOOP_MEASUREMENT: Measurement = Object.freeze({ end: () => undefined });

function badInput(op: string, name: string, reason: string): void {
  warn("stats", `${op}(${JSON.stringify(name)}): ${reason}`);
}

function validName(op: string, name: string): boolean {
  if (typeof name !== "string" || name.length === 0) {
    badInput(op, name, "name must be a non-empty string");
    return false;
  }
  return true;
}

function noCrossKindCollision(
  ctx: Context,
  op: string,
  name: string,
  target: "gauges" | "counters" | "measures",
): boolean {
  const s = ctx._internal.stats;
  const others = (["gauges", "counters", "measures"] as const).filter(
    (k) => k !== target,
  );
  for (const k of others) {
    if (s[k].has(name)) {
      badInput(
        op,
        name,
        `name already in use as ${k.slice(0, -1)} (custom names must be unique across kinds)`,
      );
      return false;
    }
  }
  return true;
}

/**
 * Set a consumer-named gauge in `Snapshot.custom` (last-write-wins).
 *
 * Runtime-quiet across the board: every failure path silently no-ops, and
 * the input-validation failures additionally route a warning to the engine
 * log helper (see `@furnace/core/log`) at `warn` level so misuse is visible
 * during development without breaking the frame:
 * - disposed `ctx` — silent no-op.
 * - `name` empty or not a string — warns, no-op.
 * - `value` not finite (NaN / ±Infinity) — warns, no-op.
 * - `name` already used as a counter or measure — warns, no-op (custom
 *   names must be unique across kinds).
 */
export function gauge(ctx: Context, name: string, value: number): void {
  if (ctx._internal.disposed) return;
  if (!validName("gauge", name)) return;
  if (!Number.isFinite(value)) {
    badInput("gauge", name, "value not finite");
    return;
  }
  if (!noCrossKindCollision(ctx, "gauge", name, "gauges")) return;
  ctx._internal.stats.gauges.set(name, value);
}

/**
 * Increment a consumer-named counter in `Snapshot.custom`. Counters are
 * monotonic — use {@link gauge} when you need absolute values that can
 * decrease.
 *
 * Runtime-quiet across the board: every failure path silently no-ops, and
 * the input-validation failures additionally route a warning to the engine
 * log helper (see `@furnace/core/log`) at `warn` level:
 * - disposed `ctx` — silent no-op.
 * - `name` empty or not a string — warns, no-op.
 * - `by` not finite — warns, no-op.
 * - `by` negative — warns, no-op (counters are monotonic).
 * - `name` already used as a gauge or measure — warns, no-op.
 *
 * @param by - Defaults to `1`.
 */
export function increment(ctx: Context, name: string, by = 1): void {
  if (ctx._internal.disposed) return;
  if (!validName("increment", name)) return;
  if (!Number.isFinite(by)) {
    badInput("increment", name, "delta not finite");
    return;
  }
  if (by < 0) {
    badInput(
      "increment",
      name,
      "negative delta not allowed (counters are monotonic — use gauge for absolute values)",
    );
    return;
  }
  if (!noCrossKindCollision(ctx, "increment", name, "counters")) return;
  const cur = ctx._internal.stats.counters.get(name) ?? 0;
  ctx._internal.stats.counters.set(name, cur + by);
}

/**
 * Time the synchronous execution of `fn()` via `performance.now()` and
 * store the elapsed milliseconds in `Snapshot.custom` under `name`. The
 * timing is recorded in a `finally` block, so `fn` throwing still records
 * the partial elapsed time and the throw propagates to the caller.
 *
 * Runtime-quiet across the board:
 * - disposed `ctx` — `fn` is intentionally NOT invoked and the call
 *   silently no-ops. See `engine-conventions.md` §"Failure policy" — the
 *   context is passive on disposed, so consumer work scoped to a
 *   `measure(...)` call deliberately skips. If you need the work to run
 *   regardless, call it outside `measure`.
 * - `name` empty or not a string — warns, `fn` not invoked, no-op.
 * - cross-kind collision (`name` already used as a {@link gauge} or
 *   {@link increment} counter) — warns, `fn` not invoked, no-op.
 *
 * For async or manually-bracketed measurements, use {@link startMeasurement}.
 */
export function measure(ctx: Context, name: string, fn: () => void): void {
  if (ctx._internal.disposed) {
    // Disposed: fn is intentionally not invoked. Per spec § 5 — passive on disposed.
    void fn;
    return;
  }
  if (!validName("measure", name)) return;
  if (!noCrossKindCollision(ctx, "measure", name, "measures")) return;
  const t0 = performance.now();
  try {
    fn();
  } finally {
    ctx._internal.stats.measures.set(name, performance.now() - t0);
  }
}

/**
 * Open a manual / async {@link Measurement}: capture `t0 =
 * performance.now()` and return a `{ end }` handle. Calling `end()`
 * records the delta in `Snapshot.custom` under `name`. Use this when the
 * work being timed spans an `await`, multiple frames, or otherwise cannot
 * be expressed as a synchronous {@link measure} call.
 *
 * Runtime-quiet across the board:
 * - disposed `ctx` — returns the shared frozen `NOOP_MEASUREMENT`; its
 *   `end()` is a no-op.
 * - `name` empty / not a string — warns, returns `NOOP_MEASUREMENT`.
 * - cross-kind collision (`name` already used as a {@link gauge} or
 *   {@link increment} counter) — warns, returns `NOOP_MEASUREMENT`.
 * - calling `end()` twice on the same handle — warns and no-ops on the
 *   second (and later) call.
 */
export function startMeasurement(ctx: Context, name: string): Measurement {
  if (ctx._internal.disposed) return NOOP_MEASUREMENT;
  if (!validName("startMeasurement", name)) return NOOP_MEASUREMENT;
  if (!noCrossKindCollision(ctx, "startMeasurement", name, "measures")) {
    return NOOP_MEASUREMENT;
  }
  const t0 = performance.now();
  let ended = false;
  return Object.freeze({
    end: () => {
      if (ended) {
        badInput("startMeasurement.end", name, "already ended");
        return;
      }
      ended = true;
      ctx._internal.stats.measures.set(name, performance.now() - t0);
    },
  });
}

import { _frameEnd, _frameStart, _recordDraw } from "./internal.ts";

/**
 * **Escape hatch.** Public wrapper over the internal `_recordDraw` hook.
 * Increments `Snapshot.gpu.drawCalls` by 1 and adds `info.triangles` to
 * `Snapshot.gpu.triangles`.
 *
 * Use when issuing your own `GPURenderPassEncoder.draw*` calls outside
 * `frame.render` / `frame.renderToTexture` (those paths already record
 * draws internally). Calling this in addition to a managed render path
 * will double-count.
 */
export function recordDraw(ctx: Context, info: { triangles: number }): void {
  _recordDraw(ctx, info);
}

/**
 * Manual frame boundary — calls `_frameEnd` (which fires {@link onFrame}
 * subscribers with this frame's snapshot) and then `_frameStart` to open
 * the next frame's counters.
 *
 * For consumers driving their own render loop without `frame.loop`
 * (`frame.loop` already calls these hooks). Calling this in addition to
 * `frame.loop` will produce two `onFrame` deliveries per loop iteration.
 *
 * Runtime-quiet: silently no-ops on a disposed `ctx`.
 */
export function frameBoundary(ctx: Context): void {
  if (ctx._internal.disposed) return;
  _frameEnd(ctx);
  _frameStart(ctx);
}
