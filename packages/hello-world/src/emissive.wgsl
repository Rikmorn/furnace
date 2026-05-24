struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
struct Emissive { color: vec4<f32> };

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;
@group(1) @binding(0) var<uniform> emissive: Emissive;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct VsOut { @builtin(position) clip_pos: vec4<f32> };

@vertex
fn vs_main(v: VsIn) -> VsOut {
  let world = object.model * vec4<f32>(v.position, 1.0);
  var out: VsOut;
  out.clip_pos = camera.viewProjection * world;
  return out;
}

@fragment
fn fs_main(_in: VsOut) -> @location(0) vec4<f32> {
  return emissive.color;
}
