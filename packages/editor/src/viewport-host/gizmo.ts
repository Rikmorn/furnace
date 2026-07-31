/**
 * Pure-math core of the world-axis translate gizmo — the three handles a
 * selected entity wears, and the arithmetic that turns a cursor ray into a
 * constrained drag along one of them (D-9).
 *
 * No engine imports: it operates on plain `[x,y,z]` tuples, so every rule here
 * unit-tests without a camera, a canvas or a GPU, and it shares no state with
 * the host. `field-host.ts` owns everything stateful — where the handles sit
 * (the selected footprint's centre), how long they are, when they are drawn,
 * and the session the drag rides. It builds rays through `camera.screenToRay`,
 * marshals them into the {@link Ray} tuple shape, and calls three things here:
 * {@link pickAxis} on the press, {@link closestPointParamOnAxis} on every move,
 * and {@link isViewParallel} to refuse a reading that would be meaningless.
 *
 * The DRAWING is the host's too and deliberately not here: the handle colours
 * are the editor's semantic axis palette (shared with the chrome's `AxisTriad`),
 * which is a chrome fact, and the line batch is engine-shaped. What this module
 * owns is only what a wrong answer would make the gizmo mis-aim.
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
 * Whether `axisDir` is within ~8° of `ray`'s own direction — the state in which
 * a handle projects to nearly a POINT on screen and every world-space reading
 * taken along it (a hit distance, a drag parameter) is ill-conditioned.
 *
 * Both {@link pickAxis} (which culls such an axis before hit-testing) and the
 * host's drag (which holds still rather than lurch) ask this, which is why it is
 * exported rather than inlined: two callers deciding "too edge-on to trust" by
 * two different thresholds is how a handle becomes pickable but undraggable.
 *
 * Assumes UNIT `axisDir` and UNIT `ray.dir` — the dot product is read as a
 * cosine. Both hold for the callers: {@link AXIS_DIR}'s entries are unit, and
 * `camera.screenToRay` normalizes.
 */
export const isViewParallel = (axisDir: V3, ray: Ray): boolean =>
  Math.abs(dot(axisDir, ray.dir)) > VIEW_PARALLEL_COS;

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
 * nearest-wins. Only the segment `[innerLen, axisLen]` along each axis (the
 * drawn handle, not the infinite line) counts as a hit, and axes within ~8° of
 * view-parallel are culled (their screen-space hit test is degenerate).
 *
 * `innerLen` is the DEAD ZONE at the origin, and it is not cosmetic: all three
 * axes converge there, every one of them is within `tol` of a ray through it,
 * and the winner would be whichever this loop visits first — so a click on the
 * gizmo's own centre would silently mean "X". That centre is also exactly where
 * the caller's other gesture lives (press the object, drag it freely), so the
 * arms have to leave it alone. The caller must DRAW from the same offset:
 * a handle that is visible below `innerLen` is a handle that does nothing.
 *
 * Returns the picked {@link Axis}, or `null` when no handle is within `tol`.
 */
export function pickAxis(
  ray: Ray,
  gizmoOrigin: V3,
  axisLen: number,
  tol: number,
  innerLen = 0,
): Axis | null {
  let best: Axis | null = null;
  let bestD = tol;
  for (const ax of ["x", "y", "z"] as Axis[]) {
    const axisDir = AXES[ax];
    if (isViewParallel(axisDir, ray)) continue;
    const t = closestPointParamOnAxis(gizmoOrigin, axisDir, ray);
    if (t < innerLen || t > axisLen) continue;
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
