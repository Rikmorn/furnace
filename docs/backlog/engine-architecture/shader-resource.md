# Shader resource (Tranche D-1) — extract `Shader` as a first-class render+compute resource

**Status:** Architecture settled in the D brainstorm (2026-05-30); implementation deferred to its own tranche (D-1). **Subsumes** `material-shader-source-shape.md` (deleted — its "what shape should shader source take?" question is now answered: a resource, not a string field). **Folds in** `shader-preprocessor.md` (the `// @include` resolution lives in the shader-loading path). **Unblocks** `shader-hot-reload.md` (the `Shader` resource is its substrate). The uniform-*params* work (`typed-uniform-setters` + `material-uniform-setters`) is a **separate** session — see "Code vs params seam" below.

## Why (the reframe)

The original backlog framed this as "collapse `MaterialDescriptor.vertex` + `.fragment` → a single `shader: string`." During the D brainstorm the user surfaced a roadmap signal — **compute shaders are coming soon for GPU physics simulation** — and an appetite for a more forward-looking abstraction. That changed the cost-benefit: a single inline `shader: string` would force a *second* breaking migration later (string → handle) once compute needs shader modules that aren't materials, and keeping both spellings would be a single-source-of-truth violation. Extracting a `Shader` resource now is **one migration, not two**, and it is the consumer the future `compute.create` shares.

## Settled shape

- New `@furnace/core/shader` sub-path module. `Shader` is a **pooled, opaque branded handle** (the sokol `sg_shader` model — a resource a pipeline references, not inline source).
- **One `Shader` type for both render and compute.** WGSL lets one module hold `@vertex` + `@fragment` + `@compute` entry points; the render-vs-compute split lives at the *pipeline* layer (`GPUComputePipelineDescriptor` carries no depth/blend/targets).
- Two factories (api-posture R4 — async because they compile/validate a shader):
  - `shader.create(ctx, wgslText): Promise<Shader>` — sync-from-text (built-ins use this).
  - `shader.load(ctx, url): Promise<Shader>` — async fetch + create. The `// @include` preprocessor lives here (and in `create` for embedded text).
- `shader.destroy(ctx, shader): void` — idempotent (matches the Material/Mesh/Geometry destroy contract).
- `MaterialDescriptor` becomes `{ shader: Shader, ...renderState, bindings? }`. Render-state (`depthEnabled`, `depthWrite`, `depthCompare`, `cullMode`, `topology`, `blend`) **stays on the Material descriptor**, hashed into the internal pipeline cache key. **No separate consumer-facing `Pipeline` object** — the internal per-ctx pipeline cache plays that role. (Trigger to expose a `Pipeline`: a consumer needing to share one render-state config across many shaders, or explicit pipeline pre-warming.)
- **Render-state signature regrouping rides this reshape (surfaced in the D brainstorm, 2026-05-30).** D-1's descriptor reshape is breaking anyway, so fold the render-state signature cleanup in here rather than pay a third migration. Two moves: (a) collapse the flat *conditional* depth fields — `depthEnabled` + `depthWrite` + `depthCompare`, where the latter two are dead when `depthEnabled:false` — into one gating union `depth?: false | { write?: boolean; compare?: GPUCompareFunction }` (single-source-of-truth; the type encodes the dependency); (b) group render-state for growth (MSAA/stencil/depthBias/frontFace — see `render-state-completeness.md`) the way WebGPU itself does (`primitive{}` / `depthStencil{}` / `multisample{}`). D ships `depthEnabled` **flat & additive** (non-breaking); D-1 regroups it here. Render-state is immutable create-time data (baked into the pipeline) — these are descriptor *fields*, never setters; mutation is purely a params (E) concern.
- `compute.create(ctx, { shader, entryPoint, ... })` is **designed-for but NOT built** in D-1 — it lands with its real consumer (the physics-sim tranche). D-1 only needs to confirm the `Shader` interface generalises to it on paper.

`depthEnabled` (the sibling D item, landing first) stays a Material descriptor field and survives the `{vertex,fragment}→{shader}` change untouched.

## Open mechanism questions (the D-1 brainstorm)

The *shape* above is settled; these are the *mechanism* decisions the D-1 brainstorm must make:

