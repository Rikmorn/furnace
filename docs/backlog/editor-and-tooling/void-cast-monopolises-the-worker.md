---
summary: the X-ray posts one whole-world job to the single field worker with no cancel, and refuses a re-request instead of coalescing it — so a stroke started mid-cast queues behind ~1 s of work and then throws that work away
---

# The void cast monopolises the one field worker: no cancel, and refusal where coalescing belongs

**Context.** F3b Task 12's X-ray posts ONE job that sweeps every allocated chunk.
`FieldWorkerClient.ensure()` creates a single worker, `mesh()` / `stampPreview()` /
`voidCast()` all post to it, and the handler is synchronous per message — so for the whole
duration of a cast, every chunk remesh and every stamp preview waits behind it. Benchmarked
at the 512-chunk ceiling: ~630 ms (code review, 584 chunks) to ~1.3 s (bun/JSC, 512 dug
chunks). Neither is a hang; both are long enough to feel.

Task 12 shipped the cheap half: `requestVoidCast` refuses while a job is in flight, keyed on
the WORKER being busy (`voidCastJobGen`) rather than on the user still wanting the answer,
because a discard cannot call the worker off — it can only agree to ignore the result. That
stops five toggles from stacking five full sweeps. Two things it does not fix:

- **No cancel.** `invalidateVoidCast` strands a job client-side; the worker grinds on. The
  protocol has no cancel message and the client has no abort.
- **Refusal is not coalescing.** Toggle off then on during a cast and the second request is
  refused with "a void cast is still building — re-tick the void layer once it lands". The
  user's last intent is dropped rather than queued. This file already contains the right
  shape — `createPreviewCoalescer` (latest-wins, at most one queued re-fire) is what the
  stamp preview uses for exactly this problem — and the open question is whether the cast
  should share it or whether a whole-world job wants different semantics from a
  region-sized one.

**The sequence to watch for at the gate,** because it will read as "the editor hitches" and
be hard to attribute: enable the cast on a big world → immediately dig → the stroke lands,
but its remesh queues behind ~1 s of cast work, so the viewport freezes → and when the cast
finally arrives it is thrown away by the very edit that was waiting on it (the stroke
invalidated it). Every part of that is working as designed; the whole is not.

**Trigger to revisit:** the F3b Safari gate reporting viewport hitching while the X-ray is
on, OR the first other whole-world worker job (F4's analyzer is the likely candidate), at
which point "one worker, first come first served" stops being a one-feature problem and
wants a priority or a second worker.

**Reference:** `packages/editor/src/field-host/field-voidcast.ts` (`requestVoidCast`'s
in-flight refusal and the `VOID_CAST_CHUNK_BUDGET` comment carrying the measurement — both
were in `field-host.ts` until foundations T3b1, 2026-08-06);
`packages/editor/src/field-host/field-stamp.ts` (`createPreviewCoalescer`, the shape that
already exists); `packages/editor/src/field-host/field-client.ts` (one worker, no cancel —
the class TSDoc states the contract).
