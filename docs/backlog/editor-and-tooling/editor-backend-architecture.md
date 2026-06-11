# Editor backend as fourth pillar

> **Epic:** `docs/superpowers/specs/2026-06-09-editor-epic-design.md` (DRAFT) — the editor epic frame; objective = replicate the bowling demo. **This doc is its design home** (the detailed architecture + decisions live here; the epic spec is the milestone-level frame).

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

## M3 resolutions (2026-06-10 design session; spec gitignored — this is the durable record)

- **Daemon runtime (open-decision 2) — RESOLVED: Node-portable source.** No `Bun.*` in daemon
  source (static-scan-enforced); esbuild for extension bundling; runs under Node ≥20 and Bun.
  Prior art: dev-loop daemons (Vite/Storybook) assume the project's standard runtime; VS Code
  writes Node-API source and provisions the runtime per distribution (Electron's Node locally,
  bundled Node for the remote server). Keeps both doors open: devDependency on the system runtime
  today, self-contained `bun build --compile` binary later.
- **UI framework (open-decision 3) — RESOLVED: React 19 + dockview + Tailwind/shadcn** for the
  editor chrome. **Svelte 5 remains the committed framework for consumer/in-page UI**
  (`docs/reference/ui-foundation.md` boundary unchanged). RJSF-vs-JSON-Forms deferred to M5.
- **Project-first resolution invariant.** The editor contains NO engine: the daemon bundles the
  consumer's `@furnace/core` + extensions + the editor's viewport-host source from the consumer's
  `node_modules` into one ESM bundle (`/engine.js`) — one core/registry/zod instance (Branch A's
  instance-identity requirement). Consequences: devDependency + run command now; a global
  launcher / compiled binary is a *packaging* step later, not a re-architecture; "editor bundled
  into core" is ruled out (core is browser-only).
- **Tab now, native shell later.** Browser tab over the same-origin daemon for M3+. A native
  window is a packaging shell around the same daemon+frontend; **lean: Tauri** over extending the
  in-house wry shell ("our Electron" — menus/updater/signing out of the box); `furnace-runtime`
  stays the consumers' *game* shell. Decide at the packaging epic.
- **Command transport.** A zod-validated handler registry (Map) behind `POST /api/<command>`
  (M3: `scene.list`, `scene.read` only — read-only shell). M4 mounts MCP over the same Map and
  adds mutations; reflection comes from the engine bundle in the browser (`host.introspect()`),
  not a daemon command.
- **`ViewportHost { init, loadScene, render, introspect, destroy }`** is the chrome↔engine protocol —
  the narrow interface the Tauri shell and M4 command layer version against. (`render()` re-issues the
  current scene on demand — panel resize — since the editor viewport is render-on-demand, no loop.)

**Trigger to revisit:** When concrete editor work begins. Any of these counts:
- First asset pipeline command in `@furnace/tools` that needs more than one shot to complete (job queue, file watching, daemon territory).
- First interactive scene-editing surface that can't reasonably live inside `hello-world`.
- First integration with an external authoring tool (Blender, Aseprite, ComfyUI, a TTS engine).

Timing (2026-06-06): editor *design* can proceed in parallel with other epics (it's mostly thinking + the scene-model spec, which is wanted regardless). Editor *build* waits on the scene-model epic landing — see the Gating prerequisite above. The recommendation from the exploration: finish the in-flight Visual Fidelity epic → scene-model epic next → editor build after.

**Reference:**
- `docs/research/2026-05-25-ai-asset-authoring/` — research on what authoring tools the backend would orchestrate, why MCP is the natural shape, and the connection to AI-character runtime work.
- `docs/reference/packaging-and-distribution.md` — engine/harness principle this extends.
- `docs/backlog/ai-agents/llm-as-planner-experiments.md` — the runtime side of AI-in-furnace; the editor backend's design should consider how baked assets (voice clones, dialogue libraries) feed the runtime AI.

## Packaging & repo access — the local/cloud dichotomy (2026-06-09 design session + research)

From a design conversation plus a research pass on how others handle "local repo vs browser/cloud editor." **The dichotomy is false: "browser UI" and "cloud compute" are independent axes.** Four industry patterns (sources in the session; key ones: VS Code Remote Tunnels docs, PlayCanvas editor, WebContainers docs, File System Access API caniuse):

- **Local daemon + browser UI** (Vite `:5173`, Storybook `:6006`, Jupyter, ComfyUI): a localhost server runs *in the repo* and serves a web frontend with full local FS/subprocess access. Browser-ness and local-ness don't conflict — the daemon bridges them. **← furnace default.** Safari is fine (renders a tab hitting localhost; the daemon does the files).
- **UI-anywhere + compute-where-files-are + relay** (VS Code tunnels / Codespaces / vscode.dev): one web UI; the server runs where the files live — local machine via an encrypted relay, *or* a cloud container. Same UI, **pluggable backend location**. **← optional upgrade/collab path; do not build it either/or.** Composes with the MCP transports below.
- **Cloud-native project** (PlayCanvas): project + assets live in the cloud, real-time multi-user, no local repo. The only *true* "cloud version" — costs local-first, contradicts furnace's dual-mode thesis (your repo, your git). Possible optional hosted offering later atop the same scene format; never the default.
- **Pure browser / WebContainers**: out for the full editor — can't run native asset-pipeline tools (Blender/ComfyUI), and local-repo access needs the File System Access API, which is **Chromium-only** (Safari + Firefox don't support `showDirectoryPicker` as of 2026-06; Apple flagged it "harmful", no commitment). Since Safari is furnace's primary test browser (`project_furnace_primary_browser`), pure-browser-touches-local-repo is dead on the primary target — which makes the **local daemon mandatory** for the local-repo story (removes this branch).

