# The chrome provider the design promised to collapse grew instead

Recorded as a MISS by user ruling at the T3 objectives audit (2026-08-08) — not
scheduled work. The foundations design said the view-model layer "collapses … the
chrome's 870-line 11-context provider"; the as-built went the other way:
`useFieldHostState.tsx` was 878 lines before T3b1, 1,075 after it (ten contexts became
per-consumer latches, but five values were FORCED into provider-held cells), and
1,093 at T3d's head — **25% larger than when the programme started**, while every other
number in the editor shrank.

## Context

The growth is not waste — §21.3 documents the shape honestly (latches + the forced
cells + two shell-held seams), and T3b2 retired two cells when the tool seam converted.
But the design's stated payoff inverted and no exit clause ever measured it. The honest
framing: the LATCH conversion was the real goal (cadence isolation, achieved); the line
count was a proxy that failed. Whether a real collapse is worth doing is an open
question, not an obligation.

## Trigger to revisit

- A third forced cell appears (the current five were each individually justified; six
  starts to look like the mechanism fighting the architecture).
- Chrome performance work that touches render cadence — the latch layer is where it
  lives.

## Reference

- `packages/editor/src/frontend/hooks/useFieldHostState.tsx`;
  `docs/reference/editor-architecture.md` §21.3.
