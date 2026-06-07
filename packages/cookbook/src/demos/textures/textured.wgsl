struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };

// Engine plumbs the camera into @group(0) (per-frame) and per-object transforms
// into @group(2) (per-draw). The struct names must match what the engine writes
// (see frame/render.ts). This is identical to every other consumer shader —
// copy this preamble when writing your own.
@group(0) @binding(0) var<uniform> camera: Camera;
@group(2) @binding(0) var<uniform> object: Object;

// ── @group(1) texture contract ───────────────────────────────────────────────
// This is the PUBLIC furnace texture binding layout for texture-sampling shaders.
// When you call `shader.load(ctx, url, { textureBinding: true })`, the engine
// marks the shader as needing @group(1) sampler+texture. Then `material.create`
// requires a `texture` in the MaterialDescriptor and wires these two bindings
// automatically from your sampler params and texture handle.
//
//   binding(0) → sampler   (filtering, addressing, anisotropy — from SamplerParams)
//   binding(1) → texture   (the GPU texture view — from texture.create / texture.load)
//
// The built-in `shader.texturedLit` is just a convenience fork of exactly this
// same contract — you could delete it and author this yourself, which is what
// this demo does. Fork it, add normal maps, parallax, custom blend — it all
// starts here.
@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct VsOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

// UV tiling constant: scale UVs so the texture repeats TILES×TILES times over
// the quad. This serves two purposes:
//   1. It makes the sampler addressMode=repeat visible (UVs exceed [0,1]).
//   2. It creates a range of texel densities across the surface — large texels
//      near the camera (magnification) and small texels toward the horizon
//      (minification+anisotropy). This is exactly where nearest/linear/AF16
//      produce visibly different results. More tiling pushes the far field
//      deeper into minification, widening the linear-vs-AF16 gap; AF is subtle
//      by nature (it only diverges from trilinear at steep grazing angles on
//      high-frequency detail), so we tile heavily to make the gap clear.
const TILES: f32 = 16.0;

@vertex
fn vs_main(v: VsIn) -> VsOut {
  let world = object.model * vec4<f32>(v.position, 1.0);
  var out: VsOut;
  out.clip_pos = camera.viewProjection * world;
  out.uv = v.uv * TILES;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let albedo = textureSample(tex, samp, in.uv);
  return albedo;
}
