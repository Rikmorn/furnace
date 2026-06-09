# Scene serialization — the core-resident interchange contract

A core-resident format + loader for scene state: a serialized scene the engine can **save and load** without the editor. This is the artifact that makes furnace's dual-mode story work (see `editor-and-tooling/editor-backend-architecture.md` decisions 5–6): the editor *produces* it, code can *build the same scene directly*, and a consumer with only `@furnace/core` installed can *load* it.

**Why this is the linchpin, not a nice-to-have.** "Furnace is both a code library and an editor-authored engine" only holds if both paths converge on one runtime representation that core itself can reconstruct. If the loader lives in the editor (or the format encodes editor-only semantics), editor-authored artifacts stop porting to plain-core projects and "both" silently collapses into editor-primary. The discipline — **loader in core; the editor emits only what the core loader understands** — is enforced *here*, in the format + loader design.

Precedent: Godot `.tscn` + `PackedScene`, Unity scene/prefab serialization, three.js editor JSON + `THREE.ObjectLoader`. All separate the authoring tool from the format; the runtime loads the format with no editor present.

**Surfaced by:** the 2026-06-06 editor-strategy exploration, which found this concern entirely untracked despite being the foundation of the agreed dual-mode direction.

## Resolved decisions (2026-06-09 — M1 design)

**Now active as editor-epic M1.** Full design + bowling mapping + SOTA grounding in the (gitignored) spec `docs/superpowers/specs/2026-06-09-editor-M1-scene-format-and-behaviors-design.md`; the component/behavior contract riding on this format is in `component-schemas.md`. What was settled:

- **Format = text JSON.** Skeleton `{ version, settings, resources, entities }`. Baked-binary is a later, additive concern.
- **Resources = id-keyed table, dependency-ordered load**, referenced by **human-readable string ids** (diffable; content-hashing deferred with the asset pipeline). Content policy: **procedural generators by params + embedded bytes**; **external file / asset-id refs deferred** (asset-pipeline epic). Resource kinds are an **extensible tagged union** — adding a `url`/`assetId` variant later is backward-compatible, not a breaking migration. Built-in shaders referenced by `kind`; material uniforms serialize as inline `params`. Loader resolves refs to live GPU resources via the existing `*.create`/`*.load` paths.
- **A "node" is a uniform-ECS entity** with typed components (`{ type: params }`) — **camera and lights included** (a light is a selectable/parentable scene object). **Transform owns all spatial data**: light/camera carry only non-spatial params, `rigidBody` seeds its pose from `transform`, and `direction`/`target` are authoring sugar baked to `transform.rotation`. The loader **projects** entities into core's existing `Light[]`/`Camera` — **no core render-API change** (decision 6).
- **Rotation stored as a quaternion** `[x,y,z,w]` (round-trip-stable); the editor edits euler degrees and bakes. Position/scale stay readable arrays.
- **Versioning:** integer `version` + an ordered migration chain (old→current) in the core loader; **field renames handled explicitly in migrations** (no Unity-style silent loss).
- **Round-trip fidelity:** save→load→save stable; a code-built scene serializes to the editor's shape.
- **Still deferred:** partial/streaming loads (v1 = full-scene); SoA storage (format is storage-agnostic, so it lands later with no format change).

## Relationship to the scene-model cluster

This is the **encode/decode + loader** layer. It sits on top of whatever scene representation `scene-graph-helpers.md` (lightweight node tree) or the ECS items (`component-schemas.md`, `ecs-data-oriented-soa-layout.md`) settle on — it does not decide that. It coordinates with `scene-based-resource-ownership.md` (the loaded scene is an ownership root whose `destroy` cascades what it instantiated) and `assets-loader-module.md` (how referenced assets are fetched).

**Status:** **Active — editor-epic M1, design resolved 2026-06-09** (above). Implementation = format + core loader + built-in components, headless-load gate. **Lifecycle:** promote to a canonical `docs/reference/` doc and delete this backlog entry in the post-ship documentation phase.

**Reference:** `editor-and-tooling/editor-backend-architecture.md` (dual-mode decisions 5–6 + Gating prerequisite), `scene-graph-helpers.md`, `scene-based-resource-ownership.md`, `component-schemas.md`, `assets-loader-module.md`.
