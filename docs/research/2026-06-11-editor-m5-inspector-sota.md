# M5 state-of-the-art: reflection-driven inspector, hierarchy, picking, gizmos

**Date:** 2026-06-11. Pre-brainstorm research for editor epic M5 (inspector + hierarchy +
viewport selection/gizmos). Three parallel research passes: (A) schema-driven form engines,
(B) shipping-editor inspector architectures, (C) picking + gizmo techniques. Verification
discipline: claims below were checked against npm registry / GitHub activity / primary source
on 2026-06-11 unless marked *(GK)* = general knowledge. This doc surfaces evidence; decisions
belong to the M5 brainstorm/spec.

---

## 1. The headline finding: production editors hand-roll the inspector

**Zero surveyed production game editors sit on a JSON-Schema form engine.** Babylon Inspector
v2 (React rewrite, 2025 — service-registry of hand-written property sections), PlayCanvas
editor (PCUI widgets + attribute descriptors), Triplex (TS-types → hand-rolled controls,
notably did NOT use leva despite being a pmndrs project), Theatre.js (prop-type-tag → component
map), three.js editor (hand-rolled everything). The generic form engines' value (submit flows,
validation UX, arbitrary nesting) is mostly irrelevant to an inspector whose validation lives
in the daemon and whose fields are a closed set of ~10 kinds — and none of them provide the
actually-hard 40% (vec/quat/color/scrub/resource-ref controls), which we'd write regardless.

### Form-engine option table (all verified against npm/GitHub 2026-06-11)

| Option | Maintenance | Kind-keyed dispatch | shadcn/Tailwind fit | Verdict signal |
|---|---|---|---|---|
| JSON Forms 3.7.0 (2025-11) | Active | **Yes** — testers can match custom schema props (`furnace.kind`) | Poor — must write the whole renderer set; only shadcn set is a 3rd-party 0.0.2 alpha | Right dispatch, wrong chrome |
| RJSF 6.6.2 (2026-06) | Very active, 15.8k★, first-party `@rjsf/shadcn` | **No** — dispatch via uiSchema layer (would generate it from our meta); vendors its own shadcn copies | Medium | Wrong dispatch layer + heavy (ajv + ~80–120KB gz) |
| leva 0.10.1 | **Stalled** (last commit 2025-11-08, 125 open issues, no maintained fork) | Via transformer + plugins | Poor (stitches theme, own store) | Right *interaction* primitives (transient onChange, set-from-external, scrub, vec inputs) — **mine its patterns, don't adopt** |
| tweakpane v4 | Core slow (4.0.5 = 2024-11); React wrappers all dead (pin v3) | Manual | Poor | Out |
| AutoForm 4.x | Quiet since 2025-08 | Yes (fieldType registry) | Good (installs into your shadcn) | zod-native but form-submit shaped; maintenance yellow→red |
| TanStack Form / RHF base | Very active | You build it | N/A | Adds submit semantics an inspector doesn't need |
| **Hand-rolled kind→renderer registry** | n/a | **Native — it IS the design** | **Perfect (our components)** | What every shipping editor does; ~1–2k LOC for our ~10 kinds (grounded in Puck/Triplex field-layer sizes) |

Useful bits regardless of choice: zod 4 `z.toJSONSchema()` targets draft-07 if ever needed for
a JSON-Schema consumer; **all `.meta()` fields copy into JSON Schema output** (verified,
zod.dev) — `furnace.kind` survives to the frontend, which already receives it via introspect.

### Number scrubbing (the Blender/Unity drag-number field)

