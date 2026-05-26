import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/context-types.ts";
import { onResize } from "../gpu/resize.ts";
import { setAspect } from "./common.ts";
import type { Camera } from "./types.ts";

/**
 * Update a camera's projection in response to a new canvas size.
 *
 * Dispatches by camera kind:
 * - perspective: recomputes aspect from `width / height` via `setAspect`.
 * - orthographic: no-op in this tranche. Tranche A-2 will introduce an
 *   explicit fitPolicy (preserve-height / preserve-width / contain / cover
 *   / fixed-units) to fill this branch.
 *
 * Throws on non-finite or non-positive width/height.
 */
export function updateForSize(
  cam: Camera,
  size: { width: number; height: number },
): void {
  if (cam == null) {
    throw new FurnaceError("cam must not be null/undefined");
  }
  const { width, height } = size;
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new FurnaceError("width and height must be finite numbers");
  }
  if (width <= 0 || height <= 0) {
    throw new FurnaceError("width and height must be positive");
  }
  if (cam.projection.kind === "perspective") {
    setAspect(cam, width / height);
    return;
  }
  // orthographic: no-op (Tranche A-2 will fill this branch with a configurable fitPolicy).
}

/**
 * Bind a camera's projection to a canvas's resize events. Applies once
 * immediately with the current canvas size, then subscribes to `gpu.onResize`
 * and calls `updateForSize` on every resize event.
 *
 * Returns an unsubscribe function (idempotent). Call in dispose.
 *
 * For orthographic cameras, this subscribes successfully but is currently a
 * no-op per `updateForSize`'s contract; consumers managing orthographic bounds
 * per-frame (via `setBounds`) can continue doing so without conflict.
 */
export function bindToCanvas(cam: Camera, ctx: Context): () => void {
  if (cam == null) {
    throw new FurnaceError("cam must not be null/undefined");
  }
  if (ctx == null) {
    throw new FurnaceError("ctx must not be null/undefined");
  }
  updateForSize(cam, { width: ctx.canvas.width, height: ctx.canvas.height });
  return onResize(ctx, ({ width, height }) => {
    updateForSize(cam, { width, height });
  });
}
