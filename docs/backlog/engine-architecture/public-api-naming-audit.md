---
summary: audit every coined public name against industry vocabulary and run the rename batch before the first npm publish, while renames are still free
---

# Public API naming audit — align coined names with industry-standard vocabulary

As the `@furnace/core` surface grows, several operations have ended up with **coined names that deviate from the well-understood, common terms** used by the engines/libraries we research against (three.js, pmndrs/postprocessing, Babylon.js, Bevy, Unity, Godot, wgpu/sokol). Naming matters for two reasons beyond ergonomics: (1) a consumer who knows three.js/Babylon should map furnace concepts onto prior knowledge with no friction, and (2) **our own prior-art research is keyed on vocabulary** — if we call a thing something nobody else does, we can't find the precedent that would inform its design. Surfaced during the Stage 2b T2 brainstorm (2026-06-06): the multi-pass effect factory landed as the provisional `post.createPasses`, which describes its *input* (passes) rather than its *output* (an `Effect`) and matches **no** engine's verb-noun — the cross-engine vocabulary is unit = "effect", stage = "pass", container = "pipeline"/"composer", and none use "compose"/"chain"/"createPasses". `post.createPasses` is good-enough and descriptive for 2b, but it is an explicit audit candidate, not a settled name.

The audit: enumerate every public operation/type in `core-modules.md`, classify each name as **(a) industry-standard** (`create`, `render`, `tonemap`, `bloom`, `requestContext`-as-platform-mirror), **(b) reasonable furnace coinage** (`fixedClock`, `drawLines`), or **(c) deviation worth reconsidering**. For each (c), record the industry-standard equivalent term and decide rename-vs-keep-with-rationale. Candidate (c) list to start from (non-exhaustive, verify each against source): `post.createPasses` (provisional), `markFrameBoundary`, `bindToCanvas`, `getDebugLines`, `normalColor`/`texturedLit`, the `policy.*`/`blend.*` sub-namespaces, `stats.gauge`/`stats.measure`, `ShaderSource`/`shader.source`/`toWgsl` (Stage 2.5). `ShaderSource` is a deliberate coinage (no AAA source-level term-of-art; closest: three.js `ShaderChunk`); the likely `Shader` → `ShaderModule` rename leaves `ShaderSource` stable (it names the pre-compile source layer, distinct from the compiled module it feeds). Output: a rename batch (cheap now — all packages private + unpushed; atomic cross-package rename like `draw→meshes`) plus an **`api-posture.md` rule** ("prefer the industry-standard term; when coining, document the coined name + its closest industry equivalent in the TSDoc, so future research can find the precedent"). Do the rename batch **before public release / first npm publish** — coined names are free to change now and expensive after consumers depend on them.

This is a focused hygiene tranche of its own (cross-cutting, needs design depth, biases reductive) — not an inline fix and not something to fold into 2b. Run it after the Visual Fidelity epic when the post + lighting + shadow surface has stabilised, so the audit sees the full coined-name set at once rather than chasing a moving target.

**Trigger to revisit:** Before public release / first `@furnace/core` npm publish (hard deadline — renames are cheap only while unpushed + private); OR when the count of coined (c)-class names crosses ~8 and the inconsistency becomes a research/onboarding tax; whichever comes first. Promote out of backlog as its own tranche after the Visual Fidelity epic seals.

**Reference:** `docs/reference/api-posture.md` (R4 construct-naming, R7 escape-hatch convention — the audit extends these with a "prefer-industry-term" rule); `docs/reference/core-modules.md` (the surface to enumerate); the Stage 2b T2 surface, where `post.createPasses` is recorded as provisional; memory `feedback_research_prior_art_before_options` (why vocabulary alignment feeds research).

---

## Stage 3 Phase 2 provisional names — lighting toolkit + frame types (2026-06-07)

**Provisional — names not yet audited.** The following new public surface landed in Stage 3 Phase 2 (multi-light Blinn-Phong). All names are working names coined to be descriptive; none have been cross-referenced against industry vocabulary (three.js, Babylon, Bevy, Unity, sokol/wgpu) for the naming audit tranche.

**`@furnace/core/shader` lighting fragments:**
- `shader.sceneBinding` — the `ShaderSource` fragment exporting the Scene/Light WGSL structs at `@group(0) @binding(1)`. The "Binding" suffix follows engine convention but "SceneUbo" or "sceneBlock" are plausible alternatives.
- `shader.lightingHelpers` — the `ShaderSource` fragment exporting the Blinn-Phong WGSL helpers. "Helpers" is vague; three.js uses "chunk" (`ShaderChunk`); Bevy uses "shader_defs". The `fr_` prefix on WGSL functions is engine-coined — no cross-engine precedent confirmed.

**WGSL function names (inside `lightingHelpers`):**
- `fr_shade` — the top-level Blinn-Phong shading call. The `fr_` namespace prefix is a collision-avoidance convention; alternatives: `furnace_shade`, no prefix + documented shadowing risk.
- `fr_windowedInvSq` — windowed inverse-square attenuation. The term "windowed inverse-square" is Filament/ACES-calibrated but the function name is coined; industry uses `GetDistanceAttenuation` (Unity), `attenuation` (three.js).
- `fr_spotCone` — spot light angular falloff. Standard term is `spotAttenuation` (three.js) or `SpotAngleAttenuation` (Unity).
- `fr_ambient` — hemisphere ambient. No strong industry consensus; three.js uses `getAmbientLightIrradiance`.

**`@furnace/core/frame` light types:**
- `frame.Light` / `DirectionalLight` / `PointLight` / `SpotLight` / `Ambient` — type names match three.js / Babylon / Unity vocabulary closely; low-risk candidates. `Ambient` (not `AmbientLight`) is a deliberate coinage reflecting its value-type-not-a-light posture — worth a TSDoc note in the audit.
- `RenderOptions.lights` / `RenderOptions.ambient` — field names; "lights" is universal; "ambient" is clear but could be `ambientLight` for consistency with the type suffix pattern.

**Other (surfaced mid-Phase-2):**
- `mat4.normalFromMat4` — inverse-transpose for normal matrix. three.js uses `getNormalMatrix`; GLSL stdlib uses `normalMatrix` as a builtin name; "normalFromMat4" is a glMatrix-style verb-noun coinage.

**Trigger:** same as the entry above — before first `@furnace/core` npm publish; or when the coined-name count becomes an onboarding tax. Fold into the existing naming-audit tranche rather than opening a new one.

**Reference:** `packages/core/src/shader/lighting.ts` (the fragments); `packages/core/src/frame/lights.ts` (the light types); `packages/core/src/transform/mat4.ts` (`normalFromMat4`).
