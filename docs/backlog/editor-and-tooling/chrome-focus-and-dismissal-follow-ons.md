# Chrome focus and dismissal — the follow-on set

Five entries about the same mechanism, consolidated at the F4.5 seal (2026-08-03) because
they are one subject and were being read one at a time. The subject: **where the keyboard is
after a surface closes, and which surface owns a key while several are open.** F4.5c Task 10
built the seam that answers most of it — `ViewportFocus` on the editor context, a
capture-phase record of where the gesture that opened a surface began, and a hand-off so a
chain of two surfaces still lands on the canvas. What is below is what that seam does not
reach, plus the one refactor it invites.

Each section keeps its own trigger. Delete a section when it is taken; delete the file when
the last one goes.

## Four trigger-less dialogs dismiss onto `<body>` when the focus record says *no*

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

### Context

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

### Trigger to revisit

The Safari gate reporting it (it is on the gate pack as a keyboard walk), or a fifth
trigger-less surface arriving — at five the per-surface answer stops being a list and starts
being a rule.

**Now also:** the next time `ActionDef` gains a field for any reason. The per-row half of this
(above) wants one fact — "this action opens a surface" — and adding it alone is hard to justify;
adding it alongside another field is not.

> **This trigger FIRED at foundations T3b2 (2026-08-06) and was NOT taken — recorded rather
> than silently passed.** The row gained `mcpProjection`, and `ActionDef` split: the data
> fields are `ActionDescriptor` in `src/action-registry/descriptors.ts` now, so the field
> this entry wants would go THERE, beside `flyLetter` and `armsTool`.
>
> Why it was declined anyway: T3b2's rows are the DAEMON's, and "this action opens a chrome
> surface" is a fact about a React surface that the registry — which may not import
> `frontend/` at all — has no business carrying. A field named for focus return would be the
> first row field no non-chrome caller could ever act on. The honest options are now (a) the
> field lives on the chrome's `ActionBehavior` half instead, which is where the closures that
> DO the opening already are, or (b) the six affected rows keep forwarding by hand. That is a
> real design choice this entry did not previously have to make, and it is cheaper to make it
> than it was before, because the split has already sorted every other field into a side.
>
> **Revised trigger:** the next time `ActionBehavior` gains a field, or the Safari gate
> reports it.

### Reference

- `packages/editor/src/frontend/hooks/useViewportFocusReturn.ts` — `onCloseAutoFocus`'s
  `if (!cameFromCanvas.current) return;`, the branch this is about, and the header paragraph
  on why the chain case needed `handOff`.
- `packages/editor/src/frontend/components/shell/WorldDrawer.tsx:345` — the comment noting
  that, like every dialog here, it has no `DialogTrigger`.
- `packages/editor/tests/chrome/viewport-focus-return.test.tsx` — both branches as they are
  pinned today.

---

## Two shell modals can stack, and then the first Esc lands on `<body>`

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

### Context

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

### What a fix would have to decide

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

### Trigger to revisit

Either of:

- **A third shell-owned modal arrives** (already named in `actions.ts` as the trigger for
  collapsing the two open-flags — same event, and the funnel is where a "one at a time" rule would
  naturally live).
- **A gate complaint about a dead first Esc**, in any of its routes — the symptom a user would
  actually report is "Escape didn't work", not "two modals stacked".

### Reference

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

---

## `session.confirm` claims ⏎ at the window, so a focused plain `<button>` never activates

`useGlobalKeybindings` (`hooks/useGlobalKeybindings.ts:50`) calls `e.preventDefault()` as
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
this exact reason, and say so at `hooks/useRovingList.tsx:299-302`.

### Context

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

### Trigger to revisit

A fourth surface needing ⏎ on a plain button (the three grids are the first three, and each
paid for it separately), or the `/impeccable` re-critique promoting it — it is on that
task's candidate list as the highest-value entry.

### Reference

- `packages/editor/src/frontend/hooks/useGlobalKeybindings.ts` — line 50, and the header
  paragraph stating why it is there.
- `packages/editor/src/frontend/lib/actions.ts` — `session.confirm`'s def; `gateAction`,
  `clickGate` and `ActionDef` are where a per-action rule would live.
- `packages/editor/src/frontend/hooks/useRovingList.tsx:299-302` — the workaround, and the
  clearest statement of the mechanism in the tree.

---

## `?` cannot reach the shortcut overlay on a layout that needs AltGr for it

`help.shortcuts` (the keyboard-shortcut overlay) is bound to the CHARACTER `?` rather than to a
modifier + physical key:

```ts
const question = (e: KeyboardEvent): boolean =>
  !mod(e) && !e.altKey && e.key === "?";
```

That is deliberately layout-agnostic across the common cases — `?` is ⇧/ on a US layout, ⇧ß on a
German one, ⇧, on a French one, and the matcher states none of it. The residue is the layouts
where `?` is an **AltGr** combination. Windows reports AltGr as ctrl+alt, and both exclusions in
the matcher refuse it (`mod(e)` covers ctrl, `!e.altKey` covers alt), so on such a layout the key
is simply dead.

