import type { Context } from "../gpu/context-types.ts";
import type { BindingHandle, ShaderHandle } from "./handle.ts";
import { createPool, type Pool } from "./pool.ts";

/**
 * Per-context resource manager. Owns one pool per consumer-facing
 * resource type. Slot data types are loose (`unknown`) at this layer
 * because the manager is generic — the type-safe wrapper lives in
 * `internal.ts` (engine-internal API) and `index.ts` (public API).
 *
 * The pool kinds are fixed at compile time and align with the four
 * consumer-facing resource types in @furnace/core. Future resource
 * types (textures, samplers, scene nodes) extend this struct.
 *
 * The two `*PipelineCache` maps are refcounted GPU-pipeline caches
 * scoped to this ctx. They live here (not at module scope) so a
 * pipeline built against one device cannot leak into another ctx's
 * draws — see `docs/backlog/engine-architecture/pipeline-cache-cross-context-leak.md`
 * (closed by this migration).
 */
export type ResourceManager = {
  meshes: Pool<unknown>;
  materials: Pool<unknown>;
  geometries: Pool<unknown>;
  effects: Pool<unknown>;
  shaders: Pool<unknown>;
  bindings: Pool<unknown>;
  physicsWorlds: Pool<unknown>;
  physicsBodies: Pool<unknown>;
  rigidMeshes: Pool<unknown>;
  materialPipelineCache: Map<string, PipelineCacheEntry>;
  postPipelineCache: Map<string, PipelineCacheEntry>;
  /** Bindings whose CPU scratch has been written since the last render flush.
   *  Drained by `_flushDirtyBindings` at the render boundary (one
   *  `writeBuffer` per entry). Per-ctx so a binding not attached to any drawn
   *  material still flushes (compute-ready). */
  dirtyBindings: Set<BindingHandle>;
  /** Per-ctx engine-owned built-in shader cache (lazily compiled once; stores
   *  the in-flight Promise for concurrent-first-call dedup; freed by the
   *  dispose cascade). See `shader/builtins.ts`. */
  builtinShaders: {
    unlit: Promise<ShaderHandle> | null;
    normalColor: Promise<ShaderHandle> | null;
  };
};

/**
 * One refcounted slot in a pipeline cache. The refcount tracks how many
 * live consumer objects (Materials, Effects) point at the pipeline;
 * the entry is evicted when refcount hits zero.
 */
export type PipelineCacheEntry = {
  pipeline: GPURenderPipeline;
  refCount: number;
};

/**
 * Construct a new resource manager with empty pools for every resource
 * type and empty pipeline caches. Called once per Context in
 * `createInternalState`.
 */
export function createResourceManager(): ResourceManager {
  return {
    meshes: createPool(),
    materials: createPool(),
    geometries: createPool(),
    effects: createPool(),
    shaders: createPool(),
    bindings: createPool(),
    physicsWorlds: createPool(),
    physicsBodies: createPool(),
    rigidMeshes: createPool(),
    materialPipelineCache: new Map(),
    postPipelineCache: new Map(),
    builtinShaders: { unlit: null, normalColor: null },
    dirtyBindings: new Set(),
  };
}

async function acquirePipeline(
  cache: Map<string, PipelineCacheEntry>,
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

function releasePipeline(
  cache: Map<string, PipelineCacheEntry>,
  key: string,
): void {
  const entry = cache.get(key);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    cache.delete(key);
  }
}

/**
 * Acquire (build or reuse) a material-shader render pipeline from this
 * ctx's material pipeline cache. Refcount on the entry is incremented
 * on a hit; `build` runs only on a miss. Engine-internal.
 */
export function acquireMaterialPipeline(
  ctx: Context,
  key: string,
  build: () => Promise<GPURenderPipeline>,
): Promise<GPURenderPipeline> {
  return acquirePipeline(
    ctx._internal.resources.materialPipelineCache,
    key,
    build,
  );
}

/**
 * Release one reference on a material-shader pipeline. The pipeline is
 * evicted from the cache when its refcount drops to zero. No-op on an
 * unknown key (safe to call from error-recovery paths). Engine-internal.
 */
export function releaseMaterialPipeline(ctx: Context, key: string): void {
  releasePipeline(ctx._internal.resources.materialPipelineCache, key);
}

/**
 * Acquire (build or reuse) a post-process render pipeline from this
 * ctx's post pipeline cache. Refcount on the entry is incremented on a
 * hit; `build` runs only on a miss. Engine-internal.
 */
export function acquirePostPipeline(
  ctx: Context,
  key: string,
  build: () => Promise<GPURenderPipeline>,
): Promise<GPURenderPipeline> {
  return acquirePipeline(ctx._internal.resources.postPipelineCache, key, build);
}

/**
 * Release one reference on a post-process pipeline. The pipeline is
 * evicted from the cache when its refcount drops to zero. No-op on an
 * unknown key (safe to call from error-recovery paths). Engine-internal.
 */
export function releasePostPipeline(ctx: Context, key: string): void {
  releasePipeline(ctx._internal.resources.postPipelineCache, key);
}
