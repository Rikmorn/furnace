---
summary: The vocabulary every chrome surface is written in — the colour and type tokens with their contrast ledger, the one control library, the roving grid, and the tooltip/refusal pair.
verified: 2026-08-18
---

# The design system

The rules the chrome's surfaces are spoken in. Where [chrome](chrome.md) says what the
surfaces ARE and [tools](tools.md) what the verbs DO, this file is what both are written with:
the tokens, the one control library, the keyboard model for a grid of controls, and how a
refused control says so.

## The tokens, and the ledger that pins them (D-23)

The tokens are the `@theme` block in `packages/editor/src/frontend/styles.css`, every one
argued at its own declaration. `packages/editor/tests/design-tokens.test.ts` is the **ledger**
— it computes contrast from the declared oklch values and asserts each pair, so a token nudged
by eye reddens rather than shipping.

- **Disabled DROPS HUE and keeps the shape.** A refused control dims rather than recolouring,
  so "cannot run now" never competes with the destructive lane for the same glance.
- **Hover LIGHTENS.** `--primary-hover` is `--primary` +0.05 L; `--destructive-hover` is +0.03
  — a smaller step, because the destructive fill sits in a four-walled box: its near-white
  foreground loses contrast as the fill lightens while `border-destructive` is held to 3:1
  against `--popover` from below. Both walls are asserted.
- **Destructive is a FILL colour and never a text colour.** `--destructive` reads **3.26:1** as
  text on `--card`, under the 4.5:1 floor, which is what `--destructive-text` exists for; that
  one is pinned on `--accent` (the hover surface) at **4.86:1**, the tightest of its three
  ledger pairs.
- **ONE neutral focus ring, and focus ≠ selection BY RULE.** `--ring` is its own literal at
  **0.96 L**, never an alias of `--primary` — an alias paints a `bg-primary` control's focus
  ring the colour the control already is. The value is arithmetic rather than taste: against
  `--primary` the 3:1 non-text floor is crossed at L 0.93904, so the ring needs ≥ 0.9391, and
  0.96 clears it at **3.19:1**. **One pair is arithmetically impossible and is recorded rather
  than fixed** — a ring on `--primary-hover` would need luminance 1.019 where pure white is
  1.0, and the dark direction closes first. The impossibility itself is asserted in the ledger.
- **Label casing documents the as-built**: lowercase for chrome (headings, group labels, param
  captions), Sentence case for anything naming a THING (menu items, options, action labels).
  `packages/editor/src/frontend/lib/humanize.ts` is untouched by that rule.
- **The type scale carries a micro tier**, `--text-2xs` at 0.625 rem, and it deliberately
  declares **no paired line-height**. The `text-[10px]` sites it replaced never set leading, so
  pairing one would change the HEIGHT of every migrated row — and nothing in this chrome may
  move the viewport ([chrome](chrome.md)'s layout contract). Leading stays each caller's own.
- **One label column**, `--spacing-label-col` at 5 rem. Without it a caption puts its value
  column wherever its own text ends, so two rows of one form start their controls at different
  x. It is `--spacing-*` rather than `--width-*` because that yields `basis-` / `min-w-` / `pl-`
  as well as the `w-label-col` the captions use, so an adopting surface needing a grid track
  does not add a second declaration. The at-rule it emits is checked, not just the value —
  `packages/editor/tests/chrome/label-column.test.tsx`.
- **The motion budget is state feedback only** — 150–250 ms, ease-out, no choreography, every
  duration zeroed by the `prefers-reduced-motion` block, which wins with `!important`. The one
  deliberate exception is the promotion pop on the session card ([inspector](inspector.md)),
  which exists because a REST card silently becoming a live session is a state change with no
  other signal.

## One control library, enforced at authoring time (D-24)

The chrome has ONE control library and it lives in
`packages/editor/src/frontend/components/ui/`. A raw `<input type="checkbox">`, a raw
`<input type="radio">` and a raw `<select>` are **errors** everywhere else under
`packages/editor/src/frontend/` — enforced by a Biome GritQL plugin,
`packages/editor/scripts/one-control-library.grit`, registered from the repo's single
`biome.json`.

Three things about that registration are load-bearing and were measured rather than assumed:

- the `plugins` config value must be the **plain string** form. The object form is not a config
  error at the pinned Biome — it is silently IGNORED, the plugin never loads, and the resulting
  zero diagnostics read exactly like successful scoping.
- **scoping is the plugin's own job**, via `$filename` (the ABSOLUTE path; Grit regexes are
  anchored full-match, hence the leading `.*`). `overrides[].plugins` is additive and cannot
  switch a plugin off.
