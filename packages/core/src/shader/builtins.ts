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

/** Resolved layout for the unlit shader's `@group(1)` uniform buffer. */
const UNLIT_LAYOUT: ResolvedLayout = computeLayout({ color: "vec4f" });

/** Lazily compile (once per ctx) the engine-owned shared built-in shader for
 *  `kind`. The Promise is cached so concurrent first-calls share one compile. */
function builtinShader(
  ctx: Context,
  kind: "unlit" | "normalColor" | "lit",
): Promise<Shader> {
  const cache = ctx._internal.resources.builtinShaders;
  const existing = cache[kind];
  if (existing) return existing;
  const wgsl =
    kind === "unlit"
      ? UNLIT_WGSL
      : kind === "lit"
        ? LIT_WGSL
        : NORMAL_COLOR_WGSL;
  const layout = kind === "normalColor" ? null : UNLIT_LAYOUT;
  const promise = _createShader(ctx, wgsl, true, layout);
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
