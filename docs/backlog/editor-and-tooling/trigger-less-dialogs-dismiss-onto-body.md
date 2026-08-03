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

### It IS provable in the harness — measured at the F4.5 gate fix round, 2026-08-03

**This entry used to say the opposite** (*"happy-dom does not focus a clicked trigger, so the
no branch's landing place cannot be observed"*), and that was wrong. It does not need focus to
move on click: the record is written by a **`pointerdown` capture listener on the window**
(`CanvasHost.tsx:141-143` sets `heldAtGestureStart = document.activeElement === canvas`), and
happy-dom dispatches that listener like any other. What the earlier reading missed is that
`fireEvent.click` alone **skips the pointerdown**, so every existing case drives the *yes*
branch by accident. Fire `pointerDown` **then** `click`, the way a mouse does, and the *no*
branch appears:

| route (real pointer: `pointerdown` then `click`) | focus after Esc |
| --- | --- |
| ☰ → View → `Find a command…` | **`<body>`** |
| ☰ → World → `Open…` | **`<body>`** |
| ☰ → World → `Save as…` | **the burger trigger** (and it holds focus while the name field is up) |
| ☰ → `Keyboard shortcuts` | canvas ✓ (hand-written row, calls `handOff`) |
| ☰ → `View options…` | canvas ✓ (hand-written row, calls `handOff`) |
| ☰ → View → `Grid` (opens nothing) | canvas ✓ |
| the SAME two routes with `click` only, no pointerdown | canvas — which is why the suite misses this |

So the four dialogs' *no*-branch landing is now reproducible, and a fix can be test-driven
rather than eyeballed in Safari.

**A second fact the table makes visible:** the split is not per-DIALOG, it is per-ROW. The two
hand-written burger items forward the answer; the REGISTRY rows do not, because forwarding is
a fact about opening a surface and `ActionDef` has no field that says so. The affected rows are
`world.open`, `world.saveAs`, `edit.history`, `view.commandPalette`, and the confirm-raising
`edit.delete` / `world.new`. **PRE-EXISTING, not introduced by the submenus** — verified both
directions: `git show 522a5d42~1:…/BurgerMenu.tsx` has the flat `RegistryGroup` rendering
`onSelect={() => action.run(ctx)}` with no hand-off, and post-commit `RegistrySubmenu` passes no
`onSelect` either. The submenus neither created nor widened it.

**Not the same defect as F4.5c Task 17's save-as fix** (`f917b961`), which was the ⌘S path
stranding on `<body>` because Radix never dispatched `onOpenAutoFocus`. This is a different
path to a different landing spot; the earlier fix has not regressed.

## Trigger to revisit

The Safari gate reporting it (it is on the gate pack as a keyboard walk), or a fifth
trigger-less surface arriving — at five the per-surface answer stops being a list and starts
being a rule.

**Now also:** the next time `ActionDef` gains a field for any reason. The per-row half of this
(above) wants one fact — "this action opens a surface" — and adding it alone is hard to justify;
adding it alongside another field is not.

## Reference

- `packages/editor/src/frontend/hooks/useViewportFocusReturn.ts` — `onCloseAutoFocus`'s
  `if (!cameFromCanvas.current) return;`, the branch this is about, and the header paragraph
  on why the chain case needed `handOff`.
- `packages/editor/src/frontend/components/shell/WorldDrawer.tsx:345` — the comment noting
  that, like every dialog here, it has no `DialogTrigger`.
- `packages/editor/tests/chrome/viewport-focus-return.test.tsx` — both branches as they are
  pinned today.
