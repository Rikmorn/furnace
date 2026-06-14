# Editor — remaining deferred viewport and hierarchy work

## Context

M5B (2026-06-14) delivered the full viewport manipulation loop on top of M5A: GPU-id picking,
AABB selection highlight, translate gizmo (3-axis drag, anchor-relative-absolute, multi-select
one-undo), editor orbit/pan/zoom camera (init from scene cam, never serialized), NumberField
drag-scrub (Safari-safe Pointer Events), focused-input echo-guard (`shouldReseed`), and
`revertSettings`. The three M5A inspector papercuts (⑩ omitted-default display, ⑪ vector
per-component multi-edit fan, ⑫ ColorField no-op-commit guard) were also delivered in M5B.

The following items were explicitly fenced out of M5B scope and remain deferred.

---

## Remaining fenced items

**6. `rebuildResource` + resource live-preview cascade** — M5A/M5B resources commit without
live preview (the `onPreview` callback in `ResourcesInspector` is a no-op; the SSE echo drives
a full `loadScene` reload). A `rebuildResource` on `LoadedScene` (analogous to `rebuildEntity`)
could be called from a `viewport-host.previewResource` method, with `ResourcesInspector.onPreview`
wired to it. The cascade implication: an entity that references the previewed resource must also
be rebuilt (its bound material/shader/geometry changes). This is a non-trivial dependency-graph
traversal.

**7. Editor fly-camera (WASD)** — WASD + mouse-look navigation of the viewport when the
viewport panel has focus. The host's orbit camera and the `render()` seam are the starting
point. Requires a per-frame update loop (rAF) driven by the viewport panel, paused when the
panel loses focus. The orbit camera would need to coexist with or switch to a fly mode.

**8. Hierarchy tree** — a tree view of entities (parent→children) in the entities panel. M5B's
`EntitiesPanel` is a flat list. The scene document's entity model is also flat today (no parent
field); the hierarchy view may require either an entity-parenting field in the scene format or
a local editor-only grouping layer. Requires a scene-format parent decision before the view
can be implemented.

---

## New deferred items surfaced during M5B

### Gizmo-controller extraction

**Title:** Extract translate-gizmo controller from `viewport-host/index.ts`

**Context:** `viewport-host/index.ts` grew to ~685 lines after M5B. The file is cohesive
(all host wiring), but it is past the ~400-line cognitive-load guideline
(`docs/rules/clean-code.md`). The gizmo controller — `tryStartGizmoDrag`,
`updateGizmoDrag`, `commitGizmoDrag`, `cancelGizmoDrag`, `committedTransform`,
`currentTransform`, `gizmoDrag` state, and `renderGizmo` (~110 lines) — is the cleanest
extraction candidate: pure drag-state management that could live in a `gizmo-controller.ts`
alongside `gizmo.ts`.

**Trigger to revisit:** Next substantial host change (e.g. M5C rotate/scale gizmo work) or a
dedicated cleanup tranche. Not urgent — the file is cohesive; the smell is size alone.

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

**Context:** `currentTransform` in `viewport-host/index.ts` fills omitted rotation/scale with
schema defaults (`[0,0,0,1]` / `[1,1,1]`) so it always produces a complete transform record.
This means a gizmo commit writes `{ position, rotation: [0,0,0,1], scale: [1,1,1] }` into the
document even when the entity's transform only had `position` before the drag. The fields have
the correct values (same as engine defaults), but they are now explicit in the document JSON
where they were previously omitted — a cosmetic bloat. The right fix is to commit only the
changed field (position) and preserve omission of unchanged ones.

**Trigger to revisit:** M5C gizmo work (rotate/scale handles) or a dedicated transform-mutation
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

## Trigger to revisit (remaining fenced items)

Items 6–8 become actionable when the next editor milestone targets them:
- Item 6 (`rebuildResource`) — when resource live-preview is prioritized (M5C or later).
- Item 7 (fly-camera) — when the orbit model limits navigation in practice.
- Item 8 (hierarchy tree) — when entity-parenting is added to the scene format.

## Reference

- As-built M5A/M5B architecture: `docs/reference/editor-architecture.md` §10–§11
- SOTA research (picking, gizmo math, form-engine): `docs/research/2026-06-11-editor-m5-inspector-sota.md`
