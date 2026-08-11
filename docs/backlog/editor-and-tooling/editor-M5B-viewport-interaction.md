# Editor — remaining deferred viewport and hierarchy work

## Context

M5B (2026-06-14) delivered the full viewport manipulation loop on top of M5A: GPU-id picking,
AABB selection highlight, translate gizmo (3-axis drag, anchor-relative-absolute, multi-select
one-undo), editor orbit/pan/zoom camera (init from scene cam, never serialized), NumberField
drag-scrub (Safari-safe Pointer Events), focused-input echo-guard (`shouldReseed`), and
`revertSettings`. The three M5A inspector papercuts (⑩ omitted-default display, ⑪ vector
per-component multi-edit fan, ⑫ ColorField no-op-commit guard) were also delivered in M5B —
but ⑫ was a regression (it suppressed every real color commit) and was reverted 2026-06-14;
see "No-op-revision suppression (reopened ⑫)" below.

The following items were explicitly fenced out of M5B scope and remain deferred.

---

## Remaining fenced items — BOTH CLOSED BY DELETION (foundations T2, 2026-08-05)

Two items were fenced out of M5B and carried here:

- **6. `rebuildResource` + resource live-preview cascade** — a `rebuildResource` on
  `LoadedScene`, analogous to `rebuildEntity`, so a resource edit could live-preview instead
  of driving a full `loadScene` reload.
- **8. Hierarchy tree** — a parent→children tree in the entities panel, gated on the scene
  format gaining an entity-parenting field.

**Neither has a subject any more.** `@furnace/core/scene` is deleted, so `LoadedScene`,
`rebuildEntity` and `loadScene` do not exist and there is no scene format to add a parent field
to; the `EntitiesPanel` those items were measured against went at F4.5a. They are recorded here
as closed-by-deletion rather than removed, because "we deliberately never built these" is the
useful fact for anyone reading this M5B record.

The live descendants, if either want returns: live preview against the FIELD is the
`FieldHost` reconfigure session (`editor-architecture.md` §13, §17.3), and a hierarchy over
generator entities — a different object model — would start from the entities palette
(§17.2/§17.7). The general transform-hierarchy question stays open as
`engine-architecture/unbuilt-tier-2-modules.md` §Transform-hierarchy helpers.

(Item 7, editor fly-camera/WASD, **landed in Slice 3.2** — RMB-hold + WASD/QE fly with wheel
speed-trim; `field-host/camera-control.ts` `flyLook`/`flyMove`.)


## New deferred items surfaced during M5B

### Gizmo-controller extraction

**Title:** Extract translate-gizmo controller from the field host

**STALE PATH, corrected 2026-08-06.** This entry was written against
`src/viewport-host/index.ts`, the M5B scene-editing host — a file that no longer exists. The
directory rename (foundations T3b1) re-pointed the path to `src/field-host/index.ts`, which is
a 57-line barrel and holds none of what is described below. Whatever survives of this want
lived in `src/field-host/field-host.ts` when this note was written — since T3c+T3d it is
spread across that file's extracted sibling modules (the gizmo's state and wiring are now
`field-entities.ts`'s, its drawing `field-render.ts`'s, its axis pick `field-picking.ts`'s);
the named symbols should be re-verified against those before the entry is acted on.

**Context (as written at M5B):** `viewport-host/index.ts` grew to ~685 lines after M5B. The file is cohesive
(all host wiring), but it is past the ~400-line cognitive-load guideline
(`docs/rules/clean-code.md`). The gizmo controller — `tryStartGizmoDrag`,
`updateGizmoDrag`, `commitGizmoDrag`, `cancelGizmoDrag`, `committedTransform`,
`currentTransform`, `gizmoDrag` state, and `renderGizmo` (~110 lines) — is the cleanest
extraction candidate: pure drag-state management that could live in a `gizmo-controller.ts`
alongside `gizmo.ts`.

**Trigger to revisit:** Next substantial host change (e.g. rotate/scale gizmo work in a future editor-redesign pass) or a
dedicated cleanup tranche. Not urgent — the file is cohesive; the smell is size alone.

