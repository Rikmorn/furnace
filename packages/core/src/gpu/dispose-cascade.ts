import { error } from "../log/internal.ts";
import type { Context } from "./context-types.ts";
import { FurnaceGpuError } from "./errors.ts";

const callbacksByCtx = new WeakMap<Context, Array<() => void>>();

/**
 * Register a teardown callback to run during `gpu.dispose(ctx)`.
 *
 * Engine-internal. Modules with ctx-bound lazy state self-register cleanup
 * on first allocation. Callbacks run LIFO during dispose, before the
 * context's disposed flag is set, so they may call `_unregisterResource`
 * and raw GPU `.destroy()` freely.
 *
 * @throws FurnaceGpuError - if `ctx` is already disposed (setup-loud, per
 *   `engine-conventions.md` §"Failure policy").
 * @returns unsubscribe function; calling it removes the callback before
 *   the cascade runs. After dispose has run, the returned function no-ops.
 */
export function _onDispose(ctx: Context, cb: () => void): () => void {
  if (ctx._internal.disposed) {
    throw new FurnaceGpuError("context disposed");
  }
  let list = callbacksByCtx.get(ctx);
  if (!list) {
    list = [];
    callbacksByCtx.set(ctx, list);
  }
  list.push(cb);
  return () => {
    const current = callbacksByCtx.get(ctx);
    if (!current) return;
    const idx = current.indexOf(cb);
    if (idx >= 0) current.splice(idx, 1);
  };
}

/**
 * Walk the registered callbacks for `ctx` in LIFO order, catching throws
 * and routing them through the engine log helper at `error` level so a
 * misbehaving module cannot strand its siblings. The log call is itself
 * wrapped in a defensive try/catch — a throwing sink does not break the
 * cascade (matches the iteration-continues invariant from
 * `packages/core/src/events/emitter.ts`).
 *
 * The callback list is removed from the registry before iteration begins,
 * which naturally makes a re-entrant cascade walk a no-op. Engine-internal —
 * `gpu.dispose` is the only caller.
 */
export function _runDisposeCascade(ctx: Context): void {
  const list = callbacksByCtx.get(ctx);
  if (!list) return;
  callbacksByCtx.delete(ctx);
  for (let i = list.length - 1; i >= 0; i--) {
    const cb = list[i];
    if (!cb) continue;
    try {
      cb();
    } catch (err) {
      try {
        error("gpu", "onDispose callback threw", err);
      } catch {
        // Sink threw while logging the cascade-callback throw.
        // Swallow so iteration continues. Mirrors the device-lost
        // handler's defensive try/catch in `gpu/context.ts`.
      }
    }
  }
}
