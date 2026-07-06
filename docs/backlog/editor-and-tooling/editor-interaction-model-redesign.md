# Editor interaction model — back to the drawing board

> Epic 3 disposition (2026-07-06): direct input to Slice 3.2 (chrome rework + curation verbs) — see docs/research/2026-07-06-editor-cockpit-audit.md.

The M1-slices visual gate (run by the user in Safari, the primary browser) confirmed the editor **functions** but the interaction model is a prototype, not a tool. User verdict: the whole interaction model needs a redesign — driven by the **concrete target application's** real editing needs, **not** by the bowling demo. Until those needs are known, the editor is **shelved** — this entry captures the evidence so the redesign doesn't start cold; it is not a list of bugs to fix piecemeal.

**Evidence from the gate (each is a symptom of a deeper model gap, noted alongside):**

1. **Resource edits don't cascade to dependent meshes.** Editing a geometry resource (e.g. sphere `radius`) doesn't update the rendered mesh — *"won't stick until I've changed the mesh data."* This is the known resource live-preview cascade gap (`editor-M5B-viewport-interaction.md` §6: a resource commit rebuilds the resource but entities referencing it aren't rebuilt). **Model gap:** the live-preview seam handles components (transform fast-path) but not resource→dependent-entity propagation.

2. **Light component edits don't stick (Safari).** The user cannot get light changes to apply. **Discrepancy to investigate honestly:** the M1-slices Chrome/Dawn gate recorded a *working* live intensity-crank on the directional light ("sun→40 lit the ball white"). Two candidate explanations: (a) **Safari-specific** — consistent with the prior ColorField change-vs-blur saga (commits `4e22f4f`/`9f8bb41`) where Chrome passed and Safari exposed the real bug, the standing "Chrome gate green ≠ correct" pattern; (b) the seal **over-generalized** from one property (intensity) to "fully editable" — other light props (color, type, transform-derived direction) may never have had a preview path. Investigation: which light props apply, in which browser; does the host preview path rebuild the `Light` + refresh `LoadedScene.lights` on a `light`-component edit, or only the transform fast-path?

3. **Schema accepts invalid combinations the loader rejects.** Material with both texture+color; rigidBody with zero/multiple shapes — the form lets you set them, then apply errors. Root cause is structural and tracked separately: `../engine-architecture/scene-schema-cannot-encode-cross-field-constraints.md`. The inspector can't enforce what the schema doesn't carry.

4. **"Sea of numbers", no ranges.** `NumberField` is a bare numeric input (drag-scrub, shift=fine) with no per-field min/max/step or slider. Angles, intensities, damping, etc. have no bounded affordance — every value looks the same and nothing signals valid ranges.

5. **Color picker has no alpha.** `ColorField` uses a native `<input type="color">` (RGB-only). Material color is stored RGBA (`vec4`, `builtins.ts:547`) but the 4th component is uneditable through the UI.

6. **No per-type / domain-aware representations.** Everything renders as generic fields. No direction-as-gizmo, no labeled-axis vectors, no bounded sliders, no enum affordances where they'd help. The reflection-driven inspector's strength (auto-forms from schema) is also its ceiling: it can only render what the schema's `furnace.kind` taxonomy already knows.

7. **Can't reopen closed panels.** The dockview chrome has no "add view / restore panel" affordance; closing a panel requires a full page refresh to recover it.

**What a redesign has to decide (the actual drawing-board questions):**

- **How much stays reflection-driven vs. hand-authored per-type editors?** Items 4–6 are the ceiling of pure reflection. A hybrid (reflection for the long tail, hand-authored widgets for high-value types: transforms, lights, colors, materials) is the likely shape — but that should be driven by what the target app actually edits.
- **The live-preview model for resources** (item 1) — resource→dependent-mesh cascade, or a different editing model entirely.
- **Where constraints live** (item 3) — couples directly to the schema-constraint backlog entry; resolve them together.
- **Chrome-vs-Safari verification discipline** (item 2) — the visual gate must run in Safari, and ideally the editor needs a component-render test harness (the inspector still has *no* field-render tests — the prior process-gap finding that let the ColorField bug through all reviews; happy-dom/testing-library harness noted in the M5B seal record).

**Trigger to revisit:** when the concrete target application defines what editing it needs (the editor's requirements should derive from the app). Do **not** redraw speculatively — the reflection-inspector ceiling and the resource-cascade model are big enough that a wrong guess is expensive to undo.

**Reference:** `packages/editor/src/frontend/inspector/` (SchemaForm, field renderers — NumberField, ColorField, kind→renderer registry), the host preview path (`previewEntity`/`revertEntity`, transform fast-path), the dockview chrome (`packages/editor/src/frontend/`), `docs/reference/editor-architecture.md`, sibling entries: `editor-M5B-viewport-interaction.md` §6 (resource cascade), `editor-viewport-hdr-context-and-post-preview.md`, `editor-author-textures-effects-resource-tables.md`, `../engine-architecture/scene-schema-cannot-encode-cross-field-constraints.md`.