### Context

Filed by the F4.5 holistic gate's ruling 3, in the commit that bound the key. The ruling itself
named the tradeoff and accepted it: *"note: `?` is ⇧/ on most layouts — fine, macOS-primary"*.

The exclusions are not incidental and cannot simply be relaxed:

- `mod(e)` (⌘ **or** ctrl) is what makes every chord in the table work on macOS and Windows
  alike. Admitting ctrl+alt here would make `?` a chord as well as a bare key.
- `!e.altKey` is the whole table's rule, for two reasons stated on `chord`: ⌥ is the viewport's
  eyedropper modifier, and on macOS it REWRITES `e.key` anyway.

So a fix means either a per-binding exemption from the ⌥ rule, or matching on something other
than `e.key` — and `e.code` is exactly the wrong tool here (`Slash` is the physical key only on
the layouts that already work).

**The overlay is not unreachable on those layouts** — the burger's Help ▸ Keyboard shortcuts item
and the ⌘K palette both open it, and the ⌘K route reaches it by name. What is lost is one
keystroke, on a keyboard nobody in this project uses.

### What a fix would have to decide

- Whether a binding may carry its own modifier policy (an `ActionDef` that opts out of the ⌥
  exclusion) — the first such exception in a table whose value is that ⇧ and ⌥ mean ONE thing
  across all of it.
- Or whether the editor grows a rebinding surface, which subsumes this and several other items.

### Trigger to revisit

Either of:

- **A non-US-layout user reports the key dead.** The specific layouts at risk are the ones
  producing `?` via AltGr; a user on ⇧-something is already covered.
- **A second binding needs a layout-dependent character.** One exception is a note; two are a
  policy, and the policy belongs in `ActionGate` rather than in a matcher's docblock.

### Reference

- `packages/editor/src/frontend/lib/actions.ts` — `question()` (the matcher and its docblock),
  `chord()`/`bare()`/`shifted()` (the ⌥ and ⇧ rules it is the exception to), and the
  `help.shortcuts` row.
- `packages/editor/tests/keybindings.test.ts` — "`?` is matched by the CHARACTER, not by ⇧"
  asserts the AltGr case is refused, so this entry describes tested behaviour rather than a
  suspicion.
- `packages/editor/src/frontend/components/shell/ShortcutsDialog.tsx` — `GROUP_NOTES.help`, which
  tells the user the binding is on the character.

---

## The viewport focus seam could leave `CanvasHost`

`CanvasHost.tsx` now holds two unrelated jobs. The first is what it has always been: the
WebGPU lifecycle — measure the canvas, `host.init`, the chained deferred dispose, the AA
re-init. The second arrived with F4.5c Task 10: the viewport FOCUS seam — two capture-phase
window listeners that record whether the canvas held focus at the start of each gesture, and
the `ViewportFocus` object (`focus`, `heldFocusAtGestureStart`, `carryGestureOrigin`) it
installs on the editor context for every overlay's close handler to read.

They already sit in separate effects, and deliberately so: the GPU effect re-runs on an AA
change, the focus effect must not. But that is the tell — the second effect depends on
nothing the first one owns except the canvas element.

### Context

Raised in Task 10's quality review and deferred there on purpose: the same round was already
carrying a behavioural fix (the hand-off), and a structural move on top of it would have made
the diff hard to reason about.

The shape, if it is taken: a `useViewportFocusSeam(canvas)` hook beside
`useViewportFocusReturn.ts`, taking the element and owning the listeners, the record and the
installed object. `CanvasHost` would keep the ref and one call. The two would then read as
what they are — a GPU host and a focus seam that happen to be about the same element.

What it buys is testability more than tidiness: the recorder is currently only reachable
through a mounted Shell with a stubbed `getBoundingClientRect`, so
`tests/chrome/viewport-focus-return.test.tsx` drives every recorder case through the whole
chrome. A standalone hook could be pinned directly, and the Shell cases could shrink to the
integration claims that actually need a Shell.

### Trigger to revisit

`CanvasHost.tsx` growing a THIRD concern, or the focus seam growing a fourth member. Either
is the point at which the file stops being "the canvas" and starts being a bag.

**The Task 15 conditional resolved NEGATIVE (2026-08-02).** That task was doc, gate and
backlog work; it did not touch `CanvasHost.tsx`, so the "while you are in there anyway"
opening did not arrive. Both conditions above are still unmet — the file holds two concerns
and `ViewportFocus` still has three members — so the entry stands unchanged.

### Reference

- `packages/editor/src/frontend/components/shell/CanvasHost.tsx` — both effects, and the
  comment on the second saying why they are separate.
- `packages/editor/src/frontend/components/editor-context.ts` — `ViewportFocus`, the seam's
  contract.
- `packages/editor/src/frontend/hooks/useViewportFocusReturn.ts` — the consumer half, which
  is already its own module.

---
