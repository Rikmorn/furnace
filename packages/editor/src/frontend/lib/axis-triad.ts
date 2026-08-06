// The viewport's corner axis triad (an orientation gizmo), minus its rendering: the
// projection math, and the one function that NAMES a snap view. Given the orbit camera's
// yaw/pitch the projection returns where each world axis points on screen, so the SVG
// overlay stays a thin render of these numbers. No DOM, no React — unit-tested.
//
// The naming function sits here rather than beside the component because two surfaces need
// it — the gizmo and the registry's six View rows — and only one of them is a component:
// `lib/actions.ts` is pure and cannot import a `.tsx`.

type Vec3 = [number, number, number];

/** A world axis projected into the triad's 2D screen frame. `x`/`y` are a unit-length
 *  direction in SVG coordinates (y grows downward); `depth` is the component along the
 *  camera's view direction (`> 0` points away from the viewer, into the screen) so the
 *  overlay can draw far axes first / dim them. */
export type ProjectedAxis = {
  axis: "x" | "y" | "z";
  x: number;
  y: number;
  depth: number;
};

/** How a snap view is NAMED, everywhere it is named — each triad tip's `aria-label` and
 *  `title`, and the burger's six View rows. One spelling because they are one control
 *  reached two ways; the argument for why that matters is on `axisView` in
 *  `lib/actions.ts`.
 *
 *  The words "positive" and "negative", not `+` and `-`. That is the ACCESSIBLE spelling
 *  rather than a verbose one: at default punctuation verbosity a screen reader commonly
 *  drops a bare `+` or `-`, which would leave the three pairs announcing identically — and
 *  as six adjacent menu rows that is the alternative route to an under-sized control
 *  collapsing to three. Axis letters rather than a ViewCube's Front/Back/Left/Right: the
 *  gizmo draws X, Y and Z, so those are the words its labels have to use.
 *
 *  `sign: 1` is the POSITIVE side of the axis, matching `FieldHost.snapView`. */
export const axisViewLabel = (axis: "x" | "y" | "z", sign: 1 | -1): string =>
  `View from ${sign === 1 ? "positive" : "negative"} ${axis.toUpperCase()}`;

const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len < 1e-8 ? [0, 0, 0] : [v[0] / len, v[1] / len, v[2] / len];
};

/**
 * Project the three world axes into the triad's 2D screen frame for the given orbit
 * `yaw`/`pitch` (radians), mirroring `camera-control.ts`'s spherical convention: the eye
 * sits at `target + distance·[cosθ·sinφ, sinφ, cosθ·cosφ]`, so the view direction is the
 * negation of that offset. World up is `+Y`. Distance and target don't affect orientation,
 * so they're not needed here.
 *
 * @returns The projected X, Y, Z axes, in that order.
 */
export function projectAxisTriad(
  yaw: number,
  pitch: number,
): [ProjectedAxis, ProjectedAxis, ProjectedAxis] {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Eye→target direction (the offset above, negated), already unit length.
  const forward: Vec3 = [-cp * Math.sin(yaw), -sp, -cp * Math.cos(yaw)];
  const right = normalize(cross(forward, [0, 1, 0]));
  const camUp = cross(right, forward); // unit: right ⟂ forward, both unit
  const project = (axis: "x" | "y" | "z", dir: Vec3): ProjectedAxis => ({
    axis,
    x: dot(dir, right),
    // SVG y grows downward, so flip the up-component.
    y: -dot(dir, camUp),
    depth: dot(dir, forward),
  });
  return [
    project("x", [1, 0, 0]),
    project("y", [0, 1, 0]),
    project("z", [0, 0, 1]),
  ];
}
