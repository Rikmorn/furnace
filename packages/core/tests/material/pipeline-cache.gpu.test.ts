import { expect, test } from "bun:test";
import * as gpu from "../../src/gpu/index.ts";
import { _pipelineCache } from "../../src/material/pipeline.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "../_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

type FakePipeline = { __id: number };

// The factory returns shape-incompatible objects intentionally — the cache
// only stores them by reference and never inspects them. The factory shape
// keeps test assertions trivial (compare __id, not pipeline identity, since
// `acquire` returns whatever `build` returned).
//
// Boundary cast: we lie about the type to the cache because the cache is
// generic over GPURenderPipeline but the test doesn't care about WebGPU
// semantics here — only refcount/eviction/per-ctx scoping.
function makeFactory(): () => GPURenderPipeline {
  let nextId = 0;
  return () => {
    nextId += 1;
    return { __id: nextId } as unknown as GPURenderPipeline;
  };
}

test.skipIf(!bunWebGpuAvailable())(
  "acquire builds a fresh pipeline for a new key",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const build = makeFactory();
    const p = await _pipelineCache.acquire(ctx, "k1", async () => build());
    expect((p as unknown as FakePipeline).__id).toBe(1);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "acquire returns the cached pipeline for the same key",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const build = makeFactory();
    const p1 = await _pipelineCache.acquire(ctx, "k1", async () => build());
    const p2 = await _pipelineCache.acquire(ctx, "k1", async () => build());
    expect(p2).toBe(p1);
    expect((p2 as unknown as FakePipeline).__id).toBe(1);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "release decrements; non-final release does not evict",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const build = makeFactory();
    const p1 = await _pipelineCache.acquire(ctx, "k1", async () => build()); // refcount 1
    await _pipelineCache.acquire(ctx, "k1", async () => build()); // refcount 2
    _pipelineCache.release(ctx, "k1"); // refcount 1
    const p3 = await _pipelineCache.acquire(ctx, "k1", async () => build()); // refcount 2 — still cached
    expect(p3).toBe(p1);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "final release evicts; next acquire rebuilds",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const build = makeFactory();
    await _pipelineCache.acquire(ctx, "k1", async () => build()); // refcount 1
    _pipelineCache.release(ctx, "k1"); // refcount 0 → evicted
    const p2 = await _pipelineCache.acquire(ctx, "k1", async () => build());
    expect((p2 as unknown as FakePipeline).__id).toBe(2);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "release on an unknown key is a no-op (does not throw)",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    expect(() => _pipelineCache.release(ctx, "never-acquired")).not.toThrow();
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "different keys produce independent entries",
  async () => {
    const canvas = await makeOffscreenCanvas();
    const ctx = await gpu.requestContext(canvas);
    const build = makeFactory();
    const p1 = await _pipelineCache.acquire(ctx, "k1", async () => build());
    const p2 = await _pipelineCache.acquire(ctx, "k2", async () => build());
    expect(p1).not.toBe(p2);
    gpu.dispose(ctx);
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "two ctxs do not share pipelines for the same key (per-ctx scope)",
  async () => {
    const canvasA = await makeOffscreenCanvas();
    const canvasB = await makeOffscreenCanvas();
    const ctxA = await gpu.requestContext(canvasA);
    const ctxB = await gpu.requestContext(canvasB);
    const buildA = makeFactory();
    const buildB = makeFactory();
    const pA = await _pipelineCache.acquire(ctxA, "shared-key", async () =>
      buildA(),
    );
    const pB = await _pipelineCache.acquire(ctxB, "shared-key", async () =>
      buildB(),
    );
    // Distinct pipeline instances — each factory ran exactly once, in its
    // own ctx's cache.
    expect(pA).not.toBe(pB);
    expect((pA as unknown as FakePipeline).__id).toBe(1);
    expect((pB as unknown as FakePipeline).__id).toBe(1);
    // Releasing in one ctx must not affect the other.
    _pipelineCache.release(ctxA, "shared-key");
    const pBagain = await _pipelineCache.acquire(ctxB, "shared-key", async () =>
      buildB(),
    );
    expect(pBagain).toBe(pB);
    gpu.dispose(ctxA);
    gpu.dispose(ctxB);
  },
);
