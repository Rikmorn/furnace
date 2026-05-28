import { expect, test } from "bun:test";
import { consoleSink, type LogEntry, setSink } from "../../src/log/index.ts";
import {
  allocSlot,
  countLiveSlots,
  createPool,
  destroySlot,
  INVALID_SLOT,
  iterateLiveSlots,
  lookupSlot,
  POOL_INITIAL_CAPACITY,
} from "../../src/resources/pool.ts";

type TestSlot = { value: number };

test("createPool starts with the initial capacity and slot 0 reserved", () => {
  const pool = createPool<TestSlot>();
  expect(pool.size).toBe(POOL_INITIAL_CAPACITY);
  expect(pool.free.length).toBe(POOL_INITIAL_CAPACITY - 1);
  expect(pool.slots[0]).toBeNull();
  expect(pool.slots[INVALID_SLOT]).toBeNull();
});

test("allocSlot returns slot index >= 1 with generation 1 on first alloc", () => {
  const pool = createPool<TestSlot>();
  const { slotIndex, generation } = allocSlot(pool, { value: 42 });
  expect(slotIndex).toBeGreaterThanOrEqual(1);
  expect(generation).toBe(1);
  expect(pool.slots[slotIndex]).toEqual({ value: 42 });
});

test("lookupSlot returns slot data on generation match", () => {
  const pool = createPool<TestSlot>();
  const { slotIndex, generation } = allocSlot(pool, { value: 7 });
  const data = lookupSlot(pool, slotIndex, generation);
  expect(data).toEqual({ value: 7 });
});

test("lookupSlot returns null on generation mismatch", () => {
  const pool = createPool<TestSlot>();
  const { slotIndex, generation } = allocSlot(pool, { value: 7 });
  expect(lookupSlot(pool, slotIndex, generation + 1)).toBeNull();
  expect(lookupSlot(pool, slotIndex, generation - 1)).toBeNull();
});

test("lookupSlot returns null for invalid slot index", () => {
  const pool = createPool<TestSlot>();
  expect(lookupSlot(pool, INVALID_SLOT, 1)).toBeNull();
  expect(lookupSlot(pool, pool.size + 100, 1)).toBeNull();
});

test("destroySlot returns true on first call, false on second (idempotent)", () => {
  const pool = createPool<TestSlot>();
  const { slotIndex, generation } = allocSlot(pool, { value: 1 });
  expect(destroySlot(pool, slotIndex, generation)).toBe(true);
  // Second call: generation has bumped, mismatch
  expect(destroySlot(pool, slotIndex, generation)).toBe(false);
});

test("destroySlot nulls slot data and returns slot to free stack", () => {
  const pool = createPool<TestSlot>();
  const { slotIndex, generation } = allocSlot(pool, { value: 1 });
  const freeBefore = pool.free.length;
  destroySlot(pool, slotIndex, generation);
  expect(pool.slots[slotIndex]).toBeNull();
  expect(pool.free.length).toBe(freeBefore + 1);
});

test("destroyed slot's generation bumps so stale handle no longer matches", () => {
  const pool = createPool<TestSlot>();
  const { slotIndex, generation } = allocSlot(pool, { value: 1 });
  destroySlot(pool, slotIndex, generation);
  expect(lookupSlot(pool, slotIndex, generation)).toBeNull();
});

test("recycled slot has bumped generation; old handle does not alias", () => {
  const pool = createPool<TestSlot>();
  const first = allocSlot(pool, { value: 1 });
  destroySlot(pool, first.slotIndex, first.generation);
  const second = allocSlot(pool, { value: 2 });
  expect(second.slotIndex).toBe(first.slotIndex);
  expect(second.generation).toBeGreaterThan(first.generation);
  expect(lookupSlot(pool, first.slotIndex, first.generation)).toBeNull();
  expect(lookupSlot(pool, second.slotIndex, second.generation)).toEqual({
    value: 2,
  });
});

