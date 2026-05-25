# Meshes and sprites — AI and procedural authoring

*Captured 2026-05-25. Sourced from web search performed in-session; specific URLs in **Sources** at end. Quality/capability claims about individual models are summarised from product/benchmark pages and have not been independently verified in this session — treat as "as of 2026-05 per vendor/community claims."*

## Reframing for what's tractable from a Claude session

Unlike audio, **I can see images via the `Read` tool**. Any tool that renders meshes or sprites to a PNG file closes the feedback loop: I write a script, it generates an asset, a viewer renders it to PNG, I `Read` the PNG, I iterate. Audio doesn't have this property (see `audio.md`).

This is why mesh/sprite authoring is the easier first integration for an AI-driven editor pipeline. Audio is intentionally further away.

## Meshes

Two distinct production paths, both worth supporting:

### Path A — AI-generated (text/image → mesh)

The 2025–2026 open-source state of the art clusters around three model families:

- **TRELLIS.2** (Microsoft, image → 3D). Best topology + PBR materials of the open set. Requires ~24GB VRAM. Practically NVIDIA-only.
- **Hunyuan3D 2.1** (Tencent). Shape generation on 6GB VRAM, separate texture model on top. Most accessible local option on a PC with a mid-range GPU.
- **TripoSR / Stable Fast 3D**. Feed-forward, very fast, lower fidelity. Useful when iteration speed matters more than final quality.

All output meshes that bake to glTF/GLB cleanly — which is what furnace would load via its eventual glTF loader.

**Apple Silicon reality:** these are CUDA-first. On the dev box this means falling back to hosted APIs (Meshy, Tripo, Rodin) or running on a remote Linux/NVIDIA machine. Not a blocker for design, but a real ergonomic tax.

**Topology caveat:** AI-generated meshes have messy topology — fine for static props and environment dressing, poor for anything that needs rigging or clean UV unwrapping. Hand-modelled wins for characters that move.

### Path B — Procedural / scripted

More interesting for an engine project, and likely the primary path:

