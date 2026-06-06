import * as binding from "../binding/index.ts";
import { computeLayout } from "../binding/layout.ts";
import { _onDispose } from "../gpu/dispose-cascade.ts";
import type { Context } from "../gpu/index.ts";
import { _createShader } from "../shader/shader.ts";
import type { Shader } from "../shader/types.ts";
import type { Effect } from "./effect.ts";
import { _setOwnedBindings, create as createEffect } from "./effect.ts";

/**
 * Selects the tone-mapping operator applied by {@link tonemap}.
 *
 * - `"neutral"` — Khronos PBR Neutral (CC0/Apache reference implementation,
 *   ported to WGSL). Preserves saturated colours at lower intensities and
 *   smoothly desaturates highlights as they approach 1.0; the recommended
 *   default for physically-based scenes.
 * - `"reinhard"` — classic per-channel Reinhard (`c / (c + 1)`). Compresses
 *   all values toward 1.0 without a desaturation step; simpler, slightly
 *   washed-out at high exposure.
 */
export type ToneMapOperator = "neutral" | "reinhard";

/** Maps each {@link ToneMapOperator} to the `u32` constant in the WGSL. */
const OPERATOR_CODE: Record<ToneMapOperator, number> = {
  neutral: 0,
  reinhard: 1,
};

const TONEMAP_WGSL = /* wgsl */ `
struct ToneMapParams {
  exposure: f32,
  // Field is 'op', not 'operator': 'operator' is a WGSL reserved word and fails
  // Dawn/Tint compilation. The public TS API still uses 'operator' (mapped here).
  op: u32,
};

@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var sceneSamp: sampler;
@group(1) @binding(0) var<uniform> params: ToneMapParams;

struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };

const TONEMAP_NEUTRAL: u32 = 0u;
const TONEMAP_REINHARD: u32 = 1u;

// Khronos PBR Neutral (CC0/Apache reference, ported to WGSL).
fn pbr_neutral(color_in: vec3<f32>) -> vec3<f32> {
  let startCompression = 0.8 - 0.04;
  let desaturation = 0.15;
  var color = color_in;
  let x = min(color.r, min(color.g, color.b));
  let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
  color = color - offset;
  let peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) { return color; }
  let d = 1.0 - startCompression;
  let newPeak = 1.0 - d * d / (peak + d - startCompression);
  color = color * (newPeak / peak);
  let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3<f32>(newPeak), g);
}

fn reinhard(c: vec3<f32>) -> vec3<f32> {
  return c / (c + vec3<f32>(1.0));
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let hdr = textureSample(sceneTex, sceneSamp, in.uv).rgb * params.exposure;
  var mapped: vec3<f32>;
  if (params.op == TONEMAP_REINHARD) {
    mapped = reinhard(hdr);
  } else {
    mapped = pbr_neutral(hdr);
  }
  return vec4<f32>(mapped, 1.0);
}
`;

/** Resolved layout for the tonemap `@group(1)` uniform buffer. */
const TONEMAP_LAYOUT = computeLayout({ exposure: "f32", op: "u32" });

/** Type alias for the tonemap `@group(1)` layout schema. The `op` key mirrors
 *  the WGSL field name (not `operator`, a WGSL reserved word — see TONEMAP_WGSL). */
type ToneMapLayout = { exposure: "f32"; op: "u32" };

/** Per-ctx cache: one shared engine-owned tonemap shader per context. */
const tonemapShaderCache = new WeakMap<
  Context,
  Promise<Shader<ToneMapLayout>>
>();

function tonemapShader(ctx: Context): Promise<Shader<ToneMapLayout>> {
  const cached = tonemapShaderCache.get(ctx);
  if (cached) return cached;
  // Boundary cast: _createShader returns Shader (no phantom L); the layout we
  // pass (TONEMAP_LAYOUT) is ToneMapLayout by construction, so re-attaching the
  // phantom is sound here.
  const promise = _createShader(
    ctx,
    TONEMAP_WGSL,
    true,
    TONEMAP_LAYOUT,
    false,
  ) as Promise<Shader<ToneMapLayout>>;
  tonemapShaderCache.set(ctx, promise);
  _onDispose(ctx, () => tonemapShaderCache.delete(ctx));
  return promise;
}

/**
 * Build a built-in HDR→LDR fullscreen tone-map post-effect.
 *
 * The effect samples the engine-supplied HDR scene input at `@group(0)` (a
 * `rgba16float` intermediate texture when `hdr: true` is set on the context)
 * and writes LDR linear-light values to `@location(0)`. Output is LINEAR —
 * no manual `pow(1/2.2)` is applied; when the swap-chain surface format is an
 * `*-srgb` variant the hardware applies the sRGB OETF automatically. Pass to
 * `frame.render` via `RenderOptions.effects` as the final (or only) effect in
 * the HDR post chain.
 *
 * **Operators** (select via `opts.operator`, default `"neutral"`):
 * - `"neutral"` — Khronos PBR Neutral tone-mapper (CC0/Apache reference
 *   implementation ported to WGSL). Preserves saturation in mid-tones and
 *   smoothly desaturates highlights; recommended default for PBR scenes.
 * - `"reinhard"` — per-channel Reinhard (`c / (c + 1)`). Simpler, no
 *   desaturation step; slightly washed-out at high exposure.
 *
 * **Exposure** (`opts.exposure`, default `1`): a linear pre-tonemap
 * multiplier applied to the sampled HDR colour before the operator. Values
 * above 1 brighten the scene; values below 1 darken it.
 *
 * **Resource ownership:** `post.destroy(ctx, tonemapEffect)` frees the
 * internal `@group(1)` binding (the `{ exposure, op }` uniform buffer) that
 * the engine created for this effect instance. The engine-owned tonemap shader
 * is shared per-ctx and is NOT freed on `post.destroy` — it is reclaimed by
 * the dispose cascade at `gpu.dispose(ctx)` (a second `post.tonemap` call on
 * the same ctx reuses it from the cache).
 *
 * Setup-loud: throws on a disposed context or WGSL compilation failure (via
 * the underlying `_createShader` + `post.create`).
 *
 * @throws FurnaceGpuError - `ctx` is disposed.
 * @throws FurnaceError - WGSL compilation failed (indicates an engine bug).
 * @throws FurnaceError - pipeline creation surfaced a WebGPU validation error.
 */
export async function tonemap(
  ctx: Context,
  opts?: { operator?: ToneMapOperator; exposure?: number },
): Promise<Effect<ToneMapLayout>> {
  const shader = await tonemapShader(ctx);
  const b = binding.create(ctx, shader);
  binding.set(ctx, b, {
    exposure: opts?.exposure ?? 1,
    op: OPERATOR_CODE[opts?.operator ?? "neutral"],
  });
  const effect = await createEffect(ctx, { shader, binding: b });
  _setOwnedBindings(ctx, effect, [b]);
  return effect;
}
