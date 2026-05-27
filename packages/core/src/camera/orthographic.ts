import { FurnaceError } from "../errors.ts";
import { mat4 } from "../transform/mat4.ts";
import type { Vec3 } from "../transform/types.ts";
import { vec3 } from "../transform/vec3.ts";
import { _deriveBounds, type FitPolicy, policy } from "./fit-policy.ts";
import type { Camera, CameraMatrices } from "./types.ts";

const DEFAULT_LEFT = -1;
const DEFAULT_RIGHT = 1;
const DEFAULT_BOTTOM = -1;
const DEFAULT_TOP = 1;
const DEFAULT_NEAR = -1;
const DEFAULT_FAR = 1;
const DEFAULT_SCALE = 1;
const DEFAULT_POSITION: readonly [number, number, number] = [0, 0, 1];
const DEFAULT_TARGET: readonly [number, number, number] = [0, 0, 0];
const DEFAULT_UP: readonly [number, number, number] = [0, 1, 0];

/**
 * Options accepted by {@link orthographic}. All fields optional.
 *
 * `fitPolicy` defaults to a stretch policy with unit bounds
 * (`{ left: -1, right: 1, bottom: -1, top: 1 }`). `scale` defaults to 1.
 * `near` defaults to -1, `far` to 1. `position`, `target`, `up` default to
 * `[0, 0, 1]`, `[0, 0, 0]`, `[0, 1, 0]` respectively.
 */
export type OrthographicOptions = {
  fitPolicy?: FitPolicy;
  scale?: number;
  near?: number;
  far?: number;
  position?: Vec3;
  target?: Vec3;
  up?: Vec3;
};

/**
 * Shape of an orthographic camera's view bounds. Returned by {@link getBounds}
 * and accepted by {@link policy.stretch}. Use this type when composing helpers
 * that receive or forward orthographic bounds.
 */
export type OrthographicBounds = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

function cloneVec3OrDefault(
  src: Vec3 | undefined,
  fallback: readonly [number, number, number],
): Vec3 {
  if (src) return vec3.copy(vec3.create(), src);
  return vec3.fromValues(fallback[0], fallback[1], fallback[2]);
}

function recomputeOrtho(data: Camera): void {
  if (data.projection.kind !== "orthographic") return;
  const { left, right, bottom, top, near, far } = data.projection;
  mat4.ortho(data.projectionMatrix, left, right, bottom, top, near, far);
}

function resolveInitialFitPolicy(opts: OrthographicOptions): FitPolicy {
  if (opts.fitPolicy) return opts.fitPolicy;
  return policy.stretch({
    left: DEFAULT_LEFT,
    right: DEFAULT_RIGHT,
    bottom: DEFAULT_BOTTOM,
    top: DEFAULT_TOP,
  });
}

function validateScale(scale: number): void {
  if (!Number.isFinite(scale)) {
    throw new FurnaceError("scale must be a finite number");
  }
  if (scale <= 0) {
    throw new FurnaceError("scale must be positive");
  }
}

/**
 * Construct an orthographic camera. See {@link OrthographicOptions} for the
 * field defaults.
 *
 * Setup-loud: validates inputs synchronously via the policy factory and the
 * scale check.
 *
 * @throws FurnaceError - propagates from {@link policy} factory validation,
 * from `scale` validation, if `near` or `far` is non-finite, or if
 * `near >= far`.
 */
