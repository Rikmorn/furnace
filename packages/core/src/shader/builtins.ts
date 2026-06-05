import { computeLayout } from "../binding/layout.ts";
import type { ResolvedLayout } from "../binding/types.ts";
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

const LIT_WGSL = /* wgsl */ `
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
struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) normal: vec3<f32>,
};

@vertex fn vs_main(v: VsIn) -> VsOut {
  var out: VsOut;
  out.pos = camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
  // Uniform-scale-correct normal transform (inverse-transpose deferred).
  out.normal = (object.model * vec4<f32>(v.normal, 0.0)).xyz;
  return out;
}

const LIGHT_DIR: vec3<f32> = vec3<f32>(0.324, 0.811, 0.487); // normalized
const LIGHT_COLOR: vec3<f32> = vec3<f32>(1.0, 0.98, 0.94);
const SKY_COLOR: vec3<f32> = vec3<f32>(0.55, 0.60, 0.72);
const GROUND_COLOR: vec3<f32> = vec3<f32>(0.12, 0.12, 0.14);

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let halfLambert = dot(n, LIGHT_DIR) * 0.5 + 0.5; // wraps the terminator
  let directional = LIGHT_COLOR * (halfLambert * halfLambert);
  let hemi = mix(GROUND_COLOR, SKY_COLOR, n.y * 0.5 + 0.5);
  let rgb = mat.color.rgb * (directional + hemi);
  return vec4<f32>(rgb, mat.color.a);
}
`;

const TEXTURED_WGSL = /* wgsl */ `
struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;
@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;
struct VsIn { @location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32> };
struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(v: VsIn) -> VsOut {
  var out: VsOut;
  out.pos = camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
  out.uv = v.uv;
  return out;
}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return textureSample(tex, samp, in.uv);
}
`;

const TEXTURED_LIT_WGSL = /* wgsl */ `
struct Camera { viewProjection: mat4x4<f32> };
struct Object { model: mat4x4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> object: Object;
@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;
struct VsIn { @location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32> };
struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) normal: vec3<f32>, @location(1) uv: vec2<f32> };
@vertex fn vs_main(v: VsIn) -> VsOut {
  var out: VsOut;
  out.pos = camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
  // Uniform-scale-correct normal transform (inverse-transpose deferred).
  out.normal = (object.model * vec4<f32>(v.normal, 0.0)).xyz;
  out.uv = v.uv;
  return out;
}
const LIGHT_DIR: vec3<f32> = vec3<f32>(0.324, 0.811, 0.487);
const LIGHT_COLOR: vec3<f32> = vec3<f32>(1.0, 0.98, 0.94);
const SKY_COLOR: vec3<f32> = vec3<f32>(0.55, 0.60, 0.72);
const GROUND_COLOR: vec3<f32> = vec3<f32>(0.12, 0.12, 0.14);
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let albedo = textureSample(tex, samp, in.uv);
  let n = normalize(in.normal);
  let halfLambert = dot(n, LIGHT_DIR) * 0.5 + 0.5;
  let directional = LIGHT_COLOR * (halfLambert * halfLambert);
  let hemi = mix(GROUND_COLOR, SKY_COLOR, n.y * 0.5 + 0.5);
  return vec4<f32>(albedo.rgb * (directional + hemi), albedo.a);
}
`;

/** Resolved layout for the unlit shader's `@group(1)` uniform buffer. */
const UNLIT_LAYOUT: ResolvedLayout = computeLayout({ color: "vec4f" });

type BuiltinKind = "unlit" | "lit" | "normalColor" | "textured" | "texturedLit";

const BUILTIN_SPECS: Record<
  BuiltinKind,
  { wgsl: string; layout: ResolvedLayout | null; textureBinding: boolean }
> = {
  unlit: { wgsl: UNLIT_WGSL, layout: UNLIT_LAYOUT, textureBinding: false },
  lit: { wgsl: LIT_WGSL, layout: UNLIT_LAYOUT, textureBinding: false },
  normalColor: {
    wgsl: NORMAL_COLOR_WGSL,
    layout: null,
    textureBinding: false,
  },
  textured: { wgsl: TEXTURED_WGSL, layout: null, textureBinding: true },
  texturedLit: { wgsl: TEXTURED_LIT_WGSL, layout: null, textureBinding: true },
};

/** Lazily compile (once per ctx) the engine-owned shared built-in shader for
 *  `kind`. The Promise is cached so concurrent first-calls share one compile. */
