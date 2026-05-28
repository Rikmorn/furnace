import { FurnaceError } from "../errors.ts";
import { warn } from "../log/internal.ts";

/**
 * Generic pool primitive backing the resource manager. One pool per resource
 * type (Mesh, Material, Geometry, Effect).
 *
 * Layout: parallel arrays. `slots[i]` holds the slot data (or null for free
 * slots). `generations[i]` holds the generation counter, bumped on each
 * alloc and destroy. `free` is a LIFO stack of free slot indices (last
 * freed reused first — better cache behaviour than FIFO).
 *
 * Slot 0 is reserved for the invalid-handle sentinel; never allocated.
 *
 * Pools auto-grow when the free stack is empty: capacity doubles, the new
 * range is added to the free stack. Existing handles remain valid (slot
 * indices stable; generation counters preserved).
 *
 * Pools never shrink — once grown, capacity stays at high-water mark for
 * the lifetime of the context.
 */
export type Pool<T> = {
  slots: (T | null)[];
  generations: Uint32Array;
  free: number[];
  size: number;
};

/** Initial slot count for new pools. */
export const POOL_INITIAL_CAPACITY = 64;

/** Slot 0 is reserved; never allocated. */
export const INVALID_SLOT = 0;

/**
 * Construct a new pool with {@link POOL_INITIAL_CAPACITY} slots. Slot 0 is
 * pre-marked as reserved (not pushed onto the free stack); slots 1..N-1
 * are pushed in reverse order so the lowest index is allocated first.
 */
export function createPool<T>(): Pool<T> {
  const size = POOL_INITIAL_CAPACITY;
  const slots: (T | null)[] = new Array(size).fill(null);
  const generations = new Uint32Array(size);
  const free: number[] = [];
  // Push in reverse so lowest index is on top of the stack (allocated first).
  for (let i = size - 1; i >= 1; i--) free.push(i);
  return { slots, generations, free, size };
}

/**
 * Double the pool's capacity. New slots become free; existing handles
 * remain valid. Called by {@link allocSlot} when the free stack is
 * empty.
 *
 * Synchronous allocation; small GC pause on growth. Documented; see
 * `engine-conventions.md` §Resource manager.
 */
function growPool<T>(pool: Pool<T>): void {
  const oldSize = pool.size;
  const newSize = oldSize * 2;
  if (newSize > 0x10000) {
    throw new FurnaceError(
      "resources.pool: cannot grow beyond 65536 slots — uint48 handle encoding limit (see engine-conventions §Resource manager → Pool model)",
    );
  }
  // Resize slots — push nulls.
  for (let i = oldSize; i < newSize; i++) pool.slots.push(null);
  // Resize generations — typed-array copy.
  const newGenerations = new Uint32Array(newSize);
  newGenerations.set(pool.generations);
  pool.generations = newGenerations;
  // Push new range onto free stack (reverse order, lowest first).
  for (let i = newSize - 1; i >= oldSize; i--) pool.free.push(i);
  pool.size = newSize;
}

/**
 * Allocate a free slot, populate it with `data`, bump the generation
 * counter. Returns the (slotIndex, generation) pair the caller encodes
 * into a handle.
 *
 * Grows the pool if no free slots are available.
 */
export function allocSlot<T>(
  pool: Pool<T>,
  data: T,
): { slotIndex: number; generation: number } {
  if (pool.free.length === 0) growPool(pool);
  const slotIndex = pool.free.pop();
  if (slotIndex === undefined) {
    throw new Error("resources.pool: free stack empty after grow");
  }
  // Internal invariant: slotIndex < pool.size = generations.length, so the
  // read is never undefined. `?? 0` narrows the type without runtime cost.
  if ((pool.generations[slotIndex] ?? 0) === 0xffff) {
    warn(
      "resources",
      `generation counter wrapping on slot ${slotIndex} — use-after-recycle protection is briefly compromised for this slot until the wrap completes`,
    );
  }
  const generation = (pool.generations[slotIndex] ?? 0) + 1;
  pool.generations[slotIndex] = generation;
  pool.slots[slotIndex] = data;
  return { slotIndex, generation };
}

/**
 * Look up a slot by (slotIndex, generation). Returns the slot data on
 * match, null on mismatch (invalid index, stale generation, destroyed
 * slot).
 *
 * Hot path — called on every operation against a handle. Cost: one
 * bounds check + one Uint32 comparison.
 */
export function lookupSlot<T>(
  pool: Pool<T>,
  slotIndex: number,
  generation: number,
): T | null {
  if (slotIndex === INVALID_SLOT || slotIndex >= pool.size) return null;
  if (pool.generations[slotIndex] !== generation) return null;
  // Internal invariant: slotIndex < pool.size = slots.length; the read is
  // never undefined. `?? null` narrows the type to T | null.
  return pool.slots[slotIndex] ?? null;
}

/**
 * Destroy a slot: bumps generation, nulls the slot data, pushes the
 * slot back onto the free stack. Silent no-op if the (slotIndex,
 * generation) pair doesn't match (handle stale or already destroyed).
 *
 * Returns true if destruction actually happened (slot was live and
 * teardown ran), false if no-op (handle stale).
 *
 * The caller is responsible for running teardown logic BEFORE calling
 * destroySlot — the pool only manages the slot's bookkeeping, not the
 * GPU resources stored in the slot's data.
 */
export function destroySlot<T>(
  pool: Pool<T>,
  slotIndex: number,
  generation: number,
): boolean {
  if (slotIndex === INVALID_SLOT || slotIndex >= pool.size) return false;
  if (pool.generations[slotIndex] !== generation) return false;
  pool.generations[slotIndex] += 1;
  pool.slots[slotIndex] = null;
  pool.free.push(slotIndex);
  return true;
}

/**
 * Count live (non-null) slots. O(N) over capacity; intended for stats
 * and dispose-cascade leak counting, not per-frame use.
 */
export function countLiveSlots<T>(pool: Pool<T>): number {
  let count = 0;
  for (let i = 1; i < pool.size; i++) {
    if (pool.slots[i] !== null) count += 1;
  }
  return count;
}

/**
 * Iterate live slot indices. Yields `(slotIndex, generation, data)`
 * triples. Used by the dispose cascade and `resources.list`.
 *
 * Iteration order is slot-index ascending; consumers needing
 * destruction-safe order should snapshot the indices first.
 */
export function* iterateLiveSlots<T>(
  pool: Pool<T>,
): IterableIterator<{ slotIndex: number; generation: number; data: T }> {
  for (let i = 1; i < pool.size; i++) {
    const data = pool.slots[i];
    if (data !== null && data !== undefined) {
      // Internal invariant: i < pool.size = generations.length.
      const generation = pool.generations[i] ?? 0;
      yield { slotIndex: i, generation, data };
    }
  }
}
