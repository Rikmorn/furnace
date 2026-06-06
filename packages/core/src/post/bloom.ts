import * as binding from "../binding/index.ts";
import { computeLayout } from "../binding/layout.ts";
import type { Binding } from "../binding/types.ts";
import { _onDispose } from "../gpu/dispose-cascade.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import { _createShader } from "../shader/shader.ts";
import type { Shader } from "../shader/types.ts";
import type { Effect } from "./effect.ts";
import { _setOwnedBindings } from "./effect.ts";
import type { PassDescriptor } from "./passes.ts";
import { createPasses } from "./passes.ts";

/**
 * Mip-pyramid sizing for the dual-filter chain. `MAX_MIPS` caps depth (each
 * extra mip is two more passes); `MIN_MIP_SIZE` stops downsampling before a
 * dimension collapses to a single texel (a 1px mip carries no useful bloom and
 * `textureDimensions`-derived texel offsets degenerate).
 */
const MAX_MIPS = 6;
const MIN_MIP_SIZE = 2;

/** Half-resolution step between adjacent mips. */
const HALF = 0.5;

/** `@group(1)` defaults (see {@link bloom} for semantics). `radius` is a small
 *  UV-space tent offset used by the upsample step. */
const DEFAULT_THRESHOLD = 0;
const DEFAULT_SOFTNESS = 0;
const DEFAULT_INTENSITY = 1;
const DEFAULT_RADIUS = 0.005;

/** Shared `@group(1)` params struct for the prefilter / upsample / composite
 *  shaders. Each shader reads only the fields it needs; the struct is identical
 *  so one Binding's buffer fits every pass's auto-derived layout. */
type BloomLayout = {
  threshold: "f32";
  softness: "f32";
  intensity: "f32";
  radius: "f32";
};

// Both forms are kept: BLOOM_LAYOUT (raw schema) is passed to binding.create via
// the explicit-layout path; BLOOM_RESOLVED (computed) is passed to _createShader.
// tonemap inlines one computeLayout call because it pairs binding and shader in
// one step — bloom cannot, since the binding is shared across four shader stages.
const BLOOM_LAYOUT: BloomLayout = {
  threshold: "f32",
  softness: "f32",
  intensity: "f32",
  radius: "f32",
};

/** Resolved layout for the shared bloom `@group(1)` uniform buffer. */
const BLOOM_RESOLVED = computeLayout(BLOOM_LAYOUT);

// ---------------------------------------------------------------------------
// WGSL — COD/Jimenez dual-filter kernels (texel size derived in-shader via
// textureDimensions, so one shader serves every mip resolution).
// ---------------------------------------------------------------------------

const VS_OUT = /* wgsl */ `
struct VsOut { @builtin(position) clip_pos: vec4<f32>, @location(0) uv: vec2<f32> };
`;

const PARAMS_STRUCT = /* wgsl */ `
struct BloomParams {
  threshold: f32,
  softness: f32,
  intensity: f32,
  radius: f32,
};
@group(1) @binding(0) var<uniform> params: BloomParams;
`;

/** 13-tap downsample (Jimenez/COD/LearnOpenGL). Texel size from
 *  textureDimensions(src). Shared body for both the plain downsample and the
 *  Karis-averaged prefilter (the latter reweights the 5 box groups). */
const DOWNSAMPLE13_FN = /* wgsl */ `
fn downsample13(src: texture_2d<f32>, samp: sampler, uv: vec2<f32>) -> vec3<f32> {
  let t = 1.0 / vec2<f32>(textureDimensions(src));
  let x = t.x; let y = t.y;
  let a = textureSample(src, samp, uv + vec2(-2.0 * x,  2.0 * y)).rgb;
  let b = textureSample(src, samp, uv + vec2( 0.0,      2.0 * y)).rgb;
  let c = textureSample(src, samp, uv + vec2( 2.0 * x,  2.0 * y)).rgb;
  let d = textureSample(src, samp, uv + vec2(-2.0 * x,  0.0)).rgb;
  let e = textureSample(src, samp, uv).rgb;
  let f = textureSample(src, samp, uv + vec2( 2.0 * x,  0.0)).rgb;
  let g = textureSample(src, samp, uv + vec2(-2.0 * x, -2.0 * y)).rgb;
  let h = textureSample(src, samp, uv + vec2( 0.0,     -2.0 * y)).rgb;
  let i = textureSample(src, samp, uv + vec2( 2.0 * x, -2.0 * y)).rgb;
  let j = textureSample(src, samp, uv + vec2(-x,  y)).rgb;
  let k = textureSample(src, samp, uv + vec2( x,  y)).rgb;
  let l = textureSample(src, samp, uv + vec2(-x, -y)).rgb;
  let m = textureSample(src, samp, uv + vec2( x, -y)).rgb;
  return e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}
`;

