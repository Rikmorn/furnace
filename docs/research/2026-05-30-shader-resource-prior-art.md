# Prior art: shader-as-resource modeling, dedup, entry points, preprocessing, and compute-pipeline shape

This document surveys how mature GPU-resource layers, browser-WebGPU APIs, and retained renderers model a **shader as a resource** — covering shader ownership/refcount, pipeline-cache keying, entry-point selection and reflection, `#include`/preprocessor strategy with async load semantics, and the render-vs-compute pipeline split. The goal is to feed furnace's Tranche D-1 "Shader resource" design with a strategy menu drawn from real precedent, mapped to each of the six mechanism questions D-1 must answer (Q1 ownership, Q2 built-in decomposition, Q3 pipeline-cache keying, Q4 entry points + reflection, Q5 preprocessor/includes + load, Q6 compute-pipeline generalisation), rather than invented categories.

Sources are cited inline; for source-code claims, the file paths and line numbers (or doc anchors) in the cited trees are listed. Each claim is labelled **verified** (read the primary source this session — URL/path given) or **uncertain / general knowledge** (could not confirm against a primary source). Verified-vs-uncertain labels are preserved from the four research threads that fed this synthesis; uncertain claims are **not** upgraded to facts. Where two threads conflict, the conflict is called out explicitly.

---

## 1. Per-system findings

### 1.1 sokol-gfx — `sg_shader` opaque handle (verified)

Source read this session: `sokol_gfx.h` @ `master`, from `https://raw.githubusercontent.com/floooh/sokol/master/sokol_gfx.h` (26798 lines). This is furnace's stated tier model, so it is the closest structural precedent.

**Handle model (pool + generation), lines 1994–2003, verbatim:**

> "Instead of pointers, resource creation functions return a 32-bit handle which uniquely identifies the resource object. The 32-bit resource id is split into a 16-bit pool index in the lower bits, and a 16-bit 'generation counter' in the upper bits. The index allows fast pool lookups, and combined with the generation-counter it allows to detect 'dangling accesses' (trying to use an object which no longer exists, and its pool slot has been reused for a new object)."

- `sg_shader` is the typed wrapper (line 2009): `typedef struct sg_shader { uint32_t id; } sg_shader;` — **one type backs both render and compute shaders** (verified).
- **Lifecycle:** `sg_make_shader(const sg_shader_desc* desc)` (line 1689); `sg_destroy_shader(sg_shader shd)` (line 1810). **No refcount** — manual create/destroy (verified, lines 1680–1825).
- **Pipeline references shader by handle value:** `sg_pipeline_desc` has field `sg_shader shader;` (line 3894). Compute pipelines use the same field with `bool compute;` (line 3893): *"A compute pipeline is created by providing a compute shader object, setting the `.compute` creation parameter to true and not defining any 'render state'."* (verified header doc).
- **Dedup: NO (verified by absence).** A grep of the full header for `dedup`, `content-address`, `hash`, `cache` found the only hashing/caching machinery to be the **WebGPU-backend BindGroups cache** (`sg_desc.wgpu.bindgroups_cache_size`, default 1024, lines 1889–1906, 5075–5076) — which caches `BindGroup` objects across `sg_apply_bindings()` calls and has nothing to do with shaders. There is **no** shader-source deduplication, content-addressing, or hashing anywhere. Each `sg_make_shader()` allocates a distinct pool slot.
- **Entry points:** `sg_shader_function` (lines 3635–3641) carries `const char* entry;`. `sg_shader_desc` holds one per stage: `vertex_func`, `fragment_func`, `compute_func` (lines 3735–3739). `_sg_shader_desc_defaults` (lines 24159–24167) defaults the entry name to **`"main"` for all three stages** (`"_main"` on Metal due to MSL name-mangling), individually overridable. Sokol does **not** use distinct per-stage names like `vs_main`/`fs_main` (verified). On the WebGPU backend it passes `entry` straight through to `entryPoint` (lines 18397, 18440, 18471).
- **Design nuance for furnace:** sokol's shaders are *stage-tagged* — a compute shader is created knowing it's compute. furnace's planned `shader.create(ctx, wgslText)` is flavour-neutral (a WGSL module can hold all stages), which is *more* general than sokol, closer to raw WebGPU (verified-by-comparison).

