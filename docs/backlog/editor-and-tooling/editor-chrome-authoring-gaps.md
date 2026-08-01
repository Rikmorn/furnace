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
scene/room `role="tree"` across 200+ cryptic IDs; `editor-interaction-model-redesign.md`):
add/delete and findability are the same panel and likely one pass.

**Trigger to revisit:** when in-editor scene authoring (not just tuning existing entities) is
needed — the procedural-authoring editor pass (Slice 3.2.5 / the interaction-model redesign).

**Reference:** `packages/editor/src/daemon/handlers.ts` (`scene.addEntity`/`removeEntity`),
`packages/editor/src/frontend/components/EntitiesPanel.tsx`,
`docs/reference/editor-architecture.md` §4, sibling `editor-interaction-model-redesign.md`.

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

**Trigger to revisit:** when in-editor authoring of textured / post-processed scenes is needed (likely the editor redesign for procgen authoring — see `editor-interaction-model-redesign.md`), i.e. when "open + render a hand-authored lit/textured scene" is no longer enough and users need to *create* texture/effect resources in the editor.

**Reference:** `packages/editor/src/daemon/handlers.ts` (`tableEnum`, `scene.setResource`, `scene.removeResource`), `packages/core/src/scene/t.ts` (`TABLE_ORDER`), `docs/reference/editor-architecture.md §12`, sibling entry: the *Editor viewport HDR context + post-chain preview* section of `editor-seams-and-preview-deferrals.md`.

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
mechanism was extracted to `frontend/hooks/useRovingList.ts` and the two-axis keyboard model
built on it as `useRowGrid`; `EntitiesList` is now a `role="grid"` with ONE tab stop (↑/↓
rows + host selection, → into the row's verb cluster, ← / Esc back, ⏎ = the row's own click),
and `FlagsPalette` and `HistoryPalette` run the same model. The three questions this entry
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
