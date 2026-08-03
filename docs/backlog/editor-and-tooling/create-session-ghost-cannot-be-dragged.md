# A CREATE session's ghost cannot be dragged — only a committed entity can

`FieldHost.beginMove` takes an `entityId`, and `pointerPress` arms a drag only on the
ALREADY-SELECTED committed entity. So the region of a live CREATE session — the stamp that
has not been committed yet, which is the thing the original finding was filed against — moves
only by the arrow keys or by the session card's d-pad inside its Advanced disclosure. Its
initial position comes from the two region-draw clicks and nothing after that is
mouse-driven.

## Context

The F3a gate's finding was "the nudge buttons aren't great, i think it should be mouse
driven". F4.5b Task 5 built the mouse-driven half for COMMITTED entities and it is a
complete mechanism: press the selected entity, travel past `DRAG_THRESHOLD_PX` and it becomes
a move; `G` grabs it with no button held; the gizmo's arms constrain it to one axis; `R`
turns it; `⏎` drops it; `Esc` reverts. A move IS a reconfigure session, so nothing reaches
the op log until the drop and a cancelled move costs nothing. The arithmetic in
`viewport-host/field-move.ts` is anchored rather than incremental, so a cursor returned to the
press point returns the region exactly.

None of that is reachable from a CREATE session, and the asymmetry is the item: two ways to
position a region depending on whether it has been committed yet.

The work is smaller than it looks and the reason it was not done is scope rather than
difficulty — `field-move.ts` is pure and takes a region, not an entity; what a CREATE session
lacks is the ARBITRATION (a press inside a live ghost has to beat the region-draw click that
the same press currently means) and a decision about what `Esc` does mid-drag when the
session itself is also cancellable.

## Trigger to revisit

**The next time region positioning is worked at all** — or the first gate complaint about
placing a stamp. It should not be taken as an isolated item: it wants deciding together with
`box-select-is-two-clicks-not-a-drag.md`, since both are the same question about what a press
inside the canvas means while something is armed.

## Reference

- `packages/editor/src/viewport-host/field-move.ts` — pure, anchored, already region-shaped.
- `packages/editor/src/viewport-host/field-host.ts` — `beginMove`, `pointerPress`,
  `nudgeStampRegion`, and the pending-stamp region-draw arm.
- `packages/editor/src/frontend/components/shell/session-card/AdvancedSection.tsx` — the d-pad
  that is the current answer.
- `docs/reference/editor-architecture.md` §17.3 (move as a reconfigure session), §17.8 (the
  pending-stamp arm and region-draw entry).
