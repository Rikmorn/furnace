# A `G` grab moved by the ARROW keys reads as idle, and ⏎ discards it

**Context.** `dropMove()` (`packages/editor/src/viewport-host/field-host.ts`) ends a live
move by asking `moveIsIdle(d)` (`viewport-host/field-move.ts`) whether the move handed the
region anything — and `moveIsIdle` reads the DRAG's accumulated lattice steps
(`d.applied`), i.e. how far the CURSOR travelled. A grab is not only driven by the cursor:
the arrow pad (`nudgeStampRegion`) and the stamp inspector's d-pad move the same session's
region without touching `d.applied`. So the sequence

> select a stamp → `G` → ← ← ← → ⏎

leaves `d.applied === [0,0,0]`, `moveIsIdle` answers true, and `dropMove` calls
`cancelStampSession()` — the region the user just moved three steps is thrown away with no
message. The same three steps committed fine before `G` was pressed (a plain reconfigure
session's ⏎ routes to `commitActiveSession`), which is what makes it surprising rather than
merely strict.

Reproduced during F4.5b Task 7, not by reading: routing the public `commitSession()`
through the same path turned `tests/field-host-move.test.ts`'s *"a move commits through the
reconfigure splice"* red at `Expected: 2, Received: 0` — a `nudgeStamp(4, 0, -2)` on a
`beginMove` session, discarded on confirm. Task 7 therefore did NOT route the public verb
through `dropMove`; the canvas ⏎ keeps it, so the defect stays where it already was rather
than spreading to three entry points.

**The shape of the fix.** The zero-step rule is right — a twitchy click should not spend a
history entry — but it is asking the wrong question. What it wants to know is whether the
SESSION's region differs from the entity's RECORDED region, which `dropMove` can answer
directly (`entityRecord(stamp.entityId)` is one call away, and the comparison is six
numbers). That also makes it correct for the mixed case (drag two steps, arrow back two),
which the current test cannot express at all. `moveIsIdle` then either goes away or becomes
a region comparator rather than a drag one.

**Trigger to revisit.** The next task that touches `dropMove` or the move session's
terminal verbs — Task 10's session card is the likely one, since its Apply button is a
third entry point into exactly this decision and would inherit the same discard.

**Reference.** `packages/editor/src/viewport-host/field-move.ts` (`moveIsIdle`),
`field-host.ts` (`dropMove`, `confirmActiveSession`), `tests/field-host-move.test.ts`.