function builtinShader(ctx: Context, kind: BuiltinKind): Promise<Shader> {
  const cache = ctx._internal.resources.builtinShaders;
  const existing = cache[kind];
  if (existing) return existing;
  const spec = BUILTIN_SPECS[kind];
  const promise = _createShader(
    ctx,
    spec.wgsl,
    true,
    spec.layout,
    spec.textureBinding,
  );
  cache[kind] = promise;
  return promise;
}

/**
 * The engine's stock **unlit** shader (reads a `vec4<f32>` colour at
 * `@group(1) @binding(0)`). Engine-owned and shared per context (compiled
 * once); {@link destroy} is a no-op on it — it is freed only by the dispose
 * cascade. Pass to `material.create`.
 *
 * Carries a by-construction `@group(1)` layout: `{ color: "vec4f" }` (16 bytes,
 * uniform). Readable via `shader._layoutOf(ctx, s)`.
 */
export function unlit(ctx: Context): Promise<Shader<{ color: "vec4f" }>> {
  return builtinShader(ctx, "unlit") as Promise<Shader<{ color: "vec4f" }>>;
}

/**
 * The engine's stock **lit** shader — baked half-Lambert directional + hemisphere
 * ambient lighting over a per-material `vec4<f32>` colour at `@group(1) @binding(0)`
 * (the SAME layout as {@link unlit}, so materials are unlit↔lit swappable).
 * Engine-owned and shared per context (compiled once); {@link destroy} is a
 * no-op — freed only by the dispose cascade. Pass to `material.create`.
 */
export function lit(ctx: Context): Promise<Shader<{ color: "vec4f" }>> {
  return builtinShader(ctx, "lit") as Promise<Shader<{ color: "vec4f" }>>;
}

/**
 * The engine's stock **normal-debug** shader — renders the world-space normal
 * as RGB; declares no `@group(1)` bindings. Engine-owned and shared per
 * context (compiled once); {@link destroy} is a no-op on it. Pass to
 * `material.create`.
 *
 * Has no `@group(1)` layout (`shader._layoutOf` returns `null`).
 */
export function normalColor(
  ctx: Context,
): Promise<Shader<Record<string, never>>> {
  return builtinShader(ctx, "normalColor") as Promise<
    Shader<Record<string, never>>
  >;
}

/**
 * The engine's stock **textured (unlit)** shader — samples albedo from a
 * texture at `@group(1)` and outputs it directly (no lighting). Engine-owned
 * and shared per context (compiled once); {@link destroy} is a no-op — freed
 * only by the dispose cascade. Pass to `material.create`.
 *
 * `@group(1)` contract: `@binding(0)` sampler, `@binding(1)` `texture_2d<f32>`.
 * These reach the shader via `MaterialDescriptor.texture` (Task 8) — no
 * `@group(1)` uniform layout is declared (`Shader<Record<string, never>>`).
 * Declares `textureBinding: true`; `material.create` will require a `texture`
 * when this shader is used.
 *
 * For a lit variant that multiplies albedo by baked lighting, use
 * {@link texturedLit}.
 */
export function textured(ctx: Context): Promise<Shader<Record<string, never>>> {
  return builtinShader(ctx, "textured") as Promise<
    Shader<Record<string, never>>
  >;
}

/**
 * The engine's stock **textured + lit** shader — samples albedo from a texture
 * at `@group(1)` and multiplies it by the same baked half-Lambert directional
 * and hemisphere ambient lighting used by {@link lit}. Engine-owned and shared
 * per context (compiled once); {@link destroy} is a no-op — freed only by the
 * dispose cascade. Pass to `material.create`.
 *
 * `@group(1)` contract: `@binding(0)` sampler, `@binding(1)` `texture_2d<f32>`.
 * These reach the shader via `MaterialDescriptor.texture` (Task 8) — no
 * `@group(1)` uniform layout is declared (`Shader<Record<string, never>>`).
 * Declares `textureBinding: true`; `material.create` will require a `texture`
 * when this shader is used.
 *
 * Light constants are identical to {@link lit}'s baked model — textured objects
 * will match the tone of solid-colour lit objects in the same scene.
 */
export function texturedLit(
  ctx: Context,
): Promise<Shader<Record<string, never>>> {
  return builtinShader(ctx, "texturedLit") as Promise<
    Shader<Record<string, never>>
  >;
}