- what it **cannot see** is stated at the source: the type has to be an authored string
  literal, so `<input type={"checkbox"} />` does not match. Verified against a fixture, so the
  residue is known rather than assumed.

**Four native `<select>`s survive, allowlisted by file AND accessible name**, and the exemption
is EVIDENCE rather than a deferral. Radix's `DismissableLayer` claims Escape on a capture-phase
document listener and `preventDefault()`s without `stopPropagation()`, while the window key
dispatcher never consults `defaultPrevented`. What holds the line for a native control is
`isTextInputTarget` recognising an `HTMLSelectElement`, which it cannot do for the `<button>` a
Radix trigger is — so migrating one would let the Esc that dismisses its popup run the cancel
ladder and discard a live session ([interaction](interaction.md)).
`packages/editor/tests/chrome/native-select-key-gate.test.tsx` walks all four sites and asserts
it per site, keyed on the same accessible names the rule allowlists, so migrating any one of
them reddens the suite as well as tripping the rule.

A second hazard found in the same read is recorded at
`packages/editor/src/frontend/components/field/form-bits.tsx` for whoever tries again:
`SelectTrigger`'s `onKeyDown` runs typeahead on ANY single-character keydown without stopping
propagation, so on the always-on tool strip every bare tool key would BOTH run its verb and
change the control. `range` and `color` are deliberately absent from the ban — a slider is the
inspector's territory and neither has a house primitive to migrate to.

## The keyboard-reachable grid (D-26)

`packages/editor/src/frontend/hooks/useRovingList.tsx` owns ONE tab stop for a set of controls,
walked with the arrows (the APG roving tabindex). It has four consumers — the tool rail plus
the entities / flags / history row grids — and it also owns the MARKUP those grids produce
(`Grid` / `GridRow` / `GridCell`).

It owns **no keys**: every consumer claims a different set, and a hook that guessed would
swallow one its caller needed. Five details are load-bearing:

1. **the stop is written in a layout effect**, never passed as a `tabIndex` prop — a prop
   changes on every focus move and defeats the memo on whatever renders the row. The effect
   carries NO dependency array, because the control list's LENGTH is data.
2. **clamped on shrink** — ⌘Z undoes a commit, a delete removes a row. Without the clamp the
   stop stays past the end, no control carries `tabindex="0"`, and the whole list falls out of
   the tab order with nothing thrown.
3. **the caller prevents default only for keys it claimed** — the arrows are also the
   stamp-region nudge and Esc is the app's one cancel ladder.
4. the ref is a **callback**, because the container can be mounted by an ancestor (a
   collapsible section opening) without the hook's component re-rendering.
5. a traversal **raises a flag** that the tooltip vocabulary below reads.

Two lists are deliberately NOT consumers, and both are rulings. The log palette has no controls
on its rows at all, so roving would turn a list a screen reader reads straight through into a
widget the user must arrow through; the world drawer is the OTHER APG model
(`aria-activedescendant`, DOM focus never leaving the filter field — [world](world.md)). The two
models are not interchangeable and must not be mixed on one surface.

## Tooltips, keycaps, and the refusal rule

`packages/editor/src/frontend/components/ui/tips.tsx` is the chrome's tooltip vocabulary and
the most widely imported UI primitive in it. It lives inside the control library because
`ui/segmented.tsx` needs `ActionTip` for its `hint` prop, and that one import was the only edge
reaching out of the library into app chrome — which D-24's scope claim (this directory is the
one place a raw control may be written) depends on not existing.

**What that bought, stated precisely, because it is less than "`ui/` is now a leaf".** The move
relocated the trio's edges into the library rather than removing them: `tips.tsx` has four
outward edges (the roving hook, the actions module, the notify store, the class helper) where
every other file under `ui/` has exactly one, so the directory's transitive closure is
unchanged. What it removed is the edge pointing at `components/` — the one a reader follows
when asking whether the control library may be depended on. No cycle exists: the notify store
imports nothing, the roving hook imports only React, and the actions module's edges back into
`components/` and `hooks/` are all `import type`. **The edge to watch** is the actions module's
one value import into `ui/`; a future value import there reaching anything under `ui/` is what
would close the loop.

The wrappers are a **PAIR**, and which one a control gets is decided by ONE fact — can the user
reach it?

- an AVAILABLE control gets **`ActionTip`**: a real Radix tooltip that opens on focus as well
  as hover and carries the registry's own keycap ([action-registry](action-registry.md)), so
  the cap on a tip and the key that runs the verb are the same string.
