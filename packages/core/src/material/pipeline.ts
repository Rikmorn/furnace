import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";

type CacheEntry = {
  pipeline: GPURenderPipeline;
  refCount: number;
};

const cache = new Map<string, CacheEntry>();

async function acquire(
  key: string,
  build: () => Promise<GPURenderPipeline>,
): Promise<GPURenderPipeline> {
  const hit = cache.get(key);
  if (hit) {
    hit.refCount += 1;
    return hit.pipeline;
  }
  const pipeline = await build();
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

/**
 * Escape hatch: wrap `device.createRenderPipeline` in a
 * `pushErrorScope("validation")` so validation failures surface as a thrown
 * `FurnaceError` instead of an async `uncapturederror`. Returns the raw
 * `GPURenderPipeline`.
 *
 * The pipeline is **not** cached and **not** registered with stats — the
 * caller owns it and is responsible for any teardown. For the normal path
 * (cached + refcounted + resource-tracked), use {@link create}.
 *
 * @throws FurnaceError - if WebGPU pipeline creation reports a validation
 *   error.
 */
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
