# Editor chrome — authoring gaps and inspector defects

Tracker for the editor CHROME items: verbs the daemon exposes but the React surface does
not offer, inspector fields that mis-handle their schema type, and refresh guards that go
stale. Each is user-visible in the editor UI (or user-visibly ABSENT from it) and each was
deferred as out of scope for the task that surfaced it. Merged so there is **one place to
check whenever you touch `packages/editor/src/frontend/components/` or
`src/frontend/inspector/`**. Sections keep their original content.

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

**Trigger to revisit:** the next schema that wants a numeric enum, or the F4 inspector pass.

**Reference:** `packages/editor/src/frontend/inspector/fields/EnumField.tsx` (the `.map(String)`
options and the `onValueChange` commit), `packages/editor/src/frontend/components/field/StampInspector.tsx`
(the `apply` boundary cast), `packages/core/src/field/generators.ts` (`ROTATIONS` TSDoc records
the dependency).

## An entity row's expanded params can show the PREVIOUS world's values after a load

**Context.** `sameEntities` in `packages/editor/src/frontend/components/FieldPanel.tsx` is
the refresh guard behind `subscribeEntities`: it returns the previous array when the new one
compares equal, so an entity tick that changed nothing does not re-render the panel. It
compares `entityId`, `generator`, `seed`, `opSpan`, the frozen/baked flags and (since F3b)
the `placed` counts — but NOT `params`, which the expanded row renders as a read-only `<dl>`.

The original argument for the omission was that a param change always moves `opSpan` with it,
because a reconfigure re-evaluates the span with ids taken from `log.nextId`. That holds
WITHIN a session and fails across a world switch: `loadWorld` recomputes
`log.nextId = max(op.id) + 1` from the loaded ops, so ids — and every `opSpan` — restart.
Two worlds can therefore hold entity records that agree on every compared field and differ
only in their params, and `FieldToolbar`'s Load button calls `loadWorld` from inside the same
`FieldPanel` mount (no remount, no state reset, just an entity tick). The guard returns
`prev`, and an expanded row keeps the previous world's param values.

Narrow in practice: it needs a row expanded across a load of a same-shaped world, and the
row's own summary line (which does not carry params) reads correctly. It is also
pre-existing — F3a shipped the `<dl>` and the guard together. F3b closed the sibling hole for
`placed` because that one puts a wrong NUMBER on the collapsed row, which is visible without
expanding anything.

What defers this is SCOPE, not difficulty — it is pre-existing and outside the task that
surfaced it. Whoever picks it up should not re-derive a blocker that is not there:

- **Depth is already decided.** `formatParam` in `EntitiesList.tsx` fixes what the row
  actually displays — `typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)`.
  "Compare what the row renders" answers the depth question with no new design decision,
  which is exactly the principle the `placed` fix used.
- **Cost is not a real objection.** Param sets are schema-driven and small (a generator's
  `paramSchema` properties), and the guard already does per-entity work on every tick.

So the likely shape is a `sameParams` helper beside `samePlaced`, comparing the rendered
projection rather than the raw values.

**Trigger to revisit:** when the params `<dl>` becomes editable (the row stops being a
read-only record), OR the first time a world switch is a routine part of the loop rather
than an occasional action — F4's cockpit pass, where switching worlds to compare generations
is the point.

**Reference:** `packages/editor/src/frontend/components/FieldPanel.tsx` (`sameEntities`,
`samePlaced`, `refreshEntities`); `packages/editor/src/viewport-host/field-host.ts`
(`loadWorld`'s `log.nextId` recomputation — the fact that breaks the id-monotonicity
premise); `packages/editor/src/frontend/components/field/EntitiesList.tsx` (the `<dl>`);
`packages/editor/src/frontend/components/field/FieldToolbar.tsx` (`onLoad`, the in-mount
reachability).

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

**Reference:** `packages/editor/src/viewport-host/index.ts` `previewEntity` +
`packages/editor/src/viewport-host/preview-gate.ts` `transformEditNeedsRebuild`;
`packages/core/src/scene/loader.ts` `setEntityTransform`/`rebuildEntity`;
`packages/core/src/scene/builtins.ts` `buildLight`.

## `GenerationWorkerClient.cancel()` has no production caller — a wedged run traps the panel

`cancel()` (`packages/editor/src/frontend/lib/generation-client.ts`) terminates the worker
instantly, mid-attempt, and is well covered by `tests/generation-client.test.ts`. Nothing in
the chrome calls it: the only callers are tests. So if a generate or bake never reports back
(worker wedged, engine bundle hung, a spec the generator loops on), the session stays
`generating`/`baking` forever — the World panel keeps every control disabled behind `busy`,
and there is no escape short of reloading the page.

Pre-existing, not a W3 regression (the old Generation panel had the same hole). W3 raises the
stakes a little: a world realize is longer and has more ways to go wrong than the old
two-cave preview, and the panel's whole surface is gated on `busy`.

The fix is a Cancel button that appears while `busy`, calls `client.cancel()`, and resets the
status to `idle` — plus a decision on whether cancel should also clear the preview host.
Cheap, but it is UI surface the W3 plan did not spec.

**Trigger to revisit:** the first observed wedge, or the 3.4 panel pass — whichever comes
first.

**Reference:** `packages/editor/src/frontend/lib/generation-client.ts` (`cancel`),
`packages/editor/src/frontend/components/WorldPanel.tsx` (`busy`).
