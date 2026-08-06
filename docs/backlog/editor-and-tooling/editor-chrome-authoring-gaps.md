# Editor chrome — authoring gaps and inspector defects

Tracker for the editor CHROME items: verbs the daemon exposes but the React surface does
not offer, inspector fields that mis-handle their schema type, and refresh guards that go
stale. Each is user-visible in the editor UI (or user-visibly ABSENT from it) and each was
deferred as out of scope for the task that surfaced it. Merged so there is **one place to
check whenever you touch `packages/editor/src/frontend/components/` or
`src/frontend/inspector/`**. Sections keep their original content.

> **State of this file after F4.5b (2026-08-01).** The refresh-guard section this file's
> preamble named ("An entity row's expanded params can show the PREVIOUS world's values
> after a load") was RESOLVED and removed at F4.5b Task 4 — verified: `sameParams` in
> `frontend/lib/field-host-mirrors.ts` compares the RENDERED projection of each param
> (`formatParam`, the same function the row's `<dl>` uses) and `sameEntities` calls it, so
> the class is closed rather than merely deleted. The EnumField section is resolved
> editor-side (F4.5b Task 11) and keeps its note for the CORE half.

> **Three sections REMOVED at foundations T2 (2026-08-05).** Entity add/delete/duplicate UI,
> `textures`+`effects` authoring, and the light-edit preview matrix were each marked "STALE,
> not resolved" at F4.5b: the CHROME they were measured against had been deleted, but their
> daemon/core facts still held, so the retire-or-re-target call was deferred. T2 deleted the
> other end — the `scene.*` command family, the mutation set and `@furnace/core/scene`
> itself — so `scene.addEntity` / `scene.removeEntity` / `scene.setResource` / `tableEnum` /
> `TABLE_ORDER` / `builtins.ts buildLight` no longer exist and the reproduction matrix names
> a "SCENE editor" that exists nowhere. A gap between two deleted things is not a gap. The
> field editor's own entity verbs (`FieldHost.deleteEntity` / `duplicateEntity`, F4.5b Task
> 4) are a different object model — generator entities — and any want there gets its own
> entry measured against that surface.

## EnumField stringifies enum members and never coerces back — numeric enums are dead on arrival

`EnumField` renders a JSON-Schema `enum` through a Radix `Select`, whose option values are
strings: it builds options as `(schema.enum ?? []).map(String)` and commits with
`onValueChange={(v) => onCommit(values.map(() => v))}`, where `v` is the option STRING.
Nothing downstream converts it back to the member's original type — `StampInspector`'s
`apply` is a bare `as Record<string, unknown>` boundary cast straight into the stamp
session's params, and from there into `evaluate`. Every sibling field parses its string
back to the schema's type before committing — `NumberField`, `VecField` and `QuatField`
via `Number(...)`, `ColorField` via `parseInt(h.slice(…), 16) / 255` — and the enum path
is the only one that does not.

Consequence: a schema property declared as `{ enum: [0, 90, 180, 270] }` round-trips out of
the inspector as the string `"90"`. A generator that validates its enum by identity against
the numeric members rejects it setup-loud, so the control is unusable in the very UI it
exists for — while every core test passes, because core never goes through the form.

This is why F3a's stamp `rotation` is spelled as a STRING enum
(`["0", "90", "180", "270"]`) in `packages/core/src/field/generators.ts` rather than the
numbers the geometry actually wants. The string spelling also keeps ONE spelling of the
value in persisted `GeneratorEntity.params` (and in `oplog.json`) instead of two — `90`
from an API caller, `"90"` from the form — which a later migration or equality check would
otherwise have to reconcile. That made string-vs-lenient-parser the right call at the time,
but it is a workaround living in core for an editor-side gap.

The fix is in `EnumField`: carry the schema's original member alongside its string label
and commit the member, not the label. That is a small change but it needs its own test, and
it touches a shared inspector primitive used by every enum in the editor (the hall's
`pillars`, the cave's `theme`, the stamp `rotation` below), so it wants a deliberate pass
rather than a drive-by.
Once it lands, `rotation` can become a numeric enum and the coercion note in the
`ROTATIONS` TSDoc can go.

**RESOLVED EDITOR-SIDE 2026-07-31 (F4.5b Task 11); the CORE half is still open.** The field
half shipped: `inspector/lib/enum-options.ts` carries each member beside its label and
transports it by INDEX, and both enum controls (`EnumField`'s Select and the new
`SegmentedField`) commit the member. `StampInspector` was deleted at Task 10; the boundary
cast now lives in `SessionCard.tsx` and is unchanged (it casts the params RECORD, not the
member).

*Coverage, corrected against the tests themselves (2026-08-01) — the sentence this replaces
said `enum-field.test.tsx` pins the COMMIT, and it does not.* That file pins the pure
mapping (`enumOptions` carries the member; `memberAt("1")` is the number `90` with
`typeof === "number"`; the transport is the INDEX so `[1, "1"]` stays distinguishable) and
`EnumField`'s DISPLAY binding. The end-to-end COMMIT is pinned through the other control —
`segmented-field.test.tsx`, "picking a segment COMMITS the schema member, not its label",
asserting `toBe(90)` and `typeof === "number"` after a real click — which consumes the same
`lib/enum-options.ts`. What stays uncovered, and is disclosed in the test file's own header:
`EnumField`'s wiring of `memberAt` into `onValueChange`, because a Radix `Select` item
cannot be clicked under happy-dom (probed — the portaled content never mounts). A
browser-driven gate is what closes that.

What has NOT changed is core: stamp `rotation` is still `["0", "90", "180", "270"]` and the
`ROTATIONS` TSDoc still records the dependency. That migration is a persisted-data change —
`GeneratorEntity.params` and every `oplog.json` on disk hold the string spelling — so it
needs a read-both-accept-one lenient parser or a migration, which is a deliberate pass and
was explicitly out of Task 11's scope.

**Trigger to revisit:** a core pass that is already touching generator param persistence, or
the next schema that wants a numeric enum in CORE (the editor no longer blocks one).

**Reference:** `packages/editor/src/frontend/inspector/lib/enum-options.ts` (the mapping),
`fields/EnumField.tsx` + `fields/SegmentedField.tsx` (both commit the member),
`packages/editor/tests/inspector/enum-field.test.tsx`, `packages/core/src/field/generators.ts`
(`ROTATIONS` TSDoc — the remaining half).

## The entities palette has no roving focus, and D-14 just made that expensive

**Context.** F4.5b Task 4 promoted `EntitiesList` from a reference read-out to the
LAYERS panel: every row now carries four verb buttons plus an expand button, and the Δ
badge makes six on a drifted row. Every one of them is an independent tab stop, so
reaching the last row of an N-entity world costs ~6N tabs, and a keyboard user cannot
move DOWN the list at all — Tab moves along a row, never across rows.

Every comparable surface solves this the same way and has for years: Blender's outliner,
Figma's layers panel and Photoshop's layers palette all use **roving `tabindex`** — the
list is ONE tab stop, arrow keys move the selection between rows, and the row's verbs are
reached with a second key (Right/Enter into the row, or a shortcut per verb). The ARIA
Authoring Practices `grid`/`treegrid` pattern is the written-down version.

It fits this palette unusually well because the selection state it would rove over
already exists and is already bidirectional: `subscribeEntitySelection` is the host's one
entity selection, a row click writes it, and a viewport pick pushes it back. Arrow-key
roving is that same write on a keyboard, which means the interaction model does not have
to be invented — only the focus management.

**Not built here** because it is a keyboard-interaction design pass, not a rider on a
verb task: it wants a decision about what Enter does on a row (expand? open?), what
happens to the expanded `<dl>`'s own focusables, and whether the palette becomes a
`treegrid` or stays a list of buttons — none of which this task had cause to settle.

**Trigger to revisit:** ~~Task 8's palette-layout pass (which decides what the controls
column opens on, and is where this palette's ergonomics get looked at as a whole), or~~
F4.5c if Task 8 stays layout-only.

**STANDS — the trigger fired and did not close it (checked 2026-08-01).** Task 8 shipped and
did build roving focus, but for the TOOL RAIL, not this palette: `shell/ToolRail.tsx` is a
`role="toolbar"` that moves a single tab stop with Arrow/Home/End and writes `tabIndex`
imperatively. `components/field/EntitiesList.tsx` was not touched — it contains no
`tabIndex` at all, so every row verb is still its own tab stop and the ~6N cost above is
unchanged. The rail is now the in-repo precedent to copy from, which is the one thing that
got cheaper. Trigger is F4.5c.

**CLOSED 2026-08-01 (F4.5c Task 9, D-26) — retire this section at the F4.5 seal.** The rail's
mechanism was extracted to `frontend/hooks/useRovingList.tsx` and the two-axis keyboard model
built on it as `useRowGrid`; `EntitiesList` is now a `role="grid"` with ONE tab stop (↑/↓
rows + host selection, → into the row's verb cluster, ← / Esc back, ⏎ = the row's own click),
and `FlagsPalette` and `HistoryPalette` run the same model. The module owns the MARKUP too
(`Grid` / `GridRow` / `GridCell`), because the stop selector is a claim about cell structure:
a row is identified by the `rowId` it declares, never by its position among the stops. The three questions this entry
said were unsettled are settled and recorded in code: Enter is the row's CLICK (so key and
mouse cannot drift); the expanded `<dl>` is its own `role="row"` holding one spanning cell,
so its focusables never sit inside a cell row; and the palette is a **grid**, not a
`treegrid` or a `listbox` — `useRowGrid`'s header carries the argument (a `listbox` option's
content must be text, so rows that carry buttons cannot be options).

