# Scene serialization — the core-resident interchange contract

A core-resident format + loader for scene state: a serialized scene the engine can **save and load** without the editor. This is the artifact that makes furnace's dual-mode story work (see `editor-and-tooling/editor-backend-architecture.md` decisions 5–6): the editor *produces* it, code can *build the same scene directly*, and a consumer with only `@furnace/core` installed can *load* it.

**Why this is the linchpin, not a nice-to-have.** "Furnace is both a code library and an editor-authored engine" only holds if both paths converge on one runtime representation that core itself can reconstruct. If the loader lives in the editor (or the format encodes editor-only semantics), editor-authored artifacts stop porting to plain-core projects and "both" silently collapses into editor-primary. The discipline — **loader in core; the editor emits only what the core loader understands** — is enforced *here*, in the format + loader design.

Precedent: Godot `.tscn` + `PackedScene`, Unity scene/prefab serialization, three.js editor JSON + `THREE.ObjectLoader`. All separate the authoring tool from the format; the runtime loads the format with no editor present.

**Surfaced by:** the 2026-06-06 editor-strategy exploration, which found this concern entirely untracked despite being the foundation of the agreed dual-mode direction.

## Open design questions (for the brainstorm, not decided here)

- **Format.** Human-readable JSON (diff-friendly, editor-and-hand-authorable, three.js-style) vs binary (compact, fast, Godot-style) vs both (text for authoring, baked binary for ship). Lean text-first.
- **Resource references.** A scene references textures/shaders/geometry/materials — by URL? content-hashed asset id? embedded? This couples to `assets-loader-module.md` and to consumer-owned-resource ownership (`scene-based-resource-ownership.md`). The loader must resolve references to live GPU resources via the existing `*.create` / `*.load` paths.
- **Versioning & migration.** Scenes outlive the engine version that wrote them. Needs a version stamp and a migration story from day one (the predictable rot otherwise).
- **What is a "node".** Depends on the scene representation chosen (`scene-graph-helpers.md` node tree vs an ECS entity/component snapshot, `component-schemas.md`). Serialization should target the *representation* decided there — it is the encode/decode layer on top, not the model itself.
- **Partial / streaming loads.** Full-scene load is the v1; level streaming / additive loads are a later concern (overlaps `unified-job-system.md`, `scene-based-resource-ownership.md` bundle/tag teardown).
- **Round-trip fidelity.** Save → load → save must be stable (no drift), and a scene built in code must serialize to the same shape the editor would emit — otherwise the two authoring paths diverge.

## Relationship to the scene-model cluster

This is the **encode/decode + loader** layer. It sits on top of whatever scene representation `scene-graph-helpers.md` (lightweight node tree) or the ECS items (`component-schemas.md`, `ecs-data-oriented-soa-layout.md`) settle on — it does not decide that. It coordinates with `scene-based-resource-ownership.md` (the loaded scene is an ownership root whose `destroy` cascades what it instantiated) and `assets-loader-module.md` (how referenced assets are fetched).

**Trigger to revisit:** Scene-model epic kickoff — serialization is part of that epic's scope, not a separate later thing (the loader is what makes the scene model useful beyond a single session). Also when editor work begins, since this is its hard prerequisite. **Now milestone 1 of the editor epic — `docs/superpowers/specs/2026-06-09-editor-epic-design.md` (DRAFT).**

**Reference:** `editor-and-tooling/editor-backend-architecture.md` (dual-mode decisions 5–6 + Gating prerequisite), `scene-graph-helpers.md`, `scene-based-resource-ownership.md`, `component-schemas.md`, `assets-loader-module.md`.
