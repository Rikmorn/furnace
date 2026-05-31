struct VignetteParams {
  strength: f32,
  falloff:  f32,
};

@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var sceneSamp: sampler;
@group(1) @binding(0) var<uniform> params: VignetteParams;

struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };

// Tuning: width of the smooth transition between "no darkening" and "max darkening".
// Aspect is ignored — vignette is elliptical on non-square viewports.
const VIGNETTE_BAND_WIDTH: f32 = 0.3;

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let scene = textureSample(sceneTex, sceneSamp, in.uv).rgb;
  // d = 0 at centre, ~1.0 at edge midpoints, ~1.41 at corners.
  let d = length(in.uv - vec2<f32>(0.5)) * 2.0;
  let mask = 1.0 - smoothstep(params.falloff, params.falloff + VIGNETTE_BAND_WIDTH, d);
  return vec4<f32>(scene * mix(1.0 - params.strength, 1.0, mask), 1.0);
}
