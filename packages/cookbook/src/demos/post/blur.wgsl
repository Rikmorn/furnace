// ── CONSUMER multi-pass effect ──────────────────────────────────────────────
// A separable 9-tap Gaussian blur, authored entirely against the PUBLIC furnace
// multi-pass contract (post.createPasses). ONE shader serves BOTH passes — the
// blur direction is supplied per-pass via @group(1), so:
//
//   pass 1 (blurH): dir = (1, 0)  → samples horizontally, writes intermediate "blurH"
//   pass 2 (blurV): dir = (0, 1)  → reads "blurH", samples vertically → chain output
//
// Two consumer-owned Bindings (one per direction) feed the same shader. They are
// NOT auto-freed by post.destroy — the demo destroys them in teardown.
//
// @group(0) is engine-supplied (the colour input + sampler), identical to every
// single-pass post shader. @group(1) is consumer-owned, exactly like the
// vignette/textured demos: copy this preamble when authoring your own multi-pass
// effect.

struct BlurParams {
  // Blur axis in UV space, scaled by `radius` into a per-tap offset. (1,0) = H,
  // (0,1) = V. Stored as a vec2 so the same struct drives both passes.
  dir:    vec2<f32>,
  radius: f32,
};

@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var sceneSamp: sampler;
@group(1) @binding(0) var<uniform> params: BlurParams;

struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };

// 9-tap Gaussian (sigma ≈ 2). Symmetric weights, sum = 1.0.
const W0: f32 = 0.227027;
const W1: f32 = 0.1945946;
const W2: f32 = 0.1216216;
const W3: f32 = 0.054054;
const W4: f32 = 0.016216;

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let step = params.dir * params.radius;
  var acc = textureSample(sceneTex, sceneSamp, in.uv).rgb * W0;
  acc = acc + textureSample(sceneTex, sceneSamp, in.uv + step * 1.0).rgb * W1;
  acc = acc + textureSample(sceneTex, sceneSamp, in.uv - step * 1.0).rgb * W1;
  acc = acc + textureSample(sceneTex, sceneSamp, in.uv + step * 2.0).rgb * W2;
  acc = acc + textureSample(sceneTex, sceneSamp, in.uv - step * 2.0).rgb * W2;
  acc = acc + textureSample(sceneTex, sceneSamp, in.uv + step * 3.0).rgb * W3;
  acc = acc + textureSample(sceneTex, sceneSamp, in.uv - step * 3.0).rgb * W3;
  acc = acc + textureSample(sceneTex, sceneSamp, in.uv + step * 4.0).rgb * W4;
  acc = acc + textureSample(sceneTex, sceneSamp, in.uv - step * 4.0).rgb * W4;
  return vec4<f32>(acc, 1.0);
}