Two rulings that go beyond what was asked, both stated where they live:
- **`LogPalette` deliberately got NO roving.** Its rows carry no controls, and making each a
  focusable option would turn a list a screen reader reads straight through into a widget
  the user must arrow through. What it actually lacked — a keyboard route to its own
  scrollbar, WCAG 2.1.1 — is fixed with one tab stop on the scroller.
- **Tooltips are vetoed on the ROW axis and only there** (`vetoTipDuringTravel` in
  `components/tips.tsx`). Radix opens a tooltip on FOCUS with no delay, so D-25's conversion
  would have popped a box on every arrow press; the veto rides Radix's own
  `composeEventHandlers` seam rather than a controlled `open`. Stepping a row's VERBS still
  opens each one — that axis is inspection, not travel.

**Reference:** `packages/editor/src/frontend/components/field/EntitiesList.tsx` (the row's
button cluster and the `RowVerb` wrapper each verb renders through);
`packages/editor/src/frontend/hooks/useFieldHostState.tsx` (`useFieldEntitySelection` —
the state arrow keys would move); ARIA Authoring Practices, the `grid` pattern's
roving-tabindex section.

---

## Folded in at the F4.5 seal (2026-08-03)

Four standalone entries about what the chrome SHOWS and how it reports, moved here for the
same reason as the field register's fold: this is where a chrome-surface gap belongs, and one
file per gap was costing findability rather than buying it. Content unchanged; each keeps its
own trigger.

