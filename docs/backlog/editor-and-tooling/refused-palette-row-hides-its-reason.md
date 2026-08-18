---
summary: a refused command-palette row's REASON reaches `aria-label` and nowhere else, so a screen-reader user hears it and a sighted user sees a grey row — the one chrome surface where "every refusal visible and explained" holds for the keyboard only
---

# A refused command-palette row does not SHOW why it is refused

`PaletteRow` renders a label and, when there is one, a keycap. The refusal REASON reaches
the accessible name (`aria-label={rowName(row)}`) and nowhere else — so a screen-reader user
hears it and a sighted mouse user sees a greyed row with no explanation. cmdk enforces the
refusal structurally (`disabled` registers no select listener, takes no click, and is skipped
by the arrows), which is right for the mechanism and is also why the chrome's usual answer
does not apply: there is no click for `ReasonTip`'s wrapper span to catch, so
`notify.sayRefusal` never fires here.

That leaves the palette as the ONE surface in the chrome where "every refusal visible +
explained" holds for the keyboard and not for the eye.

## Context

Surfaced in the F4.5c fix round and deliberately not decided there. Covering it is a LAYOUT
change to the row, and there are at least three shapes with different costs:

- **a third column**, right-aligned, carrying the reason where the keycap sits — cheapest,
  but a refused row's reason and an available row's chord then occupy the same slot, and a
  reason is a sentence where a chord is two glyphs.
- **a second line** under the label for refused rows only — reads well, but rows stop being
  uniform height, which matters in a list the arrows travel.
- **a hover/focus tip on the row** — matches the rest of the chrome, but a `disabled` cmdk
  item takes no pointer events, so it needs the same wrapper-span trick `ReasonTip` uses and
  the palette's own keyboard traversal already suppresses tips on row travel (the veto in
  `components/ui/tips.tsx`).

None is obviously right, which is why it is a design decision rather than a fix. Worth noting
the palette is deliberately a VIEW over the registry — every label, keycap and verdict comes
from `lib/actions.ts` — so whatever shape wins must not introduce a second place that decides
what a refusal says.

## Trigger to revisit

**The next design pass on the palette** — or the first time a user asks why a row is greyed.
Take it with the "row" question generally: the same three shapes apply to the burger's menu
items, which have the identical asymmetry.

## Reference

- `packages/editor/src/frontend/components/shell/CommandPalette.tsx` — `PaletteRow`, `rowName`,
  and the header's list of what the mock has that this does not.
- `packages/editor/src/frontend/components/ui/tips.tsx` — `ReasonTip`, the wrapper-span mechanism,
  and `vetoTipDuringTravel`.
- `packages/editor/src/frontend/lib/actions.ts` — `controlVerdict`, the one place a refusal's
  sentence is decided.
- `docs/reference/editor/design-system.md` (the refusal rule, and the command palette as a view).
