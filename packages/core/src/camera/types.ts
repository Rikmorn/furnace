import type { Mat4, Vec3 } from "../transform/types.ts";
import type { FitPolicy } from "./fit-policy.ts";

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
      // Derived state — recomputed by updateForSize and immediately by
      // setFitPolicy/setScale. Do not mutate directly.
      left: number;
      right: number;
      bottom: number;
      top: number;
      // Source-of-truth state:
      fitPolicy: FitPolicy;
      scale: number;
      near: number;
      far: number;
    };

/**
 * The frozen `{ view, projection, viewProjection }` wrapper returned by
 * {@link getMatrices}. The inner `Mat4` references are stable across calls
 * and mutated in place — consumers may cache them.
 */
export type CameraMatrices = Readonly<{
  view: Mat4;
  projection: Mat4;
  viewProjection: Mat4;
}>;

// Internal recompute callback set by each projection factory. Lets common.ts
// dispatch projection-matrix recompute without importing perspective.ts /
// orthographic.ts (avoids a circular dep on common.ts).
export type RecomputeProjection = (data: Camera) => void;

/**
 * Camera record produced by {@link perspective} or {@link orthographic}.
 *
 * A value-type (mutable data record) — not a manager-backed handle. Mutate
 * only via the exported setters (`setPosition`, `setTarget`, `setUp`,
 * `setAspect`, `setNearFar`, `setFov`, `setFitPolicy`, `setScale`). The
 * setters maintain
 * the `viewDirty` / `projDirty` flags that {@link getMatrices} relies on to
 * decide what to recompute.
 */
export type Camera = {
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
  // Cached last-seen canvas size. Initialized to { width: 1, height: 1 }
  // (placeholder for "no canvas known"). Overwritten by bindToCanvas and
  // each resize event. Used by setFitPolicy/setScale to re-derive bounds
  // immediately even before the next resize event fires.
  _lastSize: { width: number; height: number };
};
