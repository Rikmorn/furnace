type V3 = [number, number, number];

/** Orbit camera as target + spherical offset. Editor-only; never serialized. */
export type OrbitState = {
  target: V3;
  distance: number;
  yaw: number;
  pitch: number;
};

const PITCH_LIMIT = Math.PI / 2 - 0.01; // avoid pole flip
// Dolly (scroll-travel) step per wheel notch: a fraction of the current view
// distance so it scales with the scene, floored so a tight framing still travels —
// it never crawls to a stop the way distance-scaled orbit zoom does.
const DOLLY_FRACTION = 0.15;
const DOLLY_MIN_STEP = 0.15;
/** How much room {@link frameBox} gives what it framed: the box's longest edge
 *  times this is the view distance. At the editor's 60° vertical FOV a cube-ish
 *  box then spans ~31° of the 60°, i.e. about half the frame height — framed
 *  with margin rather than touching the edges. */
const FRAME_FIT = 1.8;
/** Floor on a framed distance, in metres. Without it a single-voxel selection
 *  fits to under half a metre and puts the eye inside the geometry it framed. */
const FRAME_MIN_DISTANCE_M = 2;

/** Clamp a pitch to just inside ±90° so the spherical rig never reaches the pole. */
function clampPitch(pitch: number): number {
  return Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
}

/** Unit-length copy of `v`; returns [0,0,0] for a (near-)zero vector — callers guard. */
function normalized(v: V3): V3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len < 1e-8 ? [0, 0, 0] : [v[0] / len, v[1] / len, v[2] / len];
}

/** Unit direction from target to eye for a spherical (yaw, pitch) orientation. */
function sphericalDir(yaw: number, pitch: number): V3 {
  const cp = Math.cos(pitch);
  return [cp * Math.sin(yaw), Math.sin(pitch), cp * Math.cos(yaw)];
}

/** The camera's orthonormal frame for a (yaw, pitch): view-forward, screen-right
 *  (kept horizontal, well-defined while |pitch| < 90° — which {@link clampPitch}
 *  guarantees) and the up that completes them. */
function basis(yaw: number, pitch: number): { f: V3; r: V3; u: V3 } {
  const dir = sphericalDir(yaw, pitch);
  const f: V3 = [-dir[0], -dir[1], -dir[2]];
  const r = normalized([-f[2], 0, f[0]]);
  const u: V3 = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ];
  return { f, r, u };
}

/**
 * Orbit about an arbitrary world `pivot`, holding the pivot where it is ON SCREEN.
 *
 * The yaw/pitch deltas are the same ones {@link flyLook} takes, and the pitch is
 * clamped the same way — the difference is where the rig ends up. `flyLook` pins
 * the EYE and swings the view; this pins the PIVOT and swings the whole rig
 * around it, so the thing being orbited neither drifts across the frame nor
 * jumps when the drag starts.
 *
 * It works by reading the pivot's coordinates in the camera's own frame, turning
 * the frame, and placing the eye so those coordinates come out unchanged —
 * which is what "the same pixel" means. `distance` is preserved and `target`
 * lands wherever the new view direction puts it.
 *
 * Passing the state's OWN target as the pivot reduces to a plain yaw/pitch turn
 * with the target untouched (the pivot is then `distance` straight ahead, and
 * that is exactly where it is put back) — which is why there is no separate
 * `orbit`.
 */
export function orbitAbout(
  s: OrbitState,
  pivot: V3,
  dYaw: number,
  dPitch: number,
): OrbitState {
  const { eye } = toEyeTarget(s);
  const rel: V3 = [pivot[0] - eye[0], pivot[1] - eye[1], pivot[2] - eye[2]];
  const before = basis(s.yaw, s.pitch);
  // The pivot in camera coordinates — the triple that has to survive the turn.
  const cr = rel[0] * before.r[0] + rel[1] * before.r[1] + rel[2] * before.r[2];
  const cu = rel[0] * before.u[0] + rel[1] * before.u[1] + rel[2] * before.u[2];
  const cf = rel[0] * before.f[0] + rel[1] * before.f[1] + rel[2] * before.f[2];
  const yaw = s.yaw + dYaw;
  const pitch = clampPitch(s.pitch + dPitch);
  const after = basis(yaw, pitch);
  const target: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const axis = i as 0 | 1 | 2;
    // eye = pivot − (the same camera-space offset, re-expressed in the new frame)
    const eyeI =
      pivot[axis] -
      (cr * after.r[axis] + cu * after.u[axis] + cf * after.f[axis]);
    target[axis] = eyeI + s.distance * after.f[axis];
  }
  return { target, distance: s.distance, yaw, pitch };
}

/**
 * Dolly the whole rig along the view direction — travel forward/back through the
 * scene rather than orbit-zooming toward the pivot (which asymptotes to a dead
 * stop and whose speed swings with the hidden pivot distance). `direction` is +1
 * forward (into the scene) / −1 back. The per-notch step scales with the current
 * distance (scale-aware) but is floored, so it never crawls to zero. Distance and
 * orientation are preserved; only the rig translates (a forward {@link flyMove}).
 */
