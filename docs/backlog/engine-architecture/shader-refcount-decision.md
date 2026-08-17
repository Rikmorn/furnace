---
summary: `Shader` ships with no refcount because a WebGPU pipeline captures the module at creation and `GPUShaderModule` has no `destroy()` — this records that basis and the exact three changes that would flip it
---

# Shader resource — revisit the no-refcount decision

**Filed 2026-05-30 (D-1 brainstorm).** D-1 ships the `Shader` resource with **no reference count** (unlike `Geometry`/`Material`, which Mesh refcounts). This entry records *why*, and the exact conditions that would flip the decision — so the assumption is falsifiable, not silent.

## The decision and its basis

`Shader` carries no refcount because **nothing depends on its `GPUShaderModule` after `material.create`**:

- A WebGPU pipeline **captures the compiled module at creation time** — once `material.create` builds the pipeline, the `Shader`'s module is irrelevant to rendering (the pipeline in the GPU process is self-contained).
- `GPUShaderModule` has **no `.destroy()`** (unlike `GPUBuffer`/`GPUTexture`) — it is GC-reclaimed when unreferenced. There is no GPU-timeline free to schedule or defer.

`Geometry`/`Material` are refcounted because their GPU resources (vertex buffer, pipeline) are read **every frame** — destroying them mid-render breaks drawing. A `Shader` has a **create-time-only** dependency, so the refcount rationale does not transfer. Consumer-owned shaders get an idempotent immediate `destroy`; built-in shaders are engine-owned (shared per-ctx, freed by the dispose cascade). See `docs/research/2026-05-30-shader-resource-prior-art.md` §Q1 (the GC + pipeline-capture observation; sokol is also non-refcounted).

## Trigger to revisit

Revisit (add an `Arc`-style refcount, à la wgpu/bevy) **only if** furnace adds any of:

1. **Lazy / deferred pipeline creation** — if `material.create` stops building the pipeline eagerly and defers it (e.g. to first-draw or async pipeline creation), the Material would need its `Shader` alive until the pipeline is built.
2. **Pipeline rebuild-from-shader** — shader *specialization* (pipeline variants, à la bevy `shader_defs`) or WGSL `override` constants baked into the pipeline, where changing a value re-derives the pipeline from the shader source. **Note: the params/uniform session (E) does NOT trigger this** — E writes uniform *values* into bind-group buffers, which never rebuild a pipeline.
3. **Always-on (production) hot-reload** — dev-only hot-reload uses its own dev registry (see `shader-hot-reload.md`); a production rebuild-on-change path would need a `Shader → Materials` reverse map and the shader kept alive.

None of these are in furnace's current or planned design as of 2026-05-30.

**Reference:** D-1 brainstorm 2026-05-30; `docs/research/2026-05-30-shader-resource-prior-art.md` §Q1. Cross-refs `shader-hot-reload.md`.