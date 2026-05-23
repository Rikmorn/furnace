import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";

type CacheEntry = {
  pipeline: GPURenderPipeline;
  refCount: number;
};

const cache = new Map<string, CacheEntry>();

function acquire(
  key: string,
  build: () => GPURenderPipeline,
): GPURenderPipeline {
  const hit = cache.get(key);
  if (hit) {
    hit.refCount += 1;
    return hit.pipeline;
  }
  const pipeline = build();
  cache.set(key, { pipeline, refCount: 1 });
  return pipeline;
}

function release(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    cache.delete(key);
  }
}

function resetForTests(): void {
  cache.clear();
}

export const _pipelineCache = { acquire, release, resetForTests };

export async function createPipeline(
  ctx: Context,
  descriptor: GPURenderPipelineDescriptor,
): Promise<GPURenderPipeline> {
  ctx.device.pushErrorScope("validation");
  const pipeline = ctx.device.createRenderPipeline(descriptor);
  const error = await ctx.device.popErrorScope();
  if (error) {
    throw new FurnaceError(`pipeline creation failed: ${error.message}`);
  }
  return pipeline;
}
