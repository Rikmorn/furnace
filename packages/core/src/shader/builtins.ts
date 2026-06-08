import { computeLayout } from "../binding/layout.ts";
import type { ResolvedLayout } from "../binding/types.ts";
import type { Context } from "../gpu/index.ts";
import { lightingHelpers } from "./lighting.ts";
import { _cameraBinding, _objectBinding, _vsIn } from "./preamble.ts";
import { _createShader } from "./shader.ts";
import type { ShaderSource } from "./source.ts";
import { source, toWgsl } from "./source.ts";
import type { Shader } from "./types.ts";

const UNLIT_SRC: ShaderSource = source`${_cameraBinding}
${_objectBinding}
${_vsIn}
struct Mat { color: vec4<f32> };
@group(1) @binding(0) var<uniform> mat: Mat;

@vertex fn vs_main(v: VsIn) -> @builtin(position) vec4<f32> {
  return camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
}

@fragment fn fs_main() -> @location(0) vec4<f32> {
  return mat.color;
}`;

const NORMAL_COLOR_SRC: ShaderSource = source`${_cameraBinding}
${_objectBinding}
${_vsIn}
struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) normal: vec3<f32>,
};

@vertex fn vs_main(v: VsIn) -> VsOut {
  var out: VsOut;
  out.pos = camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
  out.normal = (object.normalMatrix * vec4<f32>(v.normal, 0.0)).xyz;
  return out;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  return vec4<f32>(n * 0.5 + 0.5, 1.0);
}`;

const LIT_SRC: ShaderSource = source`${_cameraBinding}
${_objectBinding}
${_vsIn}
${lightingHelpers}
struct Mat { color: vec4<f32>, specular: vec4<f32> };
@group(1) @binding(0) var<uniform> mat: Mat;

// Per-material specular is MATTE by default: an unset (zero-initialized)
// specular = vec4(0) yields zero highlight (specColor.rgb = 0). Opt in by
// setting specular = vec4(specR, specG, specB, shininess) on the binding.

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldNormal: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
};

@vertex fn vs_main(v: VsIn) -> VsOut {
  var out: VsOut;
  let world = object.model * vec4<f32>(v.position, 1.0);
  out.pos = camera.viewProjection * world;
  out.worldPos = world.xyz;
  out.worldNormal = (object.normalMatrix * vec4<f32>(v.normal, 0.0)).xyz;
  return out;
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let n = normalize(in.worldNormal);
  let rgb = fr_shade(in.worldPos, n, camera.position.xyz, mat.color.rgb, mat.specular.rgb, mat.specular.w);
  return vec4<f32>(rgb, mat.color.a);
}`;

const TEXTURED_SRC: ShaderSource = source`${_cameraBinding}
${_objectBinding}
${_vsIn}
@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;
struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(v: VsIn) -> VsOut {
  var out: VsOut;
  out.pos = camera.viewProjection * object.model * vec4<f32>(v.position, 1.0);
  out.uv = v.uv;
  return out;
}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return textureSample(tex, samp, in.uv);
}`;

const TEXTURED_LIT_SRC: ShaderSource = source`${_cameraBinding}
${_objectBinding}
${_vsIn}
${lightingHelpers}
@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;

// Fixed engine-default specular: texturedLit's @group(1) is sampler+texture only
// (texture is mutually exclusive with a uniform binding), so specular cannot be
// per-material here. Per-material textured specular: backlog (descriptor ext).
const FR_TL_SPEC: vec3<f32> = vec3<f32>(0.04, 0.04, 0.04);
const FR_TL_SHININESS: f32 = 32.0;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldNormal: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
  @location(2) uv: vec2<f32>,
};
@vertex fn vs_main(v: VsIn) -> VsOut {
  var out: VsOut;
  let world = object.model * vec4<f32>(v.position, 1.0);
  out.pos = camera.viewProjection * world;
  out.worldPos = world.xyz;
  out.worldNormal = (object.normalMatrix * vec4<f32>(v.normal, 0.0)).xyz;
  out.uv = v.uv;
  return out;
}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let albedo = textureSample(tex, samp, in.uv);
  let n = normalize(in.worldNormal);
  let rgb = fr_shade(in.worldPos, n, camera.position.xyz, albedo.rgb, FR_TL_SPEC, FR_TL_SHININESS);
  return vec4<f32>(rgb, albedo.a);
}`;

/** Resolved layout for the unlit shader's `@group(1)` uniform buffer. */
const UNLIT_LAYOUT: ResolvedLayout = computeLayout({ color: "vec4f" });

/** The lit shader's `@group(1)`: colour + specular (`specular.rgb` = specular
 *  colour, `specular.w` = shininess). */
const LIT_LAYOUT: ResolvedLayout = computeLayout({
  color: "vec4f",
  specular: "vec4f",
});