/** Karis-averaged 13-tap downsample for the FIRST mip only (firefly control).
 *  Per LearnOpenGL's physically-based bloom: weight each of the 5 box groups by
 *  1/(1 + luma(groupAvg)) so a single very bright texel cannot dominate. */
const KARIS_DOWNSAMPLE_FN = /* wgsl */ `
fn luma(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}
fn karisWeight(c: vec3<f32>) -> f32 {
  return 1.0 / (1.0 + luma(c));
}
fn downsample13Karis(src: texture_2d<f32>, samp: sampler, uv: vec2<f32>) -> vec3<f32> {
  let t = 1.0 / vec2<f32>(textureDimensions(src));
  let x = t.x; let y = t.y;
  let a = textureSample(src, samp, uv + vec2(-2.0 * x,  2.0 * y)).rgb;
  let b = textureSample(src, samp, uv + vec2( 0.0,      2.0 * y)).rgb;
  let c = textureSample(src, samp, uv + vec2( 2.0 * x,  2.0 * y)).rgb;
  let d = textureSample(src, samp, uv + vec2(-2.0 * x,  0.0)).rgb;
  let e = textureSample(src, samp, uv).rgb;
  let f = textureSample(src, samp, uv + vec2( 2.0 * x,  0.0)).rgb;
  let g = textureSample(src, samp, uv + vec2(-2.0 * x, -2.0 * y)).rgb;
  let h = textureSample(src, samp, uv + vec2( 0.0,     -2.0 * y)).rgb;
  let i = textureSample(src, samp, uv + vec2( 2.0 * x, -2.0 * y)).rgb;
  let j = textureSample(src, samp, uv + vec2(-x,  y)).rgb;
  let k = textureSample(src, samp, uv + vec2( x,  y)).rgb;
  let l = textureSample(src, samp, uv + vec2(-x, -y)).rgb;
  let m = textureSample(src, samp, uv + vec2( x, -y)).rgb;
  // 5 box groups (LearnOpenGL Karis layout): centre inner quad + 4 outer quads.
  let g0 = (j + k + l + m) * 0.25;          // inner 2x2
  let g1 = (a + b + d + e) * 0.25;          // top-left outer
  let g2 = (b + c + e + f) * 0.25;          // top-right outer
  let g3 = (d + e + g + h) * 0.25;          // bottom-left outer
  let g4 = (e + f + h + i) * 0.25;          // bottom-right outer
  let w0 = karisWeight(g0);
  let w1 = karisWeight(g1);
  let w2 = karisWeight(g2);
  let w3 = karisWeight(g3);
  let w4 = karisWeight(g4);
  let wsum = w0 + w1 + w2 + w3 + w4;
  // The 5 groups carry the 13-tap weight split: centre quad 0.5, 4 outer 0.125.
  return (g0 * w0 * 0.5 + (g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) * 0.125)
       / (w0 * 0.5 + (w1 + w2 + w3 + w4) * 0.125);
}
`;

/** 3x3 tent upsample. `radius` is a small UV offset (params.radius). */
const TENT_UPSAMPLE_FN = /* wgsl */ `
fn tentUpsample(src: texture_2d<f32>, samp: sampler, uv: vec2<f32>, radius: f32) -> vec3<f32> {
  let x = radius; let y = radius;
  let a = textureSample(src, samp, uv + vec2(-x,  y)).rgb;
  let b = textureSample(src, samp, uv + vec2( 0.0, y)).rgb;
  let c = textureSample(src, samp, uv + vec2( x,  y)).rgb;
  let d = textureSample(src, samp, uv + vec2(-x,  0.0)).rgb;
  let e = textureSample(src, samp, uv).rgb;
  let f = textureSample(src, samp, uv + vec2( x,  0.0)).rgb;
  let g = textureSample(src, samp, uv + vec2(-x, -y)).rgb;
  let h = textureSample(src, samp, uv + vec2( 0.0,-y)).rgb;
  let i = textureSample(src, samp, uv + vec2( x, -y)).rgb;
  return (e * 4.0 + (b + d + f + h) * 2.0 + (a + c + g + i)) * (1.0 / 16.0);
}
`;

