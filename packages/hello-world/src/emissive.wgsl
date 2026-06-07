struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
struct Emissive { color: vec4<f32> };

@group(0) @binding(0) var<uniform> camera: Camera;
@group(2) @binding(0) var<uniform> object: Object;
@group(1) @binding(0) var<uniform> emissive: Emissive;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct VsOut {
  @builtin(position) clip_pos: vec4<f32>,
  @location(0) world_normal: vec3<f32>,
};

@vertex
fn vs_main(v: VsIn) -> VsOut {
  let world = object.model * vec4<f32>(v.position, 1.0);
  // Cube uses uniform scale — model * (normal, 0) is correct.
  // For non-uniform scale a future caller would need the inverse-transpose.
  let world_normal = (object.model * vec4<f32>(v.normal, 0.0)).xyz;
  var out: VsOut;
  out.clip_pos = camera.viewProjection * world;
  out.world_normal = world_normal;
  return out;
}

const FAKE_LIGHT_DIR = normalize(vec3<f32>(1.0, 2.0, 1.0));
const SHADING_FLOOR: f32 = 0.85;
const SHADING_RANGE: f32 = 0.15;

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.world_normal);
  let lit = max(dot(n, FAKE_LIGHT_DIR), 0.0);
  let cue = SHADING_FLOOR + SHADING_RANGE * lit;
  return vec4<f32>(emissive.color.rgb * cue, emissive.color.a);
}
