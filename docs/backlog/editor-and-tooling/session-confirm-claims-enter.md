---
summary: `useGlobalKeybindings` calls `preventDefault` as soon as the gate ALLOWS an action, before `enabled` is consulted, so `session.confirm`'s bare Enter eats the activation of every focused native button even when there is no session to confirm
---

# `session.confirm` claims ⏎ at the window, so a focused plain `<button>` never activates

`useGlobalKeybindings` (the `onClaim` callback it passes `runAction` in
`hooks/useGlobalKeybindings.ts`) calls `e.preventDefault()` as
soon as the gate ALLOWS an action — **before** `def.enabled(ctx)` is consulted. For every
action except one that is exactly right. For `session.confirm`, whose `match` is a bare
Enter and whose `enabled` is `ctx.session !== null`, it means the editor eats ⏎ on every
focused native button in the chrome even when there is no session to confirm.

Probed at F4.5c Task 10: with `session: null`, `fireEvent.keyDown(button, {key:"Enter"})`
returns `false` (i.e. prevented) while `confirmSession` is never called. Nothing runs, and
the button's own native activation cannot.

It escapes only where something else gets there first: a ConfirmDialog being open (the gate
refuses), the canvas `stopPropagation`ing its own branch, activation that is JS rather than
native (Radix, cmdk), and Task 9's three row grids — which had to perform ⏎ themselves for
this exact reason, and say so in `hooks/useRovingList.tsx`'s two-axes docblock above
`ROW_STOP` ("⏎ activates the focused control. It has to be performed here rather than left
to the browser").

## Context

**The obvious fix is wrong.** Moving `preventDefault` below the `enabled` check breaks the
behaviour the early call exists for, and that behaviour is documented at the head of the
same file: a disabled ⌘S must still suppress the browser's save-page dialog, and ⌫ over the
canvas with nothing selected must still not navigate back. Those are the cases the early
prevent was written for, and they are correct.

So this needs a **per-action rule** — something like "an action whose key has a meaningful
browser or platform default preempts it on gate-pass; an action whose key is otherwise inert
waits for `enabled`" — expressed as a field on `ActionDef` rather than as a special case for
`session.confirm`. That is a design decision about the action table's contract, which is why
this is filed rather than patched. **Do not decide it by editing the one action**: `⏎`, `⌫`,
`Esc` and the tool letters would each land differently under any rule chosen, and picking
the rule is the work.

The three grids are prior art for the workaround, not for the fix — every future list or
control cluster that wants native ⏎ has to reimplement them.

## Trigger to revisit

A fourth surface needing ⏎ on a plain button (the three grids are the first three, and each
paid for it separately), or the `/impeccable` re-critique promoting it — it is on that
task's candidate list as the highest-value entry.

## Reference

- `packages/editor/src/frontend/hooks/useGlobalKeybindings.ts` — line 50, and the header
  paragraph stating why it is there.
- `packages/editor/src/frontend/lib/actions.ts` — `session.confirm`'s def; `gateAction`,
  `clickGate` and `ActionDef` are where a per-action rule would live.
- `packages/editor/src/frontend/hooks/useRovingList.tsx` — the two-axes docblock above
  `ROW_STOP` (the "⏎ activates the focused control" note): the workaround, and the
  clearest statement of the mechanism in the tree.
