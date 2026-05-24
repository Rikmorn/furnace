struct BloomParams {
  threshold: f32,
  intensity: f32,
  radius:    f32,
  _pad:      f32,
};

@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var sceneSamp: sampler;
@group(1) @binding(0) var<uniform> params: BloomParams;

struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };

fn luminance(rgb: vec3<f32>) -> f32 {
  return dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// 7x7 (49-tap) Gaussian-weighted threshold blur. Sigma=1.5 in tap-coordinate
// units; per-tap spacing in UV space comes from params.radius. Wider kernel
// than the 3x3 we shipped first so the halo spreads smoothly without holes.
const GAUSSIAN_TWO_SIGMA_SQ: f32 = 4.5;

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let scene = textureSample(sceneTex, sceneSamp, in.uv).rgb;
  var glow = vec3<f32>(0.0);
  var weight_sum = 0.0;
  let r = params.radius;
  for (var dy = -3; dy <= 3; dy = dy + 1) {
    for (var dx = -3; dx <= 3; dx = dx + 1) {
      let d2 = f32(dx * dx + dy * dy);
      let weight = exp(-d2 / GAUSSIAN_TWO_SIGMA_SQ);
      let uv = in.uv + vec2<f32>(f32(dx), f32(dy)) * r;
      let sample = textureSample(sceneTex, sceneSamp, uv).rgb;
      let bright = max(luminance(sample) - params.threshold, 0.0);
      glow = glow + sample * bright * weight;
      weight_sum = weight_sum + weight;
    }
  }
  glow = glow * (params.intensity / weight_sum);
  return vec4<f32>(scene + glow, 1.0);
}
