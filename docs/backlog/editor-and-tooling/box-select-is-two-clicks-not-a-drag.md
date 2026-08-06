# A box selection is two clicks, not a press-drag-release

The `box` cell-selection gesture sets its anchor on the pointer PRESS and takes its second
corner on a separate later press. `onPointerUp` has no region branch at all, so
press-drag-release — the gesture every other tool in the category uses for a box — does
nothing. The `material` and `void` floods are one click each, which is right for them.

This is a GESTURE-ergonomics item, not a feedback one. The feedback half is closed: F4.5b
Task 13 made a flood selection draw one translucent cube per selected cell (surface-first,
capped at `SELECTION_DISPLAY_CAP = 65 536`) instead of an AABB outline the camera is standing
inside, and F4.5b Tasks 8–9 made the box gesture SAY what it is — the status keymap line
reads `click ×2 spans a region` and an un-anchored corner draws a cross at the cursor. The
mechanism underneath is untouched.

## Context

Carried out of two gate sets that both landed on the same finding — the F2b gate's
"selection feedback overhaul" (item 1) and the F3a gate's "box/wand selection behaves oddly"
(item 3) — and re-filed at the F4.5 seal when those sets were consumed into the charter.
F4.5b deliberately made the two-click mechanism LEGIBLE rather than changing it: changing a
selection gesture immediately before a stage gate would have added mechanism risk the charter
never priced.

The shape, if it is taken: a press that arms the anchor, a move that previews the region
(the live snapped-region preview already exists), and a release that either completes the
region or — under a threshold, exactly like `DRAG_THRESHOLD_PX` on the pointer tool — falls
back to leaving the anchor armed so the existing two-click flow still works. Both mechanisms
can coexist; the cost of the drag one is that the canvas is also where a camera orbit lives,
so the arbitration has to be written down (`field-host/field-pick.ts` is the precedent for
that kind of ordering).

## Trigger to revisit

**The first gate complaint about selection after F4.5.** The F4.5 holistic gate walked box
select as part of its spine and passed without raising it, which is evidence the legibility
work bought enough — but it is one user on one walk, and this item was raised at two previous
gates by the same user.

## Reference

- `packages/editor/src/field-host/field-host.ts` — `boxAnchor`, the press branch, and the
  `onPointerUp` that has no region case.
- `packages/editor/src/field-host/viewport-cursor.ts` — the `cross` mark an un-anchored
  corner draws; `shell/status-keymap.ts` for the line that names the gesture.
- `packages/editor/src/field-host/field-pick.ts` — the press/threshold/drag arbitration the
  pointer tool already uses, and the precedent this would follow.
- `docs/reference/editor-architecture.md` §12 (selection as a tool class), §17.1 (the pointer's
  press arbitration), §17.7 (cell-level selection display).
