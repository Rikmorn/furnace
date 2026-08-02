# `setBoxAnchor(null); setSegmentAnchor(null);` is five sites and wants a name

The box brush and the segment brush each hold a pending first click — `boxAnchor` and
`segmentAnchor` — and the two are mutually exclusive by construction: arming one clears the
other. Every path that drops a half-drawn gesture therefore has to clear BOTH, and five
places in `viewport-host/field-host.ts` do:

| site | what it is |
| --- | --- |
| `:5913` | the Esc ladder's first rung — "a half-drawn gesture" |
| `:6176` | the world-swap rebuild — an anchor in the OLD field |
| `:6493` | `setGesture` — a carried-over point would read as a start the user never clicked |
| `:6682` | `startStamp`, the arm-first branch |
| `:6706` | `startStamp`, the selection-first branch |

That is past `clean-code.md`'s third-occurrence threshold, and the last two only became
sites at F4.5c Task 14 — where the second one was MISSING and shipped as a defect: on the
ordinary path (select a region, arm a gesture, click once, pick a generator) a stale segment
anchor survived into the stamp session and ate the next Esc. Two of the five were written in
the round that fixed it.

## Context

The candidate is a private `clearGestureAnchors()` beside the two setters — pure, no new
public surface, and it makes "both, always" a thing the code says once instead of a rule five
call sites have to remember. The shape of the failure it prevents is already on record:
the pattern is exactly `setPendingStamp`'s (`field-host.ts:2860-2865`), where the clear
lives INSIDE the setter so every path that disarms drops the corner whether or not its
author thought about anchors — the same argument, applied one level up.

Not done at Task 14 because that round was already carrying a behavioural fix and adding two
lines was strictly the smaller change under the scope set for it. Surfaced rather than
silently absorbed.

One nuance a helper has to preserve: two of the five sites carry a per-site COMMENT between
the two calls (`:6176` explains that the segment anchor points into the old field; `:6682`
explains that `cursorAffordance` answers `null` for any anchored gesture). Those reasons are
site-specific and would have to move to the call site of the helper, not into it — a helper
whose adoption deletes them makes the file worse, not better.

## Trigger to revisit

A SIXTH site, or the next substantial edit to `field-host.ts`'s gesture/session region —
`clean-code.md`'s "drive-by changes don't trigger restructuring" is why this waits for a
commit already in that neighbourhood.

## Reference

- `packages/editor/src/viewport-host/field-host.ts` — the five sites above, and
  `setPendingStamp` at `:2860-2865` for the precedent.
- `packages/editor/tests/field-host-stamp-entry.gpu.test.ts:357` — the `ARM_EXITS` table,
  which walks the disarm paths and is where a sixth site would want a row.
- `.claude/rules/clean-code.md` § Cognitive Load — "tolerate duplication until the third
  occurrence".
