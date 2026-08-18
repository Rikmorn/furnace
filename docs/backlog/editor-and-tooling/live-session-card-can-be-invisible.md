---
summary: a stamp session runs and commits end to end with its card off screen — the x-close latch and the hide-all layer mask both do it by design — and nothing distinguishes "no session" from "a live session whose card is hidden"
---

# A live session can run with its card invisible — and nothing says so

Found at the T3c gate (2026-08-07, Safari): a stamp was armed, the region drawn, and the
missing session card read as "stamps no longer show the configuration dialog." The
session was live and committable the whole time — the strip carried the ⏎ affordance —
and the card was simply not on screen. **Not a T3c regression**: the tranche's chrome
diff (`9b8d6837..HEAD`) touches none of the palette, presence or session-card machinery,
and the `subscribeStamp` seam publishes correctly at head.

## Context

Two documented ways the card can be off while a session stands, both by design:

- **The ×-close latch.** `SessionCardPresence` re-opens the card only on a SUBJECT
  change (`subject === shown.current` returns early), and `palette-store.ts`'s header
  names the hole on purpose: "the card's × closes it and the driver will not re-open it
  for the same subject — without the menu item that close is a latch with no exit."
- **Hide-all.** The palette layer's `hidden` (⌘\) masks every palette regardless of
  `open`, so a driven open lands on a hidden layer with no visible effect.

With the card off, a session runs headless end to end: sizes seed from the drawn region
(D-F3-13), the seed is random, ⏎ commits from the canvas. That is coherent D-13 design —
the card is a properties surface, not a modal gate — and it is also exactly what read as
a bug to the person the surface exists for. The finding is the missing CUE, not the
capability: nothing on screen distinguishes "no session" from "a live session whose card
is hidden."

Shapes a design pass should weigh (none taken now, they pull different ways): a
session-strip affordance that names and opens the hidden card; letting a NEW session's
driven open break through hide-all for `drivenOpen` palettes specifically; a first-run
style cue the first time a session opens while its card is off. Whether the ×-latch
scope (same-subject) is itself right is a separate, smaller question.

## Trigger to revisit

- The next chrome/UX polish pass that opens the palette layer, the session card, or the
  session strip.
- A second report of the same misread — one gate hit is signal, two is a defect.

## Reference

- `packages/editor/src/frontend/components/shell/SessionCard.tsx` —
  `SessionCardPresence`, the subject latch (`shown` ref).
- `packages/editor/src/frontend/lib/palette-store.ts` — the header's "latch with no
  exit" paragraph; `drivenOpen`'s meaning.
- `packages/editor/src/frontend/components/shell/PaletteLayer.tsx` — the layer-level
  `hidden`.
