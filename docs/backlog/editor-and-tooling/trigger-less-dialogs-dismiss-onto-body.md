# Four trigger-less dialogs dismiss onto `<body>` when the focus record says *no*

F4.5c Task 10 wired conditional viewport focus return: dismissing an overlay puts focus back
on the canvas, but ONLY when the gesture that opened it began on the canvas. When the record
says *no* — the user Tabbed through the chrome and opened the surface from there — the
handler returns without preventing Radix's own restore, and Radix restores focus to the
trigger. That is correct, and it is what SC 2.4.3 asks for.

Four dialogs have no trigger for Radix to restore to. None of them is rendered with a
`DialogTrigger`; each derives `open` from state a keybinding or a menu row wrote:

| dialog | opened by |
| --- | --- |
| `ConfirmDialog` | a request object, from anywhere |
| `shell/CommandPalette` | ⌘K |
| `shell/WorldDrawer` | the world chip, or `world.open` from the menu / ⌘K |
| `shell/ShortcutsDialog` | a burger menu row |

So on the *no* branch the dismissal lands on `<body>`, and the keyboard user who was walking
the top bar is dropped to the start of the document — the same Focus Order failure the
conditional logic exists to avoid, arrived at from the other side.

## Context

**This is a different defect from the one Task 10 closed.** That one was the CHAIN — ☰ →
"Keyboard shortcuts", ⌘K → "Open…" — where the second surface's own answer is always *no*
because its gesture began inside the first, and `ViewportFocusReturn.handOff` forwards the
first surface's answer so the chain ends on the canvas. `handOff` fixes the case where the
answer should have been *yes*. This entry is the case where the answer is genuinely *no* and
there is still nowhere to go.

The shape of a fix is a per-surface "restore to" element — the control that logically
summoned it (the world chip for the drawer; the burger button for the shortcuts dialog) —
which for two of the four does not exist as a DOM node at dismissal time and for
`ConfirmDialog` does not exist at all, since the request can be raised from a keybinding.
That is a design question about what "where they were" means for a surface with no
summoner, which is why it is filed rather than patched.

Not provable in the current harness either: happy-dom does not focus a clicked trigger, so
the *no* branch's landing place cannot be observed the way the *yes* branch's can.

## Trigger to revisit

The Safari gate reporting it (it is on the gate pack as a keyboard walk), or a fifth
trigger-less surface arriving — at five the per-surface answer stops being a list and starts
being a rule.

## Reference

- `packages/editor/src/frontend/hooks/useViewportFocusReturn.ts` — `onCloseAutoFocus`'s
  `if (!cameFromCanvas.current) return;`, the branch this is about, and the header paragraph
  on why the chain case needed `handOff`.
- `packages/editor/src/frontend/components/shell/WorldDrawer.tsx:345` — the comment noting
  that, like every dialog here, it has no `DialogTrigger`.
- `packages/editor/tests/chrome/viewport-focus-return.test.tsx` — both branches as they are
  pinned today.
