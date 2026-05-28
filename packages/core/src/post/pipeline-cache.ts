import {
  acquirePostPipeline,
  releasePostPipeline,
} from "../resources/manager.ts";

/**
 * Engine-internal facade over the per-ctx post pipeline cache. The
 * underlying state lives in `ctx._internal.resources.postPipelineCache`
 * — scoping the cache to the ctx is what closes the cross-context
 * pipeline leak (mirror of the material-pipeline migration in Task 3.1;
 * see `docs/backlog/engine-architecture/pipeline-cache-cross-context-leak.md`).
 *
 * `acquire(ctx, key, build)` returns a refcounted pipeline (built only on
 * a cache miss). `release(ctx, key)` decrements one ref; the entry is
 * evicted when refcount hits zero.
 */
export const _pipelineCache = {
  acquire: acquirePostPipeline,
  release: releasePostPipeline,
};
