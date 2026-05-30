import type { Context } from "../gpu/index.ts";
import { _createShader } from "./shader.ts";
import type { Shader } from "./types.ts";

const UNLIT_WGSL = /* wgsl */ `
struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
struct Mat { color: vec4<f32> };

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;
@group(1) @binding(0) var<uniform> mat: Mat;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

@vertex fn vs_main(v: VsIn) -> @builtin(position) vec4<f32> {
  return camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
}

@fragment fn fs_main() -> @location(0) vec4<f32> {
  return mat.color;
}
`;

const NORMAL_COLOR_WGSL = /* wgsl */ `
struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};
struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) normal: vec3<f32>,
};

@vertex fn vs_main(v: VsIn) -> VsOut {
  var out: VsOut;
  out.pos = camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
  // Uniform-scale-correct normal transform. Non-uniform scale needs inverse-transpose
  // (deferred — tranche 4 demos use uniform scale).
  out.normal = (object.model * vec4<f32>(v.normal, 0.0)).xyz;
  return out;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  return vec4<f32>(n * 0.5 + 0.5, 1.0);
}
`;

/** Lazily compile (once per ctx) the engine-owned shared built-in shader for
 *  `kind`. The Promise is cached so concurrent first-calls share one compile. */
function builtinShader(
  ctx: Context,
  kind: "unlit" | "normalColor",
): Promise<Shader> {
  const cache = ctx._internal.resources.builtinShaders;
  const existing = cache[kind];
  if (existing) return existing;
  const wgsl = kind === "unlit" ? UNLIT_WGSL : NORMAL_COLOR_WGSL;
  const promise = _createShader(ctx, wgsl, true);
  cache[kind] = promise;
  return promise;
}

/** Internal — the stock unlit shader (reads a `vec4` color at `@group(1)
 *  @binding(0)`). Used by `material.unlit`. Public exposure waits for E. */
export function _unlitShader(ctx: Context): Promise<Shader> {
  return builtinShader(ctx, "unlit");
}

/** Internal — the stock normal-debug shader (no `@group(1)` bindings). Used by
 *  `material.normalColor`. Public exposure waits for E. */
export function _normalColorShader(ctx: Context): Promise<Shader> {
  return builtinShader(ctx, "normalColor");
}
