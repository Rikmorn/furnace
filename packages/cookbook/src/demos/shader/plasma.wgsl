struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
// time auto-advances each frame from a state.time accumulator in entry.ts.
struct Params { time: f32, scale: f32, colorPhase: f32 };

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

// hsv2rgb: standard hue-saturation-value → RGB. Also copy-pasted from
// striped.wgsl — WGSL has no #include yet. See shader-preprocessor.md backlog.
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

// Tuning anchors: backdrop sits slightly darker than the cube so the cube
// stands out as the subject. Not exposed as sliders.
const PLASMA_SATURATION: f32 = 0.8;
const PLASMA_VALUE: f32 = 0.6;

// Classic plasma: four sines (axis-aligned + diagonal + radial) summed into
// a single value, then mapped to a hue. scale controls zoom (smaller = bigger
// pattern blobs); colorPhase rotates the hue cycle.
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let p = (in.uv - 0.5) * params.scale;
  let t = params.time;
  let v1 = sin(p.x + t);
  let v2 = sin(p.y + t * 0.7);
  let v3 = sin((p.x + p.y) * 0.5 + t * 0.5);
  let v4 = sin(length(p) - t * 0.8);
  let v = (v1 + v2 + v3 + v4) / 4.0;
  // Map v ∈ [-1, 1] → [0, 1], then offset by colorPhase to drive hue.
  let hue = fract(v * 0.5 + 0.5 + params.colorPhase);
  return vec4<f32>(hsv2rgb(hue, PLASMA_SATURATION, PLASMA_VALUE), 1.0);
}
