import { _onDispose } from "../gpu/dispose-cascade.ts";
import type { Context } from "../gpu/index.ts";
import { _shadowCasterSrc } from "../shader/shadows.ts";
import { toWgsl } from "../shader/source.ts";
import { _recordAlloc, _recordDestroy } from "../stats/internal.ts";
import { MAX_SHADOW_CASTERS } from "./lights.ts";

/** Side length (in texels) of each shadow map layer. Fixed at 2048; resolution
 *  config is backlog. */
export const SHADOW_MAP_SIZE = 2048;

/** GPU texture format used for shadow depth storage (`depth32float`). */
export const SHADOW_FORMAT: GPUTextureFormat = "depth32float";

const SHADOW_BYTES_PER_TEXEL = 4; // depth32float

/**
 * Per-ctx engine-owned shadow-map resources: the depth array texture,
 * per-layer render-target views, the full-array sampling view, and the
 * comparison sampler. Allocated once per ctx by {@link _ensureShadowMap}
 * and freed via the dispose cascade.
 */
export type ShadowMapEntry = {
  /** The underlying depth32float 2D array texture (MAX_SHADOW_CASTERS layers). */
  texture: GPUTexture;
  /** `texture_depth_2d_array` view — bound for shadow sampling in the scene pass. */
  arrayView: GPUTextureView;
  /** Per-layer `texture_depth_2d` views — one render attachment per caster pass. */
  layerViews: GPUTextureView[];
  /** PCF-capable comparison sampler (`compare: "less"`, linear filter). */
  comparisonSampler: GPUSampler;
};

const shadowMapByCtx = new WeakMap<Context, ShadowMapEntry>();

function shadowMapBytes(): number {
  return (
    SHADOW_MAP_SIZE *
    SHADOW_MAP_SIZE *
    SHADOW_BYTES_PER_TEXEL *
    MAX_SHADOW_CASTERS
  );
}

/** Lazily allocate (once per ctx) the engine-owned shadow depth array +
 *  comparison sampler. Freed by the dispose cascade. Fixed 2048² (resolution
 *  config is backlog). */
export function _ensureShadowMap(ctx: Context): ShadowMapEntry {
  const existing = shadowMapByCtx.get(ctx);
  if (existing) return existing;

  const texture = ctx.device.createTexture({
    size: {
      width: SHADOW_MAP_SIZE,
      height: SHADOW_MAP_SIZE,
      depthOrArrayLayers: MAX_SHADOW_CASTERS,
    },
    format: SHADOW_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  _recordAlloc(ctx, "texture", shadowMapBytes());

  const arrayView = texture.createView({ dimension: "2d-array" });
  const layerViews: GPUTextureView[] = [];
  for (let i = 0; i < MAX_SHADOW_CASTERS; i++) {
    layerViews.push(
      texture.createView({
        dimension: "2d",
        baseArrayLayer: i,
        arrayLayerCount: 1,
      }),
    );
  }
  const comparisonSampler = ctx.device.createSampler({
    compare: "less",
    magFilter: "linear",
    minFilter: "linear",
  });

  const entry: ShadowMapEntry = {
    texture,
    arrayView,
    layerViews,
    comparisonSampler,
  };
  shadowMapByCtx.set(ctx, entry);
  _onDispose(ctx, () => _disposeShadowMap(ctx));
  return entry;
}

function _disposeShadowMap(ctx: Context): void {
  const entry = shadowMapByCtx.get(ctx);
  if (!entry) return;
  entry.texture.destroy();
  _recordDestroy(ctx, "texture", shadowMapBytes());
  shadowMapByCtx.delete(ctx);
}

/** Fixed slope-scaled depth bias on the caster pipeline (hardware), per the
 *  wgpu/Filament default. Per-light constant + normal-offset bias are applied
 *  in the receiver shader (fr_shade). */
export const SHADOW_SLOPE_SCALE = 2.0;

/** Fixed constant depth bias (hardware `depthBias` units, depth32float) on the
 *  caster pipeline. Paired with {@link SHADOW_SLOPE_SCALE}; per-light constant +
 *  normal-offset bias are applied in the receiver shader (fr_shade). */
export const SHADOW_CONST_BIAS = 2;

const SHADOW_VERTEX_STRIDE = 32; // pos(12) + normal(12) + uv(8) — matches the engine vertex layout
const SHADOW_POS_OFFSET = 0;
const SHADOW_NORMAL_OFFSET = 12; // after position (3 × f32)
const SHADOW_UV_OFFSET = 24; // after position + normal (6 × f32)

const casterPipelineByCtx = new WeakMap<Context, GPURenderPipeline>();

/** Build (once per ctx, SYNCHRONOUSLY) the single depth-only caster pipeline:
 *  vertex-only (no fragment / no color target), depth32float, single-sample,
 *  fixed slope-scaled bias. Cached + reused for all casters and all meshes.
 *  Sync because frame.render is sync and calls this on the per-frame path. */
export function _ensureShadowCasterPipeline(ctx: Context): GPURenderPipeline {
  const cached = casterPipelineByCtx.get(ctx);
  if (cached) return cached;
  const module = ctx.device.createShaderModule({
    code: toWgsl(_shadowCasterSrc),
  });
  const pipeline = ctx.device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: SHADOW_VERTEX_STRIDE,
          attributes: [
            {
              shaderLocation: 0,
              offset: SHADOW_POS_OFFSET,
              format: "float32x3",
            },
            {
              shaderLocation: 1,
              offset: SHADOW_NORMAL_OFFSET,
              format: "float32x3",
            },
            {
              shaderLocation: 2,
              offset: SHADOW_UV_OFFSET,
              format: "float32x2",
            },
          ],
        },
      ],
    },
    // cullMode "back": standard caster choice; flips shadow acne toward peter-panning
    // risk on thin geometry — revisit at the visual gate (try "front") if leaks appear.
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: {
      format: SHADOW_FORMAT,
      depthWriteEnabled: true,
      depthCompare: "less",
      depthBias: SHADOW_CONST_BIAS,
      depthBiasSlopeScale: SHADOW_SLOPE_SCALE,
    },
    multisample: { count: 1 },
    // NO fragment stage -> depth-only.
  });
  casterPipelineByCtx.set(ctx, pipeline);
  return pipeline;
}
