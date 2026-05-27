import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/context-types.ts";
import { onResize } from "../gpu/resize.ts";
import { _deriveBounds } from "./fit-policy.ts";
import type { Camera } from "./types.ts";

/**
 * Update a camera's projection in response to a new canvas size.
 *
 * Dispatches by camera kind:
 * - perspective: sets `projection.aspect = width / height`.
 * - orthographic: derives bounds via `_deriveBounds(fitPolicy, scale, width, height)`
 *   and writes them to the projection.
 *
 * Both branches update `cam._lastSize` and flip `projDirty`.
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
  cam._lastSize = { width, height };
  if (cam.projection.kind === "perspective") {
    cam.projection.aspect = width / height;
    cam.projDirty = true;
    return;
  }
  // orthographic: derive bounds from the camera's fit policy.
  const b = _deriveBounds(
    cam.projection.fitPolicy,
    cam.projection.scale,
    width,
    height,
  );
  cam.projection.left = b.left;
  cam.projection.right = b.right;
  cam.projection.bottom = b.bottom;
  cam.projection.top = b.top;
  cam.projDirty = true;
}

/**
 * Bind a camera's projection to a canvas's resize events. Applies once
 * immediately with the current canvas size, then subscribes to `gpu.onResize`
 * and calls `updateForSize` on every resize event.
 *
 * Returns an unsubscribe function (idempotent). Call in dispose.
 *
 * Works for both perspective and orthographic cameras. For orthographic, the
 * camera's `fitPolicy` (default `stretch`) determines how bounds respond to
 * resize.
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
