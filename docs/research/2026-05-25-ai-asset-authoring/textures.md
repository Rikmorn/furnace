# Textures — AI image and AI algorithm generation

*Captured 2026-05-25. Sourced from web search performed in-session; specific URLs in **Sources** at end. Capability claims from vendor/research pages, not independently verified.*

## Framing

Classical procedural texturing (Perlin, Worley, value noise, fbm, domain warping, hashing, voronoi tiling) is well-trodden ground. Treated here as background, not subject. The interesting question — and the one the user framed — is **AI generating both the algorithm and the final image**. Those split into three paths, not two:

| Path | What AI produces | Runtime form | Storage cost | Verifiable by Claude |
|---|---|---|---|---|
| **A. Image** | Raster PBR map sets (albedo + normal + roughness + …) | Sampled textures | Baked, fixed per asset | Read PNG → see |
| **B. Algorithm** | Shader source (GLSL / WGSL) | Compiled shader | Shader bytecode only | Render shader → PNG → see |
| **C. Node graph** | Procedural graph in an existing framework (Material Maker, Blender shader nodes, Substance) | Either compiled shader or baked map set | Graph file or baked output | Tool's CLI render → PNG → see |

All three close the feedback loop for me — every path ends in a PNG I can `Read`. Textures are the easiest asset class for me to iterate on autonomously.

## Path A — AI generates the final image

### The PBR-completeness problem

A texture isn't a single PNG. A modern engine wants a *material set*: base colour (albedo), normal, roughness, metallic, ambient occlusion, sometimes height/displacement and emissive. Raw Stable Diffusion outputs only the albedo. Anything that "AI-generates a texture" without producing the full map set is incomplete for a PBR pipeline.

### Tools that solve the full-set problem

- **Ubisoft CHORD** (open-sourced at SIGGRAPH Asia 2025) — the headline find. Takes a single RGB image and predicts the full PBR set: base colour, normal, height, roughness, metallic. Ships with **ComfyUI nodes**, so it slots directly into existing local SD workflows. Channels can be upscaled to 2K / 4K via the same pipeline. This is the open-source SOTA for end-to-end PBR generation as of early 2026.
- **DreamTextures** (`carson-katri/dream-textures`) — Stable Diffusion built into Blender. Text-prompted texture generation, built-in seamless tiling, "Project Dream Texture" for scene-wide projection via depth-to-image. Lives inside Blender, so naturally combines with the `blender-mcp` integration noted in the mesh research.
- **AITextured**, **GenPBR**, **3DAIStudio PBR Map Generator** — free online tools that take an image and synthesise the missing PBR channels. Hosted, browser-based. Useful as quick-fix tools but not local-first.
- **Scenario** (commercial, hosted) — generates full PBR sets from prompts. Higher quality than open tools for prompt-only generation as of 2026.

### Seamless / tileable generation

Tiling is its own subproblem. Most prompts produce one-off textures, not textures that tile cleanly across a surface. ComfyUI's seamless-tiling ecosystem is the established solution:

- **`spinagon/ComfyUI-seamless-tiling`** — replicates Automatic1111's "Tiling" option. Two nodes: **Seamless Tile** inserted after the checkpoint loader (before the K sampler) and **Make Circular VAE** for the decode step.
- Resolution: 512×512 or 1024×1024 square. CFG between 5–8 (higher CFG produces contrast burns that ruin tileable textures).
- Practical workflow: SDXL + seamless-tiling node + Florence2 prompt generation + Fooocus for inpainting cleanup.

This combines naturally with CHORD: seamless-tile workflow produces a tileable RGB → CHORD splits it into the full PBR set.

### Compression for shipping

Once baked, PBR map sets are bandwidth-heavy. The path forward is **KTX2 + Basis Universal** — GPU-native compressed format with universal browser support via WebGPU. Furnace's eventual texture loader (see mesh research) should target this. Not specific to AI generation — applies to all baked textures.

## Path B — AI writes the shader algorithm

This is the more novel and arguably more interesting path for furnace specifically, because WGSL *is* the engine's shader language and procedural materials cost zero asset bandwidth.

### What exists

- **ShaderGPT** (14islands) — natural-language prompt → GLSL → live WebGL render. Free, browser-based. Notable testing data point: their testing found Claude was the most consistent performer of the LLMs tested for shader generation. That aligns with what I'd expect — there's a massive corpus of GLSL on ShaderToy and similar that's deeply present in training data.
- **ShadAR** (arxiv) — AR application that generates shaders from natural-language descriptions in real time, compiling them into the headset's viewport. Academic but demonstrates the live-iteration interaction model.
- **AI Co-Artist** (arxiv) — GPT-4-driven iterative GLSL evolution. The system supports prompt → shader → visual feedback → refinement loops. Closer to what an editor would expose.
- **JIT GLSL Code Generator** — generic LLM-driven GLSL emitter, less polished but proves the pattern is accessible.

### Why Claude is good at this