type BuiltinKind = "unlit" | "lit" | "normalColor" | "textured" | "texturedLit";

const BUILTIN_SPECS: Record<
  BuiltinKind,
  {
    src: ShaderSource;
    layout: ResolvedLayout | null;
    textureBinding: boolean;
    usesScene: boolean;
    usesShadows: boolean;
  }
> = {
  unlit: {
    src: UNLIT_SRC,
    layout: UNLIT_LAYOUT,
    textureBinding: false,
    usesScene: false,
    usesShadows: false,
  },
  lit: {
    src: LIT_SRC,
    layout: LIT_LAYOUT,
    textureBinding: false,
    usesScene: true,
    usesShadows: true,
  },
  normalColor: {
    src: NORMAL_COLOR_SRC,
    layout: null,
    textureBinding: false,
    usesScene: false,
    usesShadows: false,
  },
  textured: {
    src: TEXTURED_SRC,
    layout: null,
    textureBinding: true,
    usesScene: false,
    usesShadows: false,
  },
  texturedLit: {
    src: TEXTURED_LIT_SRC,
    layout: null,
    textureBinding: true,
    usesScene: true,
    usesShadows: true,
  },
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
    toWgsl(spec.src),
    true,
    spec.layout,
    spec.textureBinding,
    spec.usesScene,
    spec.usesShadows,
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
 * The engine's stock **lit** shader — multi-light Blinn-Phong over the engine
 * Scene UBO (`RenderOptions.lights` + `ambient`): hemisphere ambient + per-light
 * diffuse and half-vector specular, with windowed inverse-square attenuation and
 * spot cones, HDR-calibrated (no 1/π). `@group(1)` carries `{ color, specular }`
 * (`specular.rgb` = specular colour, `specular.w` = shininess); the default is
 * **matte** — an unset (zero) specular adds no highlight, so a `{ color }`-only
 * binding keeps working. Add a highlight by setting both `specular.rgb` and
 * `specular.w`. Engine-owned, shared per ctx (compiled once); {@link destroy}
 * no-ops. Pass to `material.create` with a `binding` carrying at least
 * `{ color }`. Supply `frame.render({ lights })` or the surface renders
 * ambient-only.
 *
 * NOTE: lit no longer shares `unlit`'s layout (it adds `specular`), so an
 * unlit↔lit material swap requires a `{ color, specular }` binding.
 */
export function lit(
  ctx: Context,
): Promise<Shader<{ color: "vec4f"; specular: "vec4f" }>> {
  return builtinShader(ctx, "lit") as Promise<
    Shader<{ color: "vec4f"; specular: "vec4f" }>
  >;
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
 * These reach the shader via `MaterialDescriptor.texture` — no `@group(1)`
 * uniform layout is declared (`Shader<Record<string, never>>`). Declares
 * `textureBinding: true`; `material.create` will require a `texture` when this
 * shader is used.
 *
 * For a lit variant that shades the sampled albedo with the engine's multi-light
 * Blinn-Phong model, use {@link texturedLit}.
 */
export function textured(ctx: Context): Promise<Shader<Record<string, never>>> {
  return builtinShader(ctx, "textured") as Promise<
    Shader<Record<string, never>>
  >;
}

/**
 * The engine's stock **textured + lit** shader — multi-light Blinn-Phong (the
 * same model as {@link lit}) over the engine Scene UBO (`RenderOptions.lights` +
 * `ambient`): hemisphere ambient + per-light diffuse and half-vector specular,
 * with windowed inverse-square attenuation and spot cones, HDR-calibrated. Albedo
 * is sampled from the texture; specular is a **fixed engine default** (0.04 grey
 * / shininess 32), not per-material — `@group(1)` carries only the sampler +
 * texture (texture is mutually exclusive with a uniform binding), so a per-material
 * specular uniform cannot be supplied here. Per-material textured specular is a
 * backlog item (a `MaterialDescriptor` extension). Engine-owned and shared per
 * context (compiled once); {@link destroy} is a no-op — freed only by the dispose
 * cascade. Pass to `material.create`.
 *
 * `@group(1)` contract: `@binding(0)` sampler, `@binding(1)` `texture_2d<f32>`.
 * These reach the shader via `MaterialDescriptor.texture` — no `@group(1)` uniform
 * layout is declared (`Shader<Record<string, never>>`). Declares
 * `textureBinding: true`; `material.create` will require a `texture` when this
 * shader is used. Supply `frame.render({ lights })` or the surface renders
 * ambient-only (textured).
 */
export function texturedLit(
  ctx: Context,
): Promise<Shader<Record<string, never>>> {
  return builtinShader(ctx, "texturedLit") as Promise<
    Shader<Record<string, never>>
  >;
}