## A buffered numeric input commits stale text when a push lands mid-edit

**Context.** `ExactNumberInput` (`packages/editor/src/frontend/inspector/fields/common.tsx`)
holds the user's TEXT in local state and commits it on blur — the buffered parse D-25 asks
for, and the reason clearing a bounded field never snaps it to 0. It has no way to learn
that the value underneath it was replaced while it was being typed into, so a blur commits
text the form has already superseded.

The sequence, reproduced this session (F4.5b Task 11's review round) while pinning the
re-seed fix:

1. Focus a bounded field and type an out-of-range value — say `99` on a `maximum: 24` param.
   `SchemaForm` refuses it: nothing is written, nothing previews, the row prints
   `must be at most 24`.
2. An external push arrives — a different entity's reconfigure, a ⚄ reroll, an undo, an SSE
   change. `SchemaForm` DEFERS the re-seed because an input has focus (the echo guard,
   `lib/echo-guard.ts`), which is correct: it must not clobber what the user is typing.
3. The user clicks away. React runs the form's `onBlurCapture` (capture phase, downward)
   BEFORE the input's own `onBlur` (bubble phase, upward), so:
   - the form re-seeds the drafts to the incoming values and drops the refusal, then
   - the input commits its buffered `"99"`, which is refused again.

**Observed end state: the input correctly displays the incoming `12` while the row still
prints `must be at most 24` — about text that is no longer anywhere on screen — and the
commit verb stays disabled naming a field that now holds a valid number.** That is the same
user-visible symptom as the re-seed bug fixed in Task 11, reached by a different mechanism,
which is why fixing that one did not close this.

**Why it was not fixed inline.** It fails two of the four inline-fix conditions: it needs a
design decision, and the decision changes a shared primitive's contract. The candidate
shapes, none obviously right:

(a) **Move the form's deferred re-seed from `onBlurCapture` to the bubble phase**, so the
input finishes its business first and the re-seed wins. One line, but it reorders the echo
guard against every field renderer, and a *valid* blur commit would then be immediately
overwritten by the re-seed it currently precedes — trading this bug for a lost edit.
(b) **Give `ExactNumberInput` a "my value was superseded" signal.** Honest, but it needs a
discriminator the component does not have: the incoming `value` changes on every preview the
component itself fires, so "the prop moved while I was focused" is true during normal typing.
(c) **Let the refusal channel carry the decision** — a field whose refusal is dropped by a
re-seed also has its buffer reset. Puts the form in charge of a child's local state.

**Scope note.** Only the DEFERRED path is affected. The common case — no focus in the form
when the push lands — takes the render-phase re-seed and is fixed and pinned
(`tests/inspector/schema-form-validation.test.tsx`, "an external RE-SEED clears a standing
refusal", sabotage-proven red in both re-seed branches). Reaching this one needs a push to
arrive while the user is mid-edit in a field holding an *invalid* value.

**Trigger to revisit:** the first browser-driven gate that exercises the session card while
an external change lands (an SSE reload, a second client, an undo bound to a key while a
field has focus), or any task that touches `ExactNumberInput`'s blur contract or
`SchemaForm`'s echo guard.

**Reference:** `packages/editor/src/frontend/inspector/fields/common.tsx`
(`ExactNumberInput`'s `onBlur`), `packages/editor/src/frontend/inspector/SchemaForm.tsx`
(`reseed`, and the `onBlurCapture` branch that calls it),
`packages/editor/src/frontend/inspector/lib/echo-guard.ts`,
`packages/editor/tests/inspector/schema-form-validation.test.tsx` (the note above the
deferral case records why that test moves focus to a sibling rather than blurring).

---

## `useCatalogs` carries a second, narrower severity vocabulary

`NotifySeverity` (`lib/notify-store.ts:21`) is the editor's severity type:
`"info" | "success" | "warn" | "error"`, and every toast and log entry is one of those four.

`hooks/useCatalogs.tsx:83` declares a second one:

```ts
type Report = { severity: "info" | "error"; text: string };
```

with its own constructors (`info`, `bad`) and its own dispatch (`post`, an
error-else-info branch onto `notify`). It is a real design choice rather than an accident —
the three catalog loaders run concurrently and the ORDER their outcomes are said in is the
caller's decision, so an outcome has to be CARRIED rather than posted, and carrying it needs
a type. The comment above it says exactly that.

What makes it worth tracking is that it is **a second producer writing the same log through
a narrower alphabet**, and its `post` is a hand-written two-way branch over a four-member
union. The day a catalog outcome wants `warn` — a partial catalog, a stale table, an entity
archetype that resolved but is unusable — the branch silently downgrades it to `info`,
because that is what `else` means here.

### Context

This is the likely home of the "second caller" that `notify-severity-has-no-warn-member.md`
anticipated before it was retired. F4.5c Task 1 added `warn` to `NotifySeverity` and rerouted
the advisor-idle message onto it; that entry was deleted as resolved, and this datum went
with it. It lives here now so the deletion did not lose it.

The fix when it is needed is small and reductive: carry `NotifySeverity` in `Report` and
make `post` a lookup rather than a branch (`notify[report.severity](report.text)` — the store
already exposes one method per member). Not done now because at two members the branch is
correct, and widening a type nothing widens is speculative surface.

### Trigger to revisit

Any `useCatalogs` report that wants `warn` (or `success`) — at that moment the two
vocabularies must merge rather than the narrow one grow a third member. A third private
`severity` union appearing anywhere in `src/frontend` is the same signal.

### Reference

- `packages/editor/src/frontend/hooks/useCatalogs.tsx:81-89` — the `Report` type, its two
  constructors, and `post`.
- `packages/editor/src/frontend/lib/notify-store.ts:21` — `NotifySeverity`, and the store's
  per-severity methods a lookup would use.

---

## The long-job readout has a third job it cannot show, and a stats shape that will need grouping

F4.5c Task 4 gave the status bar a long-job chip (D-19): `longJobs()` in
`shell/StatusBar.tsx` derives a LIST from the world job (`bake…`, `save…`) and
`FieldStats.voidCastPending`, so two simultaneous jobs both show. Two things about that are
unfinished, and they are the same event away from each other.

### `applyReconfigure` is a third long job and cannot render a chip at all

`FieldHost.applyReconfigure` blocks the main thread — its own TSDoc §COST records **~310 ms
at 2137 ops** (core's P-F3-2 bench, JSC), "a visible freeze on Enter, with no progress
signal". The stall grows with the LOG, not with the edit: the host passes no snapshot
records, so core replays every op below the entity's span into a scratch store first. Same
synchronous shape as the bake, and worse for this chip: nothing paints during it, so a chip
set before the call would not appear until after the freeze it was meant to explain.

That makes it a different problem from the other two rather than a missing wiring, and the
TSDoc already names the lever — `captureDueSnapshots` exists in core and is unwired here, so
shrinking the stall is available before surfacing it is. Filed rather than patched because
the alternatives (wire records; yield a frame before the work, which changes reconfigure's
timing contract; or accept the freeze and say so in the copy leading up to it) are a choice,
not a fix.

Recorded so the seal does not pretend the progress story is general: it covers the two jobs
that CAN report, and names the one that cannot.

### `FieldStats` at a third boolean wants a `jobs: {}` sub-object

`FieldStats` carries one job flag today (`voidCastPending`) beside eight numbers. It rides
the stats push deliberately — a seam is public surface on `FieldHost` and a context in the
chrome's one subscription point, and this fact has no consumer that does not already read
stats — and that reasoning holds for a second and third flag too. (The original wording gave
the reason as "the seams are single-slot". Foundations T3a made every seam multicast, which
retired the slot-steal hazard but not the surface cost; the argument was always the surface.)
What
does NOT hold at three is the flat shape: `voidCastPending`, `<x>Pending`, `<y>Pending` as
siblings of `chunks` and `undoDepth` reads as a bag.

The change when it comes is `jobs: { voidCast: boolean; … }` — still ONE push, still no new
seam, and `statsEqual` (`lib/field-host-mirrors.ts:33`) grows one level rather than one
comparison. **A trigger, not a change**: doing it at one flag would be inventing structure
for a single member.

### Trigger to revisit

A third boolean arriving on `FieldStats` (do the grouping in that same commit), or a user
reporting the reconfigure freeze as a hang — whichever is first. The two are likely the same
commit if the reconfigure answer turns out to be "post progress from somewhere".

### Reference

- `packages/editor/src/frontend/components/shell/StatusBar.tsx:486-501` — `longJobs`, the
  one derivation feeding both the chips and the `aria-live` announcement.
- `packages/editor/src/viewport-host/field-host.ts` — `FieldStats` (`:331`) and
  `applyReconfigure`'s TSDoc §COST (`:870-878`), which carries the measurement and names
  `captureDueSnapshots` as the lever that exists and is unwired.
- `packages/editor/src/frontend/lib/field-host-mirrors.ts:33` — `statsEqual`, the
  never-check that a regrouping has to move with.

---

## The void cast's progress chip is indeterminate, and could be determinate

The long-job chip (D-19, F4.5c Task 4) shows `void cast…` while
`FieldStats.voidCastPending` is true and says nothing about how far along it is. Determinate
progress is AVAILABLE — it was costed and declined, not overlooked.

Both halves already exist, and `requestVoidCast`'s own comment says so:

- **The worker can post mid-handler**, and posting does not block — the void-cast handler in
  `frontend/lib/field-protocol.ts` loops over `store.chunks` extracting aprons, so a
  per-chunk progress message has an obvious home.
- **The total is `store.chunks.size`**, which `requestVoidCast` reads two lines below the
  comment declining the feature.

### Context

Declined on the DURATION: measured at the ceiling (bun/JSC, 512 dug chunks, one cast) the
job is ~1.3 s of worker time, and `VOID_CAST_CHUNK_BUDGET` caps it there precisely so it
cannot grow without bound. An indeterminate chip is honest for 1.3 s; a determinate one at
that length reads as ceremony — the bar finishes before it has said anything the user acted
on.

The rationale lives in source; what lives ONLY here is the trigger, which is the part a
source comment cannot carry.

The cost is not the arithmetic. It is a new worker→host progress message on the protocol,
plus a new `FieldHost.subscribe*` seam for the host to publish it on — and the host's seams
are deliberately **few**: each one is public surface on the `FieldHost` type and another
context in the chrome's single subscription point. That is real surface for a 1.3 s job.

**The stated reason changed at foundations T3a, the conclusion did not.** The seams were
"deliberately single-slot and deliberately few" when this was filed; T3a made all thirteen
multicast (`viewport-host/view-channel.ts`, `editor-architecture.md` §20). A fourteenth is
therefore cheaper to *implement* than it was — the primitive exists and a seam is now three
lines — but the deferral never rested on the implementation. It rests on the surface, and
that is unchanged.

### Trigger to revisit

The chunk ceiling rising above 512, or any cast observed exceeding ~3 s at a gate. Either
makes the chip's silence the user's problem rather than a design choice. If the seam is
built, check first whether `applyReconfigure` wants the same one
(`long-job-readout-cannot-see-the-third-job.md`) — one progress seam serving both is a
different design than two.

### Reference

- `packages/editor/src/frontend/lib/field-protocol.ts` — the void-cast handler's per-chunk
  loop, where a progress post would go.
- `packages/editor/src/viewport-host/field-host.ts` — `requestVoidCast` and the comment
  above it declining this; `VOID_CAST_CHUNK_BUDGET` (`:1364-1374`) and its measurement; and
  `FieldStats.voidCastPending`'s TSDoc, which explains why the pending FLAG rides the stats
  push instead of taking a seam of its own.
- `packages/editor/src/frontend/components/shell/StatusBar.tsx` — `longJobs`, the consumer.

---
