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
