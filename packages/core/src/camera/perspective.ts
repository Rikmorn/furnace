import { FurnaceError } from "../errors.ts";
import { mat4 } from "../transform/mat4.ts";
import type { Vec3 } from "../transform/types.ts";
import { vec3 } from "../transform/vec3.ts";
import type { Camera, CameraMatrices } from "./types.ts";

const DEFAULT_FOV_Y_RAD = Math.PI / 4;
const DEFAULT_ASPECT = 1;
const DEFAULT_NEAR = 0.1;
const DEFAULT_FAR = 1000;
const DEFAULT_POSITION: readonly [number, number, number] = [0, 0, 3];
const DEFAULT_TARGET: readonly [number, number, number] = [0, 0, 0];
const DEFAULT_UP: readonly [number, number, number] = [0, 1, 0];

/**
 * Options accepted by {@link perspective}. All fields optional.
 *
 * Defaults: `fovYRad = π/4`, `aspect = 1`, `near = 0.1`, `far = 1000`,
 * `position = [0, 0, 3]`, `target = [0, 0, 0]`, `up = [0, 1, 0]`. `fovYRad`
 * is the vertical field of view in radians.
 */
export type PerspectiveOptions = {
  fovYRad?: number;
  aspect?: number;
  near?: number;
  far?: number;
  position?: Vec3;
  target?: Vec3;
  up?: Vec3;
};

type PerspectiveParams = {
  fovYRad: number;
  aspect: number;
  near: number;
  far: number;
};

function validateParams(params: PerspectiveParams): void {
  const { fovYRad, aspect, near, far } = params;
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new FurnaceError("aspect must be a positive finite number");
  }
  if (near >= far) {
    throw new FurnaceError("near must be less than far");
  }
  if (near <= 0) {
    throw new FurnaceError("perspective near must be positive");
  }
  if (!Number.isFinite(fovYRad) || fovYRad <= 0) {
    throw new FurnaceError("fovYRad must be a positive finite number");
  }
}

function cloneVec3OrDefault(
  src: Vec3 | undefined,
  fallback: readonly [number, number, number],
): Vec3 {
  if (src) return vec3.copy(vec3.create(), src);
  return vec3.fromValues(fallback[0], fallback[1], fallback[2]);
}

function recomputePerspective(data: Camera): void {
  if (data.projection.kind !== "perspective") return;
  const { fovYRad, aspect, near, far } = data.projection;
  mat4.perspective(data.projectionMatrix, fovYRad, aspect, near, far);
}

/**
 * Construct a perspective camera. See {@link PerspectiveOptions} for the
 * field defaults.
 *
 * Setup-loud: validates the projection parameters synchronously.
 *
 * @throws FurnaceError - if `aspect` or `fovYRad` is non-finite or
 * non-positive, if `near <= 0`, or if `near >= far`.
 */
export function perspective(opts: PerspectiveOptions = {}): Camera {
  const params: PerspectiveParams = {
    fovYRad: opts.fovYRad ?? DEFAULT_FOV_Y_RAD,
    aspect: opts.aspect ?? DEFAULT_ASPECT,
    near: opts.near ?? DEFAULT_NEAR,
    far: opts.far ?? DEFAULT_FAR,
  };
  validateParams(params);

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
    projection: { kind: "perspective", ...params },
    view,
    projectionMatrix,
    viewProjection,
    matricesWrapper,
    recomputeProjection: recomputePerspective,
    viewDirty: true,
    projDirty: true,
    _lastSize: { width: 1, height: 1 },
  };

  return data;
}

/**
 * Set a perspective camera's vertical field of view (radians). Mutates `cam`
 * in place; flips `projDirty`.
 *
 * Setup-loud: validates the input synchronously.
 *
 * @throws FurnaceError - if `fovYRad` is non-finite or non-positive, or if
 * the camera is not perspective.
 */
export function setFov(cam: Camera, fovYRad: number): void {
  if (!Number.isFinite(fovYRad) || fovYRad <= 0) {
    throw new FurnaceError("fovYRad must be a positive finite number");
  }
  if (cam.projection.kind !== "perspective") {
    throw new FurnaceError("setFov is perspective-only");
  }
  cam.projection.fovYRad = fovYRad;
  cam.projDirty = true;
}
