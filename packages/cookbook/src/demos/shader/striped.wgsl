struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
struct Params { stripes: f32, hue: f32, softness: f32 };

// Engine plumbs the camera into @group(0) (per-frame) and per-object transforms
// into @group(2) (per-draw). The struct names must match what the engine writes
// (see frame/render.ts).
@group(0) @binding(0) var<uniform> camera: Camera;
@group(2) @binding(0) var<uniform> object: Object;
// Material-owned uniforms live at @group(1). The buffer comes from the
// binding bridge (binding.create) wired via MaterialDescriptor.binding.
@group(1) @binding(0) var<uniform> params: Params;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct VsOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(v: VsIn) -> VsOut {
  let world = object.model * vec4<f32>(v.position, 1.0);
  var out: VsOut;
  out.clip_pos = camera.viewProjection * world;
  out.uv = v.uv;
  return out;
}

// Tuning anchors for the cube's base colour. Not exposed as sliders.
const STRIPED_SATURATION: f32 = 0.7;
const STRIPED_VALUE: f32 = 0.9;

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let s = sin(in.uv.x * params.stripes * 6.2831853);
  // smoothstep with edges at ±softness anti-aliases the band edge.
  // At softness=0 this degenerates to step(); at softness>0 the edge fades.
  let band = smoothstep(-params.softness, params.softness, s);
  // hsv2rgb is composed in from chunks/color.wgsl via shader.source (see entry.ts).
  let base = hsv2rgb(params.hue, STRIPED_SATURATION, STRIPED_VALUE);
  let dark = base * 0.4;
  return vec4<f32>(mix(dark, base, band), 1.0);
}
