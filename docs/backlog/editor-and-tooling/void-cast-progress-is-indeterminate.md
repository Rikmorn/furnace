---
summary: determinate void-cast progress was costed and DECLINED, not overlooked: the worker can post mid-handler and `store.chunks.size` is the total, but the host seam it needs is public `FieldHost` surface bought for a job capped at ~1.3 s
---

# The void cast's progress chip is indeterminate, and could be determinate

The long-job chip (D-19, F4.5c Task 4) shows `void cast…` while
`FieldStats.voidCastPending` is true and says nothing about how far along it is. Determinate
progress is AVAILABLE — it was costed and declined, not overlooked.

Both halves already exist, and `requestVoidCast`'s own comment says so:

- **The worker can post mid-handler**, and posting does not block — the void-cast handler in
  `field-host/field-protocol.ts` loops over `store.chunks` extracting aprons, so a
  per-chunk progress message has an obvious home.
- **The total is `store.chunks.size`**, which `requestVoidCast` reads a few lines below the
  comment declining the feature — past the in-flight guard, where the chunk count is
  computed for the budget check anyway.

## Context

Declined on the DURATION: measured at the ceiling (bun/JSC, 512 dug chunks, one cast) the
job is ~1.3 s of worker time, and `VOID_CAST_CHUNK_BUDGET` caps it there precisely so it
cannot grow without bound. An indeterminate chip is honest for 1.3 s; a determinate one at
that length reads as ceremony — the bar finishes before it has said anything the user acted
on.

The rationale lives in source; what lives ONLY here is the trigger, which is the part a
source comment cannot carry.

The cost is not the arithmetic. It is a new worker→host progress message on the protocol,
plus a new `FieldHost.subscribe*` seam for the host to publish it on — and the host's seams
are deliberately **few**: each one is public surface on the `FieldHost` type. That is real
surface for a 1.3 s job. (This sentence also said "and another context in the chrome's single
subscription point" until foundations T3b1 Task 7, which retired both; a new seam now costs
one module-level latch plus a hook. The `FieldHost`-surface half stands, and it is the half
the argument rests on.)

**The stated reason changed at foundations T3a, the conclusion did not.** The seams were
"deliberately single-slot and deliberately few" when this was filed; T3a made all thirteen
multicast (`field-host/view-channel.ts`, `docs/reference/editor/field-host.md`). A fourteenth is
therefore cheaper to *implement* than it was — the primitive exists and a seam is now three
lines — but the deferral never rested on the implementation. It rests on the surface, and
that is unchanged.

## Trigger to revisit

The chunk ceiling rising above 512, or any cast observed exceeding ~3 s at a gate. Either
makes the chip's silence the user's problem rather than a design choice. If the seam is
built, check first whether `applyReconfigure` wants the same one
(`long-job-readout-cannot-see-third-job.md`) — one progress seam serving both is a
different design than two.

## Reference

- `packages/editor/src/field-host/field-protocol.ts` — the void-cast handler's per-chunk
  loop, where a progress post would go.
- `packages/editor/src/field-host/field-voidcast.ts` — `requestVoidCast` and the comment
  above it declining this, plus `VOID_CAST_CHUNK_BUDGET` and its measurement. (Both were in
  `field-host.ts` until foundations T3b1, 2026-08-06. Cited by NAME rather than by line
  range on purpose: the range this bullet used to carry, `:1364-1374`, had already rotted
  before the move.)
- `packages/editor/src/field-host/field-host.ts` — `FieldStats.voidCastPending`'s TSDoc,
  which explains why the pending FLAG rides the stats push instead of taking a seam of its
  own.
- `packages/editor/src/frontend/components/shell/StatusBar.tsx` — `longJobs`, the consumer.
