struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
struct Params { stripes: f32, hue: f32, _pad0: f32, _pad1: f32 };

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;
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

fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
  let c = v * s;
  let x = c * (1.0 - abs(((h * 6.0) % 2.0) - 1.0));
  let m = v - c;
  var r = 0.0; var g = 0.0; var b = 0.0;
  if (h < 1.0/6.0) { r = c; g = x; b = 0.0; }
  else if (h < 2.0/6.0) { r = x; g = c; b = 0.0; }
  else if (h < 3.0/6.0) { r = 0.0; g = c; b = x; }
  else if (h < 4.0/6.0) { r = 0.0; g = x; b = c; }
  else if (h < 5.0/6.0) { r = x; g = 0.0; b = c; }
  else { r = c; g = 0.0; b = x; }
  return vec3<f32>(r + m, g + m, b + m);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let s = sin(in.uv.x * params.stripes * 6.2831853);
  let band = step(0.0, s);
  let base = hsv2rgb(params.hue, 0.7, 0.9);
  let dark = base * 0.4;
  return vec4<f32>(mix(dark, base, band), 1.0);
}