/** Prefilter (scene → mip0): Karis-averaged 13-tap downsample with an optional
 *  soft-knee threshold. When `threshold <= 0` the knee is skipped (pass-through
 *  of the Karis downsample). `@group(1)` reads threshold + softness. */
const PREFILTER_WGSL = /* wgsl */ `
${VS_OUT}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
${PARAMS_STRUCT}
${KARIS_DOWNSAMPLE_FN}

// Soft-knee threshold (COD/Jimenez): below threshold→0, smooth knee of width
// 'softness', linear above. Operates on the colour's max channel.
fn softKnee(c: vec3<f32>, threshold: f32, softness: f32) -> vec3<f32> {
  let knee = max(softness, 1e-4);
  let brightness = max(c.r, max(c.g, c.b));
  let soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  let softCurve = (soft * soft) / (4.0 * knee + 1e-4);
  let contribution = max(softCurve, brightness - threshold) / max(brightness, 1e-4);
  return c * contribution;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let down = downsample13Karis(src, samp, in.uv);
  var outColor = down;
  if (params.threshold > 0.0) {
    outColor = softKnee(down, params.threshold, params.softness);
  }
  return vec4<f32>(outColor, 1.0);
}
`;

/** Downsample (mip(k-1) → mip(k)): plain 13-tap, no Karis, no params. */
const DOWNSAMPLE_WGSL = /* wgsl */ `
${VS_OUT}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
${DOWNSAMPLE13_FN}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  return vec4<f32>(downsample13(src, samp, in.uv), 1.0);
}
`;

/** Upsample/combine (up(k) = tent(smaller) + sample(mip(k))). Two inputs:
 *  @binding(0) = the smaller (more-blurred) mip, @binding(1) = this level's mip,
 *  @binding(2) = sampler. `@group(1)` reads radius. Additive in-shader (the
 *  furnace pool acquires a fresh target per output, so we read both mips as
 *  inputs and add — mathematically identical to the textbook hardware-blend
 *  accumulate). */
const UPSAMPLE_WGSL = /* wgsl */ `
${VS_OUT}
@group(0) @binding(0) var smaller: texture_2d<f32>;
@group(0) @binding(1) var thisMip: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
${PARAMS_STRUCT}
${TENT_UPSAMPLE_FN}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let up = tentUpsample(smaller, samp, in.uv, params.radius);
  let here = textureSample(thisMip, samp, in.uv).rgb;
  return vec4<f32>(up + here, 1.0);
}
`;

/** Composite (scene + bloom → chain output): additive bloom, intensity scales
 *  the bloom contribution. Two inputs: @binding(0) = scene, @binding(1) = the
 *  upsampled bloom (up0, or mip0 for a single-mip pyramid), @binding(2) =
 *  sampler. `@group(1)` reads intensity. */
