import { _bufferOf } from "../binding/binding.ts";
import type { Binding, LayoutSchema } from "../binding/types.ts";
import { FurnaceError } from "../errors.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import type { EffectHandle } from "../resources/handle.ts";
import {
  _allocEffect,
  _destroyEffect,
  _lookupShader,
} from "../resources/internal.ts";
import { _layoutOf } from "../shader/shader.ts";
import type { Shader, ShaderSlot } from "../shader/types.ts";
import { _ensureFullscreenVS } from "./fullscreen.ts";
import {
  _buildEffectPipelineDescriptor,
  _effectPipelineHashKey,
} from "./pipeline.ts";
import { _pipelineCache } from "./pipeline-cache.ts";

/**
 * Descriptor accepted by `post.create`.
 *
 * - `shader`: the compiled {@link Shader} resource (from `shader.create` /
 *   `shader.load`) providing the fragment stage. The shared fullscreen vertex
 *   shader (`vs_fullscreen`) is auto-supplied by the engine; the fragment entry
 *   point must be named `fs_main`. The sampler and scene colour input are bound
 *   at `@group(0)` (engine-owned); consumer params live under `@group(1)`.
 * - `binding`: typed `@group(1)` data path — a {@link Binding} whose buffer is
 *   used to build the `@group(1)` `GPUBindGroup`. Required when the shader
 *   declares a `@group(1)` layout (unless `bindings` is supplied instead). The
 *   binding OWNS its buffer; `post.destroy` does not free it.
 * - `bindings`: raw entries bound at `@group(1)`. Retained for textures,
 *   samplers, and advanced use-cases; `binding` is preferred for typed uniform
 *   data. The underlying resources (buffers, textures) are consumer-owned —
 *   destroy them yourself after `post.destroy`.
 * - `blend`: undefined disables blending (opaque output). Supply a
 *   `GPUBlendState` to alpha-blend the effect over the scene.
 *
 * The phantom `L` carries the binding layout schema when the effect was created
 * with a typed {@link Binding}. Defaults to `LayoutSchema` (wide) otherwise.
 */
export type EffectDescriptor<L extends LayoutSchema = LayoutSchema> = {
  shader: Shader<L>;
  binding?: Binding<L>;
  bindings?: GPUBindGroupEntry[];
  blend?: GPUBlendState;
};

/**
 * Opaque post-effect handle returned by `post.create`. Consumers pass it
 * to `frame.render` via `RenderOptions.effects` and dispose via
 * `post.destroy`; the underlying pipeline + bind group live in the per-ctx
 * resource manager's effects pool.
 *
 * The phantom `L` carries the binding layout schema when the effect was created
 * with a typed {@link Binding}. Defaults to `LayoutSchema` (wide) otherwise.
 * Type-alias of {@link EffectHandle}; consumers can use either name.
 */
export type Effect<L extends LayoutSchema = LayoutSchema> = EffectHandle & {
  readonly __layout?: L;
};

/**
 * One cached pipeline variant for a single target colour format, plus its
 * `@group(1)` bind group resolved against that pipeline's auto-derived layout.
 * Effects build one of these lazily per format they render into: under HDR the
 * same effect can target the `rgba16float` intermediate (mid-chain) and
 * `ctx.format` (final swap-chain pass) and so holds two variants.
 */
type EffectPipelineVariant = {
  pipeline: GPURenderPipeline;
  pipelineKey: string;
  group1: GPUBindGroup | null;
};

/**
 * Engine-private slot data backing an {@link Effect} handle in the
 * effects pool. Not exported from the `@furnace/core/post` public
 * surface; resource-manager internals only.
 *
 * Pipelines build lazily per resolved target format (see
 * {@link _resolveEffectPipeline}) and are cached in `byFormat`, keyed on the
 * `GPUTextureFormat` the effect renders into. Each variant is refcounted in the
 * per-ctx post pipeline cache (keyed on shader handle + target format + blend
 * signature). `fsModule` is the fragment-stage module retained so target-format
 * variants can be built on demand; `group1Entries` are the `@group(1)` bind-group
 * entries (re)bound per pipeline variant (or `null` when the shader declares no
 * `@group(1)` data); `blend` is the descriptor value captured at create time.
 */
export type EffectSlot = {
  fsModule: GPUShaderModule;
  shaderKey: string;
  group1Entries: GPUBindGroupEntry[] | null;
  blend: GPUBlendState | undefined;
  byFormat: Map<GPUTextureFormat, EffectPipelineVariant>;
  _teardown: () => void;
};

