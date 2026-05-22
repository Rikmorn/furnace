import type { Mat4, Vec3 } from "../transform/types.ts";

declare const __furnaceCameraBrand: unique symbol;

export type Projection =
  | {
      kind: "perspective";
      fovYRad: number;
      aspect: number;
      near: number;
      far: number;
    }
  | {
      kind: "orthographic";
      left: number;
      right: number;
      bottom: number;
      top: number;
      near: number;
      far: number;
    };

export type CameraMatrices = Readonly<{
  view: Mat4;
  projection: Mat4;
  viewProjection: Mat4;
}>;

// Internal recompute callback set by each projection factory. Lets common.ts
// dispatch projection-matrix recompute without importing perspective.ts /
// orthographic.ts (avoids a circular dep on common.ts).
export type RecomputeProjection = (data: CameraData) => void;

export type CameraData = {
  readonly [__furnaceCameraBrand]: true;
  position: Vec3;
  target: Vec3;
  up: Vec3;
  projection: Projection;
  view: Mat4;
  projectionMatrix: Mat4;
  viewProjection: Mat4;
  matricesWrapper: CameraMatrices;
  recomputeProjection: RecomputeProjection;
  viewDirty: boolean;
  projDirty: boolean;
};

// Public Camera type is the same object behind the brand.
export type Camera = CameraData;