> **The size half is being paid down by the foundations T3 tranches; the named symbols are
> gone (checked at source, 2026-08-07).** `field-host.ts` was **6,337 lines / 2,854 code** at
> foundations T3c, down from 7,410 at the original cluster-map pass — T3c alone took −929
> (−12.8%), the largest single bite, by lifting the session/gesture machine and the pointer
> chain into `field-host/field-machine.ts`. At T3d it is **3,999 / 915** (checked at source,
> 2026-08-08): the remaining clusters left for sibling modules and the file is now the facade.
>
> **None of the six symbols this entry names still exists anywhere in the repo**
> (`tryStartGizmoDrag`, `updateGizmoDrag`, `commitGizmoDrag`, `cancelGizmoDrag`, `renderGizmo`,
> `gizmoDrag`) — they belonged to the deleted scene-editing host, which is what the STALE PATH
> note above warned about. Grepped, not assumed. The field host has a translate gizmo of its
> own (D-9) whose pure math is ALREADY an extracted sibling module,
> `packages/editor/src/field-host/gizmo.ts` (`gizmoSpan`, `pickAxis`, `axisLines`,
> `closestPointParamOnAxis`); what is still in the closure is the state and the wiring —
> `gizmo`, `gizmoBatch`, `gizmoAxisAt`, `gizmoVisible`, and the rebuild that hangs them on the
> selection box. **So this sub-item is not the extraction it was written as.** Anyone acting on
> it should re-scope it against the as-built first, or retire it: the thing it proposed to
> create largely exists, and the residue is wiring rather than a controller.

**Reference:** M5B Task 13 holistic review.

---

### Per-field focus-guard redundancy

**Title:** Audit per-field `focusedRef` guards vs form-level `shouldReseed` echo-guard

**Context:** Task 16's form-level echo-guard (SchemaForm gates `setDrafts` on
`shouldReseed(focusWithin)`) subsumes the per-field `focusedRef` guards in
`NumberField`/`VecField` for the echo case: freezing `setDrafts` freezes the `values` prop,
so per-field `useEffect`s that re-seed from `values` never fire while focus is within the form.
The per-field guards remain as defense-in-depth but may be removable without behavioral
change.

**Trigger to revisit:** Post-M5B inspector audit or when a future inspector refactor changes
the SchemaForm/field architecture. Removable if the architecture doesn't change.

**Reference:** M5B Task 16 review.

---

### Gizmo commit materializes default rotation/scale

**Title:** Gizmo commit writes explicit rotation/scale even when they were previously omitted

**Context:** `currentTransform` in `field-host/index.ts` fills omitted rotation/scale with
schema defaults (`[0,0,0,1]` / `[1,1,1]`) so it always produces a complete transform record.
This means a gizmo commit writes `{ position, rotation: [0,0,0,1], scale: [1,1,1] }` into the
document even when the entity's transform only had `position` before the drag. The fields have
the correct values (same as engine defaults), but they are now explicit in the document JSON
where they were previously omitted — a cosmetic bloat. The right fix is to commit only the
changed field (position) and preserve omission of unchanged ones.

**Trigger to revisit:** rotate/scale gizmo work (a future editor-redesign pass) or a dedicated transform-mutation
cleanup session.

**Reference:** M5B Task 13 holistic review #4.

---

### Viewport commit error surfacing

**Title:** Surface errors from `onTransformCommit` daemon calls (toast/notification UX)

**Context:** `App.tsx`'s `onTransformCommit` handler calls `api.setComponent` /
`api.setComponentMany` via `suppressEcho`, but does not surface errors (no `.catch`, no user
notification). This matches the existing `commitResource` precedent. A failed commit leaves the
viewport showing the transformed state while the document is unchanged — the SSE event
(or lack thereof) is the only signal that something went wrong.

**Trigger to revisit:** When adding editor error-toast or notification UX (the
`commitComponents`/`commitSettings` paths have the same gap).

**Reference:** M5B Task 14 review.

---

### No-op-revision suppression for non-color fields

**Title:** Suppress no-op-revision bumps where both draft and committed baseline are known

**Context:** M5B's ⑫ put a draft-equality guard inside `ColorField` to skip the revision bump
on a focus+blur with no edit. It was a regression: `ColorField`'s `rgba` comes from
`SchemaForm`'s working draft, which `onChange → onPreview` advances to the picked value *before*
blur — so the guard's `eq(next, rgba)` was always true and it suppressed **every** real commit
(colors silently failed to stick). **Color is now fully resolved (2026-06-14):** `ColorField`
commits on the native `change` event, which fires only when the value actually changed — so no
no-op color commits are possible and no guard is needed. What remains is the general case for
**other** fields (`NumberField` on Enter/blur, etc.), where a focus+blur or Enter with no edit
can still bump the revision. If that becomes an annoyance, the correct home is a layer that holds
both the live draft **and** the committed baseline:
- **`SchemaForm.onCommit`** — compare the about-to-commit `updated` against the committed
  `values` prop (deep-equal on the small params object); skip the parent `onCommit` if equal.
  Frontend-local, covers every field uniformly (not just color).
