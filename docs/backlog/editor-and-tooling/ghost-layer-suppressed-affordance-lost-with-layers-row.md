# The ghost layer's "suppressed" affordance died with the layers row

The `ghost` layer checkbox used to render **disabled** while an armed selection gesture
made the brush ghost unreachable — `LayersRow` took a `ghostSuppressed` prop, which
`FieldPanel` computed from its own `gesture` + `stamp` state (`selectionArmed && stamp
=== null`), with the title "brush ghost is hidden while a selection tool is active".

F4.5a Task 9 moved the layer gates into the top bar's View popover
(`shell/ViewPopover.tsx`) and deleted `field/LayersRow.tsx`. The popover reads
`hooks/useView.tsx` — display state — and has **no access** to the armed gesture or the
live stamp session, both of which are still panel-local React state in `FieldPanel.tsx`.
So the checkbox now always reads as enabled, including in the window where ticking it
changes nothing visible.

## Context

Nothing tested the affordance (verified: no assertion mentioned `ghostSuppressed` or the
title), and it was always approximate — an armed-but-unanchored segment gesture also had
nothing to show and still read as enabled (LayersRow's own comment said so). The cost of
losing it is a checkbox that occasionally looks live over a layer with nothing in it; the
cost of keeping it would have been plumbing tool state into the shell for a `disabled`
attribute.

The real fix is not a prop: it is the **tool/gesture state lifting out of FieldPanel**
into a provider the shell can read, which is the same move `useView`/`useWorld` already
made and which F4.5b's pointer/tool work needs anyway. Once the armed gesture is shell
state, the popover can derive `suppressed` exactly as the panel did — and more precisely,
since the host's anchor state would be reachable too.

## Trigger to revisit

When FieldPanel's tool + gesture state moves to a provider (F4.5b's interaction work, or
whichever tranche dissolves the brush controls into a palette).

## Reference

- `packages/editor/src/frontend/components/shell/ViewPopover.tsx` — the layer group today.
- `packages/editor/src/frontend/components/FieldPanel.tsx` — `gesture` / `selectionArmed`
  / `stamp`, the three values the affordance needed.
- Deleted: `packages/editor/src/frontend/components/field/LayersRow.tsx` (git history).
