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
 *
 * Legacy fields `left`/`right`/`bottom`/`top` are accepted during the A-2
 * transition and synthesise a stretch policy when `fitPolicy` is omitted.
 * They will be removed in a follow-up commit; new code should use
 * `fitPolicy` directly.
 */
export type OrthographicOptions = {
  fitPolicy?: FitPolicy;
  scale?: number;
  // Transitional legacy fields — remove in Task 8.
  left?: number;
  right?: number;
  bottom?: number;
  top?: number;
  near?: number;
  far?: number;
  position?: Vec3;
  target?: Vec3;
  up?: Vec3;
};

/**
 * Shape passed to {@link setBounds}. Use this type when composing helpers
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
  // Transitional: synthesise stretch policy from legacy bounds fields (or
  // their defaults if absent). Removed in Task 8.
  return policy.stretch({
    left: opts.left ?? DEFAULT_LEFT,
    right: opts.right ?? DEFAULT_RIGHT,
    bottom: opts.bottom ?? DEFAULT_BOTTOM,
    top: opts.top ?? DEFAULT_TOP,
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
 * Set an orthographic camera's view bounds. Mutates `cam` in place; flips
 * `projDirty`.
 *
 * Setup-loud: validates the inputs synchronously.
 *
 * @throws FurnaceError - if any bound is non-finite, or if the camera is not
 * orthographic.
 */
export function setBounds(cam: Camera, bounds: OrthographicBounds): void {
  const { left, right, bottom, top } = bounds;
  const boundsFinite =
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Number.isFinite(bottom) &&
    Number.isFinite(top);
  if (!boundsFinite) {
    throw new FurnaceError("bounds must be finite numbers");
  }
  if (cam.projection.kind !== "orthographic") {
    throw new FurnaceError("setBounds is orthographic-only");
  }
  cam.projection.left = left;
  cam.projection.right = right;
  cam.projection.bottom = bottom;
  cam.projection.top = top;
  cam.projDirty = true;
}