**Decision:** editor = **web frontend over an MCP capability layer, local daemon by default, relay/cloud bridge as an optional later flavor that never moves the repo off disk.** Packaging is a deployment choice, not an architecture fork — same React frontend against a local daemon, a Tauri shell, or a relay.

### Refinements to decisions 1 & 3
- **Decision 1 split.** The "one Rust application server" conflates two layers: (a) **dev-loop daemon** — serve files, watch FS, transpile/bundle the consumer's TS extensions, HMR — is JS web-dev work (Bun/Node, *not* Rust); (b) **asset-pipeline backend** (Blender/ComfyUI/TTS) — native orchestration — is the Rust MCP service. Likely two layers; the daemon brokers to the Rust service. Keep the daemon **Node-compatible** (not Bun-locked) to honor the tools-shim "plain Node ≥20" posture. **Daemon language — RESOLVED 2026-06-09 (epic spec §7): the schema-discovery fork landed on Branch A** — the editor imports the consumer's *compiled JS* and extensions self-register, so the daemon **is a JS runtime**. Codegen-JSON-Schema (which would have kept a pure-Rust daemon viable) was rejected: the runtime must run extensions anyway (behavior can't be reconstructed from data), so it only added a second, drift-prone schema representation; B's lone win — isolating *untrusted* code — only matters for a hosted editor, which is fenced out. The Rust *asset-pipeline* service (b) is unaffected — it stays Rust; the JS daemon brokers to it. Full rationale: epic spec §7.
- **Decision 3 variant.** Editor ships as a **devDependency** in the consumer repo with a run command (Storybook/Vite model), running in-repo for native FS access. If the daemon **serves the frontend itself** (same origin), it dissolves both the Safari File-System-Access gap and the localhost-CORS/mixed-content friction.

### Scene model = milestone 1 (the gating keystone, bundled under this epic)
- **Adopt the composition half of ECS** (entities + typed components; hierarchy is itself a component) as the spine — it's the editor's reflection target (the inspector reflects over *components*) and the serialization unit. **Do NOT gate on data-oriented SoA storage** (the perf half); defer per `engine-architecture/ecs-data-oriented-soa-layout.md`.
- **Format describes logical composition, not storage layout** (entities + components + parent relation + resource refs) so the runtime can deserialize into plain objects now and SoA later with no format change. This is `feedback_storage_vs_input_type_rule` at scene scope: the scene file is *input*, runtime ECS storage is *storage*.
- **One component registry, two readers**: extensions register a type's `params` schema; the editor reflects it at edit-time (inspectors), core's loader reads it at run-time to instantiate from the scene file. `index.ts` must import the extensions *before* `loadScene` so the registry is populated at runtime too. **(Resolved 2026-06-09, epic spec §7:** each type registers two halves — `params` (serializable data → artifact + inspector) and `build`/`update` (TS behavior, run at instantiate/loop, never serialized) — the concrete shape of the data/behavior boundary. The registry covers components **and** a scene-level render-settings schema, but **not** render techniques/passes, which are core-internal "edit core".)
- **MCP command layer**: editor verbs defined once as MCP tools (`scene.addEntity`, `scene.setComponent`, `mesh.generate`…); every mutation (button / CLI / Claude) funnels through one handler set → single place for validation, undo/redo, invariants (command pattern). Transports: HTTP-localhost (daemon), in-process IPC (Tauri), or a Claude tool-use loop (local loop simplest for a local editor; a remote Managed Agent needs the server exposed via URL or custom-tool brokering).
- **Milestone 1 must be independently shippable**: save/load + headless scene loading with zero editor UI (`bun start` loads a hand-authored-then-serialized scene). Proves the interchange contract (decision 6) before any UI is built.
