# Editor backend as fourth pillar

The editor surface, once it materialises, doesn't fit any current furnace pillar. Today's model is engine (`@furnace/core`) / harness (`@furnace/tools`) / consumer (`hello-world`). The editor is two things glued together: a thin furnace consumer for its viewport and UI rendering, and a long-running application server backend that orchestrates external authoring tools (Blender headless, Aseprite CLI, ComfyUI, TTS engines, filesystem watching, asset-graph state, job queues, possibly GPU-bound model invocation).

Four shape decisions captured here so they don't get relitigated when the work starts:

1. **It's a fourth pillar, not a `furnace-runtime` extension.** The runtime shell is a thin "engine in a native window" wrapper. The editor backend is a real application server — different shape entirely. Separate Rust crate in the `furnace-runtime` family.
2. **MCP-first protocol.** Expose capabilities as MCP services (`mesh.generate`, `sprite.bake`, `audio.synthesize`, `assets.watch`, `pipeline.run`, …). Three audiences for free: the editor's own UI, human users via CLI, and AI agents (Claude included). The "AI scripts the editor" capability falls out for free instead of being a later retrofit.
3. **Separate distribution problem.** Not vendored into consumers like `furnace-runtime` is. Probably ships as a standalone desktop app that bundles or downloads the backend, or — closer to how Blender + blender-mcp work — the backend ships separately and the editor frontend connects to it. The latter lets CI / headless / agent-driven workflows use the backend without the GUI.
4. **Frontend stays a furnace consumer.** Viewport, scene graph, UI rendering all in `@furnace/core` via WebGPU. Only the backend talks to native subprocesses, AI model runtimes, and the filesystem. The browser-only core contract is not compromised.

**Trigger to revisit:** When concrete editor work begins. Any of these counts:
- First asset pipeline command in `@furnace/tools` that needs more than one shot to complete (job queue, file watching, daemon territory).
- First interactive scene-editing surface that can't reasonably live inside `hello-world`.
- First integration with an external authoring tool (Blender, Aseprite, ComfyUI, a TTS engine).

**Reference:**
- `docs/research/2026-05-25-ai-asset-authoring/` — research on what authoring tools the backend would orchestrate, why MCP is the natural shape, and the connection to AI-character runtime work.
- `docs/reference/packaging-and-distribution.md` — engine/harness principle this extends.
- `docs/backlog/ai-agents/llm-as-planner-experiments.md` — the runtime side of AI-in-furnace; the editor backend's design should consider how baked assets (voice clones, dialogue libraries) feed the runtime AI.
