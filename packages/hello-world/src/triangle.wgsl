struct CameraUniforms {
  viewProjection: mat4x4f,
};

struct ObjectUniforms {
  translation: vec3f,
  // WGSL aligns vec3<f32> to 16 bytes inside uniform buffers.
  // The host buffer is sized 16 bytes; the trailing 4 bytes are padding.
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<uniform> object: ObjectUniforms;

struct VsOut {
  @builtin(position) clip_pos: vec4f,
  @location(0)       uv:       vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
  // Covering triangle in world space, generously sized so its projection
  // through the camera blankets the visible frustum at z=0.
  var corners = array<vec3f, 3>(
    vec3f(-10.0, -10.0, 0.0),
    vec3f( 30.0, -10.0, 0.0),
    vec3f(-10.0,  30.0, 0.0),
  );
  let world = corners[vi] + object.translation;

  var out: VsOut;
  out.clip_pos = camera.viewProjection * vec4f(world, 1.0);
  // The SDF math lives in triangle-local space; subtract the translation back
  // out of the UV so the glow stays anchored to the (moving) triangle, not
  // to the world.
  out.uv = world.xy - object.translation.xy;
  return out;
}

fn sd_triangle(p: vec2f, p0: vec2f, p1: vec2f, p2: vec2f) -> f32 {
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
    vec2f(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
    vec2f(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
    vec2f(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));

  return -sqrt(d.x) * sign(d.y);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let p = in.uv;
  let t_sdf = sd_triangle(
    p,
    vec2f( 0.0,  0.5),
    vec2f(-0.5, -0.5),
    vec2f( 0.5, -0.5),
  );

  let halo_width = 0.3;
  let intensity = 1.0 - smoothstep(0.0, halo_width, t_sdf);

  let glow_color = vec3f(1.0, 0.85, 0.3);
  let bg_color  = vec3f(0.0, 0.0, 0.0);
  let rgb = mix(bg_color, glow_color, intensity);

  return vec4f(rgb, 1.0);
}