// Synchronous: GPUDevice.createRenderPipeline is synchronous and effect
// pipelines are built lazily on the synchronous frame.render hot path (per
// resolved target format). Any pipeline-creation validation error surfaces via
// the device's error scope at the call site (e.g. the test's pushErrorScope
// around frame.render) or the uncaptured-error handler in production — we cannot
// await popErrorScope here without making render async.
function buildPipeline(
  ctx: Context,
  fsModule: GPUShaderModule,
  vsModule: GPUShaderModule,
  targetFormat: GPUTextureFormat,
  blend: GPUBlendState | undefined,
): GPURenderPipeline {
  const descriptor = _buildEffectPipelineDescriptor(
    fsModule,
    vsModule,
    targetFormat,
    blend,
  );
  return ctx.device.createRenderPipeline(descriptor);
}

// getBindGroupLayout and createBindGroup can throw synchronously when the
// supplied entries don't match the auto-derived layout. Either failure must
// release the pipeline-cache slot acquired above, or the entry leaks (acquire
// ran but no release ever will, and the caller has no key to release with).
// Mirrors material.ts's buildGroup1 discipline.
function buildGroup1(
  ctx: Context,
  pipeline: GPURenderPipeline,
  pipelineKey: string,
  bindings: GPUBindGroupEntry[],
): GPUBindGroup {
  let layout: GPUBindGroupLayout;
  try {
    layout = pipeline.getBindGroupLayout(1);
  } catch {
    _pipelineCache.release(ctx, pipelineKey);
    throw new FurnaceError(
      "post.create: @group(1) data (binding/bindings) supplied but shader declares no @group(1) bindings",
    );
  }
  try {
    return ctx.device.createBindGroup({ layout, entries: bindings });
  } catch (e) {
    _pipelineCache.release(ctx, pipelineKey);
    throw e;
  }
}

function effectTeardown(ctx: Context, slot: EffectSlot): void {
  for (const variant of slot.byFormat.values()) {
    _pipelineCache.release(ctx, variant.pipelineKey);
  }
}

/**
 * Get-or-build the pipeline variant for `targetFormat` on `slot`, caching it in
 * `slot.byFormat`. The pipeline is built (or reused from the per-ctx post
 * pipeline cache) against `targetFormat` — under HDR a mid-chain effect targets
 * `ctx._internal.workingColorFormat` (rgba16float) while the final pass targets
 * `ctx.format`, so the same effect acquires two distinct cache entries.
 *
 * Engine-internal; called synchronously by `frame.render`'s post pass, not the
 * public surface.
 */
export function _resolveEffectPipeline(
  ctx: Context,
  slot: EffectSlot,
  targetFormat: GPUTextureFormat,
): EffectPipelineVariant {
  const cached = slot.byFormat.get(targetFormat);
  if (cached !== undefined) return cached;

  const vsModule = _ensureFullscreenVS(ctx);
  const pipelineKey = _effectPipelineHashKey(
    slot.shaderKey,
    targetFormat,
    slot.blend,
  );
  const pipeline = _pipelineCache.acquireSync(ctx, pipelineKey, () =>
    buildPipeline(ctx, slot.fsModule, vsModule, targetFormat, slot.blend),
  );

  const group1 =
    slot.group1Entries !== null
      ? buildGroup1(ctx, pipeline, pipelineKey, slot.group1Entries)
      : null;

  const variant: EffectPipelineVariant = { pipeline, pipelineKey, group1 };
  slot.byFormat.set(targetFormat, variant);
  return variant;
}

/**
 * Register a full-screen post-process effect and return an opaque
 * {@link Effect} handle. The effect slot is allocated in the per-ctx resource
 * manager's effects pool. The fragment-stage module and `@group(1)` entries are
 * captured now; the `GPURenderPipeline` (and its `@group(1)` bind group) build
 * lazily on first render, per resolved target colour format — under HDR the
 * same effect targets the `rgba16float` intermediate mid-chain and `ctx.format`
 * as the final swap-chain pass, so it holds one pipeline variant per format.
 *
 * The shared fullscreen vertex shader (`vs_fullscreen`) is auto-supplied; the
 * `desc.shader` resource only needs to provide the fragment stage (entry
 * `fs_main`). See {@link EffectDescriptor} for the `@group(0)` / `@group(1)`
 * binding contract. Two `create` calls on the same ctx with the same shader
 * handle (and identical blend) share one underlying `GPURenderPipeline` per
 * target format via the per-ctx post pipeline cache; the cache is per-ctx, so a
 * pipeline built against ctx A cannot be reused in ctx B.
 *
 * Allocation: when `desc.binding` (or a non-empty `desc.bindings`) is supplied,
 * the `@group(1)` entries are retained and a `GPUBindGroup` is built over each
 * pipeline variant's auto-derived layout at first render. The bind-group
 * resources (the binding's buffer, or consumer textures) are consumer-owned —
 * `post.destroy` does not touch them.
 *
 * Setup-loud: throws on bad input or a disposed context (see
 * `engine-conventions.md` §"Failure policy"). Pipeline-creation validation
 * errors surface at first render (when the pipeline is built), not at create.
 *
 * @throws FurnaceGpuError - `ctx` is disposed.
 * @throws FurnaceError - `desc.shader` is missing.
 * @throws FurnaceError - the shader handle is invalid or destroyed.
 * @throws FurnaceError - the shader declares a `@group(1)` layout but neither
 *   `desc.binding` nor a non-empty `desc.bindings` is supplied (completeness
 *   check — setup-loud).
 * @throws FurnaceError - `desc.binding` is invalid or destroyed.
 */
