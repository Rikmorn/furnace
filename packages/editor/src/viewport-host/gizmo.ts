/**
 * Pure-math core of the world-axis translate gizmo. No engine imports — operates
 * on plain `[x,y,z]` tuples so it is trivially unit-testable and shares no state
 * with the host. The host (`viewport-host/index.ts`) builds rays via
 * `camera.screenToRay`, marshals them into the {@link Ray} tuple shape, and
 * drives hit-testing ({@link pickAxis}) and the anchor-relative drag parameter
 * ({@link closestPointParamOnAxis}).
 */

type V3 = [number, number, number];

/** A world-space ray as plain tuples (the host converts engine `Vec3`s to this). */
export type Ray = { origin: V3; dir: V3 };

/** The three world axes a translate handle can lie along. */
export type Axis = "x" | "y" | "z";

const AXES: Record<Axis, V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

// Below this |denominator|, the axis line and the ray are effectively parallel
// and the closest-point parameter is ill-conditioned — treat as degenerate.
const PARALLEL_EPS = 1e-9;
// pickAxis culls an axis whose direction is within this of view-parallel: a
// near-edge-on handle projects to a near-point in screen space, so the world
// hit-distance test is meaningless. 0.99 ≈ within ~8° of the view ray.
const VIEW_PARALLEL_COS = 0.99;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

/**
 * Parameter `t` such that `origin + t·axisDir` is the point on the axis **line**
 * (infinite, through `origin` in direction `axisDir`) closest to `ray`. This is
 * the standard closest-point-between-two-lines parameter for the axis line.
 *
 * `t` is measured in units of `axisDir`'s length: with a unit `axisDir` it is a
 * world-space distance along the axis from `origin`; the gizmo always passes
 * unit axes, so the drag delta `(currentT − startT)` is a world-space offset.
 *
 * Returns `0` when the ray is (near-)parallel to the axis (`|denom| <
 * PARALLEL_EPS`) — the parameter is undefined there. {@link pickAxis} culls
 * near-view-parallel axes before this matters for hit-testing.
 */
export function closestPointParamOnAxis(
  origin: V3,
  axisDir: V3,
  ray: Ray,
): number {
  const u = axisDir;
  const v = ray.dir;
  const w0 = sub(origin, ray.origin);
  const a = dot(u, u);
  const b = dot(u, v);
  const c = dot(v, v);
  const d = dot(u, w0);
  const e = dot(v, w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < PARALLEL_EPS) return 0;
  return (b * e - c * d) / denom;
}

/**
 * Shortest distance (world units) between `ray` and the axis line, evaluated at
 * the lines' mutual closest points. Used by {@link pickAxis} to decide whether a
 * handle is "under" the cursor.
 */
function rayAxisDistance(origin: V3, axisDir: V3, ray: Ray): number {
  const t = closestPointParamOnAxis(origin, axisDir, ray);
  const pAxis: V3 = [
    origin[0] + t * axisDir[0],
    origin[1] + t * axisDir[1],
    origin[2] + t * axisDir[2],
  ];
  const w = sub(pAxis, ray.origin);
  const s = dot(w, ray.dir) / dot(ray.dir, ray.dir);
  const pRay: V3 = [
    ray.origin[0] + s * ray.dir[0],
    ray.origin[1] + s * ray.dir[1],
    ray.origin[2] + s * ray.dir[2],
  ];
  return len(sub(pAxis, pRay));
}

/**
 * Which world axis (if any) `ray` hits within `tol` world units of the handle,
 * nearest-wins. Only the segment `[0, axisLen]` along each axis (the drawn
 * handle, not the infinite line) counts as a hit, and axes within ~8° of
 * view-parallel are culled (their screen-space hit test is degenerate).
 *
 * Returns the picked {@link Axis}, or `null` when no handle is within `tol`.
 */
export function pickAxis(
  ray: Ray,
  gizmoOrigin: V3,
  axisLen: number,
  tol: number,
): Axis | null {
  let best: Axis | null = null;
  let bestD = tol;
  for (const ax of ["x", "y", "z"] as Axis[]) {
    const axisDir = AXES[ax];
    if (Math.abs(dot(axisDir, ray.dir)) > VIEW_PARALLEL_COS) continue;
    const t = closestPointParamOnAxis(gizmoOrigin, axisDir, ray);
    if (t < 0 || t > axisLen) continue;
    const dist = rayAxisDistance(gizmoOrigin, axisDir, ray);
    if (dist < bestD) {
      bestD = dist;
      best = ax;
    }
  }
  return best;
}

/** The three unit world-axis directions, keyed by {@link Axis}. */
export const AXIS_DIR = AXES;
