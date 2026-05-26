import type { Vec3 } from "../transform/types.ts";
import * as common from "./common.ts";
import type { Camera } from "./types.ts";

/**
 * Out-param shape mutated by {@link projectToScreen}.
 *
 * `x` and `y` are CSS pixels with the origin at the canvas's top-left.
 * `w` is the clip-space divisor — useful for distance-based label sizing
 * (smaller `w` = closer to camera).
 */
export type ScreenProjection = {
  x: number;
  y: number;
  w: number;
};

/**
 * Project a world-space point to canvas-relative screen pixels.
 *
 * Mutates `out` with screen `{x, y}` (CSS pixels, origin top-left) and the
 * clip-space `w` divisor (useful for distance-based label sizing).
 *
 * Returns `true` if the point is in front of the camera (`w > 0`), `false`
 * if behind. When false, `out` is left untouched — callers should hide the
 * label rather than position it.
 *
 * Viewport dimensions are CSS pixels (canvas.clientWidth / clientHeight),
 * not device pixels (canvas.width / height). DPR is the caller's problem.
 *
 * Non-finite inputs (NaN/Infinity in `worldPoint`) propagate to `out` without
 * throwing — consistent with the engine's "runtime quiet" policy.
 */
export function projectToScreen(
  out: ScreenProjection,
  cam: Camera,
  worldPoint: Vec3,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  const m = common.getMatrices(cam).viewProjection;
  const wx = worldPoint[0] as number;
  const wy = worldPoint[1] as number;
  const wz = worldPoint[2] as number;

  // Column-major M * (wx, wy, wz, 1). Only clip x, y, w needed.
  const cx =
    (m[0] as number) * wx +
    (m[4] as number) * wy +
    (m[8] as number) * wz +
    (m[12] as number);
  const cy =
    (m[1] as number) * wx +
    (m[5] as number) * wy +
    (m[9] as number) * wz +
    (m[13] as number);
  const cw =
    (m[3] as number) * wx +
    (m[7] as number) * wy +
    (m[11] as number) * wz +
    (m[15] as number);

  if (cw <= 0) return false;

  const ndcX = cx / cw;
  const ndcY = cy / cw;

  out.x = (ndcX * 0.5 + 0.5) * viewportWidth;
  // Flip Y: NDC is Y-up, screen is Y-down (origin top-left).
  out.y = (1 - (ndcY * 0.5 + 0.5)) * viewportHeight;
  out.w = cw;

  return true;
}
