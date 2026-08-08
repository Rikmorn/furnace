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
`engine-architecture/transform-hierarchy-helpers.md`.

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
