import { createEmitter, type Emitter } from "../events/emitter.ts";
import type { Context } from "./context-types.ts";
import { FurnaceGpuError } from "./errors.ts";

// Boundary type — module-private field installed on `_internal` by this
// module. Same pattern as gpu/uncaptured-error.ts and gpu/resize.ts. The
// type system can't track the installation across the public InternalState
// shape; localised casts at the read/write sites make this safe.
type InternalWithDeviceLostEmitter = {
  deviceLostEmitter?: Emitter<GPUDeviceLostInfo>;
};

function getOrCreateEmitter(ctx: Context): Emitter<GPUDeviceLostInfo> {
  // Boundary cast: this module installs `deviceLostEmitter` on the
  // engine-private `_internal` shape; TS can't track field installation
  // across the public InternalState boundary.
  const internal = ctx._internal as unknown as InternalWithDeviceLostEmitter;
  if (!internal.deviceLostEmitter) {
    internal.deviceLostEmitter = createEmitter<GPUDeviceLostInfo>(
      ctx,
      "gpu.onDeviceLost",
    );
  }
  return internal.deviceLostEmitter;
}

/**
 * Engine-internal helper called from the `device.lost` promise handler in
 * `gpu/context.ts`. Emits the {@link GPUDeviceLostInfo} on the lazy-init
 * emitter; no-ops when no subscriber has attached (the emitter was never
 * created).
 */
export function _emitDeviceLost(ctx: Context, info: GPUDeviceLostInfo): void {
  // Boundary cast: read back the engine-private field installed by this
  // module. Pre-create check skips the lazy init when no subscriber exists.
  const internal = ctx._internal as unknown as InternalWithDeviceLostEmitter;
  internal.deviceLostEmitter?.emit(info);
}

/**
 * Subscribe to WebGPU `device.lost` notification on `ctx`. The callback
 * receives the {@link GPUDeviceLostInfo} (with `reason` of `"unknown"` or
 * `"destroyed"` and a `message` string).
 *
 * Fires at most once per context — `device.lost` is a promise that resolves
 * a single time. Subscribers added after resolution are registered but
 * will never fire.
 *
 * The engine skips the emit / log / stat when `gpu.dispose(ctx)` has been
 * called, because `device.destroy()` itself resolves the lost promise with
 * `reason: "destroyed"` — that's expected teardown, not a runtime failure.
 *
 * The emitter is created lazily on the first subscription, so call sites
 * that never subscribe pay zero overhead.
 *
 * Setup-loud: throws on disposed `ctx` (per the foreground failure policy
 * in `engine-conventions.md` §"Failure policy"). Subscribing to a dead ctx
 * is a bug.
 *
 * Subscriber-throw handling follows the standard emitter contract (see
 * {@link createEmitter}): throws are caught, routed via the log helper at
 * `error` level, and iteration continues.
 *
 * @returns An idempotent unsubscribe function — safe to call once, never,
 * or repeatedly.
 *
 * @throws FurnaceGpuError - if `ctx` has been disposed.
 */
export function onDeviceLost(
  ctx: Context,
  fn: (info: GPUDeviceLostInfo) => void,
): () => void {
  if (ctx._internal.disposed) {
    throw new FurnaceGpuError("context disposed");
  }
  return getOrCreateEmitter(ctx).on(fn);
}
