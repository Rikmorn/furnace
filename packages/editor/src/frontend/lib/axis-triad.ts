// Pure projection math for the viewport's corner axis triad (an orientation gizmo).
// Given the orbit camera's yaw/pitch it returns where each world axis points on screen,
// so the SVG overlay stays a thin render of these numbers. No DOM, no React — unit-tested.

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
 *  `title`, and the burger's six View rows (`view.snapPosX` … in `lib/actions.ts`). One
 *  spelling because they are one control reached two ways: the tips are under the WCAG 2.2
 *  SC 2.5.8 target-size floor and rest on that SC's equivalent-affordance exception, and
 *  two surfaces wording one view differently would be two controls to a reader rather than
 *  one with a second route. `sign: 1` is the POSITIVE side of the axis, matching
 *  `FieldHost.snapView`'s own convention. */
export const axisViewLabel = (axis: "x" | "y" | "z", sign: 1 | -1): string =>
  `View from ${sign === 1 ? "+" : "-"}${axis.toUpperCase()}`;

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
