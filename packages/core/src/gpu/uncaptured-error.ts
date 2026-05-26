import { createEmitter, type Emitter } from "../events/emitter.ts";
import type { Context } from "./context-types.ts";

// Boundary type — module-private field installed on `_internal` by this
// module. Same pattern as gpu/resize.ts. The type system can't track the
// installation across the public InternalState shape; localised casts at
// the read/write sites make this safe.
type InternalWithUncapturedEmitter = {
  uncapturedErrorEmitter?: Emitter<GPUError>;
};

function getOrCreateEmitter(ctx: Context): Emitter<GPUError> {
  // Boundary cast: this module installs `uncapturedErrorEmitter` on the
  // engine-private `_internal` shape; TS can't track field installation
  // across the public InternalState boundary.
  const internal = ctx._internal as unknown as InternalWithUncapturedEmitter;
  if (!internal.uncapturedErrorEmitter) {
    internal.uncapturedErrorEmitter = createEmitter<GPUError>(
      ctx,
      "gpu.onUncapturedError",
    );
  }
  return internal.uncapturedErrorEmitter;
}

/**
 * Engine-internal helper called from the `uncapturederror` listener in
 * `gpu/context.ts`. Emits the unwrapped {@link GPUError} on the lazy-init
 * emitter; no-ops when no subscriber has attached (the emitter was never
 * created).
 */
export function _emitUncapturedError(ctx: Context, err: GPUError): void {
  // Boundary cast: read back the engine-private field installed by this
  // module. Pre-create check skips the lazy init when no subscriber exists.
  const internal = ctx._internal as unknown as InternalWithUncapturedEmitter;
  internal.uncapturedErrorEmitter?.emit(err);
}

/**
 * Subscribe to WebGPU uncaptured-error events on `ctx`. The callback
 * receives the unwrapped {@link GPUError} (the `.error` field of the
 * underlying `GPUUncapturedErrorEvent`).
 *
 * The emitter is created lazily on the first subscription, so call sites
 * that never subscribe pay zero overhead — only the `_recordUncapturedError`
 * stat counter and the `error("gpu", ...)` log routing fire from the
 * `requestContext` listener.
 *
 * Subscriber-throw handling follows the standard emitter contract (see
 * {@link createEmitter}): throws are caught, routed via the log helper at
 * `error` level, and iteration continues.
 *
 * @returns An idempotent unsubscribe function — safe to call once, never,
 * or repeatedly.
 */
export function onUncapturedError(
  ctx: Context,
  fn: (error: GPUError) => void,
): () => void {
  return getOrCreateEmitter(ctx).on(fn);
}
