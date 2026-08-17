# F2 "tools & materials" — tool-UX precedent research (2026-07-15)

Four-lane web sweep run during the F2 slice brainstorm, validating the editor-tool design
choices before the spec locked them. Companion to
`docs/research/2026-07-14-field-precedent-research.md` (the phase-level sweep). Each lane
returns a verdict on a specific design choice: SUPPORTS / REFUTES / REFINES.

## Lane 1 — brush chassis decomposition (shape × effect × mask × material)

**Verdict: SUPPORTS, with refinements.** The decomposition is the proven pattern of the
Minecraft-editor lineage; mask-as-cross-cutting-axis is explicitly validated.

- **Axiom** (Moulberry): shape and mask are clean shared axes (brush shapes sphere/cube/
  octahedron/cylinder/…; a dedicated Tool Masks window with OR/AND/NOT/OFFSET combinators
  over Block/Above/Below/Adjacent/Y/Angle/Surface/**In Selection** conditions, shown as a
  copyable string) — but **effect is the tool's identity**, not a dropdown: Painter,
  Sculpt, Smooth, Stamp are separate tools with **per-tool presets** (searchable dropdown +
  save button, persisted as shareable files). Mask support was rolled out tool-by-tool
  (2.0.0 added it to Slope/Elevation), and hot masks get promoted to one-click per-tool
  toggles (Painter's "Mask Surface"). [axiomdocs.moulberry.com/tools/intro.html,
  /editor/windows/toolmasks.html, /editor/toolpresets.html]
- **WorldEdit/FAWE**: the canonical **pattern** (what is written) vs **mask** (what may
  change) split. Masks compose with every block-affecting brush and stack by
  **intersection** (`//gmask` × brush `/mask`); FAWE splits mask further into destination /
  source / **targetmask** (what the crosshair ray may land on) and adds **transform** as a
  fourth axis. Patterns support weighted-random lists (`50%red_wool,10%glass`) —
  every studied material-writing system has weighted randomness.
  [worldedit.enginehub.org/en/latest/usage/general/masks/, /patterns/,
  intellectualsites.gitbook.io/fastasyncworldedit]
- **VoxelSniper**: brush (where) × performer (how) — but performers only cover shape
  brushes; effect brushes (erode/blend/canyon) stayed monolithic. The full-composability
  successor VoxelGunsmith was archived 2020 without displacing it — free-composition
  grammars are costly to finish; survivors ship **curated tools over a shared substrate**.
- **Sculpting class** (MagicaVoxel, Dreams, Substance Modeler): mode-per-tool or 2-axis
  models, **no mask axis** — masks are a discrete-voxel-with-materials pattern (our
  domain), not universal.
- **Coupling evidence**: effects gate the other axes (smooth has mask but no material;
  butcher has neither) — a UI pretending all four axes always apply shows dead controls.
- **Novelty flag**: lattice-snap on *brushes* has no precedent in any studied tool (snap
  exists on stamp/placement tools only). Our kit-write lattice discipline is unvalidated
  by prior art.

**Absorbed into the spec**: effect = palette-facing tool identity, chassis internal;
axis sections render conditionally per effect; material axis leaves a slot for weighted
patterns (designed-for, not built); the replace idiom (mask only-X + paint Y) is an
acceptance test; lattice-snap carries its own premise-table row.

## Lane 2 — selection semantics

**Verdict: SUPPORTS, with two refinements.** Every element has shipped precedent except
flood-select void.

- **Select-by-material flood**: FAWE `//sel fuzzy` ("Magic") — 6-neighbour pathfinder
  flood from a seed block, no radius arg, right-click adds seeds, generalizes to any mask
  (`fuzzy=<mask>`). MagicaVoxel Region-Select (same-volume flood, 4/8 + color/geometry
  connectivity). Blender Select-Linked bounds floods by **semantic delimiters** (material
  change) rather than budgets.
- **Flood budgets**: world-scale editors cap and abort loudly (WorldEdit `//limit`
  default 1000; FAWE `MAX_CHECKS` visited-cell budget → operation aborts with error).
  In-memory editors ship uncapped. No precedent found for showing a *partial* selection
  at cap — our stop-at-cap-with-feedback is friendlier than the abort convention.
- **Selection constrains + feeds**: WorldEdit region commands (`//set`, `//replace`,
  **`//regen`** — selection literally feeding a world generator), UE PCG Volumes, UE
  Landscape Region Selection (same dual use: constrain sculpt AND feed copy/paste),
  Houdini heightfield **mask layers** (selection stored as a per-cell field — the closest
  analog to our chunk-keyed mask; theirs fuzzy 0..1, ours binary).
- **REFINES-1 — selection undo**: WorldEdit keeps selections out of `//undo` (matches our
  v1) BUT users of exactly that tool requested a selection undo stack (cuberite/WorldEdit
  #61: "a single mis-click can destroy all that work"), and Photoshop — whose
  inside-selection semantic we adopt — makes selection changes undoable history states.
  Cost-to-rebuild is the split: laborious region selections want undo. Cheap v1
  mitigation with precedent: Photoshop-style **Reselect** (one last-selection slot).
- **REFINES-2 — the semantic is Photoshop's, not voxel-native**: MagicaVoxel's main
  brushes use the INVERSE contract (Attach/Erase/Paint operate on **unselected** voxels —
  selection as protection) and are inconsistent across tool classes. Our uniform
  "inside selection" is a deliberate adoption of the Photoshop contract, not voxel
  precedent.
- **Novelty flag**: flood-select **void** ("select this room") — no shipped precedent
  found anywhere; nothing refutes it. Genuinely our invention.

## Lane 3 — staged stamp/generator flow

**Verdict: SUPPORTS (strongly).** Every element of select-region → configure → preview →
re-roll → explicit commit → smart-object record has shipped precedent.

- **Pending-object commit**: Axiom Placement (pending paste with gizmo; **Enter = commit,
  Delete/Backspace = cancel**; merge options at commit time: Keep Existing / Merge /
  Paste Air); Axiom's own Stamp tool ships a **Deferred mode** (park, adjust via gizmo,
  then commit). [axiomdocs.moulberry.com/editor/placement.html, /tools/drawing/stamp.html]
- **Demand evidence for ghost previews**: WorldEdit/FAWE `//paste` has NO preview — and an
  entire ecosystem exists to fill the gap (Litematica translucent hologram + overlay
  strength; Create mod's walk-through hologram → explicit Place; server plugins
  hand-rolling fake-block previews).
- **Parametric-until-flatten**: Houdini HDAs stay parametric until explicit **Bake**
  (one-way, creates disconnected native assets) — the freeze≠bake analog; UE PCG
  components regenerate via Generate/Cleanup with **seed as a visible int property**
  ("lock your seed once you are happy"); UE Landscape Edit Layers = the list-stack reopen
  affordance.
- **Post-commit affordance**: universally a **list/outliner entry with a distinct
  icon whose selection reopens the params in the inspector** (Photoshop smart-object
  badge + double-click; HoudiniAssetActor; PCG actor; Landscape layer stack). No shipped
  tool draws persistent in-viewport markers for committed parametric objects — bounds
  show on selection only.
- **Ghost visual convention** (stable across Satisfactory/Fortnite/Valheim/Litematica):
  translucent **hologram blue/cyan = pending-valid, red = invalid/blocked**, yellow =
  warning; ghost is non-interactive/walk-through; no pulsing. Exact alpha uncodified
  (~40–60 % typical).
- **Seed/re-roll UI**: no single convention; PCG/Houdini = bare int + regenerate button.
  A one-click re-roll (randomize + regenerate) exceeds precedent; keep the seed visible
  and hand-editable beside it (the AI-tools seed-field + randomize pattern is the nearest
  convention).

**Absorbed**: hologram blue/red preview tints; Enter/Esc commit-cancel; visible editable
seed + dice re-roll; entities-list reopen affordance (no persistent viewport markers); a
merge-policy stamp param (replace vs keep-existing) — voxel stamp users expect the choice.

## Lane 4 — smooth semantics + palette/inspector UI

**Verdict A (smooth): SUPPORTS, with refinements.** Direct precedent for
blur-inside-brush on a density/SDF field: godot_voxel / UE Voxel Plugin smooth = **box
blur applied within a sphere, strength maximal at center with linear falloff, and
`strength` = a per-application MAX-DELTA CLAMP** (+ iterations param); Substance Modeler
smooths SDF clay with directional modes (**remove-bumps-only / fill-depressions-only**)
and a **channel split** (smooth clay vs color separately). Cautions: WorldEdit `//smooth`
is NOT a 3D precedent (it's a 2D Gaussian over a heightmap, documented unsuitable for
caves); the discrete-material 3D precedent is FAWE blendball's **majority-vote mode
filter** — blurring material IDs means blending them; unclamped iterated Laplacian
erodes thin walls (volume loss up to ~76 % in studies; Taubin/HC exist if ever needed).
Drag-feedback handling in shipped tools: single-shot-per-click + iterations (WorldEdit),
Shift-held momentary (Unity/Blender), or continuous-with-clamp (voxel plugins).
WorldEdit's convolution is **double-buffered** (read snapshot, write out) — the
determinism-friendly inner shape.

**Absorbed**: smooth = density-only box blur in the brush shape, center-max falloff,
strength as max-delta clamp (doubles as the thin-wall guard), iterations, single-shot per
click, double-buffered per application, optional raise-only/lower-only mode; material is
never blurred (mode-filter reserved if material smoothing is ever wanted).

**Verdict B (palette + one active-tool inspector): SUPPORTS.** The dominant pattern in
all five tools checked (Photoshop toolbar + Options Bar + named **Tool Presets**; Blender
toolbar + tool settings; Unity Terrain tool row + shared Brush Attributes overlay;
MagicaVoxel brush column + attributes; Substance Modeler's Palette). Voxel-specific
refinement: a **persistent material swatch strip** visible outside the tool inspector
(MagicaVoxel's always-on left palette) rather than nesting material choice per tool.

**Shortcut consensus worth copying**: `[`/`]` and/or wheel = brush size; **Alt-click =
material eyedropper** (Photoshop/MagicaVoxel/Unity `Shift+A`); **Shift-held = momentary
smooth** (Blender/Unity); **Ctrl = invert effect** (dig↔build, Unity); hotkey +
horizontal-drag scrubbing for size/strength (Unity A/S/D — congruent with the editor's
existing drag-scrub idiom).

## Net effect on the F2 design

Nothing was refuted. Adopted refinements: effect-as-tool-identity with the chassis as
internal model; conditional axis rendering; Reselect slot; partial-flood-at-cap feedback;
hologram blue/red ghosts with Enter/Esc; visible seed + re-roll; entities-list reopen;
stamp merge-policy param; the smooth spec above; persistent swatch strip; the shortcut
set. Flagged as unprecedented (kept, own risk): brush-level lattice snap; flood-select
void.

**Fed:** the F2 "tools & materials" spec — tool semantics, brushes, masks, stamps — cited by name in `docs/learnings/seals/2026-07-16-epic3-f2a-material-field.md`.
