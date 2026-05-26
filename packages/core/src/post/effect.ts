import { FurnaceError } from "../errors.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
import { warn } from "../log/internal.ts";
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
 * Engine-owned post-effect handle returned by `post.create`.
 *
 * Treated as opaque by consumers — pass to `frame.render` via
 * `RenderOptions.effects` and dispose via `post.destroy`. `pipeline` is
 * refcounted in the internal post pipeline cache (keyed on shader + ctx
 * format + blend signature); `_effectHandle` and `_internal` are
 * engine-managed bookkeeping for stats and the destroy guard.
 */
export type Effect = Readonly<{
  ctx: Context;
  pipeline: GPURenderPipeline;
  pipelineKey: string;
  bindings: GPUBindGroupEntry[] | null;
  blend: GPUBlendState | undefined;
  _effectHandle: ResourceHandle;
  _internal: { destroyed: boolean };
}>;

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

/**
 * Build (or reuse, via the internal post pipeline cache) a full-screen
 * post-process pipeline keyed on shader + ctx format + blend signature,
 * register an effect resource with stats, and return an opaque
 * {@link Effect} handle.
 *
 * The shared fullscreen vertex shader (`vs_fullscreen`) is auto-supplied;
 * `desc.shader` only needs to provide the fragment stage (entry `fs_main`).
 * See {@link EffectDescriptor} for the `@group(0)` / `@group(1)` binding
 * contract.
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
  const pipeline = await _pipelineCache.acquire(pipelineKey, () =>
    buildPipeline(ctx, desc.shader, vsModule, desc.blend),
  );
  const handle = _registerResource(ctx, { kind: "effect" });

  return Object.freeze({
    ctx,
    pipeline,
    pipelineKey,
    bindings: desc.bindings ?? null,
    blend: desc.blend,
    _effectHandle: handle,
    _internal: { destroyed: false },
  });
}

/**
 * Mark an {@link Effect} destroyed, unregister its resource handle from
 * stats, and release one ref on the cached pipeline. The pipeline itself
 * is freed when its refcount drops to zero.
 *
 * Does not destroy the consumer-owned resources passed via
 * `EffectDescriptor.bindings` (buffers/textures the consumer created and
 * handed in) — the consumer destroys those.
 *
 * Runtime-quiet on double-destroy: routes a warning to the engine log
 * helper (see `@furnace/core/log`) at `warn` level and returns without
 * re-releasing, so accidental double-destroy never decrements the
 * pipeline refcount twice.
 */
export function destroy(effect: Effect): void {
  if (effect._internal.destroyed) {
    warn("post", "effect already destroyed");
    return;
  }
  effect._internal.destroyed = true;
  _unregisterResource(effect.ctx, effect._effectHandle);
  _pipelineCache.release(effect.pipelineKey);
}
