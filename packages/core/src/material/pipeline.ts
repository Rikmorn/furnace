import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import {
  acquireMaterialPipeline,
  releaseMaterialPipeline,
} from "../resources/manager.ts";

/**
 * Engine-internal facade over the per-ctx material pipeline cache. The
 * underlying state lives in `ctx._internal.resources.materialPipelineCache`
 * — scoping the cache to the ctx is what closes the cross-context
 * pipeline leak (see
 * `docs/backlog/engine-architecture/pipeline-cache-cross-context-leak.md`).
 *
 * `acquire(ctx, key, build)` returns a refcounted pipeline (built only on
 * a cache miss). `release(ctx, key)` decrements one ref; the entry is
 * evicted when refcount hits zero.
 */
export const _pipelineCache = {
  acquire: acquireMaterialPipeline,
  release: releaseMaterialPipeline,
};

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
