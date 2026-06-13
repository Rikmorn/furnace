import { mat4 } from "../transform/mat4.ts";
import type { Vec3 } from "../transform/types.ts";
import { vec3 } from "../transform/vec3.ts";
import * as common from "./common.ts";
import type { Camera } from "./types.ts";

/** A world-space ray: an origin point and a normalized direction. */
export type Ray = { origin: Vec3; dir: Vec3 };

// Scratch — screenToRay is synchronous and single-threaded; reuse avoids per-call allocation.
const _invVP = mat4.create();
const _near = vec3.create();
const _far = vec3.create();

/**
 * Build a world-space ray from a normalized-device-coordinate cursor position
 * (`ndcX`/`ndcY` in `[-1, 1]`, Y-up). Unprojects the near and far plane points
 * through the inverse view-projection and returns `{ origin, dir }` with `dir`
 * normalized. `origin` is the near-plane point. Consumed by viewport picking and
 * gizmo hit-testing; pairs with {@link projectToScreen} (the inverse direction).
 *
 * Returns a degenerate ray (`dir` ≈ 0) only if the view-projection is singular
 * (no valid camera) — callers treat a zero direction as "no hit".
 */
export function screenToRay(cam: Camera, ndcX: number, ndcY: number): Ray {
  const vp = common.getMatrices(cam).viewProjection;
  const inv = mat4.invert(_invVP, vp);
  if (inv === null) {
    return { origin: vec3.create(), dir: vec3.create() };
  }
  // NDC z: near = 0 (WebGPU clip space), far = 1.
  vec3.transformMat4(_near, vec3.set(_near, ndcX, ndcY, 0), inv);
  vec3.transformMat4(_far, vec3.set(_far, ndcX, ndcY, 1), inv);
  const origin = vec3.fromValues(
    _near[0] as number,
    _near[1] as number,
    _near[2] as number,
  );
  const dir = vec3.create();
  vec3.normalize(dir, vec3.sub(dir, _far, origin));
  return { origin, dir };
}