// biome-ignore lint/suspicious/useAwait: public post.create returns Promise<Effect> by contract (sibling post.tonemap is irreducibly async; 2b-3's multi-pass reshape may reintroduce async work); body became await-free only because pipelines build lazily at render time
export async function create<L extends LayoutSchema = LayoutSchema>(
  ctx: Context,
  desc: EffectDescriptor<L>,
): Promise<Effect<L>> {
  if (ctx._internal.disposed) {
    throw new FurnaceGpuError("post.create: context is disposed");
  }
  if (desc.shader == null) {
    throw new FurnaceError("post.create: shader is required");
  }
  const shaderSlot = _lookupShader<ShaderSlot>(ctx, desc.shader);
  if (shaderSlot === null) {
    throw new FurnaceError(
      "post.create: shader handle is invalid or destroyed",
    );
  }

  // Completeness check: if the shader declares @group(1) data, the caller must
  // supply either a typed binding or raw bindings — a no-data effect against a
  // data-expecting shader is almost certainly a mistake (setup-loud). Mirrors
  // material.create.
  const shaderLayout = _layoutOf(ctx, desc.shader);
  const hasBinding = desc.binding != null;
  const hasRawBindings = desc.bindings != null && desc.bindings.length > 0;
  if (shaderLayout !== null && !hasBinding && !hasRawBindings) {
    throw new FurnaceError(
      "post.create: shader declares @group(1) data but no binding/bindings supplied",
    );
  }

  // Resolve the @group(1) bind-group entries: typed binding path takes
  // precedence over raw bindings. These entries are (re)bound per pipeline
  // variant in _resolveEffectPipeline; no pipeline is built at create time.
  // The binding OWNS its buffer — post.destroy does not free it.
  let group1Entries: GPUBindGroupEntry[] | null = null;
  if (desc.binding != null) {
    const buf = _bufferOf(ctx, desc.binding);
    if (buf === null) {
      // Stale/destroyed binding — fail setup-loud rather than silently leaving
      // group1 null (which would surface as a GPU error at draw time). No
      // pipeline-cache slot to release: pipelines build lazily at render time.
      throw new FurnaceError(
        "post.create: binding handle is invalid or destroyed",
      );
    }
    group1Entries = [{ binding: 0, resource: { buffer: buf } }];
  } else if (hasRawBindings && desc.bindings != null) {
    group1Entries = desc.bindings;
  }

  const slot: EffectSlot = {
    fsModule: shaderSlot.module,
    shaderKey: String(desc.shader),
    group1Entries,
    blend: desc.blend,
    byFormat: new Map(),
    _teardown: () => effectTeardown(ctx, slot),
  };
  // Boundary cast: phantom L is compile-time only; _allocEffect returns
  // EffectHandle which is structurally identical to Effect<L> at runtime.
  return _allocEffect(ctx, slot) as Effect<L>;
}

/**
 * Destroy an {@link Effect}: release one ref on the cached pipeline.
 * The pipeline itself is freed when its refcount drops to zero.
 *
 * Does not destroy the consumer-owned resources passed via
 * `EffectDescriptor.binding` / `EffectDescriptor.bindings` (the binding's
 * buffer, or buffers/textures the consumer created and handed in) — the
 * consumer destroys those.
 *
 * Silent on stale or already-destroyed handles (idempotent — matches the
 * Material / Mesh / Geometry destroy contract).
 */
export function destroy(ctx: Context, effect: Effect): void {
  _destroyEffect<EffectSlot>(ctx, effect, (s) => {
    s._teardown();
  });
}
