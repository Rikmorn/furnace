import { createEmitter, type Emitter } from "../events/emitter.ts";
import type { Context } from "./context-types.ts";
import { FurnaceGpuError } from "./errors.ts";

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
};

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

  const emitter = createEmitter<ResizeEvent>();
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

function teardownIfIdle(internal: InternalWithResize): void {
  const emitter = internal.resizeEmitter;
  if (!emitter || emitter.listenerCount > 0) return;
  internal.resizeObserver?.disconnect();
  internal.resizeObserver = undefined;
  internal.resizeEmitter = undefined;
}
