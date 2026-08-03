# Two shell modals can stack, and then the first Esc lands on `<body>`

Every chord in the editor stays live while a modal surface is open, so a second modal can be
raised over the first. When that happens the outer surface's focus answer is stranded: the first
Esc dismisses the top layer and lands on `<body>` rather than on the canvas, and only a second
Esc — which closes the layer underneath — reaches it.

Measured at the F4.5 gate fix round (2026-08-03), headless via happy-dom:

| step | state |
| --- | --- |
| canvas focused, `?` pressed **while the burger menu is open** | overlay opens; menu stays `aria-expanded=true`; focus on the overlay's Close button |
| 1st Esc | overlay gone, **menu still expanded**, focus **`<body>`** |
| 2nd Esc | menu closed, focus **canvas** ✓ |
| `?` then `⌘K` (no menu) | **two** dialogs on screen at once; the shortcuts heading is no longer queryable; one Esc leaves 1 dialog and focus on `<body>` |

The record was *yes* in every one of those runs — the `keydown` that opened the overlay happened
while the canvas held focus, and `?` alone (no menu) returns the canvas correctly. So this is the
**`cameFromCanvas === true` branch failing**, which makes it a different defect from
[`trigger-less-dialogs-dismiss-onto-body.md`](./trigger-less-dialogs-dismiss-onto-body.md) — that
entry is about the branch where the answer is genuinely *no* and there is nowhere to go. Here
there is somewhere to go and the dismissal does not get there, because a second dismissable layer
is still mounted underneath and owns focus containment.

## Context

**The `?` route is new; the stacking is not.** Before the holistic gate's ruling 3 bound `?`
(F4.5c Task 18), the overlay was reachable only from a burger row, so "overlay over an open menu"
was unreachable and this particular path did not exist. But two shell modals stacking is
pre-existing and already **accepted**: the F4.5 gate pack carries the rider that *"seven chords
stay live while the modal palette is open (`⇧⌘S` would stack save-as over it)"*, and the `?`-then-`⌘K`
row above needs no menu at all. `?` is a new member of a known class rather than a new class.

Filed rather than fixed because the fix is a **design decision the gate did not make**, and this
landed at the seal: making the surfaces mutually exclusive means answering which one wins — does
the second chord refuse (and say so), or does it replace the first? — and either answer is a rule
about every modal in the editor, not a patch to `?`. The user's standing rule is to surface such
a decision rather than invent one. Nobody is permanently stranded in the meantime: the second Esc
recovers, and every affected route needs a chord pressed *while* a surface is already open.

## What a fix would have to decide

Two shapes, neither costed:

- **The opener closes what is open.** A chord that raises a shell modal first dismisses any open
  menu/modal, so there is only ever one layer. Cheap for `?` (the burger's `menuOpen` would have
  to move to the same owner as the two open-flags, which `Shell.tsx` already holds) but it silently
  discards whatever the user had open.
- **One shell modal at a time; the second refuses.** Fits the editor's existing habit — refusals
  are visible and explained (`ActionDef.enabled` + the gate's `hint`) — and would express itself as
  a gate condition rather than as a side effect. Costs a `GateEnv` member for "a modal is open",
  which the gate already has a precedent for (`confirmOpen`).

Note the second shape interacts with `actions.ts`'s own note that *"a THIRD shell-owned modal is
the trigger"* for collapsing `openCommandPalette` / `openShortcuts` into one funnel — the same
event would make both changes worth doing together.

## Trigger to revisit

Either of:

- **A third shell-owned modal arrives** (already named in `actions.ts` as the trigger for
  collapsing the two open-flags — same event, and the funnel is where a "one at a time" rule would
  naturally live).
- **A gate complaint about a dead first Esc**, in any of its routes — the symptom a user would
  actually report is "Escape didn't work", not "two modals stacked".

## Reference

- `packages/editor/src/frontend/lib/actions.ts` — `help.shortcuts` and `view.commandPalette`, the
  two `ctx.run` openers, and the `:128-130` note on the third-modal funnel.
- `packages/editor/src/frontend/components/shell/Shell.tsx` — `commandPaletteOpen` and
  `shortcutsOpen`, the two flags a "one at a time" rule would read; the burger's own `menuOpen` is
  still local to `BurgerMenu.tsx`, which is what makes the first shape more than a one-liner.
- `packages/editor/src/frontend/hooks/useViewportFocusReturn.ts` — `onCloseAutoFocus`; the *yes*
  branch is the one failing here.
- `packages/editor/src/frontend/lib/actions.ts` — `GateEnv.confirmOpen`, the precedent for a
  "a modal covers the surface" gate member.
- The gate pack's own rider on chords staying live over the modal palette (F4.5 holistic gate,
  §"Pixels and copy").