- **Document-session mutation layer (daemon)** — skip the revision bump when a
  `setComponent`/`setResource`/`setSettings` produces a document structurally identical to the
  current one. Truest single-source-of-truth fix; covers all clients (MCP, file-watch echoes),
  not just the inspector. Bigger change; needs an equality/canonical-form decision and undo
  interaction review.

Recommend the document-session approach (single source of truth) but it is a design decision,
not a regression — hence deferred.

**Trigger to revisit:** Next inspector/command-layer cleanup tranche, or when no-op undo entries
become an actual annoyance in practice.

**Reference:** M5B Safari-pass regression triage 2026-06-14; `editor-architecture.md` §11.9 ⑫.

---

### Inspector fields have no component-level tests (process gap)

**Title:** Add a component-render test harness for inspector fields

**Context:** The ⑫ regression above shipped through all 974 tests, the two-stage spec/quality
review, the final holistic review, AND the Chrome visual gate — because the inspector fields
(`packages/editor/src/frontend/inspector/fields/*`) have **no component-level tests**. The
existing inspector tests (`tests/inspector/*.test.ts`) only cover extracted pure helpers
(`fanComponent`, `shouldReseed`, scrub math) — they never render a field and exercise the
`onChange → onPreview → setDrafts → onBlur → onCommit` chain that the bug lived in. The Chrome
gate missed it too: it never opened a scene and edited the material color (the resource path
with no-op preview + full reload). A `happy-dom` (or `@testing-library/react`) harness that
renders `SchemaForm` + a field and asserts the commit/preview callbacks fire with the right
values would have caught this directly. This is the same class of gap as the Stage-4 shadow
bug — "renders clean / all green" does not prove correct *output/behavior*.

**Trigger to revisit:** Next editor test-infra investment, or before the next inspector feature
tranche (a future editor-redesign pass). Worth doing before more field types are added.

**Reference:** M5B Safari-pass regression triage 2026-06-14.

---

## Trigger to revisit (remaining fenced items)

None — see above; both are closed by deletion. The items in "New deferred items surfaced
during M5B" keep their own triggers.


## Reference

- As-built M5A/M5B architecture: the sections describing it were deleted from `docs/reference/editor-architecture.md` when the surface was (F4.5a chrome, T2 daemon + core); git history is the record. What stands today: §9 (the inspector module, which survived intact) and §16–§18 (the overlay cockpit that replaced the rest).
- SOTA research (picking, gizmo math, form-engine): `docs/research/2026-06-11-editor-m5-inspector-sota.md`

## Viewport pointer gestures that are not press-drag-release (absorbed at T5, 2026-08-11)

Two gestures in the viewport that do not behave the way every sibling gesture does. Filed
long after M5B but they are the same surface this file tracks, so they live here.


### A box selection is two clicks, not a press-drag-release

The `box` cell-selection gesture sets its anchor on the pointer PRESS and takes its second
corner on a separate later press. `onPointerUp` has no region branch at all, so
press-drag-release — the gesture every other tool in the category uses for a box — does
nothing. The `material` and `void` floods are one click each, which is right for them.

This is a GESTURE-ergonomics item, not a feedback one. The feedback half is closed: F4.5b
Task 13 made a flood selection draw one translucent cube per selected cell (surface-first,
capped at `SELECTION_DISPLAY_CAP = 65 536`) instead of an AABB outline the camera is standing
inside, and F4.5b Tasks 8–9 made the box gesture SAY what it is — the status keymap line
reads `click ×2 spans a region` and an un-anchored corner draws a cross at the cursor. The
mechanism underneath is untouched.

#### Context

Carried out of two gate sets that both landed on the same finding — the F2b gate's
"selection feedback overhaul" (item 1) and the F3a gate's "box/wand selection behaves oddly"
(item 3) — and re-filed at the F4.5 seal when those sets were consumed into the charter.
F4.5b deliberately made the two-click mechanism LEGIBLE rather than changing it: changing a
selection gesture immediately before a stage gate would have added mechanism risk the charter
never priced.

The shape, if it is taken: a press that arms the anchor, a move that previews the region
(the live snapped-region preview already exists), and a release that either completes the
region or — under a threshold, exactly like `DRAG_THRESHOLD_PX` on the pointer tool — falls
back to leaving the anchor armed so the existing two-click flow still works. Both mechanisms
can coexist; the cost of the drag one is that the canvas is also where a camera orbit lives,
so the arbitration has to be written down (`field-host/field-pick.ts` is the precedent for
that kind of ordering).

