# Editor backend as fourth pillar

The editor surface, once it materialises, doesn't fit any current furnace pillar. Today's model is engine (`@furnace/core`) / harness (`@furnace/tools`) / consumer (`hello-world`). The editor is two things glued together: a thin furnace consumer for its viewport and UI rendering, and a long-running application server backend that orchestrates external authoring tools (Blender headless, Aseprite CLI, ComfyUI, TTS engines, filesystem watching, asset-graph state, job queues, possibly GPU-bound model invocation).

Shape decisions captured here so they don't get relitigated when the work starts (decisions 1–4 predate the 2026-06-06 strategy exploration; decisions 5–6 and the sections below came out of it):

1. **It's a fourth pillar, not a `furnace-runtime` extension.** The runtime shell is a thin "engine in a native window" wrapper. The editor backend is a real application server — different shape entirely. Separate Rust crate in the `furnace-runtime` family.
2. **MCP-first protocol.** Expose capabilities as MCP services (`mesh.generate`, `sprite.bake`, `audio.synthesize`, `assets.watch`, `pipeline.run`, …). Three audiences for free: the editor's own UI, human users via CLI, and AI agents (Claude included). The "AI scripts the editor" capability falls out for free instead of being a later retrofit.
3. **Separate distribution problem.** Not vendored into consumers like `furnace-runtime` is. Probably ships as a standalone desktop app that bundles or downloads the backend, or — closer to how Blender + blender-mcp work — the backend ships separately and the editor frontend connects to it. The latter lets CI / headless / agent-driven workflows use the backend without the GUI.
4. **Frontend stays a furnace consumer.** Viewport, scene graph, UI rendering all in `@furnace/core` via WebGPU. Only the backend talks to native subprocesses, AI model runtimes, and the filesystem. The browser-only core contract is not compromised.
5. **Dual-mode, not either/or — the serialized scene is the interchange.** Furnace is *both* a code-first library (consumers `import @furnace/core` and build scenes in TS — the one-off / website-embed path) *and* an editor-authored engine (author in the editor, ship scene artifacts — the full-game path). These coexist because both converge on one runtime representation: the editor produces a scene artifact, code can build the same scene directly, and a consumer with only core installed loads the artifact. This is standard engine architecture (Godot `.tscn`, Unity scenes/prefabs, three.js editor JSON + `ObjectLoader`).
6. **The editor emits only core-loadable artifacts.** The load-bearing discipline that keeps dual-mode honest: the scene *loader lives in core*, and the editor adds *workflow and opinionated defaults*, never *runtime semantics core cannot reconstruct*. Defaults bake into the artifact as concrete data (a new scene gets a camera + light → those are just nodes in the file). Higher-level abstractions the editor leverages must live *below* it (in core or a core-adjacent opinionated layer), or artifacts won't port to plain-core projects and "both" silently collapses into editor-primary. This is also what keeps the editor frontend genuinely *thin*. (Editor-frontend UI tech is an open downstream call — likely to differ from the in-page Svelte 5 of `ui-foundation.md`, e.g. a desktop Tauri/Electron shell; it does not affect the core contract.)

## Gating prerequisite: the scene model

The editor is, definitionally, a scene-state authoring-and-inspection tool — and furnace has **no persistent, serializable scene representation today**. Demos build their world imperatively (~85 of the ~155 lines of a cookbook `entry.ts` is construction) and pass `{ meshes, camera }` to `frame.render`. There is nothing to edit, save, or introspect. So the editor's true prerequisite is a **scene model + core-resident serialization** — not AI, not UI.

This keystone is justified *independently of the editor*: it also unlocks save/load, the inspector (`svelte-editor-inspector-surfaces.md` triggers "when ECS lands"), and the runtime LLM-planner (`llm-as-planner-experiments.md` needs entity/world state). Build it for its own sake; the editor becomes tractable once it exists.

Dependency order: **scene representation → serialization / loader (the interchange contract) → introspection → MCP-shaped command layer (decision 2 — this is the "AI from day one" mechanism) → frontend + backend.** A *serializable scene tree* (three.js / Godot node-tree style) is enough to start — this does **not** gate on the heavy data-oriented ECS (`ecs-data-oriented-soa-layout.md`).

Scene-model cluster this keystone draws from:
- `engine-architecture/scene-graph-helpers.md` — runtime hierarchy / world-matrix composition (the *structure*).
- `engine-architecture/scene-serialization-interchange.md` — the save/load format + core loader (the *interchange contract*; the linchpin of dual-mode — created from this exploration because it was previously untracked).
- `engine-architecture/scene-based-resource-ownership.md` — `Scene` as the ownership / teardown root.
- `engine-architecture/component-schemas.md` / `engine-architecture/ecs-data-oriented-soa-layout.md` — component definitions / data-oriented storage (heavier; not required to start).

## Relationship to the cookbook

The editor does **not** replace the cookbook — it absorbs its *boilerplate*. The maintenance taxes map cleanly: imperative scene construction → removed by the scene model + serialization; bespoke per-demo `controls.svelte` → removed by the editor's introspection-driven inspector (a generic property panel for free); manual dispose discipline → removed by scene-based ownership. The cookbook's durable value — the teaching prose — survives as annotations on example scenes, collapsing a demo from a 5-file mini-app to "a scene file + the prose." The *biggest* tax (construction) is removed by the scene model alone, with or without the editor — which is why the keystone, not the editor, is the thing to build first.

**Trigger to revisit:** When concrete editor work begins. Any of these counts:
- First asset pipeline command in `@furnace/tools` that needs more than one shot to complete (job queue, file watching, daemon territory).
- First interactive scene-editing surface that can't reasonably live inside `hello-world`.
- First integration with an external authoring tool (Blender, Aseprite, ComfyUI, a TTS engine).

Timing (2026-06-06): editor *design* can proceed in parallel with other epics (it's mostly thinking + the scene-model spec, which is wanted regardless). Editor *build* waits on the scene-model epic landing — see the Gating prerequisite above. The recommendation from the exploration: finish the in-flight Visual Fidelity epic → scene-model epic next → editor build after.

**Reference:**
- `docs/research/2026-05-25-ai-asset-authoring/` — research on what authoring tools the backend would orchestrate, why MCP is the natural shape, and the connection to AI-character runtime work.
- `docs/reference/packaging-and-distribution.md` — engine/harness principle this extends.
- `docs/backlog/ai-agents/llm-as-planner-experiments.md` — the runtime side of AI-in-furnace; the editor backend's design should consider how baked assets (voice clones, dialogue libraries) feed the runtime AI.
