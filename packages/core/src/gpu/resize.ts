import { createEmitter, type Emitter } from "../events/emitter.ts";
import type { Context } from "./context-types.ts";
import { _onDispose } from "./dispose-cascade.ts";
import { FurnaceGpuError } from "./errors.ts";

/**
 * Payload delivered to {@link onResize} subscribers when the canvas resizes.
 *
 * `width` / `height` are backing-store dimensions in device pixels — the
 * engine's "size truth" for cameras, viewports, and render targets.
 * `cssWidth` / `cssHeight` are the CSS-pixel layout dimensions reported by
 * the browser. `pixelRatio` matches `Context.pixelRatio` (i.e. the configured
 * value, not necessarily live `devicePixelRatio`). See `engine-conventions.md`
 * §"Device pixel ratio".
 */
export type ResizeEvent = Readonly<{
  cssWidth: number;
  cssHeight: number;
  width: number;
  height: number;
  pixelRatio: number;
}>;

// Boundary type — resize wiring is stashed on _internal lazily, matching the
// canvasContext pattern in gpu/context.ts. The same-module write/read invariant
// makes the localised cast in onResize the boundary mechanism.
type InternalWithResize = {
  disposed: boolean;
  canvasContext: GPUCanvasContext;
  resizeEmitter?: Emitter<ResizeEvent>;
  resizeObserver?: ResizeObserver;
  // Deregisters the dispose-cascade callback, so early teardown (last
  // subscriber leaves) keeps the registration 1:1 with the observer.
  resizeDisposeOff?: () => void;
};

/**
 * Subscribe to canvas resize events. Returns an unsubscribe function.
 *
 * On the first subscription for a given context the engine installs a
 * `ResizeObserver` on `ctx.canvas`. On each observed resize it updates the
 * canvas backing store (`canvas.width`/`canvas.height = cssSize * pixelRatio`)
 * *before* firing subscribers, so by the time `fn` runs the backing store
 * already matches the new {@link ResizeEvent}. The observer is torn down
 * automatically when the last subscriber unsubscribes.
 *
 * Setup-loud: throws on disposed ctx (per the foreground failure policy in
 * `engine-conventions.md` §"Failure policy"). Subscribing to a dead ctx is
 * a bug.
 *
 * @returns Unsubscribe function. Idempotent — calling more than once has no
 * additional effect.
 * @throws FurnaceGpuError - if `ctx` has been disposed.
 */
export function onResize(
  ctx: Context,
  fn: (event: ResizeEvent) => void,
): () => void {
  if (ctx._internal.disposed) {
    throw new FurnaceGpuError("context disposed");
  }

  // Boundary cast: resize wiring lives on _internal but isn't in the public InternalState shape.
  const internal = ctx._internal as unknown as InternalWithResize;
  const emitter = ensureResizeWiring(ctx, internal);
  const unsubscribe = emitter.on(fn);

  return () => {
    unsubscribe();
    teardownIfIdle(internal);
  };
}

function ensureResizeWiring(
  ctx: Context,
  internal: InternalWithResize,
): Emitter<ResizeEvent> {
  if (internal.resizeEmitter) return internal.resizeEmitter;

  const emitter = createEmitter<ResizeEvent>(ctx, "gpu.onResize");
  internal.resizeEmitter = emitter;
  internal.resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target !== ctx.canvas) continue;
      const event = computeResizeEvent(entry.contentRect, ctx);
      ctx.canvas.width = event.width;
      ctx.canvas.height = event.height;
      internal.resizeEmitter?.emit(event);
    }
  });
  internal.resizeObserver.observe(ctx.canvas);
  // The ResizeObserver is ctx-bound lazy infrastructure. Self-register its
  // teardown with the dispose cascade so gpu.dispose disconnects it even when
  // the consumer never unsubscribes — mirrors frame.render / post.intermediate.
  // Per-context: _onDispose keys callbacks by ctx, so disposing one context
  // never tears down another's resize wiring.
  internal.resizeDisposeOff = _onDispose(ctx, () => {
    teardownResizeWiring(internal);
  });
  return emitter;
}

function computeResizeEvent(
  contentRect: DOMRectReadOnly,
  ctx: Context,
): ResizeEvent {
  const dpr = ctx.pixelRatio;
  const cssWidth = contentRect.width;
  const cssHeight = contentRect.height;
  return {
    cssWidth,
    cssHeight,
    width: Math.floor(cssWidth * dpr),
    height: Math.floor(cssHeight * dpr),
    pixelRatio: dpr,
  };
}

function teardownResizeWiring(internal: InternalWithResize): void {
  internal.resizeObserver?.disconnect();
  internal.resizeObserver = undefined;
  internal.resizeEmitter = undefined;
  // Clearing the deregister fn matters on the early-unsubscribe path (so a
  // later gpu.dispose finds nothing to do); on the cascade path it's already
  // inert because _runDisposeCascade removed the callback list first.
  internal.resizeDisposeOff = undefined;
}

function teardownIfIdle(internal: InternalWithResize): void {
  const emitter = internal.resizeEmitter;
  if (!emitter || emitter.listenerCount > 0) return;
  // Deregister the cascade callback before clearing, so a later gpu.dispose
  // doesn't call into already-torn-down wiring.
  internal.resizeDisposeOff?.();
  teardownResizeWiring(internal);
}
