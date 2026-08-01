# D-25's tooltip clause did not land — 14 doc-carrying `title=` attributes survive

D-F4.5-25 asks for "real keyboard-reachable tooltips with keybinding annotations" to
replace the pattern where a native `title=` attribute carries a control's documentation.
The forms half of D-25 landed in F4.5b Task 11 (sliders, ± steppers, segmented enums,
units, the field-refusal contract). **The tooltip half did not**, and nothing in the
F4.5b plan assigned it to a task.

`grep -rno 'title="' packages/editor/src/frontend | wc -l` returns **14** at the end of
F4.5b. Five of them are the `EntitiesList` row verbs — the densest cluster, and the one
where the gap costs most: those are the verbs that open, freeze, sever and delete a
committed stamp, three of them destructive, and the sentence explaining what each one
does is reachable only by hovering a mouse.

## Why `title=` is not the thing D-25 asks for

Three distinct failures, and only the first is the obvious one:

1. **Not keyboard-reachable.** A native tooltip appears on pointer hover. A user who
   Tab-focuses the control gets nothing, on every browser.
2. **No keybinding annotation.** The repo already has an action registry (`lib/actions.ts`)
   carrying `keys` for every bound verb, and `ReasonTip` renders a real Radix tooltip. A
   `title=` string cannot show a keycap, so any control documented this way either omits
   its shortcut or hardcodes it in prose — which is the D-12 duplication problem in a
   second spelling.
3. **Uncontrollable delay and placement.** The native tooltip's ~1 s delay and OS
   placement are not ours to tune, so a documented control and an undocumented one look
   identical for the first second of a hover.

Note the distinction that keeps this from being a blanket sweep: `title=` used as a short
NAME or a redundant echo of visible text is fine and should stay. The 14 in scope are the
ones carrying *documentation* — a sentence the user needs in order to decide.

## Context

`ReasonTip` (`components/field/form-bits.tsx`) already exists and is already used for
refusal reasons on `BakeButton` and the session footer, so the mechanism is in the repo
and needs no new dependency. The work is a sweep plus a decision about **which** controls
earn a rich tooltip versus a plain accessible name — a control with a good label does not
need a tooltip at all, and converting all 14 mechanically would trade a hover-only
sentence for a tooltip nobody asked for.

The keybinding half wants the tooltip to read its keycap off the registry rather than
from prose, so the natural shape is a small wrapper that takes an action id.

## Trigger to revisit

**F4.5c** (the post-feature polish stage). It falls between slice b and slice c
otherwise: §9 of the charter assigns D-25 to slice b, and slice b shipped only the forms
half — so without an explicit home this clause has none.

## Reference

- `packages/editor/src/frontend/components/field/EntitiesList.tsx` — the five row verbs,
  the densest cluster.
- `packages/editor/src/frontend/components/field/form-bits.tsx` — `ReasonTip`, the
  mechanism that already exists.
- `packages/editor/src/frontend/lib/actions.ts` — `keys` per action, the source a
  keybinding annotation should read rather than restate.
- `docs/reference/editor-architecture.md` §21 — the as-built for what F4.5b did land.