const COMPOSITE_WGSL = /* wgsl */ `
${VS_OUT}
@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var bloomTex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
${PARAMS_STRUCT}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let scene = textureSample(sceneTex, samp, in.uv).rgb;
  let bloom = textureSample(bloomTex, samp, in.uv).rgb;
  return vec4<f32>(scene + bloom * params.intensity, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Per-ctx shader cache (mirrors tonemap: one shared engine-owned set per ctx).
// ---------------------------------------------------------------------------

type BloomShaders = {
  prefilter: Shader<BloomLayout>;
  downsample: Shader;
  upsample: Shader<BloomLayout>;
  composite: Shader<BloomLayout>;
};

const bloomShaderCache = new WeakMap<Context, Promise<BloomShaders>>();

async function compileBloomShaders(ctx: Context): Promise<BloomShaders> {
  // Boundary cast: _createShader returns Shader (no phantom L); the layout
  // we pass is BloomLayout by construction, so re-attaching the phantom is
  // sound. The downsample shader declares no @group(1) layout (null).
  const [prefilter, downsample, upsample, composite] = await Promise.all([
    _createShader(ctx, PREFILTER_WGSL, true, BLOOM_RESOLVED, false),
    _createShader(ctx, DOWNSAMPLE_WGSL, true, null, false),
    _createShader(ctx, UPSAMPLE_WGSL, true, BLOOM_RESOLVED, false),
    _createShader(ctx, COMPOSITE_WGSL, true, BLOOM_RESOLVED, false),
  ]);
  return {
    prefilter: prefilter as Shader<BloomLayout>,
    downsample,
    upsample: upsample as Shader<BloomLayout>,
    composite: composite as Shader<BloomLayout>,
  };
}

function bloomShaders(ctx: Context): Promise<BloomShaders> {
  const cached = bloomShaderCache.get(ctx);
  if (cached) return cached;
  const promise = compileBloomShaders(ctx);
  bloomShaderCache.set(ctx, promise);
  _onDispose(ctx, () => bloomShaderCache.delete(ctx));
  return promise;
}

// ---------------------------------------------------------------------------
// Pyramid sizing + pass assembly
// ---------------------------------------------------------------------------

/**
 * Largest mip count `n` (1 ≤ n ≤ {@link MAX_MIPS}) such that both
 * `floor(W / 2^n)` and `floor(H / 2^n)` stay ≥ {@link MIN_MIP_SIZE}. For tiny
 * canvases this is 1 (prefilter only). Engine-internal — exported for the
 * pass-count test.
 */
function bloomMipCount(width: number, height: number): number {
  let n = 1;
  while (n < MAX_MIPS) {
    const next = n + 1;
    const w = Math.floor(width / 2 ** next);
    const h = Math.floor(height / 2 ** next);
    if (w < MIN_MIP_SIZE || h < MIN_MIP_SIZE) break;
    n = next;
  }
  return n;
}

/**
 * Total pass count for a canvas: 1 prefilter + (mipCount-1) downsamples +
 * (mipCount-1) upsamples + 1 composite. Engine-internal; exported for tests.
 */
export function _bloomPassCount(width: number, height: number): number {
  const mips = bloomMipCount(width, height);
  return 1 + (mips - 1) + (mips - 1) + 1;
}

/** Name of mip `k`'s downsample target. */
const mipName = (k: number): string => `mip${k}`;
/** Name of mip `k`'s upsample/combine target. */
const upName = (k: number): string => `up${k}`;

/**
 * Assemble the dual-filter PassDescriptor[] for `mipCount` mips. All inputs are
 * explicit named intermediates or "scene" (never "prev"). `shaders` provides the
 * compiled fragment stages; `params` is the shared `@group(1)` binding handle.
 */
function buildBloomPasses(
  mipCount: number,
  shaders: BloomShaders,
  params: Binding<BloomLayout>,
): PassDescriptor[] {
  const passes: PassDescriptor[] = [];

  // 1. Prefilter: scene → mip0 at half-res (Karis + threshold).
  passes.push({
    shader: shaders.prefilter,
    inputs: ["scene"],
    output: { scale: HALF, intermediate: mipName(0) },
    binding: params,
  });

  // 2. Downsample k = 1..mipCount-1: mip(k-1) → mip(k) at scale 0.5^(k+1).
  for (let k = 1; k < mipCount; k++) {
    passes.push({
      shader: shaders.downsample,
      inputs: [{ intermediate: mipName(k - 1) }],
      output: { scale: HALF ** (k + 1), intermediate: mipName(k) },
    });
  }

  // 3. Upsample/combine k = mipCount-2 down to 0: up(k) = tent(smaller) + mip(k),
  //    where smaller = up(k+1) if it exists else the bottom mip(mipCount-1).
  for (let k = mipCount - 2; k >= 0; k--) {
    const smaller =
      k + 1 <= mipCount - 2 ? upName(k + 1) : mipName(mipCount - 1);
    passes.push({
      shader: shaders.upsample,
      inputs: [{ intermediate: smaller }, { intermediate: mipName(k) }],
      output: { scale: HALF ** (k + 1), intermediate: upName(k) },
      binding: params,
    });
  }

  // 4. Composite: scene + bloom → chain output at full res. The bloom input is
  //    up0 when the pyramid has upsample passes, else mip0 (single-mip case).
  const bloomInput = mipCount > 1 ? upName(0) : mipName(0);
  passes.push({
    shader: shaders.composite,
    inputs: ["scene", { intermediate: bloomInput }],
    output: {},
    binding: params,
  });

  return passes;
}

/**
 * Build a built-in COD/Jimenez **dual-filter bloom** post-effect, assembled on
 * the public multi-pass primitive ({@link createPasses}). Bloom blurs and
 * accumulates the scene's bright regions across a mip pyramid, then adds the
 * result back — the soft glow around emissive surfaces and bright highlights.
 *
 * **HDR-required.** Throws setup-loud unless the context was created with
 * `hdr: true`. Bloom samples values above 1.0; on an LDR clamp every input is
 * already ≤ 1, so the effect would be meaningless.
 *
 * **Pipeline** (texel sizes derived in-shader via `textureDimensions`, so one
 * shader serves every mip resolution):
 * - **Prefilter** — Karis-averaged 13-tap downsample (firefly control) of the
 *   scene into a half-res mip, with an optional soft-knee threshold.
 * - **Downsample** — plain 13-tap downsamples build the rest of the pyramid
 *   (mip count scales with canvas size, capped at 6 mips).
 * - **Upsample/combine** — 3x3 tent upsamples accumulate each smaller mip into
 *   the next-larger one (additive in-shader: the smaller-mip and same-level mip
 *   are read as two `@group(0)` inputs and summed — the pool acquires a fresh
 *   target per pass, so there is no in-place blend).
 * - **Composite** — adds the final blurred pyramid back over the scene at full
 *   resolution: `scene + bloom * intensity`.
 *
 * Place it BEFORE {@link tonemap} in `RenderOptions.effects` (bloom works in
 * linear HDR; tonemap maps the combined result to LDR).
 *
 * **Options** (all optional):
 * - `intensity` (default `1`) — linear scale on the bloom contribution at
 *   composite. `0` disables the glow.
 * - `threshold` (default `0`) — soft-knee brightness threshold in the
 *   prefilter; below it, colour is attenuated toward 0. `0` keeps the full
 *   Karis-averaged downsample (all light blooms, classic "energy-conserving"
 *   look).
 * - `softness` (default `0`) — width of the soft knee around `threshold`
 *   (ignored when `threshold` is `0`).
 *
 * The tent-upsample `radius` (UV-space offset applied by every upsample pass) is
 * fixed internally at `DEFAULT_RADIUS` (0.005) and is not yet a consumer option.
 *
 * **Resource ownership:** `post.destroy(ctx, bloomEffect)` frees the internal
 * `@group(1)` params binding (the shared `{ threshold, softness, intensity,
 * radius }` uniform buffer) that the engine created for this effect instance.
 * The four engine-owned bloom shaders are shared per-ctx and are NOT freed on
 * `post.destroy` — they are reclaimed by the dispose cascade at
 * `gpu.dispose(ctx)`.
 *
 * Setup-loud: throws on a non-HDR or disposed context, or WGSL compilation
 * failure (via the underlying `_createShader`).
 *
 * @throws FurnaceGpuError - `ctx` is disposed.
 * @throws FurnaceGpuError - `ctx` was not created with `hdr: true`.
 * @throws FurnaceError - WGSL compilation failed (indicates an engine bug).
 * @throws FurnaceError - pipeline creation surfaced a WebGPU validation error.
 */
export async function bloom(
  ctx: Context,
  opts?: { intensity?: number; threshold?: number; softness?: number },
): Promise<Effect> {
  if (ctx._internal.disposed) {
    throw new FurnaceGpuError("post.bloom: context is disposed");
  }
  if (!ctx._internal.hdr) {
    throw new FurnaceGpuError(
      "post.bloom requires hdr — enable hdr on requestContext (a >1.0 source is meaningless on an LDR clamp)",
    );
  }

  const shaders = await bloomShaders(ctx);

  // Shared params binding. Reused across the prefilter, every upsample, and the
  // composite (identical @group(1) struct → one buffer fits all auto-derived
  // layouts). Registered as an owned binding so post.destroy frees it.
  const params = binding.create(ctx, { layout: BLOOM_LAYOUT });
  binding.set(ctx, params, {
    threshold: opts?.threshold ?? DEFAULT_THRESHOLD,
    softness: opts?.softness ?? DEFAULT_SOFTNESS,
    intensity: opts?.intensity ?? DEFAULT_INTENSITY,
    radius: DEFAULT_RADIUS,
  });

  const mipCount = bloomMipCount(ctx.canvas.width, ctx.canvas.height);
  const passes = buildBloomPasses(mipCount, shaders, params);
  const effect = await createPasses(ctx, { passes });
  _setOwnedBindings(ctx, effect, [params]);
  return effect;
}
