---
summary: nothing in the suite pushes one resource-pool slot past the 16-bit generation-counter wrap, so the overflow warn and wrap semantics go unexercised
---

# Pool stress test: in-suite gen-overflow exercise

*Testing-hygiene candidate. Surfaced during RM-3 brainstorm (2026-05-28).*

The current refcount stress test in `packages/core/tests/resources/refcount.gpu.test.ts` runs 1000 alternating spawn/despawn iterations on a shared geometry. With ~333 destroys touching individual slots, it stays well under the 16-bit generation counter ceiling (~65,536 destroys per slot).

The Stage 2 Playwright stress test (5200 spawn / 5200 despawn over 200 cubes) approaches but does not cross the ceiling for any individual slot, and runs outside `bun test`.

After RM-3's A3 commit lands the gen-overflow debug warn, an in-suite test that pushes a single slot past 65,536 destroys would:
- Exercise the warn path
- Verify the wrap-to-zero behaviour produces correct lookups (the warn is informational; semantics must still be correct)
- Catch a regression if anyone changes the gen counter type, width, or wrap behaviour

## Fix shape

New test in `packages/core/src/resources/pool.test.ts` (non-GPU — operates on the bare pool):

```ts
test("generation overflow wraps cleanly and warns", () => {
  const pool = createPool<{ value: number }>();
  // Allocate/destroy 65_540 times on the same slot to cross the wrap boundary.
  let handle = allocSlot(pool, { value: 0 });
  for (let i = 0; i < 65_540; i++) {
    destroySlot(pool, handle.slotIndex, handle.generation);
    handle = allocSlot(pool, { value: i });
  }
  // Verify the latest handle resolves; verify the warn was emitted.
});
```

Wire up the log sink to capture warns and assert the expected entry. Test should complete in < 1 second (typed-array operations are fast).

## What to verify when fixing

- Test passes after A3 (RM-3) lands the debug warn.
- Test completes in < 1 second under `bun test`.
- The warn is emitted exactly once at the wrap boundary.

## Trigger to revisit

**When A3 (gen-overflow debug warn) ships** — RM-3 Phase 4. Or whenever the pool's gen counter type changes.

**Reference:** Surfaced during RM-3 brainstorm (2026-05-28). Related: Stage 1 learning #9 (generation overflow not exercised in any Stage 1 test).
