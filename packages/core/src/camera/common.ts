import { FurnaceError } from "../errors.ts";
import { mat4 } from "../transform/mat4.ts";
import type { Vec3 } from "../transform/types.ts";
import type { Camera, CameraMatrices } from "./types.ts";

export function setPosition(cam: Camera, position: Vec3): void {
  cam.position[0] = position[0] as number;
  cam.position[1] = position[1] as number;
  cam.position[2] = position[2] as number;
  cam.viewDirty = true;
}

export function setTarget(cam: Camera, target: Vec3): void {
  cam.target[0] = target[0] as number;
  cam.target[1] = target[1] as number;
  cam.target[2] = target[2] as number;
  cam.viewDirty = true;
}

export function setUp(cam: Camera, up: Vec3): void {
  cam.up[0] = up[0] as number;
  cam.up[1] = up[1] as number;
  cam.up[2] = up[2] as number;
  cam.viewDirty = true;
}

export function setAspect(cam: Camera, aspect: number): void {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new FurnaceError("aspect must be a positive finite number");
  }
  if (cam.projection.kind === "perspective") {
    cam.projection.aspect = aspect;
  } else {
    const top = cam.projection.top;
    const bottom = cam.projection.bottom;
    const verticalRange = top - bottom;
    const horizontalRange = verticalRange * aspect;
    cam.projection.left = -horizontalRange / 2;
    cam.projection.right = horizontalRange / 2;
  }
  cam.projDirty = true;
}

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
