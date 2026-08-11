# Chrome legibility gaps

Tracker for the places where the editor chrome **knows something the user cannot see**.
Each section is one previously standalone entry, keeping its Context, *Trigger to revisit*
and *Reference* as written.

They are merged because they are four instances of one failure, not four features: state
that is live but invisible (a running session whose card is scrolled out of view), a refusal
whose reason is withheld (a greyed command-palette row), a control that is permanently inert
and says nothing about why (the brush controls with no engine), and no answer anywhere to
"what do I do here" (no usage or onboarding surface beyond the shortcuts overlay). In every
one, the chrome has the information and does not show it — so they are decided the same way,
and reading them together is how you notice they want one legibility pass rather than four
patches.

Distinct from `editor-chrome-authoring-gaps.md`, which tracks chrome that is *wrong*
(a component that throws, a field that mis-handles its schema type). Nothing here is
incorrect; it is correct and mute.

## A live session can run with its card invisible — and nothing says so

Found at the T3c gate (2026-08-07, Safari): a stamp was armed, the region drawn, and the
missing session card read as "stamps no longer show the configuration dialog." The
session was live and committable the whole time — the strip carried the ⏎ affordance —
and the card was simply not on screen. **Not a T3c regression**: the tranche's chrome
diff (`9b8d6837..HEAD`) touches none of the palette, presence or session-card machinery,
and the `subscribeStamp` seam publishes correctly at head.

### Context

Two documented ways the card can be off while a session stands, both by design:

- **The ×-close latch.** `SessionCardPresence` re-opens the card only on a SUBJECT
  change (`subject === shown.current` returns early), and `palette-store.ts`'s header
  names the hole on purpose: "the card's × closes it and the driver will not re-open it
  for the same subject — without the menu item that close is a latch with no exit."
- **Hide-all.** The palette layer's `hidden` (⌘\) masks every palette regardless of
  `open`, so a driven open lands on a hidden layer with no visible effect.

With the card off, a session runs headless end to end: sizes seed from the drawn region
(D-F3-13), the seed is random, ⏎ commits from the canvas. That is coherent D-13 design —
the card is a properties surface, not a modal gate — and it is also exactly what read as
a bug to the person the surface exists for. The finding is the missing CUE, not the
capability: nothing on screen distinguishes "no session" from "a live session whose card
is hidden."

Shapes a design pass should weigh (none taken now, they pull different ways): a
session-strip affordance that names and opens the hidden card; letting a NEW session's
driven open break through hide-all for `drivenOpen` palettes specifically; a first-run
style cue the first time a session opens while its card is off. Whether the ×-latch
scope (same-subject) is itself right is a separate, smaller question.

### Trigger to revisit

- The next chrome/UX polish pass that opens the palette layer, the session card, or the
  session strip.
- A second report of the same misread — one gate hit is signal, two is a defect.

### Reference

- `packages/editor/src/frontend/components/shell/SessionCard.tsx` —
  `SessionCardPresence`, the subject latch (`shown` ref).
- `packages/editor/src/frontend/lib/palette-store.ts` — the header's "latch with no
  exit" paragraph; `drivenOpen`'s meaning.
- `packages/editor/src/frontend/components/shell/PaletteLayer.tsx` — the layer-level
  `hidden`.

## A refused command-palette row does not SHOW why it is refused

`PaletteRow` renders a label and, when there is one, a keycap. The refusal REASON reaches
the accessible name (`aria-label={rowName(row)}`) and nowhere else — so a screen-reader user
hears it and a sighted mouse user sees a greyed row with no explanation. cmdk enforces the
refusal structurally (`disabled` registers no select listener, takes no click, and is skipped
by the arrows), which is right for the mechanism and is also why the chrome's usual answer
does not apply: there is no click for `ReasonTip`'s wrapper span to catch, so
`notify.sayRefusal` never fires here.

That leaves the palette as the ONE surface in the chrome where "every refusal visible +
explained" holds for the keyboard and not for the eye.

### Context

Surfaced in the F4.5c fix round and deliberately not decided there. Covering it is a LAYOUT
change to the row, and there are at least three shapes with different costs:

- **a third column**, right-aligned, carrying the reason where the keycap sits — cheapest,
  but a refused row's reason and an available row's chord then occupy the same slot, and a
  reason is a sentence where a chord is two glyphs.
- **a second line** under the label for refused rows only — reads well, but rows stop being
  uniform height, which matters in a list the arrows travel.
- **a hover/focus tip on the row** — matches the rest of the chrome, but a `disabled` cmdk
  item takes no pointer events, so it needs the same wrapper-span trick `ReasonTip` uses and
  the palette's own keyboard traversal already suppresses tips on row travel (the veto in
  `components/ui/tips.tsx`).

None is obviously right, which is why it is a design decision rather than a fix. Worth noting
the palette is deliberately a VIEW over the registry — every label, keycap and verdict comes
from `lib/actions.ts` — so whatever shape wins must not introduce a second place that decides
what a refusal says.

### Trigger to revisit

**The next design pass on the palette** — or the first time a user asks why a row is greyed.
Take it with the "row" question generally: the same three shapes apply to the burger's menu
items, which have the identical asymmetry.

