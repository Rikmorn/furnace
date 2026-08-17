# AI asset authoring — research

*Investigation date: 2026-05-25. Pre-decision research; no commitments here. Conversational exploration of how AI-assisted asset authoring could fit furnace once the editor surface materialises. "A ways off" from any of this being actionable — captured now so the conversation isn't lost.*

## Why this folder exists

A conversation about adding AI to furnace's tooling, framed three ways:

1. **Authoring is offline.** `@furnace/core` is the runtime that loads and binds assets (glTF, sprite atlases, audio buffers). It does not author. Authoring lives in an editor or a CLI pipeline outside core's contract — and outside core's browser-only constraint.

2. **The editor is a fourth pillar.** Today's mental model is engine (`core`) / harness (`tools`) / consumer (`hello-world`). The editor doesn't fit any of them — it's a thin furnace consumer for its viewport, hooked to a long-running backend that orchestrates external tools (Blender, Aseprite, ComfyUI, TTS engines, …). See `docs/backlog/editor-and-tooling/editor-backend-architecture.md` for the architectural shape.

3. **MCP is the natural protocol.** If the editor backend exposes its capabilities as MCP services, three audiences get the same surface for free: the editor's own UI, human users via CLI, and AI agents (Claude included). Designing MCP-first means the editor is scriptable by AI on day one — which is the whole point of the experiment.

## Scope

Three asset domains, three files:

- [meshes-and-sprites.md](meshes-and-sprites.md) — text/image → 3D, procedural meshes, pixel art, sprite atlases
- [textures.md](textures.md) — AI-generated PBR map sets, LLM-written shaders (GLSL/WGSL), AI-driven node graphs (Material Maker, Blender shader nodes)
- [audio.md](audio.md) — music, SFX, voice/TTS, runtime synthesis, spatial audio

Animation, particle FX, world generation, dialogue trees are deliberately deferred until the others are clearer.

Texture authoring is the easiest of the three to drive from a Claude session — all three paths (image, algorithm, node graph) end in a PNG I can `Read`. Worth keeping in mind if/when a near-term spike on AI-asset-authoring is appealing; see `textures.md` §"The shader-generation experiment as a near-term spike."

## Connection to other AI research

- [`docs/backlog/ai-agents/llm-as-planner-experiments.md`](../../backlog/ai-agents/llm-as-planner-experiments.md) — LLM as game logic / character planner. The *runtime* side of AI-in-furnace.
- This research is the *authoring* side. Together they sketch what an "AI throughout the engine" furnace might look like:
  - AI authors the assets (this folder)
  - AI drives the characters at runtime (llm-as-planner)
  - AI scripts the editor itself (MCP-first design implication)

## Standing constraints

- **Apple Silicon dev environment.** Most heavy AI models are CUDA-first; running locally on M-series usually means MPS (slower than NVIDIA) or CPU only. Some tools (Piper, smaller models, fully-scriptable CLIs) work cleanly. Heavier ones (TRELLIS.2, Hunyuan3D, MusicGen-large) either need hosted APIs or a Linux/NVIDIA box. Called out per-tool in the files.
- **Engine/harness/editor split must hold.** None of this can leak into `@furnace/core`. The editor backend is the new home for native subprocesses, model invocation, and file watching — not core. Reference: `docs/reference/packaging-and-distribution.md` for the engine/harness principle this extends.
- **Output formats = furnace's native asset formats.** glTF/GLB for meshes, PNG + JSON atlas for sprites, Ogg/Opus/WAV for audio. AI tools must either produce these or convert into them via a bake step.

## What this research is not

- Not a plan. There's no commitment to build an editor backend, integrate any specific tool, or adopt any specific model.
- Not a buy/build recommendation. Tool quality changes fast in 2026; revisit when the work becomes actionable.
- Not exhaustive. Captures what surfaced in two focused conversations; gaps (e.g. dialogue trees, narrative AI, animation generation) are deliberate.

## What to do with this when the editor work starts

1. Re-verify model availability and quality — the 2026 AI tooling landscape is moving fast; some tools listed here will have been surpassed, deprecated, or licence-changed.
2. Pull the editor backend backlog entry out of `docs/backlog/` and start a proper architecture doc in `docs/reference/`.
3. The MCP-first decision should be reconsidered against MCP's state at that time. If MCP has been superseded or fragmented, the conclusion changes.

**Fed:** no decision — the AI-authoring landscape here was never ruled on. It is cited as the standing research pointer by three live backlog entries: `docs/backlog/editor-and-tooling/editor-backend-architecture.md`, `docs/backlog/editor-and-tooling/outbound-llm-editor-features.md` and `docs/backlog/ai-agents/llm-as-planner-experiments.md`.