1. **Ownership & refcount (`Shader → Material`).** Consumer-created-and-owned like `Geometry` (material refcounts it; teardown deferred until the last referencing material is destroyed)? This is the load-bearing lifecycle call. What happens to a built-in's internally-created `Shader` on `material.destroy`?
2. **Built-in material decomposition (the B-1 parallel) + shader sharing.** *(Surfaced in the D brainstorm, 2026-05-30.)* Today `material.unlit`/`material.normalColor` are convenience factories that, once D-1 exists, will **bundle a hidden `Shader` resource** — the exact shape B-1 deleted (`mesh.cube`/`plane` bundled a hidden geometry → ownership murk → replaced by `geometry.cube` + `mesh.create`). The B-1 fix applies: **expose built-in shaders** (`shader.unlit`, `shader.normalColor`) and let `material.create({ shader: shader.unlit, … })` compose, parallel to `geometry.cube` + `mesh.create`. Sub-decisions:
   - `normalColor` has **zero params** → singly-bundled (just code) → decomposes cleanly; could be **deleted** like `mesh.cube` (consumers do `material.create({ shader: shader.normalColor })`). Settles fully in D-1.
   - `unlit` has **one param** (the color buffer) → *doubly*-bundled (hidden shader **and** hidden param buffer). D-1 fixes the shader half; the **param half** (how color is expressed/owned/mutated) is the params session (E). So **fully retiring `material.unlit` must wait for E** — deleting it before an ergonomic param path exists trades one smell for hand-rolled-color-buffer boilerplate (the B-1 deletion only worked because `geometry.cube` lost nothing).
   - Then the original sharing question: do built-in shaders share one cached `Shader` per ctx (ctx-bound lazy state, `bindToCanvas` A-7 precedent), or one per call? Affects the dispose cascade.
   - **Not a descriptor.** The cube/plane lesson is "expose the sub-resource, compose via `create`," **not** "turn the factory into a descriptor" — a pure-data `unlit` descriptor can't pre-bake the color GPU buffer without dragging E's uniform-schema into D-1.
3. **Pipeline cache keying.** Key on the `Shader` *handle* (resource identity) instead of today's source string? Dedup identical-source modules, or not (sokol doesn't)?
4. **Entry-point handling.** Render keeps hardcoded `vs_main`/`fs_main` (the binding contract)? Expose `entryPoint` only on the future `compute.create`? Does `Shader` introspect which entry points it carries?
5. **`shader.load` semantics.** HTTP-failure → throw (setup-loud); URL caching yes/no; how `// @include` resolution integrates (which preprocessor approach — see `shader-preprocessor.md`).
6. **Compute-readiness sanity check.** Paper-design `compute.create({ shader, entryPoint })` just enough to confirm the interface generalises — do not build it.

## Migration surface (atomic — repo-root `bun run typecheck` is the green gate)

Breaking change is confined to `material.create` call sites that pass `vertex`/`fragment`:
- Built-ins: `material/unlit.ts`, `material/normal-color.ts` (create+own a `Shader` internally).
- Engine: `material/material.ts` (descriptor, `buildPipelineDescriptor`, pipeline key), `material/types.ts`.
- Consumers: hello-world `entry.ts` (×2), cookbook `render-target/entry.ts` (×1), cookbook `shader/entry.ts` (×2).
- Tests: `material/destroy.gpu.test.ts`, `material/blend.gpu.test.ts`, `material/material.gpu.test.ts`.
- `material.unlit`/`normalColor` consumers are **unaffected** (the built-ins hide the `Shader`).
- Docs: new `core-modules.md` shader-module section; `api-posture.md` classification (`Shader` = Resource; `shader.create`/`load` = Factory; `shader.destroy` = Lifecycle-op); `engine-conventions.md` §Drawables; cookbook shader-demo refresh to teach `shader.create`/`load`.

## Code vs params seam (why the audit's "Tranche E" dissolves)

The decomposition is **Shader = code; Material = shader + parameter-values**. That line re-carves the audit's original "Shader uniforms + helpers" (E) bundle:
- **`shader-preprocessor` is shader *code* composition** → folds into D-1 (`// @include` in the load path).
- **`typed-uniform-setters` + `material-uniform-setters` are shader *params*** (the `@group(1)` data layer, orthogonal to the code resource) → a **separate "uniform/params session"** (the uniform-schema-DSL question, spanning material + post, that A-4 deliberately avoided).

## Prior-art basis (verified 2026-05-30, primary sources)

- **sokol** `sg_shader` is a pooled handle pipelines reference → `Shader`-as-resource is **tier-aligned** (api-posture R8), not up-tier. (wgpu `ShaderModule` is likewise a held resource.)
- **WGSL/WebGPU**: one `GPUShaderModule` can hold `@vertex`/`@fragment`/`@compute`; `GPUComputePipelineDescriptor` has no render state. WGSL has **no render-state syntax** → depth/blend/cull *must* live host-side (forecloses the Unity/Godot "render-state in the shader" model).
- **bevy** (WGSL, like furnace): one `Handle<Shader>` for render+compute, two factories (`Shader::from_wgsl` sync + `asset_server.load` async). Unity/Godot split shader-vs-compute only because they juggle dual shading languages (HLSL/`.compute`, GDShader/GLSL→SPIR-V) — **not applicable** to a WGSL-only engine.

A full `docs/research/` write-up should be produced when D-1 is spec'd; the conclusions + citations above are the durable capture for now.

**Trigger to revisit:** Now actionable — picked up as Tranche D-1 immediately after D (`depthEnabled`) lands. Compute-physics roadmap reinforces the timing.

**Reference:** D brainstorm 2026-05-30. Subsumes `material-shader-source-shape.md`. Cross-refs `shader-preprocessor.md`, `shader-hot-reload.md`, `typed-uniform-setters.md`, `material-uniform-setters.md`. Prior-art: `docs/research/api-posture-prior-art.md` + 2026-05-30 verification.