### Reference

- `packages/editor/src/frontend/components/shell/CommandPalette.tsx` — `PaletteRow`, `rowName`,
  and the header's list of what the mock has that this does not.
- `packages/editor/src/frontend/components/ui/tips.tsx` — `ReasonTip`, the wrapper-span mechanism,
  and `vetoTipDuringTravel`.
- `packages/editor/src/frontend/lib/actions.ts` — `controlVerdict`, the one place a refusal's
  sentence is decided.
- `docs/reference/editor-architecture.md` §18.4 (the refusal rule), §18.5 (the palette as a view).

## The brush controls are permanently inert with no engine, and say nothing about it

In the `no-webgpu` and `engine-error` states the editor still renders its whole chrome —
`App.tsx` renders `<Shell />` unconditionally — but `status` never reaches `ready` and
`fieldHostRef.current` is never assigned. The tool rail and the top strip therefore render
fully interactive and absorb every click in silence.

### Context

Foundations T3b2 Task 6 made this visible rather than causing it. Before it, the chrome held
`tool` and `radius` in provider cells, so a click MOVED the strip while `host?.setTool`
no-opped — a control that looked alive over a host that did not exist. The tool seam's
conversion removed the cell, so the strip now shows the truth (nothing armed, nothing
changing). That is the right ANSWER and the wrong PRESENTATION: a permanently dead control
should say it is dead rather than swallow presses.

The same window exists during a normal boot, for the length of the engine-bundle load. That
one is short enough to accept and is documented as a delta
(`docs/reference/editor-architecture.md` §22.8). This entry is only about the states the
window never closes in.

### What it is not

Not the tool seam's problem. The seam is a state mirror over a host, and with no host there
is no state to mirror. Whatever is done here belongs to the SURFACES — the rail, the strip,
and whatever the status bar already says about the failure — and it is a presentation
decision (disable? explain? a single banner?) that should be made once for every host-backed
control at the same time, not one control at a time.

### Trigger to revisit

Either of:

- the next pass over the editor's failure/empty states, or anything that touches what the
  status bar says about `no-webgpu` / `engine-error`;
- a report of someone clicking brush controls on a machine without WebGPU and not
  understanding why nothing happens.

### Reference

- `packages/editor/src/frontend/components/App.tsx` (the unconditional `<Shell />`, the two
  failure dispatches)
- `packages/editor/src/frontend/hooks/useFieldHostState.tsx` (`FieldShell.host`'s docblock,
  which states the superseded "a control that silently did nothing … is a dead control"
  principle and what replaced it)
- `docs/reference/editor-architecture.md` §22.8, delta 2

## A usage / onboarding surface, beyond the shortcuts overlay

The editor can now tell you what every KEY does. It cannot tell you what to DO. There is no
surface that answers "I have just opened this — what is the loop?", and the user asked for
one at the F4.5 holistic gate.

The shortcuts overlay (`?`, or Help ▸ Keyboard shortcuts) renders the action registry, so it
is complete and cannot go stale — but it is a reference, organised by binding, and a
reference is the wrong shape for a first session. The command palette (⌘K) is random access
by name, which needs you to already know the name. Between them there is nothing that says:
dig with the brush, stamp a room, scatter props, read the flags, save-as, make default, bake,
walk it.

### Context

Requested by the user at the gate and deliberately not built in the fix round: the `?`
binding landed there and partially serves the ask, and a usage surface is a content
problem with a design decision in front of it, not a mechanism gap. Three shapes are
plausible and they are not equivalent:

- **a static help panel** — one authored page, cheapest, and the one that goes stale, since
  nothing checks prose against the app.
- **a first-run tour** — highest cost, most likely to annoy on the second run, and it needs a
  dismissal-persistence decision (the workspace blob is where it would live).
- **contextual empty states** — the entities palette on a world with no entities, the flags
  palette before the advisor has run, the canvas on an untitled world. This is the one that
  cannot go stale, because each surface teaches only its own next step, and the F4.5c "first-run
  hint" on the world name is the precedent already in the build.

Worth noting what the editor already does say, so a new surface does not duplicate it: every
refusal states its reason on press (`notify.sayRefusal`), the status bar's keymap line names
the four keys that matter in the armed mode, and every available control's tooltip carries its
own chord from the registry.

### Trigger to revisit

**A second person uses the editor**, or the user asks again after living with `?` for a
while. Until then the audience is one developer who built it, which is the worst possible
population to design onboarding against.

### Reference

- `packages/editor/src/frontend/components/shell/ShortcutsDialog.tsx` — the reference surface
  that exists; `shell/CommandPalette.tsx` — the by-name route.
- `packages/editor/src/frontend/lib/actions.ts` — every action's one-sentence `hint`, which is
  authored content a usage surface could reuse rather than re-write.
- `docs/reference/editor-architecture.md` §18.5 (the palette and the overlay), §18.4 (what the
  chrome already says at the point of refusal).
- `packages/editor/PRODUCT.md` — "capability per pixel"; a permanent help surface has to earn
  its space against that.
