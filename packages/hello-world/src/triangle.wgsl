struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
struct Mat { halo: vec4<f32> }; // halo width in .x; .yzw padding (group 1 binding 0)

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;
@group(1) @binding(0) var<uniform> mat: Mat;

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
  let world = (object.model * vec4<f32>(v.position, 1.0)).xyz;
  var out: VsOut;
  out.clip_pos = camera.viewProjection * vec4<f32>(world, 1.0);
  // SDF math is in triangle-local space — subtract the translation column out of the world position.
  out.uv = world.xy - object.model[3].xy;
  return out;
}

fn sd_triangle(p: vec2<f32>, p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>) -> f32 {
  let e0 = p1 - p0;
  let e1 = p2 - p1;
  let e2 = p0 - p2;

  let v0 = p - p0;
  let v1 = p - p1;
  let v2 = p - p2;

  let pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  let pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  let pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);

  let s = sign(e0.x * e2.y - e0.y * e2.x);

  let d = min(min(
    vec2<f32>(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
    vec2<f32>(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
    vec2<f32>(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));

  return -sqrt(d.x) * sign(d.y);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let p = in.uv;
  let t_sdf = sd_triangle(
    p,
    vec2<f32>(0.0, 0.5),
    vec2<f32>(-0.5, -0.5),
    vec2<f32>(0.5, -0.5),
  );

  let halo_width = mat.halo.x;
  let intensity = 1.0 - smoothstep(0.0, halo_width, t_sdf);

  let glow_color = vec3<f32>(1.0, 0.85, 0.3);
  let bg_color = vec3<f32>(0.0, 0.0, 0.0);
  let rgb = mix(bg_color, glow_color, intensity);

  return vec4<f32>(rgb, 1.0);
}
