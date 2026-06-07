import type { ShaderSource } from "./source.ts";
import { source } from "./source.ts";

/**
 * The engine **Scene** binding at `@group(0) @binding(1)`: the `Light` struct
 * (std140-safe vec4 lanes) + the `Scene` uniform (hemisphere ambient + a fixed
 * `array<Light, 16>`). Compose this into a custom shader and pass
 * `shader.create(ctx, src, { usesScene: true })` to receive the engine's
 * per-frame lights. Engine-managed and written by `frame.render` from
 * `RenderOptions.lights`/`ambient`.
 */
export const sceneBinding: ShaderSource = source(
  `struct Light {
  posRange : vec4<f32>,
  dirType  : vec4<f32>,
  colorInt : vec4<f32>,
  spotCos  : vec4<f32>,
};
struct Scene {
  ambientSky    : vec4<f32>,
  ambientGround : vec4<f32>,
  lightCount    : vec4<u32>,
  _reserved     : vec4<f32>,
  lights        : array<Light, 16>,
};
@group(0) @binding(1) var<uniform> scene: Scene;`,
);

/**
 * Composable Blinn-Phong helpers over the engine {@link sceneBinding} (it is a
 * dependency, so composing `lightingHelpers` pulls the Scene UBO in too). Exposes
 * `fr_shade(worldPos, n, viewPos, albedo, specColor, shininess) -> vec3<f32>`:
 * hemisphere ambient + per-light diffuse/specular with windowed inverse-square
 * attenuation and spot cones, HDR-calibrated (no 1/π; specular is additive).
 * Names carry an `fr_` prefix to avoid colliding with consumer functions.
 */
export const lightingHelpers: ShaderSource = source`${sceneBinding}
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
    color = color + light.colorInt.rgb * light.colorInt.w * att * (albedo * NdotL + spec);
  }
  return color;
}`;
