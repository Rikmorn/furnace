# Closing a chrome overlay returns focus to its trigger, killing the viewport keys

The field host binds its keyboard verbs to the CANVAS — WASD/QE fly, `[` / `]` radius,
the arrow nudges, `⌘Z` — so they only fire while the canvas holds focus
(`CanvasHost.tsx`'s `tabIndex={0}` and the focus ring that advertises it). Radix's
dismiss behaviour returns focus to whatever opened the overlay: close the View popover
and focus sits on the ⬒ view button in the top bar, not on the canvas. Every viewport key
is dead until the user clicks the canvas again, with nothing on screen saying so.

Pre-existing as a class — the burger menu, the world drawer and the confirm dialog all do
it — but F4.5a made it matter: the View popover is now the primary surface for shading,
layers, slice and AA, so "open it, change something, close it, keep flying" is the normal
loop rather than a rare detour.

## Context

The naive fix (focus the canvas on every overlay close) is wrong: a user who tabbed to the
top bar with the keyboard and dismissed a popover with Esc expects focus back on the
control they came from, which is exactly what Radix does and what
`WCAG 2.4.3 Focus Order` asks for. The behaviour that is actually wanted is conditional —
**return focus to the canvas only if the canvas held it when the overlay was summoned** —
which needs a small piece of shared machinery: record the active element at open, and on
close restore it if it was the canvas, otherwise let Radix do its thing. That is a design
decision (where does the record live — per overlay, or one shell-level "viewport focus
memory"? does it cover the drawer and the confirm too?), not a one-line patch, which is
why it is here rather than fixed inline.

Related: the same seam would answer "should ⌘Z work while a palette input has focus?",
which today is handled separately by `useGlobalKeybindings` + the canvas's own handler.

## Trigger to revisit

F4.5b's pointer/interaction work — it owns the viewport input model and will already be
touching focus, capture and the gesture state. Or sooner if the slice slider (a control a
user drags repeatedly while looking at the field) makes the dead-keys window obvious.

## Reference

- `packages/editor/src/frontend/components/shell/CanvasHost.tsx` — the focusable canvas
  and why the focus ring is not optional there.
- `packages/editor/src/frontend/components/shell/ViewPopover.tsx` — the overlay that made
  this a normal-loop problem.
- `packages/editor/src/viewport-host/field-host.ts` — `attachListeners`, which binds the
  keydowns to the canvas element.
