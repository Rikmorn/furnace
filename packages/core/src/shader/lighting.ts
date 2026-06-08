import { shadowHelpers } from "./shadows.ts";
import type { ShaderSource } from "./source.ts";
import { source } from "./source.ts";

// Re-exported for back-compat: `sceneBinding` historically lived here and several
// importers still reach for `shader/lighting.ts`. It now lives in the leaf module
// `scene-binding.ts` to break the lighting↔shadows import cycle (lightingHelpers
// composes shadowHelpers, which depends on sceneBinding).
export { sceneBinding } from "./scene-binding.ts";

/**
 * Composable Blinn-Phong helpers over the engine {@link sceneBinding} (it is a
 * dependency, so composing `lightingHelpers` pulls the Scene UBO in too). It also
 * composes {@link shadowHelpers}, so it pulls in the shadow bindings at `@group(0)`
 * bindings 2 and 3 — a lit shader composing `lightingHelpers` MUST be created with
 * `usesShadows: true` (the built-in `lit`/`texturedLit` already do) or the render
 * path leaves those bindings unbound and fails validation. Exposes
 * `fr_shade(worldPos, n, viewPos, albedo, specColor, shininess) -> vec3<f32>`:
 * hemisphere ambient + per-light diffuse/specular with windowed inverse-square
 * attenuation and spot cones, HDR-calibrated (no 1/π; specular is additive). The
 * per-light direct term is multiplied by `fr_shadowFactor` so casting lights cast
 * shadows; ambient is never shadowed. Names carry an `fr_` prefix to avoid
 * colliding with consumer functions.
 */
export const lightingHelpers: ShaderSource = source`${shadowHelpers}
fn fr_windowedInvSq(d: f32, r: f32) -> f32 {
  let w = saturate(1.0 - pow(d / max(r, 1e-4), 4.0));
  return (w * w) / max(d * d, 1e-4);
}
fn fr_spotCone(L: vec3<f32>, axis: vec3<f32>, cosInner: f32, cosOuter: f32) -> f32 {
  let cd = dot(-L, axis);
  return clamp((cd - cosOuter) / max(cosInner - cosOuter, 1e-4), 0.0, 1.0);
}
fn fr_ambient(n: vec3<f32>, albedo: vec3<f32>) -> vec3<f32> {
  let hemi = mix(scene.ambientGround.rgb, scene.ambientSky.rgb, n.y * 0.5 + 0.5);
  return hemi * scene.ambientSky.w * albedo;
}
fn fr_shade(
  worldPos: vec3<f32>, n: vec3<f32>, viewPos: vec3<f32>,
  albedo: vec3<f32>, specColor: vec3<f32>, shininess: f32,
) -> vec3<f32> {
  let V = normalize(viewPos - worldPos);
  var color = fr_ambient(n, albedo);
  let count = scene.lightCount.x;
  for (var i: u32 = 0u; i < count; i = i + 1u) {
    let light = scene.lights[i];
    let tag = light.dirType.w;
    var L: vec3<f32>;
    var att = 1.0;
    if (tag < 0.5) {
      L = -light.dirType.xyz / max(length(light.dirType.xyz), 1e-4);
    } else {
      let toLight = light.posRange.xyz - worldPos;
      let dist = length(toLight);
      L = toLight / max(dist, 1e-4);
      att = fr_windowedInvSq(dist, light.posRange.w);
      if (tag > 1.5) {
        att = att * fr_spotCone(L, normalize(light.dirType.xyz), light.spotCos.x, light.spotCos.y);
      }
    }
    let NdotL = max(dot(n, L), 0.0);
    let H = normalize(L + V);
    // max(shininess, 1.0) guards pow(0,0) -> NaN on the matte path (specColor=0,
    // shininess=0): the clamp is a no-op for real highlights (shininess >= 1) and
    // keeps a matte surface NaN-free at grazing angles.
    let spec = specColor * pow(max(dot(n, H), 0.0), max(shininess, 1.0)) * step(0.0001, NdotL);
    let slot = i32(light.shadow.x);
    let depthBias = light.shadow.y;
    let normalBias = light.shadow.z;
    // texel-scaled normal-offset bias (2048 = SHADOW_MAP_SIZE) applied to the
    // receiver position before sampling — fights acne at grazing angles.
    let biasedPos = worldPos + n * normalBias * (1.0 / 2048.0);
    let vis = fr_shadowFactor(biasedPos, slot, depthBias);
    color = color + vis * light.colorInt.rgb * light.colorInt.w * att * (albedo * NdotL + spec);
  }
  return color;
}`;
