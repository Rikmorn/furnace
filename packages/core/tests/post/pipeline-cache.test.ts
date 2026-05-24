import { beforeEach, expect, test } from "bun:test";
import { _pipelineCache } from "../../src/post/pipeline-cache.ts";

type FakePipeline = { __id: number };

beforeEach(() => {
  _pipelineCache.resetForTests();
});

function makeFactory(): () => GPURenderPipeline {
  let nextId = 0;
  return () => {
    nextId += 1;
    return { __id: nextId } as unknown as GPURenderPipeline;
  };
}

test("acquire builds a fresh pipeline for a new key", async () => {
  const build = makeFactory();
  const p = await _pipelineCache.acquire("k1", async () => build());
  expect((p as unknown as FakePipeline).__id).toBe(1);
});

test("acquire returns the cached pipeline for the same key", async () => {
  const build = makeFactory();
  const p1 = await _pipelineCache.acquire("k1", async () => build());
  const p2 = await _pipelineCache.acquire("k1", async () => build());
  expect(p2).toBe(p1);
});

test("release decrements; non-final release does not evict", async () => {
  const build = makeFactory();
  const p1 = await _pipelineCache.acquire("k1", async () => build());
  await _pipelineCache.acquire("k1", async () => build());
  _pipelineCache.release("k1");
  const p3 = await _pipelineCache.acquire("k1", async () => build());
  expect(p3).toBe(p1);
});

test("final release evicts; next acquire rebuilds", async () => {
  const build = makeFactory();
  await _pipelineCache.acquire("k1", async () => build());
  _pipelineCache.release("k1");
  const p2 = await _pipelineCache.acquire("k1", async () => build());
  expect((p2 as unknown as FakePipeline).__id).toBe(2);
});

test("release on an unknown key is a no-op (does not throw)", () => {
  expect(() => _pipelineCache.release("never-acquired")).not.toThrow();
});

test("post cache is independent of material cache", async () => {
  const build = makeFactory();
  const { _pipelineCache: matCache } = await import(
    "../../src/material/pipeline.ts"
  );
  matCache.resetForTests();
  await matCache.acquire("k1", async () => build());
  const p2 = await _pipelineCache.acquire("k1", async () => build());
  expect((p2 as unknown as FakePipeline).__id).toBe(2);
});