- **Base UI** (`@base-ui/react`, MUI team, 1.5.0 2026-05, monthly releases — the strongest-
  maintained headless primitive set; shadcn ecosystem converging on it) has a first-class
  `NumberField.ScrubArea` using Pointer Lock. **CRITICAL: docs state ScrubArea is disabled in
  Safari** — furnace's primary browser. Any scrub solution needs a non-pointer-lock drag-delta
  fallback (leva's approach and the small libs work in Safari; hand-rolling is ~100 LOC).
- Small standalone libs exist but are pre-1.0/dormant (`draggable-number-input`,
  `react-input-with-drag`). leva and three.js editor both inline their own.

## 2. Convergent architecture patterns (every serious editor has these)

1. **Edits are operations against a document, never widget→object pokes.** PlayCanvas:
   Observer.set → OT op; three.js: Command objects; Godot: `emit_changed` → UndoRedo; Unity:
   SerializedProperty. A binding/command seam always insulates widgets from mutation. (Babylon
   Inspector writes objects directly — precisely because it's a debug tool with no document and
   NO undo; don't borrow its mutation model.) **M4's command layer is exactly the right
   substrate.** Open question for M5: PlayCanvas ops are per-leaf-path (`{p, oi}`), ours are
   whole-component `setComponent` — at our scale whole-component set + client-side field merge
   is likely fine, but it's a deliberate call to make.
2. **Renderer registry keyed by field-kind with a guaranteed default fallback, and per-field
   overrides above per-kind.** Unity: attribute → type → base-type chain, most-specific wins;
   Godot: plugin chain with `parse_property` override + default-plugin floor; PlayCanvas:
   UI-type string registry (`Element.create(type)`); Theatre: prop-tag map. String/tag keys fit
   our JSON-Schema `furnace.kind` metadata naturally. Ship defaults for every kind from day one
   so every field always renders *something*; per-row error boundaries (Babylon) so one bad
   schema doesn't blank the panel.
3. **One undo entry per drag, live preview during.** Three proven mechanisms: binding-level
   combine flag + unique-name-per-drag (PlayCanvas); undo-manager merge-by-action-name (Godot
   `MERGE_ENDS`); explicit scrub object with `temporarilySetValue / discardTemporaryValue /
   permanentlySetValue` (**Theatre.js — the cleanest seam**, generalizes sliders, color
   pickers, gizmo drags, and Escape-to-cancel with one interface; composes with our daemon:
   temporary values can be viewport-local preview, commit sends one canonical command).
   three.js's 500ms time-window merge is the minimal version but leaks entries on slow drags.
4. **Commit granularity for text/number fields:** commit on Enter/blur, Escape reverts,
   sliders/scrubs live-update with coalesced undo. Godot's `changing=true` guard: **suppress
   model→UI refresh echo while the user is the source of the change** — we will need this the
   first time an SSE round-trip echoes a change back into a focused input.
5. **Selection is a first-class shared service owned by neither tree nor viewport** (PlayCanvas
   `selector:*` bus; Babylon `selectionService` observable). Tree and viewport are both
   clients. Decide early if selection is undoable (PlayCanvas: yes, with suppress-for-sync).
6. **Flat entity map + parent/children fields; reparent/rename/delete are commands** with
   cycle-check and optional preserve-world-transform (PlayCanvas ships exactly our planned
   model — validates "hierarchy as a component later").
7. **The same registry drives "Add Component" + defaults + tooltips** (PlayCanvas
   `getDefaultData(component)`; docs in a parallel registry keyed `"component:field"`).
8. **Multi-object editing is decided at the binding layer, not per widget** (Unity
   SerializedObject over N targets; PCUI `field.link(observers[])`). If we ever want
   multi-select editing, the binding seam takes N targets from day one — retrofitting widgets
   is the expensive path. (Bowling doesn't need it; the *seam shape* is the cheap insurance.)
9. **Babylon v2's rewrite reasons** are a checklist of what rots: monolith → registry
   extensibility; polling → observation; 8k-node tree meltdown → flat virtualized tree.

## 3. Hierarchy tree

Shipping editors mostly hand-roll (PlayCanvas PCUI TreeView, three.js, VS Code); Babylon v2
uses Fluent FlatTree + virtualizer. Among React libs (verified 2026-06):
- **headless-tree** (`@headless-tree/core` 1.7.0, 2026-05; lukasbach; the declared successor of
  react-complex-tree): headless — DOM is ours (fits dockview/Tailwind chrome), every state
  slice (selected/expanded/focused) externally controllable (viewport-click → tree selection is
  first-class), DnD incl. external/native drags, virtualization-ready. Strongest library fit.
- **react-arborist** 3.10.1 (2026-06, active): fastest to ship, batteries included, but
  single-id controlled `selection` prop (external multi-select sync awkward) and depends on
  aging react-dnd *(GK)*; React 19 compat unverified.
- react-complex-tree: maintenance mode, no virtualization — out.
- **Scale check:** bowling is ~tens of entities and entities are FLAT until the hierarchy
  component lands — the existing `EntitiesPanel` list + selection sync may be all M5 needs,
  with the tree lib decision deferrable to the hierarchy milestone.

## 4. Picking

**Editor consensus = GPU id-buffer picking** (PlayCanvas `pc.Picker` framebuffer picker;
Babylon v8 added `GPUPicker`; Unity scene view by strong circumstantial evidence). Games
default to CPU rays (they need hit points + physics anyway); editors prefer id-buffers because
they're pixel-exact (match what's rendered, occlusion correct by construction) and need no
CPU-side geometry retention.

- **Drop-in WebGPU recipe** (webgpufundamentals "WebGPU Picking"): canvas-sized `r32uint`
  target + own depth, second pipeline sharing the vertex stage with a `vec4u(id)` fragment
  entry, per-draw id uniform, **render on click only**, `copyTextureToBuffer` of a SINGLE
  texel (sidesteps the 256-byte bytesPerRow alignment, which only binds multi-row copies),
  `mapAsync` readback (~one frame of latency, invisible for selection). Optimization headroom:
  scissor-rect to 1px, cull first.
- **Spec-verified gotcha:** `r32uint` is NOT multisample-capable — with MSAA in scene settings,
  the id pass must be a separate non-MSAA pass with its own depth (cannot be an extra
  attachment on an MSAA forward pass).
- **CPU raycast** (three.js Raycaster model: unproject NDC → ray; sphere → local-space AABB →
  Möller–Trumbore triangles) is trivially fast at our scale but couples the editor to retained
  CPU geometry (grows costly when glTF lands).
- **Either way, the camera ray (NDC unproject) must be built** — every gizmo drag algorithm
  consumes it. So scene picking and gizmo hit-testing can be decoupled: id-buffer for scene
  click-select, analytic math for gizmo handles.

## 5. Gizmos

**Best reference spec: the `transform-gizmo` Rust crate** (urholaukkarinen; engine-agnostic by
construction — consumes view/proj matrices + cursor, emits viewport-space vertices; ~3k LOC
core; the math is credited and portable to TS):
- **Analytic hit-testing, no picker meshes**: arrows via segment-to-segment closest distance
  (Sunday), rings via ray-to-plane + `|dist − radius|`, quads via ray∩plane + extent — all
  against a **~5-pixel screen-space tolerance** converted to world units.
- **Screen-constant scale**: `world-units-per-pixel = clipW_at_origin / proj[0][0] / viewportW * 2`.
- **Translate drag**: closest point on axis line to view ray (`ray_to_ray`) — better
  conditioned than three.js's plane-intersection method when the axis nears the view ray.
  Anchor-relative absolute deltas (never integrate per-event deltas). Re-pick the anchor if the
  camera moves mid-drag.
- **Rotate drag**: **entirely screen-space** — project gizmo center, `atan2(cursor − center)`,
  delta wrapped to (−π, π], sign from view·normal. More robust than three.js's distance-tuned
  tangent projection; one cursor revolution = exactly 2π.
- three.js TransformControls (the most-copied implementation, read in source): the
  load-bearing usability details are **fat invisible hit zones** (~25× visual width), hover
  highlight (yellow), screen-constant sizing, always-on-top (depthTest off + draw last; Babylon
  and PlayCanvas instead use a depth-cleared second pass/layer — that's our shape too), and
  degenerate-view culling (hide axis at `|axis·eye| > 0.99`, plane at `< 0.2`).
- **MVP order observed in the wild: translate first** (rotate/scale reuse ~80% of the
  infrastructure; scale has the most edge cases). Orbit-suppression while dragging + gizmo
  pick-priority over scene pick are required interaction plumbing. Snapping/plane-handles/
  local-vs-world toggle are second tier.

## 6. Selection highlight

The reference web editor (three.js) ships **world-space AABB lines** as the entire selection
visual. Furnace's existing `frame.drawLines` overlay (built for physics debug-draw) makes this
**free** — 8 corners → 12 segments through the same path. Outline post-passes (stencil/dilate,
JFA) are the editor-grade upgrade ladder later; an id-buffer built for picking gives an
id-edge-detect outline nearly free *if* the id pass runs per repaint (ours would run per click —
so AABB lines remain the M5 answer).

## 7. Implications for the M5 brainstorm (questions the evidence sharpens)

1. **Inspector engine:** evidence strongly favors hand-rolled kind→renderer registry (shadcn
   components, ~10 kinds, default-fallback + per-field override chain, per-row error
   boundaries). The JSON-Forms-vs-RJSF question from M3 is effectively answered "neither" —
   confirm and record.
2. **Scrub/drag commit seam:** adopt Theatre-style `temporarily/discard/commit` as the binding
   interface? Interacts with M4's session: preview = viewport-local (no daemon op) vs streamed;
   commit = one `setComponent` (one undo snapshot — M4's snapshot-per-mutation makes
   PlayCanvas-style coalescing unnecessary if previews never hit the daemon).
3. **Mutation granularity:** keep whole-component `setComponent` + client-side merge, or add a
   path-level `setComponentField`? (PlayCanvas is path-level; our scale may not need it.)
4. **Selection service:** chrome-level shared selection state (viewport + entities panel +
   inspector as clients); undoable or not.
5. **Picking:** GPU id-buffer (editor consensus, on-click render, MSAA caveat) vs CPU ray
   (needs retained geometry). Engine work either way: NDC-unproject camera ray.
6. **Gizmo scope:** translate-first MVP with transform-gizmo's math as the spec; rotate/scale
   in-milestone or follow-on; where gizmo rendering lives (depth-cleared overlay pass vs
   drawLines-style overlay).
7. **Hierarchy:** flat EntitiesPanel + selection sync may suffice for M5; tree library
   (headless-tree) decision deferrable until the hierarchy component exists.
8. **Safari:** scrubbing must not depend on Pointer Lock (Base UI ScrubArea disabled there);
   test scrub + gizmo drags in Safari first per [[project_furnace_primary_browser]].

## Sources

Agent-verified primary sources, 2026-06-11: npm registry + GitHub APIs (all version/activity
claims); jsonforms.io custom-renderer docs; rjsf docs + `@rjsf/shadcn` README; pmndrs/leva
docs (controlled inputs/transient); zod.dev/json-schema; base-ui.com NumberField docs;
playcanvas/editor + pcui + observer source (attributes-inspector.ts, observer-sync.ts,
reparent.ts, history.ts, SliderInput); BabylonJS/Babylon.js inspector-v2 source
(propertiesService.tsx, boundProperty.tsx, sceneExplorer.tsx) + Inspector v2 announcement;
Unity ScriptAttributeUtility.cs; Godot inspector docs + editor_inspector.cpp; three.js editor
(History.js, commands/, libs/ui.js) + TransformControls.js (full read); theatre-js/theatre
propEditors source + studio API docs; triplex.dev docs; puckeditor.com custom-fields docs;
webgpufundamentals.org/webgpu/lessons/webgpu-picking.html; W3C WebGPU spec texture-format-caps
(r32uint multisample row); Babylon gpuPicker.ts + utilityLayerRenderer.ts; PlayCanvas
Picker/TransformGizmo API docs; urholaukkarinen/transform-gizmo (full crate read);
github.com/jameskerr/react-arborist; headless-tree.lukasbach.com + successor announcement.

**Fed:** the editor M5A inspector + M5B viewport-interaction design (picking, gizmo math, form engine), as-built in `docs/reference/editor-architecture.md`; cited by name from the M5B viewport entries in `docs/backlog/editor-and-tooling/` — `gizmo-controller-extraction.md`, `per-field-focus-guard-redundancy.md`, `gizmo-commit-materializes-defaults.md`, `no-op-revision-suppression.md` and `inspector-fields-have-no-component-tests.md` (one merged tracker, `editor-M5B-viewport-interaction.md` (gone), until the genre-contracts un-merge).
