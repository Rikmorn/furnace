import { FurnaceError } from "../errors.ts";
import { mat4 } from "../transform/mat4.ts";
import type { Vec3 } from "../transform/types.ts";
import type { Camera, CameraMatrices } from "./types.ts";

/**
 * Set the camera's position. Mutates `cam` in place; flips `viewDirty`.
 */
export function setPosition(cam: Camera, position: Vec3): void {
  cam.position[0] = position[0] as number;
  cam.position[1] = position[1] as number;
  cam.position[2] = position[2] as number;
  cam.viewDirty = true;
}

/**
 * Set the camera's look-at target. Mutates `cam` in place; flips `viewDirty`.
 */
export function setTarget(cam: Camera, target: Vec3): void {
  cam.target[0] = target[0] as number;
  cam.target[1] = target[1] as number;
  cam.target[2] = target[2] as number;
  cam.viewDirty = true;
}

/**
 * Set the camera's up vector. Mutates `cam` in place; flips `viewDirty`.
 */
export function setUp(cam: Camera, up: Vec3): void {
  cam.up[0] = up[0] as number;
  cam.up[1] = up[1] as number;
  cam.up[2] = up[2] as number;
  cam.viewDirty = true;
}

/**
 * Set a perspective camera's aspect ratio. Mutates `cam` in place; flips
 * `projDirty`.
 *
 * Setup-loud: validates the input synchronously.
 *
 * @throws FurnaceError - if `aspect` is non-finite or non-positive, or if
 * `cam` is orthographic (orthographic cameras use {@link setFitPolicy} for
 * bounds management).
 */
export function setAspect(cam: Camera, aspect: number): void {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new FurnaceError("aspect must be a positive finite number");
  }
  if (cam.projection.kind !== "perspective") {
    throw new FurnaceError(
      "setAspect is perspective-only; orthographic cameras use setFitPolicy",
    );
  }
  cam.projection.aspect = aspect;
  cam.projDirty = true;
}

/**
 * Set the camera's near and far clip planes. Mutates `cam` in place; flips
 * `projDirty`. Works on both projection kinds.
 *
 * Setup-loud: validates the inputs synchronously.
 *
 * @throws FurnaceError - if `near` or `far` is non-finite, if `near >= far`,
 * or if the camera is perspective and `near <= 0`.
 */
export function setNearFar(cam: Camera, near: number, far: number): void {
  if (!Number.isFinite(near) || !Number.isFinite(far)) {
    throw new FurnaceError("near and far must be finite numbers");
  }
  if (near >= far) {
    throw new FurnaceError("near must be less than far");
  }
  if (cam.projection.kind === "perspective" && near <= 0) {
    throw new FurnaceError("perspective near must be positive");
  }
  cam.projection.near = near;
  cam.projection.far = far;
  cam.projDirty = true;
}

/**
 * Return the camera's `{ view, projection, viewProjection }` matrices,
 * recomputing only the entries flagged dirty by setters since the last call.
 *
 * Returns the same frozen wrapper across calls — the inner `Float32Array`s
 * are stable references mutated in place. Consumers may cache the wrapper
 * (or its members) for the camera's lifetime; do not assume new arrays are
 * allocated per call.
 *
 * Called per draw inside `frame.render`; most consumers don't call it
 * directly outside custom render paths.
 */
export function getMatrices(cam: Camera): CameraMatrices {
  let recomputed = false;
  if (cam.viewDirty) {
    mat4.lookAt(cam.view, cam.position, cam.target, cam.up);
    cam.viewDirty = false;
    recomputed = true;
  }
  if (cam.projDirty) {
    cam.recomputeProjection(cam);
    cam.projDirty = false;
    recomputed = true;
  }
  if (recomputed) {
    mat4.multiply(cam.viewProjection, cam.projectionMatrix, cam.view);
  }
  return cam.matricesWrapper;
}
