import type { ShaderSource } from "./source.ts";
import { source } from "./source.ts";

/**
 * Shared engine binding-preamble fragments — the single source of truth for the
 * standard `@group(0)`/`@group(2)` binding structs, composed by every engine
 * built-in shader (and available for consumer shaders via the public lighting
 * toolkit added in Stage 3 Phase 2).
 *
 * The group scheme (see `engine-conventions.md` §Binding contract):
 * - `@group(0)` = per-frame scene data (camera; scene/lights added in Phase 2)
 * - `@group(1)` = per-material params
 * - `@group(2)` = per-draw object data (model matrix)
 */

/** Camera binding — `@group(0) @binding(0)`, per-frame. `position` is the
 *  world-space eye (vec4 for std140; `.w` unused) — read by lit shaders for
 *  Blinn-Phong specular; non-specular shaders ignore it. */
export const _cameraBinding: ShaderSource = source(
  `struct Camera { viewProjection: mat4x4<f32>, position: vec4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;`,
);

/** Object binding — `@group(2) @binding(0)`, per-draw. `normalMatrix` is the
 *  inverse-transpose of `model` (correct normals under non-uniform scale);
 *  shaders read its upper 3×3. */
export const _objectBinding: ShaderSource = source(
  `struct Object { model: mat4x4<f32>, normalMatrix: mat4x4<f32> };
@group(2) @binding(0) var<uniform> object: Object;`,
);

/** Standard interleaved vertex input (position / normal / uv). */
export const _vsIn: ShaderSource = source(
  `struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};`,
);
