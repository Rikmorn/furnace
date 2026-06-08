import { _onDispose } from "../gpu/dispose-cascade.ts";
import type { Context } from "../gpu/index.ts";
import { _recomputeModelIfDirty } from "../mesh/mesh.ts";
import type { MeshSlot } from "../mesh/types.ts";
import { _shadowCasterSrc } from "../shader/shadows.ts";
import { toWgsl } from "../shader/source.ts";
import { _recordAlloc, _recordDestroy } from "../stats/internal.ts";
import { type Light, MAX_SHADOW_CASTERS, type ShadowCaster } from "./lights.ts";
import type { ResolvedDraw } from "./render.ts";
import {
  _directionalLightViewProj,
  _spotLightViewProj,
} from "./shadow-projection.ts";

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

/** Default texel-scaled normal-offset bias applied when a caster omits
 *  `normalBias`. Packed into the shadow lane and consumed by the receiver shader. */
const DEFAULT_NORMAL_BIAS = 1.5;

/**
 * Scan `lights` for shadow casters — `directional`/`spot` lights that carry a
 * `shadow` config — assigning slots `0..N-1` and deriving each light-space
 * view·proj·remap matrix. Clamps to {@link MAX_SHADOW_CASTERS} and reports
 * overflow (the caller warns once — never throws; this runs on the render path).
 * Pure: builds and returns a fresh array, mutates nothing. Engine-internal;
 * exported for tests.
 */
export function _collectShadowCasters(lights: readonly Light[] | undefined): {
  casters: ShadowCaster[];
  overflowed: boolean;
} {
  const casters: ShadowCaster[] = [];
  if (!lights) return { casters, overflowed: false };
  let overflowed = false;
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i];
    if (!l) continue;
    if (l.type === "point" || l.shadow == null) continue;
    if (casters.length >= MAX_SHADOW_CASTERS) {
      overflowed = true;
      continue;
    }
    const viewProj =
      l.type === "directional"
        ? _directionalLightViewProj(l)
        : _spotLightViewProj(l);
    casters.push({
      lightIndex: i,
      slot: casters.length,
      viewProj,
      depthBias: l.shadow.depthBias ?? 0,
      normalBias: l.shadow.normalBias ?? DEFAULT_NORMAL_BIAS,
    });
  }
  return { casters, overflowed };
}

/** One `mat4x4<f32>` (16 × f32). Per-slot light-VP uniform buffer size. Kept as
 *  its own 64 B buffer per slot (not one buffer at 256 B dynamic offsets — the
 *  uniform-offset alignment trap). */
const LIGHT_VP_SIZE = 64;

const vpBuffersByCtx = new WeakMap<Context, GPUBuffer[]>();
const lightGroup0ByCtx = new WeakMap<Context, GPUBindGroup[]>();
const casterObjectGroupByMesh = new WeakMap<MeshSlot, GPUBindGroup>();

/** Lazily allocate the `MAX_SHADOW_CASTERS` per-slot 64 B light-VP uniform
 *  buffers (one per slot) and return the one for `slot`. Freed via the dispose
 *  cascade. */
