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
 * The handle GEOMETRY lives here too — {@link gizmoSpan} derives it from the
 * selected footprint and {@link axisLines} emits the vertex/colour pair a
 * `drawLines` batch wants — because the drawn arms and the picked arms must be
 * the same span or the gizmo lies about where it can be grabbed. Only the
 * COLOURS come from the caller: they are the editor's semantic axis palette
 * (shared with the chrome's `AxisTriad`) and belong beside the theme, not beside
 * the arithmetic.
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

// --- handle geometry --------------------------------------------------------

// Floor on the arm length, so a hair-thin entity still gets something grabbable.
const MIN_HANDLE_LEN_M = 0.75;
// The dead zone at the origin, as a fraction of the arm: all three arms converge
// there, so a click on the centre would resolve to whichever axis pickAxis
// visits first — and the centre is where the caller's OTHER gesture lives (press
// the object, drag it freely). See {@link pickAxis}'s `innerLen`.
const HANDLE_INNER_FRACTION = 0.25;
// Pick tolerance as a fraction of the arm rather than a world constant: the
// target scales with the handle being aimed at, instead of a big entity's gizmo
// being needle-thin to hit and a tiny one's swallowing the box behind it.
const PICK_TOL_FRACTION = 0.15;

/** Where a selected footprint's handles sit and how big they are. All four
 *  numbers come out of ONE derivation deliberately: the drawn arm, the pickable
 *  arm, the dead zone and the hit tolerance are the same fact, and deriving them
 *  separately is how a gizmo ends up grabbable somewhere it is not drawn. */
export type GizmoSpan = {
  origin: V3;
  /** Arm length in metres, from `origin` outward. */
  len: number;
  /** Where each arm STARTS — the dead zone's outer edge. */
  inner: number;
  /** Hit tolerance in metres, for {@link pickAxis}. */
  tol: number;
};

/**
 * The handle span for a footprint AABB: arms centred on the box, reaching
 * roughly its longest face (its largest half-extent, floored at
 * {@link MIN_HANDLE_LEN_M}) so they stay proportionate to the thing they move.
 */
export function gizmoSpan(box: { min: V3; max: V3 }): GizmoSpan {
  const len = Math.max(
    MIN_HANDLE_LEN_M,
    Math.max(
      box.max[0] - box.min[0],
      box.max[1] - box.min[1],
      box.max[2] - box.min[2],
    ) / 2,
  );
  return {
    origin: [
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2,
    ],
    len,
    inner: len * HANDLE_INNER_FRACTION,
    tol: len * PICK_TOL_FRACTION,
  };
}

/** A `drawLines`-shaped vertex/colour pair. Structural, not an engine import —
 *  this module stays free of `@furnace/core` (see the module docblock). */
export type AxisLines = { vertices: Float32Array; colors: Float32Array };

/**
 * The handle arms as line segments, each `[inner, len]` along its axis — exactly
 * the span {@link pickAxis} accepts for the same {@link GizmoSpan}, which is the
 * point of taking one.
 *
 * `only` restricts the batch to a single axis: while a drag is CONSTRAINED to
 * one, that arm is the constraint indicator and the other two would advertise
 * motion the drag will not make. `null` draws all three.
 */
export function axisLines(
  span: GizmoSpan,
  colors: Record<Axis, readonly [number, number, number, number]>,
  only: Axis | null = null,
): AxisLines {
  const axes: Axis[] = only === null ? ["x", "y", "z"] : [only];
  const vertices = new Float32Array(axes.length * 6);
  const rgba = new Float32Array(axes.length * 8);
  const at = (dir: V3, d: number): V3 => [
    span.origin[0] + dir[0] * d,
    span.origin[1] + dir[1] * d,
    span.origin[2] + dir[2] * d,
  ];
  axes.forEach((ax, i) => {
    const dir = AXES[ax];
    vertices.set(at(dir, span.inner), i * 6);
    vertices.set(at(dir, span.len), i * 6 + 3);
    rgba.set(colors[ax], i * 8);
    rgba.set(colors[ax], i * 8 + 4);
  });
  return { vertices, colors: rgba };
}