export function orthographic(opts: OrthographicOptions = {}): Camera {
  const fitPolicy = resolveInitialFitPolicy(opts);
  const scale = opts.scale ?? DEFAULT_SCALE;
  validateScale(scale);
  const near = opts.near ?? DEFAULT_NEAR;
  const far = opts.far ?? DEFAULT_FAR;
  if (!Number.isFinite(near) || !Number.isFinite(far)) {
    throw new FurnaceError("near and far must be finite numbers");
  }
  if (near >= far) {
    throw new FurnaceError("near must be less than far");
  }

  // Derive initial bounds with the placeholder 1×1 canvas size; bindToCanvas
  // re-derives with the real size on first bind.
  const initialBounds = _deriveBounds(fitPolicy, scale, 1, 1);

  const position = cloneVec3OrDefault(opts.position, DEFAULT_POSITION);
  const target = cloneVec3OrDefault(opts.target, DEFAULT_TARGET);
  const up = cloneVec3OrDefault(opts.up, DEFAULT_UP);

  const view = new Float32Array(16);
  const projectionMatrix = new Float32Array(16);
  const viewProjection = new Float32Array(16);
  const matricesWrapper: CameraMatrices = Object.freeze({
    view,
    projection: projectionMatrix,
    viewProjection,
  });

  const data: Camera = {
    position,
    target,
    up,
    projection: {
      kind: "orthographic",
      left: initialBounds.left,
      right: initialBounds.right,
      bottom: initialBounds.bottom,
      top: initialBounds.top,
      fitPolicy,
      scale,
      near,
      far,
    },
    view,
    projectionMatrix,
    viewProjection,
    matricesWrapper,
    recomputeProjection: recomputeOrtho,
    viewDirty: true,
    projDirty: true,
    _lastSize: { width: 1, height: 1 },
  };

  return data;
}

/**
 * Update the orthographic camera's fit policy. Re-derives bounds immediately
 * using the camera's last-seen canvas size; subsequent resize events keep
 * the policy active.
 *
 * The policy itself is not re-validated — construct via the `policy.*`
 * factory namespace to guarantee well-formed inputs. Hand-written literals
 * are accepted but lose validation.
 *
 * Setup-loud: validates `cam` and `p` references synchronously.
 *
 * @throws FurnaceError - if `cam` is null/undefined or not orthographic, or
 * if `p` is null/undefined.
 */
export function setFitPolicy(cam: Camera, p: FitPolicy): void {
  if (cam == null) {
    throw new FurnaceError("cam must not be null/undefined");
  }
  if (cam.projection.kind !== "orthographic") {
    throw new FurnaceError("setFitPolicy is orthographic-only");
  }
  if (p == null) {
    throw new FurnaceError("policy must not be null/undefined");
  }
  cam.projection.fitPolicy = p;
  const { width, height } = cam._lastSize;
  const b = _deriveBounds(p, cam.projection.scale, width, height);
  cam.projection.left = b.left;
  cam.projection.right = b.right;
  cam.projection.bottom = b.bottom;
  cam.projection.top = b.top;
  cam.projDirty = true;
}

/**
 * Update the orthographic camera's scale (zoom multiplier). Bounds are
 * multiplied by `scale` about the policy's anchor. Re-derives bounds
 * immediately using the camera's last-seen canvas size.
 *
 * Setup-loud: validates inputs synchronously.
 *
 * @throws FurnaceError - if `cam` is null/undefined or not orthographic, or
 * if `scale` is non-finite or non-positive.
 */
export function setScale(cam: Camera, scale: number): void {
  if (cam == null) {
    throw new FurnaceError("cam must not be null/undefined");
  }
  if (cam.projection.kind !== "orthographic") {
    throw new FurnaceError("setScale is orthographic-only");
  }
  validateScale(scale);
  cam.projection.scale = scale;
  const { width, height } = cam._lastSize;
  const b = _deriveBounds(cam.projection.fitPolicy, scale, width, height);
  cam.projection.left = b.left;
  cam.projection.right = b.right;
  cam.projection.bottom = b.bottom;
  cam.projection.top = b.top;
  cam.projDirty = true;
}

/**
 * Return the orthographic camera's current bounds as a frozen object.
 *
 * Bounds are derived state; consumers cannot mutate them. To freeze the
 * current derived bounds into a stretch policy, pass the return value to
 * `policy.stretch` and call {@link setFitPolicy}.
 *
 * @throws FurnaceError - if `cam` is null/undefined or not orthographic.
 */
export function getBounds(cam: Camera): Readonly<OrthographicBounds> {
  if (cam == null) {
    throw new FurnaceError("cam must not be null/undefined");
  }
  if (cam.projection.kind !== "orthographic") {
    throw new FurnaceError("getBounds is orthographic-only");
  }
  const { left, right, bottom, top } = cam.projection;
  return Object.freeze({ left, right, bottom, top });
}
