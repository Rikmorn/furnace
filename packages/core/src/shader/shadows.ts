import { sceneBinding } from "./scene-binding.ts";
import { type ShaderSource, source } from "./source.ts";

/**
 * Composable shadow-sampling helpers over the engine shadow maps. Declares the
 * shadow depth array at `@group(0) @binding(2)` and the comparison sampler at
 * `@binding(3)` (bound only for pipelines created with `usesShadows: true`).
 * Depends on {@link sceneBinding} (reads each light's shadow slot from its
 * `shadow` lane + `scene.shadowMatrices`).
 *
 * Exposes `fr_shadowFactor(worldPos, slot, depthBias) -> f32` (1 = lit,
 * 0 = fully occluded): 3×3 PCF over a hardware comparison sampler. `slot < 0`
 * returns `1.0` (light not casting). The caller applies any normal-offset bias
 * to `worldPos` before calling; `depthBias` is subtracted from the compare depth.
 */
export const shadowHelpers: ShaderSource = source`${sceneBinding}
@group(0) @binding(2) var fr_shadowMaps: texture_depth_2d_array;
@group(0) @binding(3) var fr_shadowSamp: sampler_comparison;

fn fr_shadowFactor(worldPos: vec3<f32>, slot: i32, depthBias: f32) -> f32 {
  if (slot < 0) { return 1.0; }
  let lightSpace = scene.shadowMatrices[slot] * vec4<f32>(worldPos, 1.0);
  let ndc = lightSpace.xyz / lightSpace.w;
  // Light clip-space NDC (xy in [-1,1], z in [0,1]) -> shadow-map UV (y flipped).
  let uv = ndc.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
  // Outside the shadow frustum -> treat as lit. (ndc.z < 0, in front of the
  // near plane, is intentionally not culled: compared against [0,1] stored
  // depths with compare:"less" it always resolves lit, so the result is correct.)
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z > 1.0) {
    return 1.0;
  }
  // 2048 = SHADOW_MAP_SIZE (frame/shadow-map.ts).
  let texel = 1.0 / 2048.0;
  let refDepth = ndc.z - depthBias;
  var vis = 0.0;
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let off = vec2<f32>(f32(x), f32(y)) * texel;
      // textureSampleCompareLevel: no uniformity requirement (we are past early
      // returns) and no derivative computation -> correct + portable for shadows.
      vis = vis + textureSampleCompareLevel(
        fr_shadowMaps, fr_shadowSamp, uv + off, slot, refDepth);
    }
  }
  return vis / 9.0;
}`;

/**
 * Internal depth-only caster vertex source. Transforms object-space position by
 * the per-pass light view-projection · model. No fragment stage (depth-only).
 * `lightVP` at `@group(0) @binding(0)`; object `model` at `@group(1) @binding(0)`
 * (contiguous groups — the depth pass has no camera/scene/material). The full
 * 3-attribute `VsIn` is declared to match the engine vertex-buffer layout even
 * though only `position` is read.
 */
export const _shadowCasterSrc: ShaderSource = source`
struct LightVP { viewProj: mat4x4<f32> };
@group(0) @binding(0) var<uniform> lightVP: LightVP;
// Binds the engine's 128 B Object buffer (model + normalMatrix); this 64 B
// struct reads only model, which is valid (bound size may exceed struct size).
struct Object { model: mat4x4<f32> };
@group(1) @binding(0) var<uniform> object: Object;
struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};
@vertex fn vs_main(v: VsIn) -> @builtin(position) vec4<f32> {
  return lightVP.viewProj * object.model * vec4<f32>(v.position, 1.0);
}`;