- **Blender headless** (`blender --background --python script.py`) with `bpy` + `bmesh`. Fully scriptable, exports glTF natively, infinite ceiling.
- **`blender-mcp`** ([ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp)) — MCP server officially endorsed by blender.org. Lets an LLM drive a live Blender session over a socket: write Python that runs inside Blender, read scene state back, iterate. This is the closest thing to "Claude composes meshes interactively." Same author as the Ableton MCP server (see `audio.md`).
- **Manifold** (Google) — robust CSG library with a wasm build. Fast, mesh-correct booleans.
- **Gypsum** ([playkostudios/gypsum](https://github.com/playkostudios/gypsum)) — wraps Manifold for procedural mesh + glTF in JS. Demonstrates the pattern of Manifold-as-runtime-CSG-engine.

**Runtime opportunity inside `@furnace/core`:** Manifold.wasm is a candidate for in-engine CSG/booleans, since live editor interactions want sub-frame latency. This is the one mesh-authoring thing that could legitimately ship inside core. Aligns with furnace's existing "wasm hot paths in core" direction.

### Mesh feedback loop (closing it for Claude)

For me to actually evaluate a mesh I've authored, I need a render-to-PNG step:

- `screenshot-glb` (Shopify) — Puppeteer + Google's `model-viewer` web component. Headless Chrome renders the GLB to a PNG. Reliable, cross-platform.
- `gltf-viewer` (Rust CLI, crates.io) — direct CLI screenshot path. Faster than the Puppeteer route. Headless mode is best-supported on macOS; Linux needs Docker or xvfb.
- `render-glb` (headless WebGL → PNG with auto-fitting camera).
- Blender headless render — most powerful, slowest.
- `blender-mcp` itself can drive viewport renders directly without leaving the session.

## Sprites

Same split: hand-pipelined (deterministic, scriptable) versus AI-generated.

### Path A — Hand-pipelined

- **Aseprite CLI** is the natural primary. `--batch --sheet out.png --data out.json --sheet-type packed --split-tags` gets you a packed atlas + metadata in one command. `--format json-hash`/`--format json-array` chooses the metadata shape. Lua scripting via `app.command.ExportSpriteSheet` for advanced workflows. Aseprite costs $20 — a real distribution concern if the editor wants to bundle it.
- **Pixelorama** — free, open-source, has CLI/scripting. Plausible alternative if Aseprite's licence is a blocker for bundling.
- **LibreSprite** — fork of Aseprite from before the EULA change. Free, but lags behind Aseprite on features.
- Purely procedural: Python + Pillow/numpy, or `ImageMagick`/`resvg` (Rust) for vector → raster.

### Path B — AI-generated

- **ComfyUI** is the standard orchestration layer for local Stable Diffusion workflows. Has an API mode for programmatic invocation, which is what the editor backend would talk to.
- Pixel-art-tuned checkpoints/LoRAs: **Pixel Art XL**, **Pixel Art Diffusion XL**, **SD_PixelArt_SpriteSheet_Generator** (specifically does 4-angle sheets), **All-In-One-Pixel-Model** (trigger words `pixelsprite` / `16bitscene`). **Retro Diffusion** is the pixel-art specialist that came out of this community.
- **PixelAI** — Aseprite plugin that bridges local Stable Diffusion into Aseprite directly. Local mode wants 6GB+ VRAM for lighter workflows, 10GB+ for FLUX.

**MCP-side:** several generic image-generation MCP servers exist ([mcp-image-gen](https://github.com/sarthakkimtani/mcp-image-gen), [image-gen-mcp](https://github.com/lansespirit/image-gen-mcp), [GMKR/mcp-imagegen](https://mcpservers.org/servers/GMKR/mcp-imagegen)). All cloud-backed (Replicate, Together, Flux, Imagen). Useful as a quick start but doesn't satisfy a local-first design.

### Sprite feedback loop

Trivial: Aseprite (or ComfyUI) writes PNG, I `Read` the PNG. No headless renderer needed because sprites *are* the rendered output.

## Furnace fit — what would land where

Three layers of work, all deferred:

1. **Inside `@furnace/core` eventually:**
   - glTF/GLB loader → vertex/index buffers, materials, textures. First mesh-related thing to land once primitives stabilise.
   - PNG texture loader (KTX2 + Basis Universal later — bandwidth wins are too big to skip long-term, but heavy to integrate).
   - Sprite atlas loader: PNG + JSON metadata. Aseprite's JSON format is the sensible default to support natively. Adapter pattern so TexturePacker / custom formats slot in later.
   - Material/PBR plumbing to consume glTF materials.
   - Animation (skinning, morph targets) — deeper, defer.
   - Possibly: Manifold.wasm for runtime CSG (the one authoring-flavoured thing that legitimately fits in core).

2. **In `@furnace/tools` eventually:** a `furnace bake` subcommand family (`bake meshes`, `bake sprites`, `bake textures`) that wraps Blender headless + Aseprite CLI + KTX2 compression as a baked asset pipeline. Lives in Rust, no JS, no leakage.

3. **In the editor backend (the fourth pillar):** the long-running orchestrator that drives all the AI/heavy tools, manages job queues, watches the filesystem, exposes MCP services. See `docs/backlog/editor-and-tooling/editor-backend-architecture.md`.

Concrete day-one setup recommendation, when the time comes:

- **For meshes:** `blender-mcp` + Blender 4.x + `screenshot-glb`. Gives interactive Blender control, full Python ceiling, and a PNG render path Claude can see.
- **For sprites:** Aseprite (or Pixelorama) + ComfyUI with a pixel-art checkpoint. Hand-pipelined as default, AI when the input is a vibe rather than a spec.

## Sources

Verified in-session via WebSearch (2026-05-25):

- [TRELLIS.2 / Hunyuan3D / Tripo comparison](https://trellis2.app/blog/best-image-to-3d-models-huggingface)
- [Open-source text-to-3D landscape](https://medevel.com/text-to-3d-8/)
- [blender-mcp on GitHub](https://github.com/ahujasid/blender-mcp)
- [Blender.org MCP server announcement](https://www.blender.org/lab/mcp-server/)
- [Claude + Blender MCP capabilities/limits](https://www.mindstudio.ai/blog/claude-blender-mcp-real-world-performance)
- [Gypsum: procedural mesh + Manifold CSG](https://github.com/playkostudios/gypsum)
- [Blender headless CLI guide](https://renderday.com/blog/mastering-the-blender-cli)
- [Shopify screenshot-glb](https://github.com/Shopify/screenshot-glb)
- [render-glb — headless WebGL → PNG](https://github.com/rawwerks/render-glb)
- [Aseprite CLI docs](https://www.aseprite.org/docs/cli/)
- [SD_PixelArt_SpriteSheet_Generator](https://huggingface.co/Onodofthenorth/SD_PixelArt_SpriteSheet_Generator)
- [ComfyUI + Pixel-Art-XL guide](https://www.kokutech.com/blog/gamedev/tips/art/pixel-art-generation-with-comfyui)
- [PixelAI for Aseprite (local AI)](https://red335.itch.io/pixelai-local-ai-directly-in-aseprite)
