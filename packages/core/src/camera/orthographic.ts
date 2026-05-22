import { FurnaceError } from "../errors.ts";
import { mat4 } from "../transform/mat4.ts";
import type { Vec3 } from "../transform/types.ts";
import { vec3 } from "../transform/vec3.ts";
import type { Camera, CameraData, CameraMatrices } from "./types.ts";

const DEFAULT_LEFT = -1;
const DEFAULT_RIGHT = 1;
const DEFAULT_BOTTOM = -1;
const DEFAULT_TOP = 1;
const DEFAULT_NEAR = -1;
const DEFAULT_FAR = 1;
const DEFAULT_POSITION: readonly [number, number, number] = [0, 0, 1];
const DEFAULT_TARGET: readonly [number, number, number] = [0, 0, 0];
const DEFAULT_UP: readonly [number, number, number] = [0, 1, 0];

export type OrthographicOptions = {
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

type OrthographicParams = {
  left: number;
  right: number;
  bottom: number;
  top: number;
  near: number;
  far: number;
};

export type OrthographicBounds = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

function validateParams(params: OrthographicParams): void {
  const { left, right, bottom, top, near, far } = params;
  const boundsFinite =
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Number.isFinite(bottom) &&
    Number.isFinite(top);
  if (!boundsFinite) {
    throw new FurnaceError("bounds must be finite numbers");
  }
  if (near >= far) {
    throw new FurnaceError("near must be less than far");
  }
}

function cloneVec3OrDefault(
  src: Vec3 | undefined,
  fallback: readonly [number, number, number],
): Vec3 {
  if (src) return vec3.copy(vec3.create(), src);
  return vec3.fromValues(fallback[0], fallback[1], fallback[2]);
}

function recomputeOrtho(data: CameraData): void {
  if (data.projection.kind !== "orthographic") return;
  const { left, right, bottom, top, near, far } = data.projection;
  mat4.ortho(data.projectionMatrix, left, right, bottom, top, near, far);
}

export function orthographic(opts: OrthographicOptions = {}): Camera {
  const params: OrthographicParams = {
    left: opts.left ?? DEFAULT_LEFT,
    right: opts.right ?? DEFAULT_RIGHT,
    bottom: opts.bottom ?? DEFAULT_BOTTOM,
    top: opts.top ?? DEFAULT_TOP,
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

  const data: CameraData = {
    position,
    target,
    up,
    projection: { kind: "orthographic", ...params },
    view,
    projectionMatrix,
    viewProjection,
    matricesWrapper,
    recomputeProjection: recomputeOrtho,
    viewDirty: true,
    projDirty: true,
  } as unknown as CameraData;

  return data;
}

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
  const data = cam as CameraData;
  if (data.projection.kind !== "orthographic") {
    throw new FurnaceError("setBounds is orthographic-only");
  }
  data.projection.left = left;
  data.projection.right = right;
  data.projection.bottom = bottom;
  data.projection.top = top;
  data.projDirty = true;
}
