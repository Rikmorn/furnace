# Editor chrome — authoring gaps and inspector defects

Tracker for the editor CHROME items: verbs the daemon exposes but the React surface does
not offer, inspector fields that mis-handle their schema type, and refresh guards that go
stale. Each is user-visible in the editor UI (or user-visibly ABSENT from it) and each was
deferred as out of scope for the task that surfaced it. Merged so there is **one place to
check whenever you touch `packages/editor/src/frontend/components/` or
`src/frontend/inspector/`**. Sections keep their original content.

> **State of this file after F4.5b (2026-08-01).** The refresh-guard section this file's
> preamble names ("An entity row's expanded params can show the PREVIOUS world's values
> after a load") was RESOLVED and removed at F4.5b Task 4 — verified: `sameParams` in
> `frontend/lib/field-host-mirrors.ts` compares the RENDERED projection of each param
> (`formatParam`, the same function the row's `<dl>` uses) and `sameEntities` calls it, so
> the class is closed rather than merely deleted. The EnumField section is resolved
> editor-side (F4.5b Task 11) and keeps its note for the CORE half. Three sections —
> entity add/delete/duplicate, textures+effects authoring, light-edit preview — are STALE
> rather than resolved: their daemon/core facts still hold, but the chrome they were
> measured against was deleted at F4.5a. Each says so in place; retiring them is a seal
> decision, not a doc-pass one.

## Entity add / delete / duplicate UI in the editor chrome

The daemon exposes `scene.addEntity` / `scene.removeEntity` (editor-architecture §4 command
table) with full validation + undo, but the **chrome has no UI for them**: the Entities panel
is select-only, `Del`/`⌫` on a selection does nothing, and there is no "add entity"
affordance. You can mutate components/resources/settings of EXISTING entities, but you cannot
create or remove entities without hand-editing the scene JSON.

Surfaced at the Slice 3.2 `/impeccable` gate (Alex persona: "Del on selection → nothing;
entity add/delete doesn't exist in the chrome"). Deferred there as out of scope for the
foundation pass, whose goal was chrome finish, not new authoring verbs.

**Scope when picked up:**
- Add affordance (a "+" in the Entities-panel header / a context action) → `scene.addEntity`
  (id optional/generated), then select the new entity.
- Delete via `Del`/`⌫` on the selection + a context action → `scene.removeEntity`, guarded by
  the in-chrome confirm; multi-select = one undo entry (matching the gizmo/batch precedent).
- Duplicate (add + copy components) is the natural third verb.
- Reference integrity: removing an entity other entities reference — the loader's
  resolve-or-throw validates at load, but the UI should warn before a dangling ref commits.

**Couples to** the Entities-panel IA (the 3.2 gate's top P2 — a filter/search box + a
scene/room `role="tree"` across 200+ cryptic IDs):
add/delete and findability are the same panel and likely one pass.

**Trigger to revisit:** when in-editor scene authoring (not just tuning existing entities) is
needed — the procedural-authoring editor pass (Slice 3.2.5 / the interaction-model redesign).

**Reference:** `packages/editor/src/daemon/handlers.ts` (`scene.addEntity`/`removeEntity`),
`packages/editor/src/frontend/components/EntitiesPanel.tsx`,
`docs/reference/editor-architecture.md` §4.2, sibling `scene-chrome-returns-as-consumer-surface.md`.

**Surface check 2026-08-01 (F4.5b Task 14) — STALE, not resolved.** The daemon half is
intact and still registered: `scene.addEntity` and `scene.removeEntity` are in
`daemon/handlers.ts`. The CHROME half named above is not — `components/EntitiesPanel.tsx`
was deleted with the whole scene-editing surface at F4.5a, and the editor is field-only
today, so the Reference line above points at a file that no longer exists. Nothing here was
fixed; the surface the gap was measured against went away. Note also that the FIELD editor
now has its own entity verbs (`FieldHost.deleteEntity` / `duplicateEntity`, F4.5b Task 4,
D-14), which is a different object model — generator entities, not scene entities — so it
does not discharge this. Whether this entry retires or re-targets is a call for the F4.5
seal, not for a doc pass.

## Editor authoring of the `textures` + `effects` resource tables

The core scene format now has five resource tables — `geometries, textures, shaders, materials, effects` (`packages/core/src/scene/t.ts` `TABLE_ORDER`). The editor can **load, validate, render, and reflect** all five: a scene using textures/effects opens fine, renders in the viewport (lights/ambient; post deferred — see the *Editor viewport HDR context + post-chain preview* section of `editor-seams-and-preview-deferrals.md`), and the inspector's resources panel lists texture/effect resources with their fields.

But the editor's **command layer cannot mutate** the two new tables. `scene.setResource` and `scene.removeResource` (`packages/editor/src/daemon/handlers.ts:154`, `:175`) gate their `table` arg on:

```ts
// handlers.ts:23
const tableEnum = z.enum(["geometries", "shaders", "materials"]);
```

So a command targeting `table: "textures"` or `table: "effects"` is rejected before it reaches `mutations.setResource`. Consequence: you can author a textured/post scene by **hand-editing the JSON**, but you cannot **add, edit, or remove** a texture or effect resource through the editor (the inspector reflects them, but committing a change to one would be rejected by the command registry). This is the *authoring* path; the *render* path is covered separately by the *Editor viewport HDR context + post-chain preview* section of `editor-seams-and-preview-deferrals.md`.

This was an accepted, documented scope boundary of the M1-slices batch (the batch's goal was "core loader reproduces the bowling setup from data + headless render + lit editor viewport", not full editor authoring of the expanded set). Noted in `docs/reference/editor-architecture.md §12`.

**Context to weigh when picking this up:**
- Extend `tableEnum` to all five `TABLE_ORDER` tables (or derive it from `TABLE_ORDER` so it can't drift again — single source of truth).
- Verify `mutations.setResource` + the registry-validated mutation path handle a `textures`/`effects` entry correctly (kind params, build/destroy on live preview, leak-clean reconcile) the same way they do for materials.
- The M5A inspector's resource-edit → command dispatch for the new tables (does editing a checkerboard's `cells` or a bloom's `intensity` round-trip through `scene.setResource`?).
- Adding/removing a texture/effect resource and the reference integrity it implies (a material referencing a deleted texture; `settings.post` referencing a deleted effect — the loader's resolve-or-throw + the now-recursive `checkResourceRefs` already validate refs at the boundary).

**Trigger to revisit:** when in-editor authoring of textured / post-processed scenes is needed (likely alongside `scene-chrome-returns-as-consumer-surface.md`), i.e. when "open + render a hand-authored lit/textured scene" is no longer enough and users need to *create* texture/effect resources in the editor.

**Reference:** `packages/editor/src/daemon/handlers.ts` (`tableEnum`, `scene.setResource`, `scene.removeResource`), `packages/core/src/scene/t.ts` (`TABLE_ORDER`), `docs/reference/editor-architecture.md §10`, sibling entry: the *Editor viewport HDR context + post-chain preview* section of `editor-seams-and-preview-deferrals.md`.

**Surface check 2026-08-01 (F4.5b Task 14) — STALE, not resolved.** The daemon-side fact is
verbatim true and unchanged: `tableEnum` in `daemon/handlers.ts` is still
`z.enum(["geometries", "shaders", "materials"])` and both resource verbs still gate on it.
What is gone is the other end — the M5A inspector's resources panel and every scene surface
that would have edited a texture or effect were deleted at F4.5a (field-only editor). So the
command-layer gap is real and the surface that would use it is absent; same
retire-or-re-target call as the section above, at the F4.5 seal.

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
it touches a shared inspector primitive used by every enum in the editor (today: the hall's
`pillars`, plus scene-format enums), so it wants a deliberate pass rather than a drive-by.
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

## Light-edit preview: transform-direction bug FIXED; Safari per-property verification pending

**Investigation (Slice 3.2.2 Task 13).** The bug report ("light component edits
don't stick in Safari"; M1 Chrome gate saw intensity work) resolved into TWO
separate questions, answered by a source trace of the host preview path:

- **Transform-derived DIRECTION — was broken UNIVERSALLY, now FIXED.**
  `previewEntity`'s `transform` fast-path (`setEntityTransform`) pokes only mesh
  transforms; a light's direction is transform-derived and refreshed only by
  `rebuildEntity`. So editing a light entity's rotation never previewed its
  direction — in Chrome OR Safari. Fixed by gating the fast-path: light/camera
  entities route through clone+rebuild. Regression-pinned (`transformEditNeedsRebuild`
  predicate test + a host GPU test).

- **INTENSITY / COLOR / TYPE — have a working host preview path (code-verified).**
  These go through clone+rebuild → `rebuildEntity` → `result.lights` refreshed.
  So the seal did NOT fully over-generalize: these DO preview at the host level
  (Chrome-confirmed for intensity).

**Residual Safari-specific unknown (needs the user's Safari gate — not
reproducible without Safari in this session).** If light intensity/color still
"don't stick" in Safari despite the working host path, the failure is in the
inspector→preview/commit event path, most likely the ColorField change-vs-blur
class for light COLOR (the prior `4e22f4f`/`9f8bb41` saga). The Task-1 harness
now pins ColorField's commit-on-native-change / blur-never-commits behavior, so
that class is guarded — but Safari's native `<input type="color">` event timing
is only verifiable in Safari.

**Reproduction matrix to run at the Safari gate (Chrome verify after):** for a
directional light entity, edit each of {intensity (NumberField), color
(ColorField), type (enum Select), rotation (transform → direction)} and record
preview-updates? / commits-and-sticks? in BOTH browsers. Direction should now
preview in both (this fix). If intensity/color fail in Safari only, the fix is
in the inspector event path (ColorField), not the host — file a follow-up.

**Trigger to revisit:** the next user Safari gate that touches the SCENE editor
(run the reproduction matrix above then), or the UX/polish stage's editor pass —
whichever comes first. (Line added 2026-07-25: the hygiene prune found this
section had no trigger and would never surface from a trigger grep.)

**Reference:** `packages/editor/src/viewport-host/index.ts` `previewEntity` +
`packages/editor/src/viewport-host/preview-gate.ts` `transformEditNeedsRebuild`;
`packages/core/src/scene/loader.ts` `setEntityTransform`/`rebuildEntity`;
`packages/core/src/scene/builtins.ts` `buildLight`.

**Surface check 2026-08-01 (F4.5b Task 14) — STALE, not resolved; the editor half of the
Reference above is dead.** `preview-gate.ts` no longer exists and `previewEntity` returns no
hits anywhere in `packages/editor/src` — the scene host went with the scene-editing surface
at F4.5a. The core-side references still resolve. The reproduction matrix this section exists
for names "the SCENE editor", which the editor no longer has, so its trigger can never fire
as written. Retire-or-re-target at the F4.5 seal.

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
the stats push deliberately — the seams are single-slot, and this fact has no consumer that
does not already read stats — and that reasoning holds for a second and third flag too. What
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
plus a new single-slot `FieldHost.subscribe*` seam for the host to publish it on — and the
host's seams are deliberately single-slot and deliberately few. That is real surface for a
1.3 s job.

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