function perSlotVpBuffer(ctx: Context, slot: number): GPUBuffer {
  let buffers = vpBuffersByCtx.get(ctx);
  if (!buffers) {
    buffers = [];
    for (let i = 0; i < MAX_SHADOW_CASTERS; i++) {
      const buffer = ctx.device.createBuffer({
        size: LIGHT_VP_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      _recordAlloc(ctx, "buffer", LIGHT_VP_SIZE);
      buffers.push(buffer);
    }
    vpBuffersByCtx.set(ctx, buffers);
    _onDispose(ctx, () => _disposeVpBuffers(ctx));
  }
  // slot is bounded 0..MAX_SHADOW_CASTERS-1 by _collectShadowCasters; the array
  // is exactly that length, so the entry is always present.
  return buffers[slot] as GPUBuffer;
}

function _disposeVpBuffers(ctx: Context): void {
  const buffers = vpBuffersByCtx.get(ctx);
  if (!buffers) return;
  for (const buffer of buffers) {
    buffer.destroy();
    _recordDestroy(ctx, "buffer", LIGHT_VP_SIZE);
  }
  vpBuffersByCtx.delete(ctx);
}

/** Lazily build the per-slot light-VP bind group at `@group(0) @binding(0)` of
 *  the caster pipeline (the caster shader's `lightVP`). Cached per slot. */
function perSlotLightGroup0(
  ctx: Context,
  pipeline: GPURenderPipeline,
  slot: number,
  vpBuf: GPUBuffer,
): GPUBindGroup {
  let groups = lightGroup0ByCtx.get(ctx);
  if (!groups) {
    groups = [];
    lightGroup0ByCtx.set(ctx, groups);
  }
  const cached = groups[slot];
  if (cached) return cached;
  const bindGroup = ctx.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: vpBuf } }],
  });
  groups[slot] = bindGroup;
  return bindGroup;
}

/** Lazily build the per-mesh caster object bind group at `@group(1) @binding(0)`
 *  of the caster pipeline (the caster shader declares `object` at group 1, NOT
 *  group 2 like the main pipeline). Binds the mesh's 128 B Object buffer; the
 *  64 B caster `Object` struct reads only `model`, which is valid. Cached per
 *  mesh (the caster pipeline is a per-ctx singleton, so it does not widen the key). */
function casterObjectGroup(
  ctx: Context,
  pipeline: GPURenderPipeline,
  mesh: MeshSlot,
): GPUBindGroup {
  const cached = casterObjectGroupByMesh.get(mesh);
  if (cached) return cached;
  const bindGroup = ctx.device.createBindGroup({
    layout: pipeline.getBindGroupLayout(1),
    entries: [{ binding: 0, resource: { buffer: mesh.objectBuffer } }],
  });
  casterObjectGroupByMesh.set(mesh, bindGroup);
  return bindGroup;
}

/**
 * Record one depth-only pass per caster into its array layer, drawing every
 * resolved mesh with the shared caster pipeline. Each caster's light-VP matrix
 * is written to its per-slot uniform buffer first; each mesh's model matrix is
 * refreshed (idempotently priming it for the main pass that follows). No-op when
 * there are no casters. SYNCHRONOUS — runs on the per-frame render path.
 * Engine-internal.
 */
export function _recordShadowPasses(
  ctx: Context,
  encoder: GPUCommandEncoder,
  casters: readonly ShadowCaster[],
  resolvedDraws: readonly ResolvedDraw[],
): void {
  if (casters.length === 0) return;
  const pipeline = _ensureShadowCasterPipeline(ctx);
  const sm = _ensureShadowMap(ctx);
  for (const c of casters) {
    const vpBuf = perSlotVpBuffer(ctx, c.slot);
    ctx.queue.writeBuffer(vpBuf, 0, c.viewProj);
    const pass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        // slot is bounded by _collectShadowCasters to a valid layer index.
        view: sm.layerViews[c.slot] as GPUTextureView,
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, perSlotLightGroup0(ctx, pipeline, c.slot, vpBuf));
    for (const d of resolvedDraws) {
      // Refresh the model matrix before drawing — mirrors the main pass
      // (recordDraw). Since the shadow pass runs first, this also primes
      // mesh.objectBuffer for the main pass (idempotent).
      _recomputeModelIfDirty(ctx, d.mesh);
      pass.setBindGroup(1, casterObjectGroup(ctx, pipeline, d.mesh));
      pass.setVertexBuffer(0, d.geometry.vertexBuffer);
      const { indexBuffer, indexFormat, indexCount, vertexCount } = d.geometry;
      if (indexBuffer && indexFormat) {
        pass.setIndexBuffer(indexBuffer, indexFormat);
        pass.drawIndexed(indexCount);
      } else {
        pass.draw(vertexCount);
      }
    }
    pass.end();
  }
}