export function dolly(s: OrbitState, direction: number): OrbitState {
  const step = Math.max(DOLLY_MIN_STEP, s.distance * DOLLY_FRACTION);
  return flyMove(s, { f: direction, r: 0, u: 0 }, step);
}

/**
 * Frame a metre AABB: pivot on its centre and back off far enough to see it,
 * keeping the orientation the user is looking from. A FIT, not a flight — yaw
 * and pitch are untouched, so framing shows the thing from where you already
 * were rather than resetting the view.
 *
 * The distance is the box's longest edge × {@link FRAME_FIT}, floored at
 * {@link FRAME_MIN_DISTANCE_M} so a one-voxel box cannot put the eye inside it.
 */
export function frameBox(s: OrbitState, box: { min: V3; max: V3 }): OrbitState {
  const target: V3 = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  const longest = Math.max(
    box.max[0] - box.min[0],
    box.max[1] - box.min[1],
    box.max[2] - box.min[2],
  );
  return {
    ...s,
    target,
    distance: Math.max(FRAME_MIN_DISTANCE_M, longest * FRAME_FIT),
  };
}

/**
 * Snap to an axis-aligned view. `sign: 1` puts the EYE on the POSITIVE side of
 * `axis` looking back at the pivot, `-1` on the negative side — the convention
 * the corner triad's tips are labelled with, so clicking the tip marked +X sends
 * the camera to +X.
 *
 * Target and distance are the user's framing and survive the snap; only the
 * angles move. The two Y views land one hundredth of a radian off the pole (the
 * shared pitch clamp) and KEEP the current yaw, because yaw is undefined
 * straight up — a top view that also spun the horizon would be a second change
 * nobody asked for.
 */
export function axisView(
  s: OrbitState,
  axis: "x" | "y" | "z",
  sign: 1 | -1,
): OrbitState {
  if (axis === "y") return { ...s, pitch: clampPitch((sign * Math.PI) / 2) };
  // Target→eye is sphericalDir(yaw, 0) = [sin yaw, 0, cos yaw]: +Z at yaw 0,
  // +X at yaw +90°.
  const yaw = axis === "x" ? (sign * Math.PI) / 2 : sign === 1 ? 0 : Math.PI;
  return { ...s, yaw, pitch: 0 };
}

/**
 * Fly-look: rotate the view by yaw/pitch deltas with the EYE held fixed
 * (recomputing the target) — the inverse of {@link orbitAbout}, which holds a
 * pivot and swings the rig. Distance is preserved and pitch is clamped. Drives
 * RMB-hold flythrough, where the camera pivots about its own position.
 */
export function flyLook(
  s: OrbitState,
  dYaw: number,
  dPitch: number,
): OrbitState {
  const yaw = s.yaw + dYaw;
  const pitch = clampPitch(s.pitch + dPitch);
  const { eye } = toEyeTarget(s);
  // Offset from target to eye for the new orientation; target = eye − that offset
  // holds the eye exactly where it was while re-aiming the view direction.
  const toEye = sphericalDir(yaw, pitch);
  const target: V3 = [
    eye[0] - s.distance * toEye[0],
    eye[1] - s.distance * toEye[1],
    eye[2] - s.distance * toEye[2],
  ];
  return { target, distance: s.distance, yaw, pitch };
}

/**
 * Fly-move: translate the whole orbit rig (eye + target together) by a
 * camera-relative move — `f` along view-forward, `r` along view-right, `u` along
 * world-up — scaled by `speed`. Yaw/pitch/distance are unchanged; only the target
 * shifts, and the eye follows because it is a fixed spherical offset from it.
 * Drives WASD/QE flythrough movement.
 */
export function flyMove(
  s: OrbitState,
  move: { f: number; r: number; u: number },
  speed: number,
): OrbitState {
  const { f: forward, r: right } = basis(s.yaw, s.pitch);
  const worldUp: V3 = [0, 1, 0];
  const target: V3 = [
    s.target[0] +
      (forward[0] * move.f + right[0] * move.r + worldUp[0] * move.u) * speed,
    s.target[1] +
      (forward[1] * move.f + right[1] * move.r + worldUp[1] * move.u) * speed,
    s.target[2] +
      (forward[2] * move.f + right[2] * move.r + worldUp[2] * move.u) * speed,
  ];
  return { ...s, target };
}

/** Convert spherical orbit state to Cartesian eye position, target, and up. */
export function toEyeTarget(s: OrbitState): { eye: V3; target: V3; up: V3 } {
  const dir = sphericalDir(s.yaw, s.pitch);
  const eye: V3 = [
    s.target[0] + s.distance * dir[0],
    s.target[1] + s.distance * dir[1],
    s.target[2] + s.distance * dir[2],
  ];
  return { eye, target: s.target, up: [0, 1, 0] };
}