test("pool auto-grows when free stack exhausted", () => {
  const pool = createPool<TestSlot>();
  const initial = pool.size;
  for (let i = 0; i < initial - 1; i++) {
    allocSlot(pool, { value: i });
  }
  expect(pool.free.length).toBe(0);
  const { slotIndex } = allocSlot(pool, { value: 999 });
  expect(pool.size).toBe(initial * 2);
  expect(slotIndex).toBeGreaterThanOrEqual(initial);
  expect(pool.slots[slotIndex]).toEqual({ value: 999 });
});

test("countLiveSlots reports allocated minus destroyed", () => {
  const pool = createPool<TestSlot>();
  const a = allocSlot(pool, { value: 1 });
  const b = allocSlot(pool, { value: 2 });
  allocSlot(pool, { value: 3 });
  expect(countLiveSlots(pool)).toBe(3);
  destroySlot(pool, a.slotIndex, a.generation);
  expect(countLiveSlots(pool)).toBe(2);
  destroySlot(pool, b.slotIndex, b.generation);
  expect(countLiveSlots(pool)).toBe(1);
});

test("iterateLiveSlots yields all and only live slots", () => {
  const pool = createPool<TestSlot>();
  const a = allocSlot(pool, { value: 10 });
  allocSlot(pool, { value: 20 });
  allocSlot(pool, { value: 30 });
  destroySlot(pool, a.slotIndex, a.generation);
  const values = [...iterateLiveSlots(pool)].map((s) => s.data.value);
  expect(values.sort()).toEqual([20, 30]);
});

test("pool growth preserves existing slot data and generation counters across capacity doubling", () => {
  const pool = createPool<TestSlot>();
  // Allocate one slot, capture handle + data.
  const original = allocSlot(pool, { value: 42 });
  expect(original.slotIndex).toBeGreaterThanOrEqual(1);
  const originalGen = original.generation;

  // Fill the pool to force at least one growth.
  for (let i = 0; i < POOL_INITIAL_CAPACITY * 2; i++) {
    allocSlot(pool, { value: i });
  }

  // Pool must have grown beyond initial capacity.
  expect(pool.size).toBeGreaterThan(POOL_INITIAL_CAPACITY);

  // Original handle still resolves to original data.
  const resolved = lookupSlot(pool, original.slotIndex, original.generation);
  expect(resolved).toEqual({ value: 42 });

  // Original generation counter is preserved.
  expect(pool.generations[original.slotIndex]).toBe(originalGen);
});

test("growPool throws when capacity would exceed 65536 slot limit", () => {
  const pool = createPool<TestSlot>();
  // Crank pool state directly to the ceiling so the next alloc forces growth
  // past it. Doubling 65536 → 131072 must throw.
  pool.size = 0x10000;
  pool.generations = new Uint32Array(0x10000);
  pool.slots = new Array(0x10000).fill(null);
  pool.free = []; // empty free stack → next alloc triggers growPool

  expect(() => allocSlot(pool, { value: 1 })).toThrow(
    /cannot grow beyond 65536 slots/,
  );
});

test("allocSlot warns when generation counter wraps from 0xffff", () => {
  const pool = createPool<TestSlot>();
  // Pre-fill slot 1's generation to the wrap boundary.
  pool.generations[1] = 0xffff;

  const entries: LogEntry[] = [];
  setSink((entry) => entries.push(entry));
  try {
    // Override free stack so slot 1 is the next allocated.
    pool.free = [1];

    const handle = allocSlot(pool, { value: 42 });
    expect(handle.slotIndex).toBe(1);
    // The bumped generation stored in the pool is 0x10000 (uint32 storage,
    // pre-mask). The uint48 handle encoding masks this to 16 bits when
    // building handles; here we just verify the in-pool value.
    expect(handle.generation).toBe(0x10000);

    // The warn was emitted exactly once with the expected module + slot id.
    const warnEntries = entries.filter(
      (e) =>
        e.module === "resources" &&
        e.message.includes("generation counter wrapping"),
    );
    expect(warnEntries.length).toBe(1);
    expect(warnEntries[0]?.message).toContain("slot 1");
  } finally {
    setSink(consoleSink);
  }
});
