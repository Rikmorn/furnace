import { expect, test } from "bun:test";
import {
  _allocMesh,
  _countLive,
  _destroyMesh,
  _iterateLive,
  _lookupMesh,
} from "../../src/resources/internal.ts";
import { createResourceManager } from "../../src/resources/manager.ts";

type FakeMeshSlot = { value: number };

// Minimal Context shape sufficient for the internal API. The real Context
// is much richer; this stub exposes only what resources/internal.ts reads.
function fakeCtx() {
  return {
    _internal: { resources: createResourceManager(), ctxId: 0xffff },
  } as unknown as Parameters<typeof _allocMesh>[0];
}

// Teardown stub used when a test doesn't care about teardown side effects.
function noopTeardown(_data: FakeMeshSlot): void {
  return;
}

test("_allocMesh + _lookupMesh round-trips", () => {
  const ctx = fakeCtx();
  const handle = _allocMesh<FakeMeshSlot>(ctx, { value: 42 });
  const data = _lookupMesh<FakeMeshSlot>(ctx, handle);
  expect(data).toEqual({ value: 42 });
});

test("_destroyMesh runs teardown then bumps generation", () => {
  const ctx = fakeCtx();
  const handle = _allocMesh<FakeMeshSlot>(ctx, { value: 7 });
  let teardownCalled = false;
  const result = _destroyMesh<FakeMeshSlot>(ctx, handle, (data) => {
    expect(data).toEqual({ value: 7 });
    teardownCalled = true;
  });
  expect(result).toBe(true);
  expect(teardownCalled).toBe(true);
  expect(_lookupMesh(ctx, handle)).toBeNull();
});

test("_destroyMesh on stale handle is silent no-op (teardown not called)", () => {
  const ctx = fakeCtx();
  const handle = _allocMesh<FakeMeshSlot>(ctx, { value: 1 });
  _destroyMesh<FakeMeshSlot>(ctx, handle, noopTeardown);
  let teardownCalled = false;
  const result = _destroyMesh<FakeMeshSlot>(ctx, handle, () => {
    teardownCalled = true;
  });
  expect(result).toBe(false);
  expect(teardownCalled).toBe(false);
});

test("_countLive reflects allocations and destructions per kind", () => {
  const ctx = fakeCtx();
  expect(_countLive(ctx, "mesh")).toBe(0);
  const a = _allocMesh<FakeMeshSlot>(ctx, { value: 1 });
  _allocMesh<FakeMeshSlot>(ctx, { value: 2 });
  _allocMesh<FakeMeshSlot>(ctx, { value: 3 });
  expect(_countLive(ctx, "mesh")).toBe(3);
  _destroyMesh<FakeMeshSlot>(ctx, a, noopTeardown);
  expect(_countLive(ctx, "mesh")).toBe(2);
});

test("_iterateLive yields all live handles for the requested kind", () => {
  const ctx = fakeCtx();
  const a = _allocMesh<FakeMeshSlot>(ctx, { value: 10 });
  const b = _allocMesh<FakeMeshSlot>(ctx, { value: 20 });
  _allocMesh<FakeMeshSlot>(ctx, { value: 30 });
  _destroyMesh<FakeMeshSlot>(ctx, a, noopTeardown);
  const collected = [..._iterateLive<FakeMeshSlot>(ctx, "mesh")];
  expect(collected.length).toBe(2);
  expect(collected.some((c) => c.handle === b)).toBe(true);
  const values = collected.map((c) => c.data.value).sort((x, y) => x - y);
  expect(values).toEqual([20, 30]);
});

test("recycled slot produces a distinct handle from the original", () => {
  const ctx = fakeCtx();
  const first = _allocMesh<FakeMeshSlot>(ctx, { value: 1 });
  _destroyMesh<FakeMeshSlot>(ctx, first, noopTeardown);
  const second = _allocMesh<FakeMeshSlot>(ctx, { value: 2 });
  expect(second).not.toBe(first);
  expect(_lookupMesh(ctx, first)).toBeNull();
  expect(_lookupMesh<FakeMeshSlot>(ctx, second)).toEqual({ value: 2 });
});
