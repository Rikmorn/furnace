import { FurnaceError } from "../errors.ts";
import { FurnaceGpuError } from "../gpu/errors.ts";
import type { Context } from "../gpu/index.ts";
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

export type EffectDescriptor = {
  shader: string;
  bindings?: GPUBindGroupEntry[];
  blend?: GPUBlendState;
};

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

export function destroy(effect: Effect): void {
  if (effect._internal.destroyed) {
    console.warn("[furnace/post] effect already destroyed");
    return;
  }
  effect._internal.destroyed = true;
  _unregisterResource(effect.ctx, effect._effectHandle);
  _pipelineCache.release(effect.pipelineKey);
}
