# The void cast's progress chip is indeterminate, and could be determinate

The long-job chip (D-19, F4.5c Task 4) shows `void cast…` while
`FieldStats.voidCastPending` is true and says nothing about how far along it is. Determinate
progress is AVAILABLE — it was costed and declined, not overlooked.

Both halves already exist, and `requestVoidCast`'s own comment says so:

- **The worker can post mid-handler**, and posting does not block — the void-cast handler in
  `frontend/lib/field-protocol.ts` loops over `store.chunks` extracting aprons, so a
  per-chunk progress message has an obvious home.
- **The total is `store.chunks.size`**, which `requestVoidCast` reads two lines below the
  comment declining the feature.

## Context

Declined on the DURATION: measured at the ceiling (bun/JSC, 512 dug chunks, one cast) the
job is ~1.3 s of worker time, and `VOID_CAST_CHUNK_BUDGET` caps it there precisely so it
cannot grow without bound. An indeterminate chip is honest for 1.3 s; a determinate one at
that length reads as ceremony — the bar finishes before it has said anything the user acted
on.

The rationale lives in source; what lives ONLY here is the trigger, which is the part a
source comment cannot carry.

The cost is not the arithmetic. It is a new worker→host progress message on the protocol,
plus a new single-slot `FieldHost.subscribe*` seam for the host to publish it on — and the
host's seams are deliberately single-slot and deliberately few. That is real surface for a
1.3 s job.

## Trigger to revisit

The chunk ceiling rising above 512, or any cast observed exceeding ~3 s at a gate. Either
makes the chip's silence the user's problem rather than a design choice. If the seam is
built, check first whether `applyReconfigure` wants the same one
(`long-job-readout-cannot-see-the-third-job.md`) — one progress seam serving both is a
different design than two.

## Reference

- `packages/editor/src/frontend/lib/field-protocol.ts` — the void-cast handler's per-chunk
  loop, where a progress post would go.
- `packages/editor/src/viewport-host/field-host.ts` — `requestVoidCast` and the comment
  above it declining this; `VOID_CAST_CHUNK_BUDGET` (`:1364-1374`) and its measurement; and
  `FieldStats.voidCastPending`'s TSDoc, which explains why the pending FLAG rides the stats
  push instead of taking a seam of its own.
- `packages/editor/src/frontend/components/shell/StatusBar.tsx` — `longJobs`, the consumer.
