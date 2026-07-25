type V3 = [number, number, number];

/** Orbit camera as target + spherical offset. Editor-only; never serialized. */
export type OrbitState = {
  target: V3;
  distance: number;
  yaw: number;
  pitch: number;
};

const MIN_DISTANCE = 0.05;
const PITCH_LIMIT = Math.PI / 2 - 0.01; // avoid pole flip
const ZOOM_SCALE = 0.1;
// Dolly (scroll-travel) step per wheel notch: a fraction of the current view
// distance so it scales with the scene, floored so a tight framing still travels —
// it never crawls to a stop the way distance-scaled orbit zoom does.
const DOLLY_FRACTION = 0.15;
const DOLLY_MIN_STEP = 0.15;

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

/** Return a new state with yaw/pitch adjusted. Pitch is clamped away from ±90°. */
export function orbit(s: OrbitState, dYaw: number, dPitch: number): OrbitState {
  return { ...s, yaw: s.yaw + dYaw, pitch: clampPitch(s.pitch + dPitch) };
}

/** Return a new state with distance scaled by exp(delta). Always positive. */
export function zoom(s: OrbitState, delta: number): OrbitState {
  const distance = Math.max(
    MIN_DISTANCE,
    s.distance * Math.exp(delta * ZOOM_SCALE),
  );
  return { ...s, distance };
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
 * Return a new state with the target panned in the screen-right/up plane.
 * `right` and `up` are world-space camera axes; `speed` scales by distance so
 * panning is proportional to how close the camera is.
 */
export function pan(
  s: OrbitState,
  dx: number,
  dy: number,
  right: V3,
  up: V3,
  speed: number,
): OrbitState {
  const k = speed * s.distance;
  const target: V3 = [
    s.target[0] - right[0] * dx * k + up[0] * dy * k,
    s.target[1] - right[1] * dx * k + up[1] * dy * k,
    s.target[2] - right[2] * dx * k + up[2] * dy * k,
  ];
  return { ...s, target };
}

/**
 * Fly-look: rotate the view by yaw/pitch deltas with the EYE held fixed
 * (recomputing the target) — the inverse of {@link orbit}, which holds the
 * target and swings the eye. Distance is preserved and pitch is clamped. Drives
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
  // View-forward (eye→target) is the negated target→eye offset direction.
  const dir = sphericalDir(s.yaw, s.pitch);
  const forward: V3 = [-dir[0], -dir[1], -dir[2]];
  // Right = forward × worldUp, kept horizontal; well-defined while |pitch| < 90°.
  const worldUp: V3 = [0, 1, 0];
  const right = normalized([-forward[2], 0, forward[0]]);
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

/** Initialize an orbit state from a camera's eye position and look target. */
export function fromEyeTarget(eye: V3, target: V3): OrbitState {
  const dx = eye[0] - target[0];
  const dy = eye[1] - target[1];
  const dz = eye[2] - target[2];
  const distance = Math.max(MIN_DISTANCE, Math.hypot(dx, dy, dz));
  const pitch = Math.asin(Math.max(-1, Math.min(1, dy / distance)));
  const yaw = Math.atan2(dx, dz);
  return { target, distance, yaw, pitch };
}
