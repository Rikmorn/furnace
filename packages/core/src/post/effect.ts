import { FurnaceError } from "../errors.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import type { EffectHandle } from "../resources/handle.ts";
import { _allocEffect, _destroyEffect } from "../resources/internal.ts";
import {
  _registerResource,
  _unregisterResource,
  type ResourceHandle,
} from "../stats/internal.ts";
import { _ensureFullscreenVS } from "./fullscreen.ts";
import {
  _buildEffectPipelineDescriptor,
  _effectPipelineHashKey,
} from "./pipeline.ts";
import { _pipelineCache } from "./pipeline-cache.ts";

/**
 * Descriptor accepted by `post.create`.
 *
 * - `shader`: required WGSL fragment-stage source. The shared fullscreen
 *   vertex shader (`vs_fullscreen`) is auto-supplied by the engine; the
 *   fragment entry point must be named `fs_main`. The sampler and scene
 *   colour input are bound at `@group(0)` (engine-owned); consumer
 *   bindings live under `@group(1)`.
 * - `bindings`: entries bound at `@group(1)`. The underlying resources
 *   (buffers, textures) are consumer-owned — destroy them yourself after
 *   `post.destroy`.
 * - `blend`: undefined disables blending (opaque output). Supply a
 *   `GPUBlendState` to alpha-blend the effect over the scene.
 */
export type EffectDescriptor = {
  shader: string;
  bindings?: GPUBindGroupEntry[];
  blend?: GPUBlendState;
};

/**
 * Opaque post-effect handle returned by `post.create`. Consumers pass it
 * to `frame.render` via `RenderOptions.effects` and dispose via
 * `post.destroy`; the underlying pipeline + bindings live in the per-ctx
 * resource manager's effects pool.
 *
 * Type-alias of {@link EffectHandle}; consumers can use either name.
 */
export type Effect = EffectHandle;

/**
 * Engine-private slot data backing an {@link Effect} handle in the
 * effects pool. Not exported from the `@furnace/core/post` public
 * surface; resource-manager internals only.
 *
 * `pipeline` is refcounted in the per-ctx post pipeline cache (keyed on
 * shader + ctx format + blend signature). `bindings` and `blend` are the
 * descriptor values captured at create time, consumed by `frame.render`'s
 * post pass via `_resolveEffect`.
 */
export type EffectSlot = {
  ctx: Context;
  pipeline: GPURenderPipeline;
  pipelineKey: string;
  bindings: GPUBindGroupEntry[] | null;
  blend: GPUBlendState | undefined;
  _teardown: () => void;
};

async function buildPipeline(
  ctx: Context,
  shader: string,
  vsModule: GPUShaderModule,
  blend: GPUBlendState | undefined,
): Promise<GPURenderPipeline> {
  ctx.device.pushErrorScope("validation");
  const fsModule = ctx.device.createShaderModule({ code: shader });
  const descriptor = _buildEffectPipelineDescriptor(
    fsModule,
    vsModule,
    ctx.format,
    blend,
  );
  const pipeline = ctx.device.createRenderPipeline(descriptor);
  const err = await ctx.device.popErrorScope();
  if (err) {
    throw new FurnaceError(
      `post effect pipeline creation failed: ${err.message}`,
    );
  }
  return pipeline;
}

function effectTeardown(slot: EffectSlot, statsHandle: ResourceHandle): void {
  _unregisterResource(slot.ctx, statsHandle);
  _pipelineCache.release(slot.ctx, slot.pipelineKey);
}

/**
 * Build (or reuse, via the internal per-ctx post pipeline cache) a
 * full-screen post-process pipeline keyed on shader + ctx format + blend
 * signature, register an effect resource with stats, and return an
 * opaque {@link Effect} handle.
 *
 * The shared fullscreen vertex shader (`vs_fullscreen`) is auto-supplied;
 * `desc.shader` only needs to provide the fragment stage (entry `fs_main`).
 * See {@link EffectDescriptor} for the `@group(0)` / `@group(1)` binding
 * contract. Two `create` calls on the same ctx with identical keys share
 * one underlying `GPURenderPipeline`; the cache is per-ctx, so a pipeline
 * built against ctx A cannot be reused in ctx B.
 *
 * Setup-loud: throws on bad input or a disposed context (see
 * `engine-conventions.md` §"Failure policy").
 *
 * @throws FurnaceGpuError - `ctx` is disposed.
 * @throws FurnaceError - `desc.shader` is empty, or pipeline creation
 *   surfaced a WebGPU validation error.
 */
export async function create(
  ctx: Context,
  desc: EffectDescriptor,
): Promise<Effect> {
  if (ctx._internal.disposed) {
    throw new FurnaceGpuError("post.create: context is disposed");
  }
  if (!desc.shader) {
    throw new FurnaceError("post.create: shader is required");
  }

  const vsModule = _ensureFullscreenVS(ctx);
  const pipelineKey = _effectPipelineHashKey(
    desc.shader,
    ctx.format,
    desc.blend,
  );
  const pipeline = await _pipelineCache.acquire(ctx, pipelineKey, () =>
    buildPipeline(ctx, desc.shader, vsModule, desc.blend),
  );
  const statsHandle = _registerResource(ctx, { kind: "effect" });

  const slot: EffectSlot = {
    ctx,
    pipeline,
    pipelineKey,
    bindings: desc.bindings ?? null,
    blend: desc.blend,
    _teardown: () => effectTeardown(slot, statsHandle),
  };
  return _allocEffect(ctx, slot);
}

/**
 * Destroy an {@link Effect}: unregister its stats handle and release one
 * ref on the cached pipeline. The pipeline itself is freed when its
 * refcount drops to zero.
 *
 * Does not destroy the consumer-owned resources passed via
 * `EffectDescriptor.bindings` (buffers/textures the consumer created and
 * handed in) — the consumer destroys those.
 *
 * Silent on stale or already-destroyed handles (idempotent — matches the
 * Material / Mesh / Geometry destroy contract).
 */
export function destroy(ctx: Context, effect: Effect): void {
  _destroyEffect<EffectSlot>(ctx, effect, (s) => {
    s._teardown();
  });
}