Shader languages are highly structured, syntactically tight, and have a large public training corpus (ShaderToy alone is tens of thousands of GLSL shaders). The output format is small (most procedural shaders are 50–300 lines). The verification loop is fast (compile → render → look). This is genuinely one of the better fits for LLM-driven code generation right now.

### GLSL vs WGSL

Almost all existing AI-shader tooling targets GLSL because WebGL is what most browser tools rendered to historically. WGSL is the WebGPU shading language and is what `@furnace/core` would compile against. The two languages are semantically similar but syntactically different (different type names, different built-ins, different binding model). Practical implications:

- LLMs are stronger at GLSL than WGSL today (training data imbalance). Quality gap narrows as WGSL adoption grows.
- A trivial GLSL→WGSL transpiler step (or just careful prompting) bridges the gap.
- Naga (Rust crate, part of wgpu) does GLSL → WGSL translation as a fallback path.
- Long-term: prompt directly for WGSL with a small fewshot example set; quality will catch up.

### Verification loop for shader generation

For me to iterate on an AI-generated shader without a human:

1. LLM outputs WGSL source.
2. A small browser tool (or Bun script using `bun-webgpu`) loads the shader into a pipeline and renders to an offscreen texture.
3. Texture → PNG on disk.
4. I `Read` the PNG.
5. Iterate the prompt or edit the shader directly.

The whole loop is sub-second for simple shaders. This is much tighter than the mesh or audio loops.

### Drawbacks

- LLM shader output has subtle correctness bugs (precision artefacts, swizzle errors, edge-case divisions by zero) that don't show up until specific lighting conditions or angles. The fast feedback loop catches most of them but not all.
- Performance characteristics are opaque from source — an AI shader that "looks right" might tank framerate via expensive branching. Profiling stays a human concern.
- WGSL specifically has stricter validation than GLSL; LLMs sometimes produce code that's valid GLSL but invalid WGSL.

## Path C — AI builds node graphs in existing frameworks

The hybrid path: instead of generating raster outputs or raw shader code, the AI manipulates an existing procedural framework's node graph. The framework's renderer produces the final output (either compiled shader or baked maps).

### Material Maker (the open-source pick)

- **Material Maker** (`RodZill4/material-maker`) — MIT-licensed, Godot-based, ~200 nodes, exports for Godot/Unity/Unreal. Node definitions *are* GLSL shaders; connecting nodes generates a combined shader (rather than rendering each node to an image). Means runtime export can be either baked textures or a single composed shader.
- **Material Maker 1.5** (Jan 2026) added a **CLI** for scripted/batch export. This is the unlock for AI integration — a CLI means LLM-drivable.
- **Material Maker 1.6** (Apr 2026) added a **Controlled Variations** node for parameterised procedural variation. Useful when AI needs to generate "100 variations of this brick material" with controlled axes.

The AI-driven workflow here: LLM generates or modifies a `.ptex` graph file → Material Maker CLI exports the result → render preview → iterate.

### Blender shader nodes via blender-mcp

The same `blender-mcp` integration noted for mesh authoring covers Blender's shader node graph. Claude can build Principled BSDF setups, image-texture chains, procedural-texture stacks, all interactively. Reuses an investment furnace would already be making for mesh authoring.

### Substance Designer

Industry standard but commercial (Adobe). Has a Python API (`pysbs`) that's scriptable. No public MCP today. Probably out of scope unless a consumer specifically wants Substance integration.

## Differentiable rendering / inverse procedural (frontier)

A different category worth flagging but not adopting: instead of generating textures, **fit procedural parameters to a target image**. You hand the system "this brick wall photo, what Voronoi+noise+colour-curve parameters produce it?" and it back-propagates through a differentiable renderer to find the answer.

- Mostly research-stage as of 2026 (recent papers on mesh-based inverse rendering, neural deferred shading, Bayesian procedural-material parameter estimation).
- Production-grade tools don't exist yet for general material recovery.
- Worth re-checking in a year — if this matures, it changes how AI texture authoring works (target-image-driven instead of prompt-driven).
- Not actionable for furnace today; keep watching.

## Feedback loops summary

| Path | My loop |
|---|---|
| A (image gen) | ComfyUI/CHORD → PNG set → `Read` PNGs → see albedo/normal/etc. |
| B (shader gen) | LLM → WGSL → headless WebGPU render → PNG → `Read` |
| C (node graph) | LLM → graph edit → Material Maker CLI / `blender-mcp` render → PNG → `Read` |

