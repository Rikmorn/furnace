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

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let scene = textureSample(sceneTex, sceneSamp, in.uv).rgb;
  var glow = vec3<f32>(0.0);
  let r = params.radius;
  for (var dy = -1; dy <= 1; dy = dy + 1) {
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      let uv = in.uv + vec2<f32>(f32(dx), f32(dy)) * r;
      let sample = textureSample(sceneTex, sceneSamp, uv).rgb;
      let bright = max(luminance(sample) - params.threshold, 0.0);
      glow = glow + sample * bright;
    }
  }
  glow = glow * (params.intensity / 9.0);
  return vec4<f32>(scene + glow, 1.0);
}
