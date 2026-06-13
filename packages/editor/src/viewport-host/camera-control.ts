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

/** Return a new state with yaw/pitch adjusted. Pitch is clamped away from ±90°. */
export function orbit(s: OrbitState, dYaw: number, dPitch: number): OrbitState {
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, s.pitch + dPitch));
  return { ...s, yaw: s.yaw + dYaw, pitch };
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

/** Convert spherical orbit state to Cartesian eye position, target, and up. */
export function toEyeTarget(s: OrbitState): { eye: V3; target: V3; up: V3 } {
  const cp = Math.cos(s.pitch);
  const eye: V3 = [
    s.target[0] + s.distance * cp * Math.sin(s.yaw),
    s.target[1] + s.distance * Math.sin(s.pitch),
    s.target[2] + s.distance * cp * Math.cos(s.yaw),
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
