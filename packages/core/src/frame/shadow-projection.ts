import { mat4 } from "../transform/mat4.ts";
import type { Mat4, Vec3 } from "../transform/types.ts";
import { vec3 } from "../transform/vec3.ts";
import type { DirectionalLight, SpotLight } from "./lights.ts";

// Remap clip space [-1,1] xy -> [0,1] UV (y flipped to match texture space) and
// pass through WebGPU's [0,1] depth. Column-major. Receiver samples with .xy/.z.
// biome-ignore format: matrix layout aids spatial correctness review
const CLIP_TO_UV: Mat4 = new Float32Array([
  0.5,  0,   0, 0,
  0,   -0.5, 0, 0,
  0,    0,   1, 0,
  0.5,  0.5, 0, 1,
]);

const scratchView: Mat4 = mat4.create();
const scratchProj: Mat4 = mat4.create();
const scratchVP: Mat4 = mat4.create();
const scratchEye: Vec3 = vec3.create();
const scratchTarget: Vec3 = vec3.create();
const scratchDir: Vec3 = vec3.create();
const scratchOffset: Vec3 = vec3.create();

/** Choose an up vector that is not parallel to `dir` (lookAt degeneracy guard). */
function safeUp(dir: Vec3): Vec3 {
  // If dir is near-vertical, use +Z as up; else world +Y.
  return Math.abs(dir[1] as number) > 0.99
    ? vec3.fromValues(0, 0, 1)
    : vec3.fromValues(0, 1, 0);
}

/**
 * Build the light-space view·proj·remap matrix for a directional light's
 * orthographic shadow frustum. The result maps world positions to shadow-map
 * UV (`.xy`) and depth (`.z`) in `[0, 1]`. Engine-internal; consumed by the
 * shadow-caster collection pass.
 */
export function _directionalLightViewProj(light: DirectionalLight): Mat4 {
  const s = light.shadow;
  if (!s) return mat4.identity(mat4.create());
  const [tx, ty, tz] = s.target ?? [0, 0, 0];
  vec3.set(scratchTarget, tx, ty, tz);
  vec3.set(
    scratchDir,
    light.direction[0],
    light.direction[1],
    light.direction[2],
  );
  vec3.normalize(scratchDir, scratchDir);
  const dist = s.distance ?? s.far / 2;
  // eye = target + dir * (-dist)   (vec3.scaleAndAdd unavailable; use scale+add)
  vec3.scale(scratchOffset, scratchDir, -dist);
  vec3.add(scratchEye, scratchTarget, scratchOffset);
  mat4.lookAt(scratchView, scratchEye, scratchTarget, safeUp(scratchDir));
  const h = s.orthoHalfExtent;
  mat4.ortho(scratchProj, -h, h, -h, h, s.near, s.far);
  mat4.multiply(scratchVP, scratchProj, scratchView);
  return mat4.multiply(mat4.create(), CLIP_TO_UV, scratchVP);
}

/**
 * Build the light-space view·proj·remap matrix for a spot light's perspective
 * shadow frustum. The result maps world positions to shadow-map UV (`.xy`) and
 * depth (`.z`) in `[0, 1]`. Engine-internal; consumed by the shadow-caster
 * collection pass.
 */
export function _spotLightViewProj(light: SpotLight): Mat4 {
  const s = light.shadow;
  if (!s) return mat4.identity(mat4.create());
  vec3.set(scratchEye, light.position[0], light.position[1], light.position[2]);
  vec3.set(
    scratchDir,
    light.direction[0],
    light.direction[1],
    light.direction[2],
  );
  vec3.normalize(scratchDir, scratchDir);
  // target = a point one unit along the ray (lookAt only uses the direction).
  vec3.add(scratchTarget, scratchEye, scratchDir);
  mat4.lookAt(scratchView, scratchEye, scratchTarget, safeUp(scratchDir));
  const fovY = 2 * light.outerAngle; // outerAngle is the half-angle
  const near = s.near ?? 0.1;
  const far = s.far ?? light.range;
  mat4.perspective(scratchProj, fovY, 1, near, far);
  mat4.multiply(scratchVP, scratchProj, scratchView);
  return mat4.multiply(mat4.create(), CLIP_TO_UV, scratchVP);
}