All three are tighter than mesh (which needs a multi-axis viewer) and *much* tighter than audio (which I can't perceive at all). Texture work is the highest-bandwidth AI-asset-authoring task I can drive autonomously.

## Furnace fit — what would land where

### Inside `@furnace/core` eventually

- **Texture loader** — PNG day one; KTX2 + Basis Universal once bandwidth becomes a real concern. Same path noted in mesh research.
- **PBR material binding** — once glTF materials load, AI-generated PBR sets drop in without additional work.
- **Procedural-shader primitives** — basic noise / SDF / domain-warping helpers in WGSL that AI-generated shaders can compose with. Lowers the surface area an LLM has to invent from scratch and improves consistency.
- **Shader hot-reload** — already on the backlog ([hot-reload-for-wgsl-shaders.md](../../backlog/editor-and-tooling/hot-reload-for-wgsl-shaders.md)). Directly enables tight AI-shader iteration loops.

### In `@furnace/tools` eventually

- `furnace bake textures` — wraps `ffmpeg`/ImageMagick for resize/convert, `toktx` for KTX2 + Basis compression, atlas generation for grouped textures.
- Optionally: `furnace gen texture --prompt "..."` as a thin CLI wrapper that calls into the editor backend's MCP service. Same UX as `furnace bake`, different verb.

### In the editor backend (fourth pillar)

The most interesting design space — three overlapping services:

- `texture.generate_pbr` → wraps CHORD ComfyUI workflow, returns full map set
- `shader.generate_wgsl` → wraps an LLM call + a render-and-validate step, returns compiled WGSL + preview PNG
- `material.compose_graph` → wraps Material Maker CLI or blender-mcp shader nodes, returns either baked maps or composed shader

All three exposed as MCP services means Claude can author textures *for the consumer's game inside the consumer's editor* via the same MCP surface that humans use. This is arguably the cleanest AI-in-the-editor demo because the loop is so tight and visual.

### The shader-generation experiment as a near-term spike

If we wanted to *try* one thing early — before the full editor backend exists — the smallest viable shape is:

1. A `@furnace/tools` subcommand that takes a prompt, calls an LLM, returns WGSL.
2. A `hello-world` variant that loads the generated WGSL into a material on a sphere.
3. Iteration via prompt re-runs.

That's a self-contained spike that proves out Path B without committing to editor backend architecture. It also generates real data on WGSL-via-LLM quality that informs the bigger decision.

## Apple Silicon notes

- **DreamTextures** in Blender works on M-series with standard SD setup.
- **ComfyUI + CHORD** works on MPS; slower than CUDA but functional.
- **Material Maker** runs natively (Godot-based), no GPU model dependency.
- **LLM-driven shader generation** is the most platform-agnostic of the three paths — no local model required, just an API call. The render step is WebGPU which works fine on Apple Silicon.

## What's deliberately out of scope

- **Texture painting** (ArmorPaint, Blender texture paint, Substance Painter). Hand-paint-driven, different problem.
- **Trim sheets / texture atlases for repeated detail** — known technique, not AI-specific.
- **Decal systems** — runtime composition concern, not authoring.
- **Megatextures / virtual texturing** — streaming infrastructure, not authoring.
- **Texture upscaling / super-resolution** (Real-ESRGAN, etc.). Post-process, mostly orthogonal.

## Sources

Verified in-session via WebSearch (2026-05-25):

- [Ubisoft Generative Base Material / CHORD (SIGGRAPH Asia 2025)](https://www.ubisoft.com/en-us/studio/laforge/news/1i3YOvQX2iArLlScBPqBZs)
- [Ubisoft CHORD ComfyUI nodes](https://blog.comfy.org/p/ubisoft-open-sources-the-chord-model)
- [DreamTextures on GitHub](https://github.com/carson-katri/dream-textures)
- [Material Maker on GitHub](https://github.com/RodZill4/material-maker)
- [Material Maker 1.5 release (DDS, FBX, CLI)](https://digitalproduction.com/2026/01/26/material-maker-1-5-adds-dds-fbx-cli-10-new-nodes/)
- [Material Maker 1.6 release (Controlled Variations)](https://www.cgchannel.com/2026/04/open-source-material-authoring-software-material-maker-1-6-is-out/)
- [ShaderGPT by 14islands (write-up)](https://www.14islands.com/journal/ai-generated-glsl-shaders)
- [ShaderGPT Abduzeedo coverage](https://abduzeedo.com/shadergpt-ai-shader-generator-14islands)
- [ShadAR: LLM-driven shader generation for AR (arxiv)](https://arxiv.org/pdf/2602.17481)
- [AI Co-Artist: GPT-4 GLSL evolution (arxiv)](https://arxiv.org/html/2512.08951v1)
- [ComfyUI seamless-tiling extension](https://github.com/spinagon/ComfyUI-seamless-tiling)
- [Seamless texture workflow guide](https://www.nextdiffusion.ai/tutorials/how-to-make-seamless-textures-with-ai-stable-diffusion)
- [AITextured (hosted PBR generation)](https://aitextured.com/)
- [GenPBR (hosted PBR generation)](https://genpbr.com/)
- [Bayesian procedural material parameter estimation (arxiv)](https://arxiv.org/pdf/1912.01067)
- [Differentiable rendering overview](https://www.emergentmind.com/topics/differentiable-rendering)