#### Trigger to revisit

**The first gate complaint about selection after F4.5.** The F4.5 holistic gate walked box
select as part of its spine and passed without raising it, which is evidence the legibility
work bought enough — but it is one user on one walk, and this item was raised at two previous
gates by the same user.

#### Reference

- `packages/editor/src/field-host/field-selection.ts` — `boxAnchor`, which stayed in
  `field-host.ts` deliberately at foundations T3c because by EDGES it is the selection
  overlay's rather than the gesture cluster's — and then left WITH the selection cluster at
  T3d, which is that reasoning cashed out. **The press branch and the `onPointerUp` that has no region case both
  MOVED** to `packages/editor/src/field-host/field-machine.ts` (T3c, 2026-08-07): the four
  pointer handlers in `field-host.ts` are delegates now, and the anchor reaches the machine as
  the `setBoxAnchor` / `boxCorner` deps. So this change is a two-module edit today — grep by
  name, not by line.
- `packages/editor/src/field-host/viewport-cursor.ts` — the `cross` mark an un-anchored
  corner draws; `shell/status-keymap.ts` for the line that names the gesture.
- `packages/editor/src/field-host/field-pick.ts` — the press/threshold/drag arbitration the
  pointer tool already uses, and the precedent this would follow.
- `docs/reference/editor-architecture.md` §12 (selection as a tool class), §17.1 (the pointer's
  press arbitration), §17.7 (cell-level selection display).

### A CREATE session's ghost cannot be dragged — only a committed entity can

`FieldHost.beginMove` takes an `entityId`, and `pointerPress` arms a drag only on the
ALREADY-SELECTED committed entity. So the region of a live CREATE session — the stamp that
has not been committed yet, which is the thing the original finding was filed against — moves
only by the arrow keys or by the session card's d-pad inside its Advanced disclosure. Its
initial position comes from the two region-draw clicks and nothing after that is
mouse-driven.

#### Context

The F3a gate's finding was "the nudge buttons aren't great, i think it should be mouse
driven". F4.5b Task 5 built the mouse-driven half for COMMITTED entities and it is a
complete mechanism: press the selected entity, travel past `DRAG_THRESHOLD_PX` and it becomes
a move; `G` grabs it with no button held; the gizmo's arms constrain it to one axis; `R`
turns it; `⏎` drops it; `Esc` reverts. A move IS a reconfigure session, so nothing reaches
the op log until the drop and a cancelled move costs nothing. The arithmetic in
`field-host/field-move.ts` is anchored rather than incremental, so a cursor returned to the
press point returns the region exactly.

None of that is reachable from a CREATE session, and the asymmetry is the item: two ways to
position a region depending on whether it has been committed yet.

The work is smaller than it looks and the reason it was not done is scope rather than
difficulty — `field-move.ts` is pure and takes a region, not an entity; what a CREATE session
lacks is the ARBITRATION (a press inside a live ghost has to beat the region-draw click that
the same press currently means) and a decision about what `Esc` does mid-drag when the
session itself is also cancellable.

#### Trigger to revisit

**The next time region positioning is worked at all** — or the first gate complaint about
placing a stamp. It should not be taken as an isolated item: it wants deciding together with
the *A box selection is two clicks, not a press-drag-release* section, since both are the same question about what a press
inside the canvas means while something is armed.

#### Reference

- `packages/editor/src/field-host/field-move.ts` — pure, anchored, already region-shaped.
- **Paths corrected 2026-08-07 (foundations T3c).** `beginMove`, `nudgeStampRegion` and the
  pending-stamp region-draw arm are no longer in `field-host.ts`: they live in
  `packages/editor/src/field-host/field-machine.ts`, together with the whole session/gesture
  state this entry would have to change. `pointerPress` DID stay in `field-host.ts` through
  T3c — and at T3d became what it always was: it is `picking.press` in
  `packages/editor/src/field-host/field-picking.ts`, and the machine still calls it as a
  dep. Grep by name — the extraction opened a
  ~1,000-line hole and every line number below it drifted by a different amount.
- `packages/editor/src/frontend/components/shell/session-card/AdvancedSection.tsx` — the d-pad
  that is the current answer.
- `docs/reference/editor-architecture.md` §17.3 (move as a reconfigure session), §17.8 (the
  pending-stamp arm and region-draw entry).
