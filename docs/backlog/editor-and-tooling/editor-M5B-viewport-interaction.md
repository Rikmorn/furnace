# Editor M5B — viewport interaction, picking, gizmos, drag-scrub

## Context

M5A (2026-06-13) landed the reflection-driven inspector (editable components, settings, resources), multi-entity selection (replace/toggle/range, modifier-click), live preview (`previewEntity`/`previewSettings`/`revertEntity`/`syncCommitted`), and the `scene.batch` command. The following surfaces were explicitly fenced out of M5A scope and are recorded here for M5B.

**Note: multi-select was pulled forward into M5A** (vs the M5 SOTA research's deferral recommendation — the research recommended deferring it to the same milestone as batch editing, but the brainstorm concluded they belonged together with the inspector).

### Fenced 5B items

**1. Viewport picking** — click in the 3D viewport to select an entity. Two candidate strategies documented in the M5 SOTA research:
- **GPU-id pick**: render a flat-shaded pass where each entity has a unique integer color id encoded into the pixel; read back the pixel at the mouse position. Accurate to pixel, correct for any mesh shape, requires a second render pass (depth write, no AA) and a GPU→CPU readback (async, introduces one frame of latency). WebGPU supports this via `copyTextureToBuffer`.
- **CPU-ray**: unproject the mouse into world space, cast a ray, test against each entity's AABB or triangle mesh. No extra pass, no readback latency, but requires the scene's geometry to be CPU-accessible and is O(entities × triangles) naive.

The GPU-id path is the industry standard (Unity, Godot, Blender all use it). The CPU-ray path is viable for small scenes. Decision pending.

**2. AABB highlight via `frame.drawLines`** — highlight the selected entity's axis-aligned bounding box in the viewport. `frame.drawLines` (`@furnace/core/frame`) is the primitive; the host needs to accumulate the 12 AABB edges and submit them as an overlay on the rendered frame.

**3. Translate gizmo** — a 3-axis drag handle centered on the selected entity. Requires:
- Transform-gizmo math: project the 3D axis handles into screen space; detect which axis is dragged; compute the world-space delta from mouse delta along the projected axis (Blender's technique: project the axis to screen, find the component of mouse movement along that line).
- In-place update contract: the gizmo drag emits a preview on every mouse-move (no daemon round-trip) and commits on mouse-up. This is where the `binding.set` fast-path matters — see item 4.
- Visual: the three axis handles (X=red, Y=green, Z=blue) rendered via `frame.drawLines` or a dedicated gizmo pass.

**4. Smooth continuous drag-scrub + `binding.set` fast-path** — the NumberField renderer currently commits on blur. Drag-scrub (mouse-down → drag → mouse-up) requires preview on every mouse-move frame. The seam is already in place (`onPreview` wires to `viewport-host.previewEntity`), but continuous 60 fps scrub will create GC pressure from `structuredClone(committedDoc)` on every frame. The `binding.set` fast-path (direct GPU uniform update without a scene rebuild) is the correct fix: `rebuildEntity` is too expensive for continuous input; `Binding<L>.set` is the GPU fast path. This item also makes the **focused-input echo-suppression guard** load-bearing (see item 5).

**5. Focused-input echo-suppression guard** (spec §B rule 3, deferred from M5A) — in a single-user local session, a concurrent external edit (another process editing the scene file) arriving mid-keystroke while the user has a number input focused would clobber the field with the daemon's value. M5A does not implement this guard: `session-updated` events unconditionally re-seed `SchemaForm`'s `values` prop, which drops any in-progress draft. The guard is: if the focused element is inside a `<SchemaForm>` (tracked via a `FocusManager` or a `data-inspector-input` attribute), suppress `session-updated` re-seeds for that field until the input blurs. This is single-user only and benign in M5A (only one writer), but lands naturally alongside the smooth drag-scrub seam (same interaction model: in-progress input must not be clobbered by an incoming update).

**6. `rebuildResource` + resource live-preview cascade** — M5A resources commit without live preview (the `onPreview` callback in `ResourcesInspector` is a no-op; the SSE echo drives a full `loadScene` reload). M5B can add `rebuildResource` on `LoadedScene` (analogous to `rebuildEntity`), call it from `viewport-host.previewResource`, and wire `ResourcesInspector.onPreview` to it. The cascade implication: an entity that references the previewed resource must also be rebuilt (its bound material/shader/geometry changes). This is a non-trivial dependency-graph traversal.

**7. Editor fly-camera** — WASD + mouse-look navigation of the viewport when the viewport panel has focus. The host's `render()` + the transform module are the seam. Requires a per-frame update loop (rAF) driven by the viewport panel, paused when the panel loses focus.

**8. Hierarchy tree** — a tree view of entities (parent→children) in the entities panel. M5A's `EntitiesPanel` is a flat list. The scene document's entity model is also flat today (no parent field); the hierarchy view may require either an entity-parenting field in the scene format or a local editor-only grouping layer.

**9. Settings-revert gap** — M5A has no `revertSettings` on `ViewportHost`. When the user previews a settings field (e.g. `clearColor`) and then presses Escape, the `onCancel` handler in `InspectPanel.tsx` is a no-op: the preview stays in the engine until the next `document-changed` SSE event reloads the scene. Entity edits revert cleanly via `revertEntity`; settings edits do not. The fix is a `revertSettings()` method on `ViewportHost` that restores `loaded.settings` from the committed doc's settings and re-renders. The gap is noted inline in `InspectPanel.tsx` (`onCancel` comment).

## Trigger to revisit

When viewport interaction (picking, gizmos) becomes the next editor priority, or when continuous-scrub performance is observed to be a problem in the as-shipped M5A inspector. Items 5 (echo-suppression guard) and 9 (settings-revert gap) are the clearest day-one papercuts — they surface as real UX friction as soon as the inspector is in daily use.

## Reference

- Plan: `docs/superpowers/plans/2026-06-13-editor-M5A-inspector.md` (Tasks 1–15 executed the 5A scope)
- SOTA research: `docs/research/2026-06-11-editor-m5-inspector-sota.md` (picking strategies, gizmo math, form-engine evaluation, leva pattern analysis)
- As-built architecture: `docs/reference/editor-architecture.md` §10 (M5A inspector, live-preview seam, echo suppression, settings-revert gap)