- a REFUSED one gets **`ReasonTip`**, because a `disabled` button takes neither pointer events
  nor focus and no tooltip has a channel to it. Its reason rides a wrapper span for the mouse
  and the accessible NAME for everyone else.

Nothing carries both, and nothing that carries either may also carry a `title` —
`packages/editor/tests/frontend-no-doc-titles.test.ts` enforces that with a named allowlist.

**A refused control STATES ITS REASON when pressed.** One mechanism, `notify.sayRefusal`, with
three call sites (the `ReasonTip` span, the roving rail button, the key dispatcher). A hover
tooltip is opt-in and costs both a wait and knowing there is something to wait for; a press
that does nothing whatsoever is the "every refusal visible and explained" bar failing on the
one gesture that matters. The rules live in the store rather than at the sites, because three
copies is how they come to disagree about a sentence the gate went to the trouble of making
one:

- **`reason: null` / `undefined` / `""` posts NOTHING.** The enabled case is silent
  STRUCTURALLY rather than by luck — an available control passes no reason, its click bubbles
  through the span, and `sayRefusal(undefined)` is a no-op. The invariant every caller honours
  is that a reason is present only while the wrapped control is refused.
- **the same sentence does not stack while it is still on screen.** Keyed on what is VISIBLE,
  not on what has ever been said: once the toast has gone, asking again says it again, because
  a user who comes back and presses the same button must not get silence.

**A tooltip is kept shut while a roving traversal moves focus past its trigger**, per axis:
travelling the ROWS of a list is navigation (every row's tip says the same sentence, so the box
is noise) while stepping the VERBS of one row is inspection (each sentence is the answer being
looked for). The mechanism is Radix's own veto — `composeEventHandlers` skips Radix's handler
when the consumer's came back `defaultPrevented` — so one `onFocus` on the trigger is the whole
fix, with no controlled `open`.

Sabotaging that fix found the second reason it has to exist: an open tooltip mounts a
`DismissableLayer` whose capture-phase document listener `preventDefault()`s Escape, so a tip
left open by arrow travel makes the next Esc dismiss the tip AND run the cancel ladder —
exactly what interaction's one-thing-at-a-time contract exists to prevent. That class is closed
on the row axis only; on the cell axis, where tips deliberately open, it is **accepted, not
absent**, and reads as nesting.

## The command palette, and the two doors it makes affordable

`packages/editor/src/frontend/components/shell/CommandPalette.tsx` (⌘K) is the registry reader
that renders the WHOLE table at once. It is a **VIEW, not a surface with verbs of its own**:
every label is the descriptor's own `label(ctx)`, every keycap its binding, every refusal the
same `controlVerdict` a button would get — so a row cannot say something the burger, the rail
or the keyboard would not.

Its own chord is read off the table it renders through `byId`, which **THROWS** at module init:
a renamed action must fail the import rather than render an empty `<kbd>` nobody notices. It is
a **dialog**, not a floating palette — no palette id, nothing persists it, ⌘\ does not hide it,
and it is gone the moment it has done its one job.

**It is never refused**, because the one state in which it would be useless is one where
nothing at all can run — and in that state a palette showing every verb greyed with its reason
is the most useful screen in the editor.

The palette is also what makes **menu depth affordable**: the burger's three registry groups
are submenus precisely because ⌘K reaches every verb in them by name
([chrome](chrome.md) carries the menu's shape and its fold arithmetic).

**`?` opens the shortcut overlay** through the same `typed` gate as every other bare key, so it
is refused while the user is typing and nowhere else. Its matcher is the one in the binding
table that states a CHARACTER rather than a modifier + key — `?` is ⇧/ on a US layout and ⇧ß on
a German one — with AltGr layouts the known residue, filed at
`docs/backlog/editor-and-tooling/question-key-unreachable-on-altgr-layouts.md`.

**`view.frameWorld` has NO keycap, deliberately.** `F` is the selection frame and ⇧F would
collide with the tool rail's own modifier, so this verb is menu- and palette-only. It fits the
camera to the allocated chunks' AABB with its top lowered to the occupied top whenever that
answers — a chunk is 16 samples tall, so a world whose only rock sits at the bottom of a column
still allocates the whole column, and framing the chunk box would fit the camera to padding.
The chrome's Open runs it automatically unless `FieldHost.cameraAimedByHand()`, which is a
**LATCH rather than a pose comparison**: comparing floats against the boot literal would answer
"yes" for a user who orbited and happened to land back on it. `frameWorld` deliberately does
not set the latch, or one Open would suppress the next one's frame, and `loadWorld` frames
nothing at all — it is a data primitive and every headless suite's fixture loader.
