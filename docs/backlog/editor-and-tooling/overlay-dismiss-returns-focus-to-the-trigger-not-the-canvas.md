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

## Partially handled — the MOMENTARY-COMMAND case (F4.5b Task 6, 2026-07-31)

The trigger fired: Task 6 put six `<button>` tips on the corner axis triad, over the
canvas, and they landed in this class immediately — a click on one moved focus off the
canvas, killing every viewport key, and `field-host.ts`'s `onBlur` runs
`cancelMoveInFlight()`, so a user mid-`G`-grab who clicked a tip to see what they were
doing lost the grab silently.

That case does **not** need the conditional machinery below, and the distinction is the
useful part of this entry now: a triad tip is a **momentary command**, not a surface
anyone navigates INTO. Focus was never meant to land there at all, so the fix is to
refuse it — `onPointerDown={(e) => { if (e.button === 0) e.preventDefault(); }}`, the
standard toolbar pattern, which suppresses the click-focus transfer while leaving
Tab-focus and Enter/Space activation intact. Pinned in `tests/chrome/shell.test.tsx`.

**Still open: the DISMISSIBLE-SURFACE case** — the View popover, the burger, the world
drawer, the confirm dialog. Those legitimately take focus (you navigate into them), so
the question is where focus goes on CLOSE, and that is still the conditional-restore
design decision described above. The momentary-command answer does not generalise to it.

## Narrowed again — most of the "dead keys" left (F4.5b Task 7, 2026-07-31)

The action registry moved every APP-LEVEL verb onto a `window` listener: ⏎, Esc, R, F, ⌫,
`G`, `V`/`B`/`M`/`S`, `X`, ⌘J, ⌘S, ⌘Z, ⌘\. None of them needs the canvas focused any
more, so clicking a palette control no longer kills them — which is most of what made
this entry feel urgent. The canvas keeps only what steers the viewport under the pointer:
the fly set, `[`/`]`, the arrow nudges and the momentary ⇧/⌃. Losing those to a palette
click is a much smaller loss (they all have panel equivalents or repeat harmlessly), and
`onBlur`'s `cancelMoveInFlight()` — the sharp edge — is unchanged.

The line above about ⌘Z is still accurate as written: both listeners bind it, and the
canvas's `stopPropagation` is what keeps one press from stepping the log twice.

## Trigger to revisit

The F4.5c polish stage, or sooner if the slice slider (a control a user drags repeatedly
while looking at the field) makes the remaining dead-keys window obvious. F4.5b's pointer
work already came and went — it handled the momentary-command half only, and Task 7
retired most of the rest.

## Reference

- `packages/editor/src/frontend/components/shell/CanvasHost.tsx` — the focusable canvas
  and why the focus ring is not optional there.
- `packages/editor/src/frontend/components/shell/ViewPopover.tsx` — the overlay that made
  this a normal-loop problem.
- `packages/editor/src/viewport-host/field-host.ts` — `attachListeners`, which binds the
  keydowns to the canvas element, and `onBlur`, which cancels a move in flight.
- `packages/editor/src/frontend/components/AxisTriad.tsx` — the momentary-command fix.
