import { FurnaceError } from "../errors.ts";
import { mat4 } from "../transform/mat4.ts";
import type { Vec3 } from "../transform/types.ts";
import type { Camera, CameraData, CameraMatrices } from "./types.ts";

export function setPosition(cam: Camera, position: Vec3): void {
  const data = cam as CameraData;
  data.position[0] = position[0] as number;
  data.position[1] = position[1] as number;
  data.position[2] = position[2] as number;
  data.viewDirty = true;
}

export function setTarget(cam: Camera, target: Vec3): void {
  const data = cam as CameraData;
  data.target[0] = target[0] as number;
  data.target[1] = target[1] as number;
  data.target[2] = target[2] as number;
  data.viewDirty = true;
}

export function setUp(cam: Camera, up: Vec3): void {
  const data = cam as CameraData;
  data.up[0] = up[0] as number;
  data.up[1] = up[1] as number;
  data.up[2] = up[2] as number;
  data.viewDirty = true;
}

export function setAspect(cam: Camera, aspect: number): void {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    throw new FurnaceError("aspect must be a positive finite number");
  }
  const data = cam as CameraData;
  if (data.projection.kind === "perspective") {
    data.projection.aspect = aspect;
  } else {
    const top = data.projection.top;
    const bottom = data.projection.bottom;
    const verticalRange = top - bottom;
    const horizontalRange = verticalRange * aspect;
    data.projection.left = -horizontalRange / 2;
    data.projection.right = horizontalRange / 2;
  }
  data.projDirty = true;
}

export function setNearFar(cam: Camera, near: number, far: number): void {
  if (!Number.isFinite(near) || !Number.isFinite(far)) {
    throw new FurnaceError("near and far must be finite numbers");
  }
  if (near >= far) {
    throw new FurnaceError("near must be less than far");
  }
  const data = cam as CameraData;
  if (data.projection.kind === "perspective" && near <= 0) {
    throw new FurnaceError("perspective near must be positive");
  }
  data.projection.near = near;
  data.projection.far = far;
  data.projDirty = true;
}

export function getMatrices(cam: Camera): CameraMatrices {
  const data = cam as CameraData;
  let recomputed = false;
  if (data.viewDirty) {
    mat4.lookAt(data.view, data.position, data.target, data.up);
    data.viewDirty = false;
    recomputed = true;
  }
  if (data.projDirty) {
    data.recomputeProjection(data);
    data.projDirty = false;
    recomputed = true;
  }
  if (recomputed) {
    mat4.multiply(data.viewProjection, data.projectionMatrix, data.view);
  }
  return data.matricesWrapper;
}