Primary source: [sokol_gfx.h (master)](https://github.com/floooh/sokol/blob/master/sokol_gfx.h). Author's compute announcement posts (verified, official author floooh): [sokol-gfx compute update](https://floooh.github.io/2025/03/03/sokol-gfx-compute-update.html), [milestone 2](https://floooh.github.io/2025/05/19/sokol-gfx-compute-ms2.html) — frame it as *"Shaders, pipelines and passes now come in two runtime flavours: 'render' vs 'compute'."*

### 1.2 WebGPU spec & wgpu — `GPUShaderModule` / `ShaderModule` (verified)

**Compilation cache is non-normative UA behaviour.** WebGPU spec §2.2.4 "User Agent State" (`https://www.w3.org/TR/webgpu/#privacy-user-agent-state`), verbatim:

> "it is expected that user agents will have compilation caches for the result of expensive compilation like `GPUShaderModule`, `GPURenderPipeline` and `GPUComputePipeline`." … "These caches are important to improve the loading time of WebGPU applications after the first visit."

This is the *only* spec text touching caching of shader modules, and it is **expectation, not requirement** — a UA-internal compilation cache for *loading time*, not an application-visible dedup of `GPUShaderModule` objects. The spec does **not** define content-addressed deduplication of `createShaderModule` calls.

> **Conflict / partial-verification flag.** The resource-and-dedup thread could **not** read the normative §9 `createShaderModule` algorithm line-by-line (the spec page exceeded the fetcher's reach) and explicitly labelled "the algorithm has no dedup step" as **uncertain / not directly read**. Its "WebGPU does not mandate dedup" claim rests on the §2.2.4 note (verified verbatim) being the only caching language, plus MDN's return-value text, plus a community debate treating dedup as a hazard ([kvark ShaderCompile debate](https://kvark.github.io/webgpu-debate/ShaderCompile.component.html), **secondary**) — strong, but not a direct read of the §9 steps. Treat "no normative source dedup" as well-supported but not spec-step-verified.

**wgpu — `ShaderModule` is a cloneable, refcounted handle; no source dedup (verified).** [docs.rs/wgpu ShaderModule](https://docs.rs/wgpu/latest/wgpu/struct.ShaderModule.html) describes it as **"Handle to a compiled shader module."** with trait impls `Clone`, `Eq`, `Hash`, `Ord`, `PartialEq`, `PartialOrd`, `Debug`. The crate-level docs (verified at [docs.rs/wgpu](https://docs.rs/wgpu/latest/wgpu/), "Getting Started") state verbatim:

> "The API is refcounted, so all handles are cloneable, and if you create a resource which references another, it will automatically keep dependent resources alive."

So wgpu's reuse model is **handle identity**: `Device::create_shader_module` returns a new module; clones share the same underlying `Arc`; a pipeline keeps its module alive by holding a clone. The same `ShaderModule` type is used by both render (`VertexState.module`/`FragmentState.module`) and compute (`ComputePipelineDescriptor.module`) (verified, §1.6 below). Internal `wgpu_core::pipeline::ShaderModule` holding `device: Arc<Device>` is **mostly verified** (from doc-snippet search, not a line-by-line crate read this session).

Sources: [W3C WebGPU spec §2.2.4](https://www.w3.org/TR/webgpu/#privacy-user-agent-state) (verified), [wgpu ShaderModule docs](https://docs.rs/wgpu/latest/wgpu/struct.ShaderModule.html) (verified), [wgpu crate docs](https://docs.rs/wgpu/latest/wgpu/) (verified).

### 1.3 WebGPU spec — entry points are optional with a single-entry-point default (verified)

Read raw spec source `spec/index.bs` from `https://raw.githubusercontent.com/gpuweb/gpuweb/main/spec/index.bs`.

`GPUProgrammableStage` (lines 7883–7887) — `entryPoint` is **NOT** `required`:

```webidl
dictionary GPUProgrammableStage {
    required GPUShaderModule module;
    USVString entryPoint;
    record<USVString, GPUPipelineConstantValue> constants = {};
};
```

The spec NOTE (lines 7904–7907), verbatim:

> "NOTE: Since the `entryPoint` dictionary member is not required, methods which consume a `GPUProgrammableStage` must use the 'get the entry point' algorithm to determine which entry point it refers to."

The **"get the entry point" algorithm** (lines 7978–7997) — load-bearing for Q4:

> To **get the entry point**(`GPUShaderStage` |stage|, `GPUProgrammableStage` |descriptor|) … 1. If |descriptor|.`entryPoint` is **provided**: 1. If |descriptor|.`module` contains an entry point whose name equals |descriptor|.`entryPoint`, **and whose shader stage equals |stage|**, return that entry point. Otherwise, return `null`. Otherwise: 1. If there is **exactly one entry point** in |descriptor|.`module` whose shader stage equals |stage|, return that entry point. Otherwise, return `null`.

Validation consequence (`validating GPUProgrammableStage`, lines 8012–8014): *"|entryPoint| must not be `null`."* So omitting `entryPoint` is valid **iff** the module has exactly one entry point for that stage; otherwise pipeline creation fails validation.

**The rule is uniform across vertex/fragment/compute** because all three descriptors inherit from `GPUProgrammableStage` (verified): `GPUFragmentState : GPUProgrammableStage` (lines 9091–9094), `GPUVertexState : GPUProgrammableStage` (lines 10161–10164), `GPUComputePipelineDescriptor … required GPUProgrammableStage compute` (lines 8276–8279). `createComputePipeline` calls `get the entry point(COMPUTE, …)` (line 8327); `createRenderPipeline` calls it with `FRAGMENT` (9123) and `VERTEX` (10277). Same algorithm, same optionality, all three stages.

> **Cross-thread nuance (apparent conflict, resolved).** The compute-pipeline thread extracted the spec member-`dfn` text for `entryPoint` stating *"there is no default, even if only one entry point is present in the module"* and recommended **requiring** `entryPoint` explicitly. The entry-points thread cites the "get the entry point" algorithm that **does** permit omission when exactly one stage entry point exists. These are not contradictory: the member's *own dictionary default* is none (the field is simply absent), while the *resolution algorithm* supplies the single-entry fallback at pipeline-creation time. Both are verified against the same `index.bs`. MDN states the failure mode plainly (verified, [createComputePipeline](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createComputePipeline)): *"You can omit the `entryPoint` property if your shader code contains a single function with the `@compute` attribute set … If `entryPoint` is omitted and the browser cannot determine a default entry point, a `GPUValidationError` is generated."*

**History (verified):** entry points became optional in 2023/Chrome 121. Chromium "Intent to Ship: WebGPU default entry points to shader modules" ([blink-dev thread](https://groups.google.com/a/chromium.org/g/blink-dev/c/k_gcnAUinT0)) — posted 2023-11-23, shipped Chrome 121; gpuweb issue #4342, spec PR #4387; positive standards positions from Gecko and WebKit. **Uncertain / general knowledge:** exact Safari/WebKit and Firefox release versions were not verified this session (only the standards-position approval in the intent thread).

### 1.4 WGSL spec — one module CAN hold `@vertex` + `@fragment` + `@compute`; no runtime entry-point reflection (verified)

Read raw `wgsl/index.bs` from `https://raw.githubusercontent.com/gpuweb/gpuweb/main/wgsl/index.bs`.

- **Entry point** (line 9291): *"An entry point is a user-defined function that performs the work for a particular shader stage."* Three stages: `compute`, `vertex`, `fragment` (lines 9325–9330). §13.2 (lines 9334–9340): *"the entry point's function name maps to the `entryPoint` attribute of the WebGPU `GPUProgrammableStage` object."*
- **Mixed stages in one module:** the lifecycle text (lines 612–616) is unambiguous: *"Only the code forming the shader of the specified entry point of the `GPUProgrammableStage` is considered during pipeline creation … Note: Each shader stage is considered to be compiled separately and, thus, might include different portions of the module."* Combined with "get the entry point", the model is: **a module may hold any number of entry points across all three stages; each pipeline stage selects exactly one.** No per-stage uniqueness constraint at the module level (only at selection time, and only when `entryPoint` is omitted). This **directly validates furnace's WGSL-only single-module design** (verified).
- **Restriction** (`#function-restriction`, line 8658): *"An entry point must never be the target of a function call."* No constraint found this session on the *number* of entry points per module.
- **`@workgroup_size` is shader-side (§12.14, verbatim):** *"Must only be applied to a compute shader entry point function. Must not be applied to any other object."* Spec EXAMPLE proving a compute entry point MUST carry it: `@compute fn bad_shader() { }` is annotated *"Error: workgroup_size must be specified on compute shader."* Parameters: one to three const-/override-expressions; missing y/z default to 1. So workgroup geometry is declared **in the WGSL source**, never in the pipeline API (verified).
- **Reflection: WebGPU exposes NO runtime entry-point enumeration (verified).** The entire `GPUShaderModule` interface (`spec/index.bs` lines 7131–7137): `[Exposed=(Window, Worker), SecureContext] interface GPUShaderModule { Promise<GPUCompilationInfo> getCompilationInfo(); };`. `GPUCompilationInfo` (lines 7327–7346) returns only diagnostic messages (`message`, `type`, `lineNum`, `linePos`, `offset`, `length`) — **nothing about entry points or stages**. The browser knows internally (it runs "get the entry point") but never surfaces it to JavaScript. There is no browser API to ask "which entry points/stages does this module have."

### 1.5 naga — full host-side entry-point reflection exists, but is NOT browser-available (verified)

[docs.rs/naga `ir::Module`](https://docs.rs/naga/latest/naga/ir/struct.Module.html) and [`ir::EntryPoint`](https://docs.rs/naga/latest/naga/ir/struct.EntryPoint.html), **naga 29.0.3**. `Module` has `pub entry_points: Vec<EntryPoint>`; `EntryPoint` has `name: String`, `stage: ShaderStage` (Vertex | Fragment | Compute), `workgroup_size: [u32; 3]`, `function: Function`. So parsing WGSL with `naga::front::wgsl` yields a `Module` from which every entry point, its name, stage, and (for compute) workgroup size can be enumerated — exactly the reflection WebGPU withholds.

**Relevance for furnace:** this is *host-side Rust* reflection, NOT what `device.createShaderModule` gives in the browser (verified). furnace *could* introspect entry points only by vendoring naga compiled to wasm and parsing WGSL itself before handing it to WebGPU — shipping a WGSL parser in the browser bundle to rediscover what the browser already validated internally but won't tell you. **Uncertain / general knowledge:** naga-in-wasm feasibility/size was not verified this session (wgpu's own web path compiles naga, but a standalone wasm build's cost was not measured).

### 1.6 wgpu / bevy entry-point posture (verified)

- **wgpu** ([VertexState](https://docs.rs/wgpu/latest/wgpu/struct.VertexState.html), wgpu 29.0.3): `pub entry_point: Option<&'a str>` — *"If `Some`, there must be a vertex-stage shader entry point with this name … Otherwise, expect exactly one vertex-stage entry point in `module`, which will be selected."* Same optional-with-single-default rule as WebGPU; no hardcoded name.
- **bevy** ([VertexState](https://docs.rs/bevy/latest/bevy/render/render_resource/struct.VertexState.html), bevy 0.18.1): `pub entry_point: Option<Cow<'static, str>>` — *"or `None` if the default entry point is used."* **Correction to D-1's premise:** current bevy is `Option<Cow<'static, str>>`, not a bare `Cow<'static, str>`. The bare-`Cow` form was an **older** bevy API; bevy migrated to optional + default to follow the WebGPU change. (**Uncertain / general knowledge:** bevy example code commonly passes explicit names like `"vertex".into()` — seen in examples, not re-verified against current example source this session.)

Neither wgpu nor bevy nor sokol encodes `vs_main`/`fs_main`-style stage-specific names into the engine. Hardcoding such names would make furnace *more* opinionated than every reference design surveyed.

### 1.7 bevy — `Handle<Shader>` asset, `ShaderCache`, `PipelineCache` (verified)

Sources read this session (all `bevyengine/bevy@main`): `crates/bevy_render/src/render_resource/pipeline_cache.rs` (837 lines), `crates/bevy_shader/src/shader_cache.rs` (469 lines), `crates/bevy_shader/src/shader.rs` (434 lines), plus docs.rs struct pages.

- **Shader is an Asset, referenced by handle.** `shader.rs` line 34: `pub struct Shader { … pub source: Source, … pub import_path: ShaderImport }`. `Shader::from_wgsl(source, path)` (lines 86–100) builds a `Shader` identified by its `path`/`import_path` — created *from* source but identified by asset path/id, not source bytes. Consumers hold a `Handle<Shader>`.
- **The GPU shader-module cache keys on (asset id, shader_defs) — NOT on source.** `shader_cache.rs`: root `data: HashMap<AssetId<Shader>, ShaderData<ShaderModule>>` (line 69, top-level key = handle identity); within one asset, `processed_shaders: HashMap<Box<[ShaderDefVal]>, Arc<ShaderModule>>` (line 44, keyed on the specialization defs). The GPU module is stored `Arc<ShaderModule>` (refcounted). Two distinct `Shader` assets with byte-identical WGSL produce two `AssetId`s → two GPU modules. **Bevy does not content-address shader source.**
- **PipelineCache explicitly does NOT dedup pipelines.** `pipeline_cache.rs` lines 198–199, verbatim: *"Note that the cache does not perform automatic deduplication of identical pipelines. It is up to the user not to insert the same pipeline twice to avoid wasting GPU resources."* The per-pipeline queue methods repeat (lines 382, 411): *"There is no attempt to deduplicate it."* The pipeline label key (`pipeline_cache_key` format helper, lines 765–787) uses the shader's **path** (`shader.path()`, the asset path — **not** WGSL text) + entry point + defs string, for labelling/diagnostics, not dedup.
- **One shader type spans render and compute (verified):** `ComputePipelineDescriptor.shader: Handle<Shader>` and `VertexState.shader: Handle<Shader>` / `FragmentState.shader` use the **same `Handle<Shader>` type**. `Handle<Shader>` is an asset handle — directly parallels furnace's planned `shader.load(ctx, url)` factory alongside `shader.create(ctx, wgslText)`.

> Bevy is the clearest model for furnace's tier: shader = asset/handle; the engine caches the compiled module keyed on (handle id, defs) and refcounts via `Arc`, but never collapses two handles that share source, and never dedups pipelines.

Sources: [pipeline_cache.rs](https://github.com/bevyengine/bevy/blob/main/crates/bevy_render/src/render_resource/pipeline_cache.rs), [shader_cache.rs](https://github.com/bevyengine/bevy/blob/main/crates/bevy_shader/src/shader_cache.rs), [shader.rs](https://github.com/bevyengine/bevy/blob/main/crates/bevy_shader/src/shader.rs), [ComputePipelineDescriptor](https://docs.rs/bevy/latest/bevy/render/render_resource/struct.ComputePipelineDescriptor.html), [RenderPipelineDescriptor](https://docs.rs/bevy/latest/bevy/render/render_resource/struct.RenderPipelineDescriptor.html) (all verified).

### 1.8 three.js — `WebGLPrograms` program cache: the canonical "dedup by source-key" precedent (verified)

Source read this session: `src/renderers/webgl/WebGLPrograms.js` @ `dev` (679 lines). three.js has **no standalone shader resource** — the cached unit is the linked `WebGLProgram`. The cache is a content/parameter-keyed map with refcounting:

- `const programsMap = new Map();` (line 22).
- **`getProgramCacheKey(parameters)`** (lines 393–430) builds an array and `return array.join();`. The key includes `parameters.shaderID` (a built-in material's shader identity) **OR** `parameters.customVertexShaderID` + `parameters.customFragmentShaderID` (for `ShaderMaterial`/`RawShaderMaterial`, derived from the actual GLSL source), then every `defines[name]=value`, then all boolean/parameter encodings + `renderer.outputColorSpace`, then `parameters.customProgramCacheKey`.
- **`acquireProgram(parameters, cacheKey)`** (lines 613–630), verbatim: `let program = programsMap.get(cacheKey); if (program !== undefined) { ++program.usedTimes; } else { program = new WebGLProgram(...); programs.push(program); programsMap.set(cacheKey, program); }`.
- **`releaseProgram(program)`** (lines 634+): `if (--program.usedTimes === 0) { … programsMap.delete(program.cacheKey); program.destroy(); }`.

So three.js **deduplicates compiled programs by a cache-key string** that encodes shader-source identity + defines + render parameters, and **reference-counts** them via `usedTimes`. This is dedup unit **(a) content/parameter key**.

> Nuance for furnace: three.js dedups at the *program* (pipeline-equivalent) level, keyed on shader-identity-plus-state, not at a bare "shader module" level. The shader is one component of a many-parameter string key — closer to furnace's Q3 pipeline-cache key than to Q1 shader ownership. three.js explicitly flags the per-acquire string allocation as a hot-path concern ([issue #22530](https://github.com/mrdoob/three.js/issues/22530), **secondary**).

Source: [WebGLPrograms.js (dev)](https://github.com/mrdoob/three.js/blob/dev/src/renderers/webgl/WebGLPrograms.js) (verified).

### 1.9 Babylon.js — `Effect` cache + refcount (verified)

Source read this session: `packages/dev/core/src/Engines/thinEngine.pure.ts` @ `master` (4731 lines; the old `thinEngine.ts` is now just `export * from "./thinEngine.pure";`). `createEffect(...)` (lines 2052–2079, verbatim key block):

```js
const name = vertex + "+" + fragment + "@" + fullDefines;
if (this._compiledEffects[name]) {
    const compiledEffect = this._compiledEffects[name];
    if (onCompiled && compiledEffect.isReady()) { onCompiled(compiledEffect); }
    compiledEffect._refCount++;
    return compiledEffect;
}
…
const effect = new Effect( baseName, …, name, … );
this._compiledEffects[name] = effect;
return effect;
```

So Babylon **deduplicates `Effect`s by a string cache key** = `vertex + "+" + fragment + "@" + fullDefines`, and **reference-counts** (`_refCount++`) on a hit. Dedup unit **(a) key string**. Nuance on what's in the key: `vertex`/`fragment` resolve from `baseName` — when `baseName` is a string it's a **shader name** (file/store reference), but the `vertexSource`/`fragmentSource` option variants (lines 2040–2041) put **inline source** into the key. So the key is "shader name *or* source, plus the defines string" — content-addressed when source is inline, name-addressed otherwise. **Refcounting confirmed:** the `Material.dispose()` `_forceDisposeEffect` param is documented "kept for backward compat. We reference count the effect now" ([Material typedoc](https://doc.babylonjs.com/typedoc/classes/babylon.material), verified via search snippet — could not render the typedoc body directly); `_compiledEffects[effect._key]` is deleted on disposal (lines 1979–1980, verified).

Sources: [thinEngine.pure.ts (master)](https://github.com/BabylonJS/Babylon.js/blob/master/packages/dev/core/src/Engines/thinEngine.pure.ts) (verified, source read), [Babylon Material docs](https://doc.babylonjs.com/typedoc/classes/babylon.material) (verified via search snippet).

### 1.10 WGSL preprocessor / `#include` landscape (verified)

**WGSL has no native preprocessor, `#include`, or import (verified).** The W3C WGSL spec (`https://www.w3.org/TR/WGSL/`) defines a module as directives (`enable`, `requires`, `diagnostic`) followed by module-scope declarations, and carries the note *"A WGSL program is currently composed of a single WGSL module."* There is no `#include`/`#import`/preprocessor in the language. The long-standing WG issue [gpuweb/gpuweb#568 "[wgsl] Consider a preprocessor"](https://github.com/gpuweb/gpuweb/issues/568) is unresolved this session — any include system lives in tooling above `createShaderModule()`.

**naga_oil (Bevy's composition crate) (verified, [README](https://github.com/bevyengine/naga_oil)):** directives are *not* WGSL; a module names itself with `#define_import_path my_module`; imports use Rust-style `::` paths (`#import my_module::{my_func, my_const}`); conditional compilation via `#define`/`#ifdef`/`#if`. **Resolution is by registered path string, not file** — modules are registered via `Composer::add_composable_module()`; no automatic file/URL resolution in the crate. Import-graph constraint (quote): *"imports can be nested — modules may import other modules, but not recursively. when a new module is added, all its `#import`'s must already have been added."* — i.e. requires an acyclic, topologically-pre-ordered registry (it does not itself detect cycles). Mechanism: builds each module to **naga IR** (a full parse, not a string splice). Runs in-process at runtime in Rust; not browser/HTTP-based. Transferable lessons: (a) path identity decoupled from file location, (b) enforce an acyclic graph, (c) separate **loading** (asset layer) from **composition** (linker).

**WESL — the emerging community standard (verified, [wesl-spec](https://github.com/wgsl-tooling-wg/wesl-spec) + `Imports.md`):** a *"portable and modular superset of WGSL"* from the `wgsl-tooling-wg` group, goal *"module composition, conditional compilation, and shader libraries"* to enable a *"reusable shader-library ecosystem on npm and crates.io"*. Critically: *"All WESL enhancements are translated to vanilla WGSL before being passed to WebGPU calls such as `createShaderModule()`."* Rust-flavoured `import` keyword (`import super::lighting::pbr;`, `import package::geom::sphere::{ draw, default_radius as foobar };`). Relative forms: `super::` (parent module, repeatable), `package::` (top-level module of current package); absolute paths reference packages in `wesl.toml`. File-resolution algorithm checks `prev.wesl` for the named item, else `prev/seg.wesl` or a `prev/` directory; *"Linkers should fall back to `.wgsl` files when a `.wesl` file cannot be found."* Conditional compilation via `@if(...)` attributes. **Status: early / pre-1.0** (the spec itself says *"The simple enhancements we want to find will take some time to stabilize"*). Implementations: **`wesl` npm package** — a **TypeScript linker** that *"can be used at runtime or at build time"* ([wesl-js](https://github.com/wgsl-tooling-wg/wesl-js), v0.7.19, actively published — "last published 12 hours ago" at fetch time); `wesl-rs` (Rust). Runtime API (verified, [Getting-Started-JavaScript](https://wesl-lang.dev/docs/Getting-Started-JavaScript)):

```js
import { link, createWeslDevice } from "wesl";
import appWesl from "../shaders/app.wesl?link";
const linked = await link(appWesl);
const shaderModule = linked.createShaderModule(device, {});
```

> **Uncertain / could not confirm against linker internals:** the `?link` import suffix is a **bundler virtual-module convention**, strongly suggesting the WESL bundler plugin statically collects all `.wesl` sources at **build time** into an in-memory manifest that `link()` then processes string-to-string — i.e. the runtime linker does **not** perform HTTP fetches. The docs confirm "bundler plugin is the recommended experience" but the thread could not read the linker source to confirm **zero network I/O**. Treat "WESL does no runtime fetch" as a strong inference, not verified fact.

**Other npm/CLI preprocessors (verified survey):**

| Package | Approach | `#include`/fetch? | Build-time vs runtime |
|---|---|---|---|
| [toji/wgsl-preprocessor](https://github.com/toji/wgsl-preprocessor) | tagged template literal, `#if/#elif/#else/#endif` only | **No** `#include`, no fetch | Runtime (browser), <100 LOC |
| [wgsl-plus](https://github.com/JSideris/wgsl-plus) | C-style preprocessor + linker, `#include "utils.wgsl"` (relative to including file) | **Yes**, file linking | **Build-time CLI**; cycle/dedup behaviour **undocumented** |
| [pre-wgsl](https://github.com/reeselevine/pre-wgsl) | C++ preprocessor, includes + macros | Yes | Build-time |
| wesl (above) | full superset linker | imports (not `#include`) | runtime or build-time |

**Bottom line (verified):** there is **no widely-adopted, runtime, browser-side `#include`-style WGSL preprocessor npm package**. Include-capable ones are build-time CLIs; the famous tiny runtime one (toji) does conditional compilation only, *not* includes. The only serious runtime importer is WESL, which favours build-time bundling. furnace's runtime `// @include` is genuinely under-served by existing libs. (**Note:** the preprocessor thread flagged that its WebFetch of the wgsl-plus README returned a spurious "Anthropic's official CLI for Claude" string — a **fetch artifact**, discarded; the CLI usage and quoted-path relative includes are treated as the verified facts.)

### 1.11 three.js `ShaderChunk` + `#include <chunk>` — the canonical runtime string-scan preprocessor (verified)

Source read this session: `src/renderers/webgl/WebGLProgram.js` @ `master`. Resolution is **by registry name, not file path or URL** — includes resolve against the global `ShaderChunk` dictionary (`{ name: glslString }`).

Exact regex (verbatim): `const includePattern = /^[ \t]*#include +<([\w\d./]+)>/gm;` — multiline + global, captures the chunk name. Resolution + recursion (paraphrasing the verbatim code read):

```js
function resolveIncludes( string ) { return string.replace( includePattern, includeReplacer ); }
function includeReplacer( match, include ) {
  let string = ShaderChunk[ include ];
  if ( string === undefined ) {
    const newInclude = shaderChunkMap.get( include ); // deprecation alias map
    if ( newInclude !== undefined ) { string = ShaderChunk[ newInclude ]; }
    else { throw new Error( 'Can not resolve #include <' + include + '>' ); }
  }
  return resolveIncludes( string ); // RECURSES
}
```

Key behaviours (verified, including by absence): **recursion** into included chunks; **missing chunk = hard throw** (loud failure); **no cycle detection** — a self-including chunk would infinite-recurse → stack overflow (three.js gets away with it because `ShaderChunk` is a curated, acyclic, author-controlled registry, not user URLs); **no dedup** — the same chunk included twice is inlined twice (acceptable for GLSL *snippets*, not top-level declarations); loop unrolling is a *separate* function.

> Closest precedent to `// @include`. It proves a ~10-line regex + recursive replace is the canonical minimal runtime preprocessor. But the two simplifications it relies on — registry-not-URLs and acyclic-curated-content — are exactly what furnace *cannot* assume if `shader.load(url)` fetches arbitrary author files that include each other. furnace must **add cycle detection and a URL-resolution layer that three.js omits.**

Source: [WebGLProgram.js (master)](https://github.com/mrdoob/three.js/blob/master/src/renderers/webgl/WebGLProgram.js) (verified).

### 1.12 Async loading, HTTP-failure handling, and caching-by-URL (verified)

**Bevy `AssetServer::load`** ([docs.rs](https://docs.rs/bevy/latest/bevy/asset/struct.AssetServer.html), verified): **caches/dedups by path** — *"Note that if the asset at this path is already loaded, this function will return the existing handle, and will not waste work spawning a new load task."* **Async, non-blocking** — *"This will not block on the asset load. Instead, it returns a 'strong' Handle."* **Failure surfaces later, not at the call** — `load()` does not return a `Result`; failures appear via `LoadState`/`AssetEvent`. So: **path-keyed dedup + deferred fallible loading**.

**three.js `FileLoader`** ([FileLoader.js](https://github.com/mrdoob/three.js/blob/master/src/loaders/FileLoader.js) + [issue #17635](https://github.com/mrdoob/three.js/issues/17635), verified — the richest precedent):

1. **Cache-check-first:** returns cached content asynchronously (preserving the async contract even on a cache hit).
2. **In-flight request dedup (callback queue):** a module-level `loading` map; if `loading[url]` exists, the new call pushes its `{onLoad, onProgress, onError}` onto the queue and returns — only **one** network request fires; all queued callbacks fire on completion.
3. **Do NOT cache errors — the load-bearing failure-mode lesson.** Original bug #17635: three.js called `Cache.add(url, response)` *before* checking HTTP status, so **404/500 error bodies got cached as if valid**, and retries returned the cached error to `onLoad`. The fix moved caching into the success branch; the current source comment reads *"Add to cache only on HTTP success, so that we do not cache error response bodies as proper responses to requests."*
4. **On error, clear the in-flight entry** (`delete loading[url]`) so a failed URL retries cleanly.
5. Cache is opt-in: `THREE.Cache.enabled` defaults to `false`.

| System | Cache key | Dedup in-flight? | Caches failures? |
|---|---|---|---|
| Bevy AssetServer | asset path | yes (one load task) | no (load fails, no poisoned handle) |
| three.js FileLoader | `file:`+url | **yes (callback queue)** | **no (only on HTTP success)** — learned via #17635 |
| Browser HTTP cache (free) | URL + headers | yes | per `Cache-Control` |

**Relative include resolution (verified precedents):** WESL navigates a logical `super::`/`package::` module tree; wgsl-plus resolves `#include "utils.wgsl"` relative to the including file (build-time); three.js does **no** relative resolution at all (flat registry names). **Uncertain / general-knowledge (web-platform-confirmed):** the standard browser primitive is `new URL(includeSpecifier, baseUrl)` — resolving a relative include against the *referencing* file's absolute URL, exactly as ES modules and CSS `@import` resolve relative to the referrer. The "relative to referrer" semantics are general-knowledge-confirmed; the `new URL(spec, base)` API is standard WHATWG URL.

### 1.13 Compute-pipeline shape — render-vs-compute split lives at the pipeline layer (verified)

WebGPU spec IDL (`https://www.w3.org/TR/webgpu/`, anchors `dictdef-gpucomputepipelinedescriptor`, `dictdef-gpupipelinedescriptorbase`), verbatim:

```
GPUPipelineDescriptorBase : GPUObjectDescriptorBase {
    required (GPUPipelineLayout or GPUAutoLayoutMode) layout;
};
GPUComputePipelineDescriptor : GPUPipelineDescriptorBase {
    required GPUProgrammableStage compute;
};
```

The **entire** compute descriptor is `{ label?, layout, compute }` — **nothing** about depth, blend, color targets, primitive topology, multisample, or vertex buffers; those live only on `GPURenderPipelineDescriptor` (verified, cross-checked against [gpuweb.github.io/types](https://gpuweb.github.io/types/interfaces/GPUComputePipelineDescriptor.html) and [webgpu.rocks](https://webgpu.rocks/reference/dictionary/gpucomputepipelinedescriptor/)). The narrative reference confirms the intent: *"Most of the state of a pipeline is defined by a `GPURenderPipeline` or a `GPUComputePipeline` object."* `GPUProgrammableStage` (the `compute` member type) is *"the base type for `GPUVertexState` and `GPUFragmentState`"* per gpuweb.github.io/types — the strongest single evidence that the `(module, entryPoint, constants)` triple is **stage-agnostic**. `createComputePipeline(descriptor)` returns synchronously; `createComputePipelineAsync(descriptor)` returns a `Promise` (verified, spec + [MDN](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createComputePipeline)).

**wgpu `ComputePipelineDescriptor`** ([docs.rs](https://docs.rs/wgpu/latest/wgpu/struct.ComputePipelineDescriptor.html), verified): `label`, `layout`, `module: &ShaderModule` (same type render uses), `entry_point: Option<&str>`, `compilation_options`, `cache` — no render-state fields. **bevy `ComputePipelineDescriptor`** (verified): `label`, `layout`, `push_constant_ranges`, `shader: Handle<Shader>`, `shader_defs`, `entry_point: Option<Cow<…>>`, `zero_initialize_workgroup_memory` — render-only fields (`primitive`, `depth_stencil`, `multisample`, `fragment`) live on `RenderPipelineDescriptor`. (`zero_initialize_workgroup_memory` exists on **both** descriptors → it's a wgpu compilation option, not a render/compute differentiator.)

**Caveat — workgroup size is NOT dispatch size (verified).** `@workgroup_size` is per-workgroup thread geometry (compile-time, shader-side, §1.4); the *number of workgroups* is a separate runtime argument to the dispatch call (`dispatchWorkgroups(x,y,z)` in WebGPU, `sg_dispatch(x,y,z)` in sokol, `pass.dispatch_workgroups(x,y,z)` in bevy). That belongs to furnace's pass/command layer, not to `compute.create`. (**Uncertain / general knowledge:** the bevy `compute_shader_game_of_life.rs` example's exact `dispatch_workgroups` line was not read this session — confirmed via search + wgpu API knowledge, not a fresh line-read.)

---

## 2. Synthesis — organised by furnace mechanism question

### Q1 — Shader ownership / refcount

The field **splits cleanly on abstraction tier** (verified across all five resource-and-dedup sources):

- **Low-level GPU-resource layers** (sokol, wgpu, the WebGPU API itself, bevy's render-resource layer) model a shader as an **opaque handle/asset that the consumer owns and reuses**, with **no source dedup**. Within this tier the refcount question forks:
  - **sokol:** manual create/destroy, **no refcount**. Lightest, matches a pool+generation handle model exactly.
  - **wgpu / bevy:** **`Arc`-refcounted** module so dependents (pipelines) keep it alive automatically.
- **High-level retained renderers** (three.js, Babylon) have **no standalone shader resource** — they dedup *compiled programs/effects* by a content/parameter cache-key string and reference-count the result (`usedTimes` / `_refCount`). This exists because *their* consumers (materials) don't manage shader handles, so the engine must auto-collapse duplicates.

**Directly applicable precedent:** furnace sits in the sokol/wgpu tier, so the relevant model is the **opaque handle with no source dedup**. A real and load-bearing observation from the thread: in browser-WebGPU the GC already keeps the underlying `GPUShaderModule` alive as long as a pipeline references it, and WebGPU pipelines capture the module *at creation* — so a sokol-style *non-refcounted* handle is defensible (the *GPU* resource survives regardless of the handle table). A refcount would only protect the *handle-table slot* from reuse-after-free, which the generation counter already detects. (This is the thread's reasoning, presented for the brainstorm — not a furnace decision.) Babylon's "we reference count the effect now" is the directly applicable precedent *if* furnace ever grows an effect/material layer above the handle tier.

### Q2 — Built-in decomposition

D-1 has flagged this as a **furnace-internal B-1-precedent decision with little external prior art**. The threads surfaced essentially nothing external that maps to it: WGSL's single-module model (§1.4) and the universal `GPUShaderModule` type (§1.2, §1.13) mean the platform imposes no decomposition; sokol/wgpu/bevy all treat a shader as one opaque unit. The nearest tangential signals are three.js's `ShaderChunk` registry (a *built-in library* of reusable GLSL snippets, §1.11) and naga_oil/WESL module systems (§1.10) — but those are composition/import mechanisms, not a "decompose the engine's built-in shaders" decision. **Conclusion: treat Q2 as a furnace-local design call; the prior art here is thin and only loosely analogous.**

### Q3 — Pipeline-cache keying / dedup unit

Two distinct precedents, mapping to two distinct tiers (all verified):

- **Handle-identity keying** — bevy keys its module cache on `(AssetId<Shader>, shader_defs)`; pipelines reference shaders by handle, and `PipelineCache` **explicitly does not dedup pipelines** ("It is up to the user not to insert the same pipeline twice"). Cheap (hash a handle + state, not a string); never pays to hash/compare WGSL text. Cost: two byte-identical shaders created via two `shader.create` calls won't collapse. This is the dominant choice at furnace's tier (sokol/wgpu/bevy).
- **Source/content-key keying** — three.js (`getProgramCacheKey` → join of shaderID/customVertexShaderID + defines + params) and Babylon (`vertex+"+"+fragment+"@"+defines`) build a *string* key including a source proxy, and refcount the result. This is the retained-renderer choice; it costs a string build + map lookup per acquire (three.js flags the allocation as a hot-path concern, #22530, **secondary**) and earns its cost only where consumers don't manage shader handles.

**Directly applicable precedent:** bevy's `(handle-id, defs)` module-cache + non-deduping pipeline cache is the cleanest map to a low-level WGSL-only handle engine. Note the field-wide signal: **no surveyed low-level layer content-addresses shader source for the pipeline key** — it keys on handle identity + state. Source-string content-addressing belongs one tier up (material/effect layer), if furnace ever grows one.

### Q4 — Entry points + reflection

Strong, multi-source convergence (verified):

- **The platform makes `entryPoint` optional with a "single entry point per stage" default** (§1.3), and the rule is **uniform across vertex/fragment/compute** (all inherit `GPUProgrammableStage`). So an asymmetric API (hardcode render names, parameterize compute) is a *furnace choice*, not a platform constraint. Hardcoding `vs_main`/`fs_main` would force consumers to name functions exactly that — a requirement the platform does not impose.
- **No reference design hardcodes distinct per-stage names.** wgpu/bevy default to "the one stage entry point" (`Option<&str>`/`Option<Cow>`, omit → resolve); sokol defaults to a single uniform `"main"` for all stages, individually overridable. Hardcoding stage-specific names would make furnace *more* opinionated than sokol. **Correction to D-1's premise:** current bevy is `Option<Cow<'static, str>>`, not bare `Cow` (the bare form was an older API).
- **One WGSL module can hold `@vertex` + `@fragment` + `@compute` together** (§1.4) — and could hold *two* `@compute` kernels (relevant to the GPU-physics roadmap: an integrate pass + a collision pass). The same "which entry point?" question therefore applies to render and compute alike, which is why the entry-points thread argued an asymmetric API is the weakest option.
- **Reflection: the browser exposes NO runtime entry-point enumeration** (§1.4 — `GPUShaderModule` has only `getCompilationInfo()`). Full reflection exists only host-side in naga (§1.5), unavailable in-browser without vendoring a WGSL parser to wasm (cost not verified this session). The platform's own answer — omit the name (single-entry default) or pass an explicit name — sidesteps the need for introspection. If furnace ever wants to *validate* "this module has the entry points I expect" at `shader.create` time, the cheapest browser-only mechanism is to attempt pipeline creation and read the `GPUValidationError`, not to parse WGSL.

**Note on the inter-thread nuance (resolved in §1.3):** the member's *dictionary default* is "none" (the compute thread's verbatim extract) while the *resolution algorithm* supplies the single-entry fallback (the entry-points thread's verbatim extract). Both are spec-verified and consistent. The compute thread *recommended* requiring `entryPoint` explicitly (loud-setup posture, disambiguates multi-entry modules); the entry-points thread *recommended* an optional override on all three stages (matches wgpu/bevy, handles multi-compute without an API change). These are competing recommendations for the brainstorm, not a factual conflict.

### Q5 — Preprocessor / includes + load semantics

Convergent lessons (verified unless noted):

- **WGSL has no native include/preprocessor** (§1.10), and **no widely-adopted runtime browser-side `#include` library exists** — include-capable tools are build-time CLIs; the runtime ones don't do includes; WESL (the only serious runtime importer, and the most credible standard) is **pre-1.0** and leans toward **build-time bundling** via a `?link` virtual-module convention (the "no runtime fetch" inference is **uncertain**, not source-confirmed). So furnace's runtime `// @include` is genuinely under-served — building a small resolver is defensible.
- **three.js `resolveIncludes` is the proven minimal skeleton** (§1.11): ~10-line regex + recursive replace, missing-chunk = hard throw. But it omits **cycle detection** and **URL resolution** — safe only because its registry is curated and acyclic. furnace fetching *arbitrary author URLs* must add both (an on-stack `Set` DFS guard; `new URL(spec, includingFileUrl)` referrer-relative resolution, matching CSS `@import`/ESM).
- **Declaration-level dedup is correctness, not just optimization** (thread inference from §1.11 + WGSL's no-redefinition rule): three.js re-inlines GLSL *snippets* harmlessly, but if furnace's includes hold *top-level declarations* (fns, structs, bindings), inlining the same file twice produces WGSL redefinition errors — so dedup-within-graph is required. (Labelled an inference, not a spec-read fact.)
- **Async load + cache lessons** (§1.12): both serious precedents **cache/dedup by path/URL** (Bevy returns the same handle for the same path; three.js `FileLoader` caches by `file:`+url). The load-bearing failure mode is **never cache errors** (three.js #17635 — caching a 404 body poisoned retries). Other lessons: **in-flight dedup** (one fetch shared across concurrent callers), **cache key = canonicalized absolute URL**, **failure surfaces deferred from the call** (Bevy), and a **hot-reload tension** with a permanent URL cache (suggesting an explicit cache-bust / `?v=` escape hatch). A standing counter-consideration: the browser's HTTP cache already dedups identical-URL fetches at the network layer, so caching only the *handle* (one URL → one Shader) plus letting the browser cache bytes captures most benefit with less furnace-owned state.

**Directly applicable precedent:** three.js `resolveIncludes` (mechanism) + three.js `FileLoader`/#17635 (failure modes) + Bevy `AssetServer` (path-keyed handle dedup, deferred fallibility) together specify the minimal correct runtime `// @include` resolver. WESL is the **adopt-vs-build candidate** to track for a future package-level shader-library ecosystem, but its build-time/manifest model is an impedance mismatch with runtime `shader.load(url)`.

### Q6 — Compute-pipeline shape generalisation

All three sub-claims of furnace's paper design are **verified against primary sources**:

- **(a) One shader module/object backs both render and compute.** WebGPU `compute.module` is a `GPUShaderModule` — the exact type render references. wgpu uses one `ShaderModule`; sokol one `sg_shader`; bevy one `Handle<Shader>`. (§1.2, §1.4, §1.7, §1.13)
- **(b) The render-vs-compute split lives at the PIPELINE layer.** `GPUComputePipelineDescriptor` carries *no* render state — only `layout` (inherited) and `compute` (a `GPUProgrammableStage`). Mirrored by wgpu and bevy. (§1.13)
- **(c) Compute needs only `(shader, entryPoint)` at the API surface** because `@workgroup_size` is a WGSL shader-side attribute reflected from the named entry point, never a pipeline parameter. (§1.4, §1.13)

This **validates `compute.create(ctx, { shader, entryPoint })`** and the separate-factory shape (exactly as sokol's `.compute = true` pipeline flag, wgpu's `ComputePipelineDescriptor`, and bevy's `ComputePipelineDescriptor` all structure it). Two conscious-omission watch-items from the thread (both verified from the IDL, neither blocking the minimal signature):

1. **Bind-group / pipeline layout** is shared between render and compute (both descriptors require it) — but it's the field a minimal `compute.create` silently picks `"auto"` for. Compute binding needs differ (storage buffers/textures with `read_write`, storage-image views); a render-derived explicit `GPUPipelineLayout` won't fit compute. The descriptor field generalises; the *layout-construction logic* does not. **This is the one place render assumptions could leak wrong into compute.**
2. **`constants` (WGSL `override`)** is on `GPUProgrammableStage` for *both* stages — so if furnace adds it later, add it uniformly to render and compute, not as a compute-only path.

Explicit non-issues (verified): workgroup size (shader-side), dispatch dimensions (command/pass layer), all render state (absent from the compute descriptor by spec).

---

## 3. Closing observations

**Tier is the dominant axis.** The single strongest signal across every question is that the field bifurcates by abstraction tier, and furnace's stated tier (sokol/wgpu) lands consistently on one side: shader = **opaque handle**, dedup = **handle identity not source content**, pipeline cache = **does not auto-dedup** (bevy says so in a code comment), entry points = **optional with platform default, no hardcoded names**. The content-addressed source-key + refcount pattern (three.js, Babylon) is real, canonical, and well-engineered — but it lives one tier *up*, in the material/effect layer, and exists precisely because *those* consumers don't manage shader handles. For a low-level WGSL-only handle engine, importing that pattern into the GPU-resource layer would be paying retained-renderer costs (per-acquire string keys, refcount bookkeeping) for a problem the handle model doesn't have.

**Convergence signals.** (1) Shader-as-opaque-handle at the low tier: sokol, wgpu, bevy, raw WebGPU all agree. (2) No source dedup at the low tier: verified by absence in sokol, by `(AssetId, defs)` keying in bevy, by the WebGPU spec offering only a *non-normative* UA compilation cache. (3) Entry points optional with a single-stage default, uniform across all three stages: spec-mandated, mirrored by wgpu and current bevy. (4) Render-vs-compute split at the pipeline, one shader type spanning both: spec-structural, mirrored by sokol/wgpu/bevy. (5) Async load: cache by path/URL, never cache failures, dedup in-flight (Bevy + three.js).

**Divergence points.** (1) **Refcount or not** at furnace's tier — sokol (no) vs wgpu/bevy (`Arc`); the GC + pipeline-capture argument suggests furnace may not need one, but this is the genuine open fork for Q1. (2) **Require vs optional `entryPoint`** — the two threads gave competing (both spec-valid) recommendations; not a factual conflict. (3) **Build-time vs runtime** preprocessing — the ecosystem leans build-time (WESL, naga_oil, wgsl-plus); furnace's `shader.load(url)` is the runtime outlier, under-served by libraries, with three.js as the only proven runtime mechanism (and one it gets away with only via a curated acyclic registry).

**What this implies for a low-level WGSL-only handle-based engine specifically.** The WGSL-only constraint is an *advantage* for furnace that none of the bridging engines enjoy: because there is exactly one shading language and one module type, (a) the single-module `@vertex`+`@fragment`+`@compute` design is fully spec-conformant (verified), (b) the platform's "single entry point per stage" default means furnace can avoid hardcoded names and even avoid storing names entirely for single-entry modules (sokol needed a default name only because it bridges GLSL/HLSL/MSL where a name is mandatory — furnace gets the platform default for free), and (c) the universal `GPUShaderModule` type makes the render→compute generalisation structural, so a flavour-neutral `Shader` resource is *more* general than sokol's stage-tagged shaders and maps 1:1 onto the platform. The two places furnace must add machinery the low-tier precedents don't provide are both at the *edges* of the resource: a runtime URL `// @include` resolver (three.js's skeleton plus cycle-detection and URL-resolution it omits) for Q5, and a deliberate decision about compute bind-group-layout construction for Q6. Everything in the core shader-resource model has a clean, verified precedent to lean on.

---

## Source ledger (primary unless marked secondary)

- WebGPU spec source: `https://raw.githubusercontent.com/gpuweb/gpuweb/main/spec/index.bs` (GPUProgrammableStage L7883; get-the-entry-point L7978–7997; validating L8012–8014; GPUFragmentState L9091; GPUVertexState L10161; GPUComputePipelineDescriptor L8276; GPUShaderModule L7131; GPUCompilationInfo L7327–7346) — verified
- WebGPU spec (W3C TR HTML): `https://www.w3.org/TR/webgpu/` (§2.2.4 caching note; compute pipeline IDL `dictdef-gpucomputepipelinedescriptor`, `dictdef-gpupipelinedescriptorbase`, `dom-gpuprogrammablestage-*`) — verified (§9 createShaderModule algorithm **not** read line-by-line — see Q1/§1.2 partial-verification flag)
- WGSL spec source: `https://raw.githubusercontent.com/gpuweb/gpuweb/main/wgsl/index.bs` (entry point L9291; stages L9325; §13.2 L9334; "compiled separately" L612–616; function restriction L8658) and W3C TR HTML `https://www.w3.org/TR/WGSL/` (§12.14 workgroup_size, §12.15.3 compute, bad_shader example) — verified
- WebGPU official TS typings: `https://gpuweb.github.io/types/interfaces/GPUComputePipelineDescriptor.html`, `https://gpuweb.github.io/types/interfaces/GPUProgrammableStage.html` — verified
- MDN (secondary, mirrors spec): `https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createComputePipeline`, `.../createRenderPipeline`, `.../GPUShaderModule` — verified
- Chromium Intent to Ship (history): `https://groups.google.com/a/chromium.org/g/blink-dev/c/k_gcnAUinT0`; gpuweb issue #4342, PR #4387 — verified
- sokol `sokol_gfx.h` master: `https://raw.githubusercontent.com/floooh/sokol/master/sokol_gfx.h` (handle model L1994–2003; sg_shader L2009; sg_pipeline_desc.shader L3894; sg_shader_function L3635; sg_shader_desc L3735; entry defaults L24159–24167; bindgroups cache L1889–1906) — verified. Author posts `https://floooh.github.io/2025/03/03/sokol-gfx-compute-update.html`, `https://floooh.github.io/2025/05/19/sokol-gfx-compute-ms2.html` — verified
- wgpu docs.rs (29.0.3): `struct.ShaderModule.html`, `struct.VertexState.html`, `struct.ComputePipelineDescriptor.html`, crate root `https://docs.rs/wgpu/latest/wgpu/` — verified
- naga docs.rs (29.0.3): `https://docs.rs/naga/latest/naga/ir/struct.Module.html`, `.../struct.EntryPoint.html` — verified
- bevy docs.rs (0.18.1): `render_resource/struct.{ComputePipelineDescriptor,RenderPipelineDescriptor,VertexState}.html`, `asset/struct.AssetServer.html` — verified. Source: `crates/bevy_render/src/render_resource/pipeline_cache.rs`, `crates/bevy_shader/src/{shader_cache,shader}.rs` (bevyengine/bevy@main) — verified. `compute_shader_game_of_life.rs` dispatch line — **uncertain / not line-read**
- three.js (dev/master): `src/renderers/webgl/WebGLPrograms.js`, `src/renderers/webgl/WebGLProgram.js`, `src/loaders/FileLoader.js`; issue #17635 (cache-error fix); issue #22530 (cache-key allocation, **secondary**) — verified (source); secondary (issues)
- Babylon.js master: `packages/dev/core/src/Engines/thinEngine.pure.ts` (createEffect L2052–2079; disposal L1979–1980) — verified. `https://doc.babylonjs.com/typedoc/classes/babylon.material` — verified via search snippet
- WGSL preprocessor landscape: WGSL preprocessor WG issue `https://github.com/gpuweb/gpuweb/issues/568`; naga_oil README `https://github.com/bevyengine/naga_oil`; WESL spec `https://github.com/wgsl-tooling-wg/wesl-spec` + `Imports.md`, `https://wesl-lang.dev/docs/Getting-Started-JavaScript`, `https://github.com/wgsl-tooling-wg/wesl-js` (v0.7.19); `https://github.com/toji/wgsl-preprocessor`; `https://github.com/JSideris/wgsl-plus`; `https://github.com/reeselevine/pre-wgsl` — verified. WESL "no runtime fetch" inference — **uncertain**; wgsl-plus cycle/dedup behaviour — **undocumented/uncertain**
- kvark ShaderCompile debate `https://kvark.github.io/webgpu-debate/ShaderCompile.component.html`; webgpu.rocks; webgpufundamentals — **secondary**, corroboration only

**Fed:** the D-1 shader-resource decision — `Shader` as a first-class, non-refcounted resource, whose surface is `docs/reference/core-modules.md` §`@furnace/core/shader`. Its live residue cites this file twice: `docs/backlog/engine-architecture/shader-substrate-follow-ons.md` §Shader composition — deferred follow-ons and §Shader resource — revisit the no-refcount decision.
