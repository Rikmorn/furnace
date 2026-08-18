---
summary: four call sites clear the box anchor and the segment anchor together because arming either drops the other, and a fifth site once shipped MISSING the pair and ate the next Esc — a private `clearGestureAnchors()` would say "both, always" once
---

# `setBoxAnchor(null); segment.setAnchor(null);` is four sites and wants a name

The box brush and the segment brush each hold a pending first click — `boxAnchor` and
`segmentAnchor` — and the two are mutually exclusive by construction: arming one clears the
other. Every path that drops a half-drawn gesture therefore has to clear BOTH, and four
places do (the line numbers below were re-checked 2026-08-06, after T3b1's five extractions
shifted every one of them by ~+13 from the 2026-08-05 pass — and have since rotted outright:
T3c+T3d moved the sites themselves out of `field-host.ts` into `field-machine.ts` and
`field-world.ts`, so grep by symbol, not by line):

| site | what it is |
| --- | --- |
| `:6389` / `:6392` | the world-swap rebuild — an anchor in the OLD field |
| `:6720` / `:6721` | `setGesture` — a carried-over point would read as a start the user never clicked |
| `:6834` / `:6841` | `startStamp`, the arm-first branch |
| `:6858` / `:6859` | `startStamp`, the selection-first branch |

**It was five, and the fifth was the Esc ladder's first rung.** Foundations T3a deleted
`escapeLadder` for a capture stack, and the box anchor and segment anchor now hold **one
entry each** rather than being cleared together by one rung — because the arming rules make
the pair unreachable (`setGesture` drops both on any switch, a stamp arm drops both), so the
dual clear there was guarding a state that cannot happen. The remaining four are the paths
that really do have to drop both. At head the second call travels as a dep — the machine
sites spell `deps.setSegmentAnchor(null)` and the world-reset site `deps.clearSegmentAnchor()`
(the segment cluster itself lives in `field-segment.ts`; T3d re-checked this sentence, which
had been one extraction behind).

Four is still past `clean-code.md`'s third-occurrence threshold, and the last two only became
sites at F4.5c Task 14 — where the second one was MISSING and shipped as a defect: on the
ordinary path (select a region, arm a gesture, click once, pick a generator) a stale segment
anchor survived into the stamp session and ate the next Esc. Two of them were written in
the round that fixed it.

## Context

The candidate is a private `clearGestureAnchors()` beside the two setters — pure, no new
public surface, and it makes "both, always" a thing the code says once instead of a rule four
call sites have to remember. The shape of the failure it prevents is already on record:
the pattern is exactly `setPendingStamp`'s (now in `field-machine.ts` — grep the setter),
where the clear
lives INSIDE the setter so every path that disarms drops the corner whether or not its
author thought about anchors — the same argument, applied one level up.

Not done at Task 14 because that round was already carrying a behavioural fix and adding two
lines was strictly the smaller change under the scope set for it. Surfaced rather than
silently absorbed.

One nuance a helper has to preserve: two of the four sites carry a per-site COMMENT between
the two calls (`:6390-6391` explains that the segment anchor points into the old field;
`:6835-6840` explains that `cursorAffordance` answers `null` for any anchored gesture). Those
reasons are site-specific and would have to move to the call site of the helper, not into it —
a helper whose adoption deletes them makes the file worse, not better.

## Trigger to revisit

A FIFTH site, or the next substantial edit to the gesture/session code — now
`field-machine.ts` / `field-tool.ts` — `clean-code.md`'s "drive-by changes don't trigger
restructuring" is why this waits for a
commit already in that neighbourhood.

## Reference

- `packages/editor/src/field-host/field-machine.ts` — three of the four sites (`setGesture`
  and both `startStamp` branches), and `setPendingStamp` for the precedent;
  `packages/editor/src/field-host/field-world.ts` — the world-swap site (its reset calls
  the `clearBoxAnchor` / `clearSegmentAnchor` deps).
- `packages/editor/tests/field-host-stamp-entry.gpu.test.ts` — the `ARM_EXITS` table,
  which walks the disarm paths and is where a fifth site would want a row.
- `.claude/rules/clean-code.md` § Cognitive Load — "tolerate duplication until the third
  occurrence".
