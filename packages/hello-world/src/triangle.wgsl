struct CameraUniforms {
  viewProjection: mat4x4f,
};

@group(0) @binding(0) var<uniform> camera: CameraUniforms;

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec3f, 3>(
    vec3f( 0.0,  0.5, 0.0),
    vec3f(-0.5, -0.5, 0.0),
    vec3f( 0.5, -0.5, 0.0),
  );
  return camera.viewProjection * vec4f(pos[vi], 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return vec4f(0, 0.4, 0.2, 1.0);
}
