# Prior art: JS↔WGSL uniform/param data-binding ("the bridge") in WebGPU engines and libraries

This document surveys how the WebGPU/WGSL substrate and the surrounding engine ecosystem **move named host-side data into shader uniform and storage memory** — the layer furnace's Tranche E ("the bridge") must design. It is the data-binding sibling to the `Shader` resource (Tranche D-1, landed 2026-05-31), which drew the **code-vs-params seam**: D-1 owns the WGSL *code*, E owns the `@group(1)` *data*. The two backlog entries this feeds are [`typed-uniform-setters.md`](../backlog/engine-architecture/typed-uniform-setters.md) (the generic schema-driven setter) and [`material-uniform-setters.md`](../backlog/engine-architecture/material-uniform-setters.md) (the per-built-in friendly end + built-in reconciliation).

**This doc is NEUTRAL.** It feeds a brainstorm; it does **not** pick furnace's design. Where a verification verdict refutes or nuances a common assumption — most importantly the backlog's "runtime WGSL reflection needs a heavy vendored wasm parser" claim — that correction is foregrounded. Sections that rest on thinner evidence are flagged inline.

Findings are verified against primary sources (the WGSL/WebGPU specs, library source on GitHub, official docs, npm registry data) in research sessions of 2026-05-30/31. Claims resting on general knowledge are flagged "uncertain". Citations are inline.

The systems surveyed span the full abstraction spectrum, deliberately matching the tier furnace already occupies (sokol/wgpu) plus the higher tiers furnace's consumers know:

- **The substrate** — the WGSL spec's memory-layout rules + the WebGPU JS API's (non-)reflection surface. The hard constraints everything else works around.
- **Pure-JS WebGPU tooling** — `wgsl_reflect`, `webgpu-utils`, `TypeGPU`. The libraries that solve exactly furnace's problem, in furnace's language.
- **The native low-tier** — `wgpu` (Rust), `sokol-gfx` (C). furnace's own abstraction tier.
- **Build-time codegen** — `sokol-shdc`, `wgsl_to_wgpu`, `wgsl_bindgen`, `encase`/`crevice`/`bytemuck` (Rust). The dominant production pattern.
- **High-tier engines** — three.js, Babylon.js, Bevy, Unity, Unreal, Godot, bgfx. How the engines furnace's consumers know expose by-name params, and crucially how they split engine vs user uniforms.

---

## 1. Purpose & scope

**What E is.** furnace today is at the sokol-gfx / wgpu abstraction tier: opaque uint48 resource handles, namespaced free functions taking a `Context` first (`material.create(ctx, desc)`, `mesh.setPosition(ctx, m, vec3)`, `shader.create(ctx, wgsl)`). The binding contract is fixed: `@group(0)` = engine-owned uniforms (camera `viewProjection: mat4x4<f32>`, per-object `model: mat4x4<f32>`); `@group(1)` = consumer-defined material/effect params. **Today consumers hand-manage `@group(1)`**: `createBuffer` with a manually-correct 16-byte-aligned size, allocate a scratch `Float32Array`, write named fields into *magic indices* (`scratch[0]=stripes`, `scratch[1]=hue`…), and `queue.writeBuffer` every frame. That is the pain E exists to remove.

**What E must scale to.** Beyond per-material vec4s: vertex + fragment **and** compute shaders, storage buffers, and heavy GPGPU data (physics, image processing, effects). Shaders are first-class. The single most decision-relevant constraint the user names is the **scaling axis**: the abstraction chosen for `@group(1)` material params must not be a dead end when storage buffers and compute I/O arrive.

**The key open fork (stated, not decided here).** Do engine uniforms keep **typed per-resource setters** (`mesh.setPosition` writes the model matrix) while consumer params get a **separate** mechanism — or is there **one unified by-name interface** for all uniforms, engine and consumer alike? Reflection (parsing WGSL to derive the layout) is *low-appetite* to build right now, but the chosen abstraction **must not preclude** adding it later. This document gathers what the field does on each axis so the brainstorm can choose; it states no preference.

---

## 2. The WebGPU/WGSL substrate

This is the bedrock. Every option in §3–§8 is a strategy for satisfying these rules. Two facts dominate: (a) **uniform and storage address spaces have different layout rules**, and (b) **the WebGPU JS API exposes zero runtime reflection of shader internals**.

### 2.1 Alignment & size — the exact numbers

WGSL defines `AlignOf` and `SizeOf` for every type in its formal memory-layout section (§14.4.1). For the types furnace's bindings actually use ([WGSL spec §14.4.1](https://www.w3.org/TR/WGSL/#alignment-and-size); cross-checked against [teoxoy's canonical layout gist](https://gist.github.com/teoxoy/936891c16c2a3d1c3c5e7204ac6cd76c) and [sotrh learn-wgpu alignment](https://sotrh.github.io/learn-wgpu/showcase/alignment/)):

| Type | `AlignOf` (bytes) | `SizeOf` (bytes) | Note |
|---|---|---|---|
| `f32` / `i32` / `u32` | 4 | 4 | |
| `f16` | 2 | 2 | |
| `vec2<f32>` | 8 | 8 | |
| `vec3<f32>` | **16** | **12** | size < align — 4-byte padding hole follows each field |
| `vec4<f32>` | 16 | 16 | |
| `mat2x2<f32>` | 8 | 16 | |
| `mat4x4<f32>` | 16 | 64 | four column-`vec4`s, column-major |
| `array<E,N>` | `AlignOf(E)` | `N × roundUp(AlignOf(E), SizeOf(E))` | element stride rounds up |
| `struct S` | `max(AlignOf(members))` | `roundUp(AlignOf(S), offsetOfLastMember + SizeOfLastMember)` | size padded up |

where `roundUp(k, n) = ⌈n ÷ k⌉ × k` (verified verbatim from the [W3C CRD-WGSL-20260519](https://www.w3.org/TR/2026/CRD-WGSL-20260519/#alignment-and-size)).

**The `vec3` footgun, concretely.** `vec3<f32>` has `AlignOf = 16` but `SizeOf = 12`. A struct member's offset is `roundUp(AlignOf(member), prevOffset + SizeOf(prev))` — the running offset advances by **`SizeOf`**, not by `roundUp(align, size)` (that rounded-stride rule is for *array elements*, §14.4.4, a distinct rule). Two consequences:
- `{ vec3<f32>, f32 }` is **16 bytes**: the `vec3` occupies bytes 0–11, and the `f32` (align 4) packs into the tail padding at offset `roundUp(4, 12) = 12`. The scalar fills the hole — this is the *benign* direction. (Earlier drafts of this note, and the E-B plan, wrongly put the `f32` at byte 16 / struct 20; corrected here against the spec — the calculator in `packages/core/src/binding/layout.ts` and its tests encode the right values.)
- `{ f32, vec3<f32> }` is **32 bytes**: the `f32` is at 0, but the `vec3` needs align 16, so it lands at `roundUp(16, 4) = 16` (bytes 4–15 wasted), running extent 28, struct rounded to 32. *This* is where vec3's alignment actually bites.

Both are verified spec consequences, not folklore.

The `@align(N)` and `@size(N)` attributes override member alignment/size (`@align`: N a power of 2 ≥ natural align; `@size`: N ≥ natural size), letting a host struct be byte-exactly matched against a WGSL struct even when natural layout would differ ([WGSL §12.1 `@align`](https://www.w3.org/TR/WGSL/#align-attr), [§12.13 `@size`](https://www.w3.org/TR/WGSL/#size-attr)).

### 2.2 The uniform-vs-storage layout fork

This is the rule the *scaling axis* hangs on.

- **Uniform address space** imposes std140-equivalent *extra* constraints (WGSL §14.4.5 "Address Space Layout Constraints"): array element stride must be a multiple of 16 — `roundUp(16, SizeOf(E))`. So `array<f32,4>` needs stride 16 (not 4), `array<vec2<f32>,4>` needs stride 16 (not 8), `array<vec3<f32>,4>` is already 16. Nested struct members of struct type `S` must be followed by the next member at an offset ≥ `roundUp(16, SizeOf(S))`. ([WGSL §14.4.5](https://www.w3.org/TR/WGSL/#address-space-layout-constraints); error-message evidence in [Slang #4985](https://github.com/shader-slang/slang/issues/4985): *"'uniform' storage requires that array elements are aligned to 16 bytes, but array element of type 'vec2<f32>' has a stride of 8 bytes"*; [naga #953](https://github.com/gfx-rs/naga/issues/953): *"array stride 4 is not a multiple of the required alignment 16"*.)
- **Storage address space** uses the *base* rules only (std430-equivalent): element stride = `AlignOf(E)`, no 16-byte floor. So `array<f32,4>` packs as 16 bytes total (stride 4), not 64. ([webgpufundamentals storage buffers](https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-buffers.html).)

Per [gpuweb PR #1215](https://github.com/gpuweb/gpuweb/pull/1215) (which added the layout section), WGSL uniform layout is a strict superset of GLSL std140; WGSL storage layout equals std430. The one deviation: std140 gives all matrices 16-byte alignment, WGSL gives `matCx2` only 8.

Two more hard differences:

- **Size caps:** `maxUniformBufferBindingSize = 65536` bytes (64 KiB); `maxStorageBufferBindingSize = 134217728` bytes (128 MiB) — a 2048× difference. Any data above 64 KiB (particles, image kernels, big instance arrays) **must** be storage. ([WebGPU spec supported-limits](https://www.w3.org/TR/webgpu/#dom-supported-limits-maxuniformbufferbindingsize).)
- **Access mode:** uniform is always read-only from the shader; `var<storage, read_write>` enables shader writes — the only path for compute output. ([WGSL §14.2 address spaces](https://www.w3.org/TR/WGSL/#address-spaces).)

**Implication, foregrounded:** an `@group(1)` abstraction that silently reuses uniform layout math for arrays of small types will produce **invalid** buffers. The bridge must either refuse to materialize `array<T>` (stride < 16) as uniform, or route array bindings to storage. This is a verified silent footgun, not a hypothetical.

> **A near-term escape valve, but NOT cross-browser safe.** The `uniform_buffer_standard_layout` WGSL language extension lifts the 16-byte uniform array-stride constraint, making uniform layout identical to storage. Shipped Chrome 144 (May 2025), opt-in via `requires uniform_buffer_standard_layout;`, feature-detected with `navigator.gpu.wgslLanguageFeatures.has(...)`. As of May 2026: Chrome ships it; WebKit gave a positive WG signal but **has not shipped**; Firefox has **no signal**. ([Chrome 144 blog](https://developer.chrome.com/blog/new-in-webgpu-144), [WGSLLanguageFeatures MDN](https://developer.mozilla.org/en-US/docs/Web/API/WGSLLanguageFeatures), [WGSL extension spec](https://www.w3.org/TR/WGSL/#language_extension-uniform_buffer_standard_layout).) **furnace's primary browser is Safari** (per project memory) — so furnace must NOT rely on this extension for layout correctness. Note it; don't depend on it.

### 2.3 The hard fact: WebGPU has NO runtime shader reflection

**Verification verdict: CONFIRMED.** All primary sources agree, no refuting evidence found.

`GPUShaderModule` has exactly two surface members: the `label` property and `getCompilationInfo()`, which returns a `Promise<GPUCompilationInfo>` — an array of error/warning/info messages from the WGSL compiler. It returns **no** bind-group layouts, struct member names, field byte offsets, or type info. ([gpuweb spec GPUShaderModule](https://gpuweb.github.io/gpuweb/#gpushadermodule), [MDN GPUShaderModule](https://developer.mozilla.org/en-US/docs/Web/API/GPUShaderModule).)

`getBindGroupLayout(index)` on a render/compute pipeline returns a `GPUBindGroupLayout` that exposes only an inherited `label` and **no methods** — it encodes binding slot, stage visibility, resource category, and whether dynamic offsets are used, but **not** struct member names, field offsets, or field types. Its sole purpose is to let you build a compatible `GPUBindGroup` for a `layout: "auto"` pipeline. ([MDN getBindGroupLayout](https://developer.mozilla.org/en-US/docs/Web/API/GPURenderPipeline/getBindGroupLayout), [MDN GPUBindGroupLayout](https://developer.mozilla.org/en-US/docs/Web/API/GPUBindGroupLayout).)

This is a *deliberate* break from WebGL2, which exposed `getActiveUniforms` with `UNIFORM_OFFSET` / `UNIFORM_ARRAY_STRIDE` / `UNIFORM_MATRIX_STRIDE` plus `getActiveUniformBlockParameter` — enough to query every named member's byte offset at runtime. webgpufundamentals states it plainly: *"in WebGPU … EVERYTHING is by byte offset or index and there is no API to query them. Keeping the locations … in sync … is entirely your responsibility."* ([webgpufundamentals from-webgl](https://webgpufundamentals.org/webgpu/lessons/webgpu-from-webgl.html).) The working group rejected reflection on performance grounds; [gpuweb #2316](https://github.com/gpuweb/gpuweb/issues/2316) (requesting that Dawn's internal Tint reflection be exposed) was closed without adding it, and no 2024–2026 proposal revives it.

**Consequence:** any name→offset mapping furnace wants must come from **parsing WGSL** (CPU-side, see §3) or from a **consumer-declared layout**. The runtime GPU API will never hand it over for free. The unified by-name interface is *not blocked* by WebGPU — but it is *not handed to furnace either*; furnace must construct and own the mapping.

---

## 3. Layout-source options matrix

Five strategies exist for getting from "a named field" to "the correct byte offset in a correctly-sized buffer." Each row notes maturity, cost, browser-only fit, and whether it **forecloses adding reflection later** (the explicit constraint).

| Option | What it is | Maturity | Cost / footprint | Browser-only fit | Precludes adding reflection later? |
|---|---|---|---|---|---|
| **(A) Consumer-declared schema** | Consumer passes `{ stripes: "f32", hue: "f32" }` (or `{ offset, type }` per field); engine computes layout from *that*, never the WGSL. The current pain, but typed. | Proven everywhere (Bevy `AsBindGroup` attrs, sokol-shdc `@ctype`, Babylon `addFloat`). | Lowest engine lift. **SSOT cost**: schema duplicates the WGSL struct; the two can drift. | Perfect — pure data, no deps. | **No.** Schema is an *alternative* layout source; reflection can fill the same internal map later. |
| **(B) Runtime pure-JS WGSL reflection** | Parse the WGSL string furnace already retains (D-1 `Shader` slot keeps `.source`) at `shader.create()` time; derive name→offset map. Via `wgsl_reflect` (parser) and/or `webgpu-utils` (structured-view layer). | `wgsl_reflect` ~1.4M downloads/month, 438 commits, MIT; `webgpu-utils` 40+ versions, ~1.4k downloads/week, MIT. Both validated against Tint. | One-time parse per shader (not per frame). Dependency or vendored-parser footprint (~2.3 MB unpacked source; ~321 KB bundle). | **Pure JS, no wasm, no build step.** Both ship browser ESM. | N/A — *this is* the reflection option. |
| **(C) Vendored wasm parser** | Compile naga/Tint to wasm, run it in-browser to reflect WGSL. | naga/Tint are mature *as Rust*; wasm-in-browser-for-reflection is not a standard path anyone surveyed actually ships. | Heavy: wasm bundle + glue; the option the backlog assumed was *required*. | Works but is the heaviest browser footprint of the five. | N/A — also a reflection option, just a worse-fit one. |
| **(D) Build-time codegen** | A build step parses WGSL and emits a typed struct + offset asserts. sokol-shdc (C/Zig/Rust headers), wgsl_to_wgpu / wgsl_bindgen (Rust). | Production-proven (sokol-shdc ships in sokol; both Rust tools widely used). | Build-tool dependency on every consumer; no runtime cost. **Foundational-rule tension:** only `@furnace/tools` ships binaries; a required build step for `@furnace/core` consumers cuts against "any TS bundler can consume core." | Generated *output* is pure TS — but the *generator* is a build dependency. | **No.** Codegen and reflection both feed the same internal layout map; additive. |
| **(E) TS-schema-as-SSOT → generates WGSL** | The TS schema (`d.struct({ color: d.vec4f })`) is the single source of truth; the library *generates* the WGSL struct from it and serializes CPU data to the matching bytes. TypeGPU. | TypeGPU v0.11.8 — **pre-1.0**, 46 releases, MIT, 3 prod deps (`tinyest`, `typed-binary`, `tsover-runtime`). | Adds prod deps; **inverts authoring** — consumers write params in TS, not WGSL. TGSL shader transpilation needs a bundler plugin (data schemas/buffers do not). | Pure JS schema layer; WebGPU-targeted. | **No.** But it changes the authoring direction; reflection (WGSL→TS) is the *reverse* tool (`tgpu-gen`), also offered. |

### 3.1 Foregrounded correction — the backlog's "heavy wasm parser" assumption is FALSE

The two backlog entries assert that the by-name path *"needs a vendored parser since WebGPU exposes no runtime uniform reflection"* and list *"Vendor a WGSL parser (heavy)"* as the implementation cost ([`typed-uniform-setters.md`](../backlog/engine-architecture/typed-uniform-setters.md), [`material-uniform-setters.md`](../backlog/engine-architecture/material-uniform-setters.md) — the latter calls reflection *"the heaviest, worst-fit-for-tier option"*).

**Verification verdict: NUANCED — the core assumption is FALSE.** A mature **pure-JavaScript, no-wasm, no-build-step** WGSL reflection path exists today:

- **`brendan-duncan/wgsl_reflect`** — a hand-written TypeScript WGSL parser, **zero production dependencies**, MIT. Exposes `.uniforms`, `.storage`, `.structs`, `.entry.{vertex,fragment,compute}`, with `MemberInfo.{name, type, offset, size}` (byte offset from struct start) and `ArrayInfo.stride`. Parsing happens at runtime when you call `new WgslReflect(src)`. Ships browser ESM + Node entries + `.d.ts`. (~1.4M downloads/month — primarily as a transitive dep of larger tools.) ([repo](https://github.com/brendan-duncan/wgsl_reflect), [npm](https://registry.npmjs.org/wgsl_reflect/latest).)
- **`greggman/webgpu-utils`** — wraps `wgsl_reflect` (inlined at build time as a devDependency, so **zero runtime npm deps**) and adds `makeShaderDataDefinitions(wgsl)` + `makeStructuredView(def)`. The structured view returns `.arrayBuffer` (correctly sized + padded), `.views` (a TypedArray per named field), and `.set({ field: value })`. The consumer writes named fields and calls `device.queue.writeBuffer(buf, 0, view.arrayBuffer)` once. **This is the only production-ready JS API that replaces magic-index `Float32Array` writes with named-field `.set()` calls today.** Verified by inspecting the CDN bundle — self-contained, no `.wasm` fetch. ([repo](https://github.com/greggman/webgpu-utils), [data-definitions.ts](https://github.com/greggman/webgpu-utils/blob/main/src/data-definitions.ts), [docs](https://greggman.github.io/webgpu-utils/docs/), [memory-layout lesson](https://webgpufundamentals.org/webgpu/lessons/webgpu-memory-layout.html).)

**So the backlog's "no reflection now" stance is cost-based, not feasibility-based.** Reflection is open *today*; it is not blocked on building or vendoring a wasm parser. The real, still-open questions the brainstorm should weigh:

1. **Dependency posture.** Depend on `wgsl_reflect` directly (smaller, the actual parser, MIT) vs `webgpu-utils` (bundles it, but modest direct adoption ~1.4k/week) vs **vendor the parser as a build-time devDep** (same pattern webgpu-utils uses) to keep core's runtime-dep count at zero. Core's contract ("plain ESM, any TS bundler consumes it") is satisfiable by all three; the vendored-devDep route keeps zero runtime deps.
2. **Subset vs whole.** furnace needs only uniform/storage struct layout + bind-group slots — not the full AST. A lighter in-house parser of *just that subset* is an option; the tradeoff is build-and-maintain vs take-a-dep.
3. **Known hard gap: unsized arrays.** `wgsl_reflect` cannot size a runtime-sized array (`array<T>` with no N) at parse time — its size is determined by the buffer binding. For GPGPU/compute storage buffers this is real; size must still come from explicit user metadata. Not a blocker for the common uniform-struct case, but a genuine limit on parse-time reflection for the scaling axis.

> **Low-confidence note on (C).** No surveyed project actually ships a wasm WGSL parser *in the browser for reflection*. naga/Tint are mature Rust/C++ compilers used at build time or server-side; "vendor a wasm parser" is the option the backlog *assumed* and is the least-evidenced of the five. Treat its cost as "plausibly heavy, not demonstrated by anyone here."

---

## 4. Cross-engine comparison table

Columns chosen to match E's open questions: who declares the layout, whether engine and user uniforms share one mechanism (the fork), how the abstraction extends to compute/storage (the scaling axis), and when layout is computed.

| Source | Tier | By-name / Typed-struct / Raw-bytes | Engine-vs-user uniforms | Compute / storage story | Layout computed at |
|---|---|---|---|---|---|
| **WebGPU/WGSL (substrate)** | substrate | Raw bytes (`queue.writeBuffer` + magic-index `Float32Array`) | Same raw path; split is convention (`@group` index) only | Same bind-group mechanism; storage = different BufferBindingType + std430 layout + `read_write` | Run (host computes offsets by hand) |
| **`wgsl_reflect`** | JS lib | Reflection → by-name (`MemberInfo.offset`) | No distinction; all groups in one `.uniforms`/`.storage` list, keyed by `.group`/`.binding` | `.storage` + `.entry.compute` in the same API | Run (parse on `new WgslReflect`) |
| **`webgpu-utils`** | JS lib | Reflection → by-name (`.set({field})`) | No distinction; flat name→def map, no group scoping | `makeStructuredView` works identically for `defs.storages`; `makeBindGroupLayoutDescriptors` handles compute | Run (parse on `makeShaderDataDefinitions`) |
| **TypeGPU** | JS lib | Typed-struct (TS schema *is* SSOT, generates WGSL) | No distinction; one `tgpu.bindGroupLayout`, group via `.$idx(n)` | One layout discriminated by `{uniform}`/`{storage, access}` key; `.$usage('storage')`; same `with()` for compute | Load (schema construct) + run (`tgpu.resolve` emits WGSL) |
| **wgpu** (Rust) | low (GPU) | Raw bytes (`queue.write_buffer` + `bytemuck`/`encase`) | Same mechanism; split is `@group` convention | Identical BindGroupLayout for compute; storage = different `BufferBindingType` | Build/load (host-declared `BindGroupLayout`) |
| **sokol-gfx** (C) | low (GPU) | Raw bytes (`sg_apply_uniforms(slot, range)`) — integer slot, no name | Same mechanism; split = slot-index convention | Same `sg_apply_uniforms` inside compute passes; storage via separate `view` bindings | Build/load (block size at `sg_make_shader`; GL needs member descriptors) |
| **sokol-shdc** (codegen) | tool | Typed-struct (generated C/Zig/Rust); `--reflection` adds by-name `uniform_offset(...)` | Same mechanism; separate UBs by update frequency, caller-partitioned | Same codegen pipeline for SSBO element structs (since 2024) | **Build** (offline compiler) |
| **Bevy** (Rust) | high (engine) | Typed-struct (`#[derive(AsBindGroup)]` + `encase`) | **SPLIT** — engine `ViewUniform`/`MeshUniform` via dedicated systems; user params via `AsBindGroup` at group 3 | `#[storage(N)]` field; `ShaderStorageBuffer` asset. Compute bypasses `AsBindGroup` (manual `BindGroupLayoutEntries`) | Build (proc-macro) + run (`encase` byte-packing) |
| **three.js** (WebGL path) | high | By-name (`{ name: { value } }` map) | **SPLIT** — built-ins (`modelViewMatrix` etc.) injected as GLSL preamble, separate from user `uniforms` object | n/a (WebGL2 UBO via ordered `UniformsGroup`) | Run (`gl.getActiveUniform` after link) |
| **three.js** (WebGPU/TSL) | high | By-name (`uniform(value)` node) | **SPLIT by group** — engine nodes → `frameGroup`/`renderGroup`; user → `objectGroup`; same `uniform()` codegen | `StorageBufferNode` in same node/bind-group system; `var<storage,read_write>` auto-emitted | Build (TSL compile per material variant) |
| **Babylon.js** (WebGPU) | high | By-name (`setFloat`/`setMatrix`) for scalars; explicit `UniformBuffer.add*` for UBOs | **Unified for scalars** (`setMatrix("world",…)` == user); named UBOs (`Scene`/`Mesh`) are a distinct path | `ComputeShader.setStorageBuffer`/`setUniformBuffer`; reuses `UniformBuffer` class | Run (lazy `_checkUniform`) / load (`UniformBuffer` once) |
| **Unity** (URP) | high | By-name with **interned int** (`Shader.PropertyToID`) | **SPLIT** — `CBUFFER(UnityPerDraw)` engine vs `CBUFFER(UnityPerMaterial)` user; SRP Batcher *requires* it | `Material.SetBuffer(nameID, ComputeBuffer)` — same interned-id pattern | Build (cbuffer fixed at shader compile); ids interned at startup |
| **Unreal 5.7** | high | By-name with **interned FName** + explicit index fast-path | **SPLIT** — `FViewUniformShaderParameters` (global UB) vs MID scalar/vector params | Same `BEGIN_SHADER_PARAMETER_STRUCT` macros for compute (`SHADER_PARAMETER_UAV`) | Build (macro metadata: name+type+offset) |
| **Godot 4.x** (high path) | high | By-name (`set_shader_parameter(name, value)`) | **SPLIT** — built-ins (`MODEL_MATRIX` etc.) are read-only in-vars, never settable | RenderingDevice (low path): `RDUniform` + integer binding; same uniform-set for compute + draw | Build (shader compile) for high path; caller-specified for low path |
| **bgfx** (C++) | mid | **Interned handle** (`createUniform(name)` → handle; `setUniform(handle, ptr)`) | Same mechanism; engine `u_viewProj`/`u_model` injected by driver, user calls `createUniform` | Storage **bypasses** uniforms entirely: `setBuffer(slot, handle, Access)` — parallel system | Load (`createUniform` type+count); byte layout caller-managed |

Source-line evidence for the table is in §5–§6 and the §9 citation list.

---

## 5. The core fork — typed per-resource setters vs one unified by-name interface

This is E's headline decision. The prior art speaks to two sub-questions: **should engine and user uniforms share one mechanism?** and **how do you make a by-name interface hot-path-acceptable?**

### 5.1 Engine-vs-user split — verdict: the field overwhelmingly SPLITS

**Verification verdict: CONFIRMED — higher-tier engines do NOT fully unify engine/built-in uniforms with user uniforms.**

- **three.js (WebGL):** `WebGLProgram.js` has an explicit `if (parameters.isRawShaderMaterial) { … } else { … }` branch; the `else` (ShaderMaterial) prepends literal GLSL `uniform mat4 modelMatrix; modelViewMatrix; projectionMatrix; viewMatrix;` etc. into the shader prefix at compile time. The user's `uniforms` JS object contains **only** user values; built-ins are never in it. `RawShaderMaterial` opts out of the injection entirely. ([WebGLProgram.js](https://raw.githubusercontent.com/mrdoob/three.js/dev/src/renderers/webgl/WebGLProgram.js), [WebGLMaterials.js](https://raw.githubusercontent.com/mrdoob/three.js/dev/src/renderers/webgl/WebGLMaterials.js).)
- **three.js (WebGPU/TSL):** engine contextual nodes (`cameraPosition`, `modelViewMatrix`) resolve to `frameGroup`/`renderGroup`; user `uniform(value)` defaults to `objectGroup` — a **structural bind-group split**, enforced via `this.groupNode = objectGroup` in `UniformNode.js`. [PR #28665](https://github.com/mrdoob/three.js/pull/28665) documents the intent: *"Bind group 0: camera uniforms, Bind group 1: object and material uniforms."* They share the `uniform()` *codegen* pipeline but land in different UBOs. ([UniformNode.js](https://raw.githubusercontent.com/mrdoob/three.js/dev/src/nodes/core/UniformNode.js), [UniformGroupNode.js](https://raw.githubusercontent.com/mrdoob/three.js/dev/src/nodes/core/UniformGroupNode.js).)
- **Bevy:** group 0 = view/lights/shadows via `SetMeshViewBindGroup`; group 2 = `MeshUniform` (world transforms) via `SetMeshBindGroup`; group 3 = material via `SetMaterialBindGroup<3>` (`MATERIAL_BIND_GROUP_INDEX = 3`). View/mesh uniforms use **dedicated ECS systems** (`prepare_view_uniforms`, `DynamicUniformBuffer<ViewUniform>`, `GpuArrayBuffer<MeshUniform>`) — **not** `AsBindGroup`. The `AsBindGroup` docs even state *"the 'group' index is determined by the usage context. It is not defined in AsBindGroup."* ([material.rs](https://github.com/bevyengine/bevy/blob/main/crates/bevy_pbr/src/material.rs), [AsBindGroup docs](https://docs.rs/bevy/latest/bevy/render/render_resource/trait.AsBindGroup.html), [ViewUniforms](https://docs.rs/bevy/latest/bevy/render/view/struct.ViewUniforms.html).)
- **Unity:** engine props in `CBUFFER(UnityPerDraw)` (`unity_ObjectToWorld`, etc.), user props in `CBUFFER(UnityPerMaterial)`; the SRP Batcher *structurally requires* this split or the shader is incompatible. ([SRP Batcher docs](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/shaders-in-universalrp-srp-batcher.html), [UnityInput.hlsl](https://github.com/Unity-Technologies/Graphics/blob/master/Packages/com.unity.render-pipelines.universal/ShaderLibrary/UnityInput.hlsl).)
- **Unreal:** `FViewUniformShaderParameters` (global UB, `SHADER_PARAMETER_STRUCT_REF`) vs MID `SetScalarParameterValue`/`SetVectorParameterValue` (FName-keyed) — entirely separate binding *and* update systems. ([FViewUniformShaderParameters](https://docs.unrealengine.com/5.2/en-US/API/Runtime/Engine/FViewUniformShaderParameters/).)
- **Godot:** engine built-ins (`MODEL_MATRIX`, `VIEW_MATRIX`, `PROJECTION_MATRIX`) are **read-only in-variables** written by the pipeline, never settable via `set_shader_parameter`. ([spatial shader reference](https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/spatial_shader.html).)

**The one genuine unifier — Babylon.js — earns it by owning the whole bind cycle.** `effect.setMatrix("world", world)` (engine) and `effect.setMatrix("myCustomMatrix", m)` (user) are *identical* call sites; both names live in the same `uniforms: string[]` array. ([shaderMaterial.pure.ts](https://raw.githubusercontent.com/BabylonJS/Babylon.js/master/packages/dev/core/src/Materials/shaderMaterial.pure.ts).) This is the proof that a unified by-name surface *can* work — **but only because the engine unconditionally drives the entire material bind, leaving the consumer no per-resource setter to hold.** That is a different posture from furnace's `mesh.setPosition(ctx, m, vec3)`. bgfx is similar at its tier: engine `u_viewProj`/`u_model` are injected by the *driver*; user uniforms need `createUniform` — same shader-side spelling, different *who-calls-setUniform*. ([bgfx_shader.sh](https://github.com/bkaradzic/bgfx/blob/master/src/bgfx_shader.sh).)

**What this teaches the fork (not a decision):**

- Keeping engine uniforms (`@group(0)` camera VP + per-object model) as **typed per-resource setters** managed by the engine, with consumer params getting a **separate** `@group(1)` mechanism, is the **proven, dominant pattern** — every higher-tier engine surveyed except Babylon does exactly this, and furnace's existing `@group(0)`/`@group(1)` split already mirrors it. Unity shows the split can even be a *hard correctness constraint* (SRP Batcher).
- A **fully unified** by-name interface for both is **possible** (Babylon, bgfx-at-tier) but has thin prior-art support and demands the engine own the whole bind cycle — a posture shift away from per-resource setters. It is *not precluded* by anything in this research; it is simply the road less traveled.
- The low-tier libs (wgpu, sokol) make **no** API-level engine/user distinction at all — both are integer-slot + raw bytes; the split is pure `@group` convention. furnace sits at this tier, so the split it *does* have is already an engine-author convention layered on top, consistent with the tier.

### 5.2 Making by-name fast — verdict: interned-handle pattern is the proven answer

**Verification verdict: CONFIRMED — higher-tier engines mitigate per-call string cost with an interned-handle/id pattern.**

- **Unity:** `Shader.PropertyToID(name) → int` interns a name to a **session-stable** int once; the docs explicitly recommend caching it (*"it is better to get the identifiers of the properties you need just once"*), and every typed setter (`SetFloat`, `SetVector`, `SetBuffer`…) has an `(int nameID, …)` overload alongside the `(string, …)` one. The int is *not* stable across sessions/machines. ([PropertyToID](https://docs.unity3d.com/ScriptReference/Shader.PropertyToID.html), [SetFloat](https://docs.unity3d.com/ScriptReference/Material.SetFloat.html).)
- **bgfx:** `createUniform(name, type, num) → UniformHandle`; `setUniform(handle, value*, num)` takes the **handle, not the name**. Canonical usage: create once in init, store as a member, `setUniform` every frame. Calling `createUniform` with the same name returns the **same handle** (ref-counted) — effectively a global string intern. ([bgfx.h](https://raw.githubusercontent.com/bkaradzic/bgfx/master/include/bgfx/bgfx.h), [issue #1905](https://github.com/bkaradzic/bgfx/issues/1905).)
- **Unreal:** `FName` (global intern table, O(1) index comparison, case-insensitive) is the parameter identifier type at the MID API; an explicit `InitializeScalarParameterAndGetIndex` → `SetScalarParameterByIndex` fast-path exists for hot updates (but with per-instance invalidation — *"Do NOT presume the index can be used from one instance on another"*, flagged as fragile). ([FName](https://dev.epicgames.com/documentation/en-us/unreal-engine/fname-in-unreal-engine), [SetScalarParameterByIndex](https://dev.epicgames.com/documentation/en-us/unreal-engine/BlueprintAPI/Rendering/Material/SetScalarParameterbyIndex).)

**What this teaches the fork:** the choice is *not* "typed setters vs by-name as fundamentally different mechanisms." Both engines unify them under handles: an init-time `name → handle` call pays the string cost once; a per-frame `handle → value` call has no string overhead. A furnace `params.uniform("stripes") → ParamHandle` (cached on first call, fast integer-keyed path after) would make a by-name surface hot-path-acceptable — and typed per-resource setters (`mesh.setPosition`) become thin wrappers whose handle is implicit/baked. bgfx's idempotent-by-name property even means furnace could let `params.uniform("stripes")` be safe to call repeatedly without consumer caching, deferring the intern bookkeeping to the engine. (*Low-confidence caveat:* Unity's docs imply `PropertyToID` does **not** self-memoize at the call site — the internal mechanism was not reachable from the C# reference source this session; the caching recommendation strongly implies user-side caching is genuinely beneficial.)

> **What furnace should NOT copy.** (1) Unity's `MaterialPropertyBlock` per-renderer override model is **incompatible with Unity's own SRP Batcher** — confirming that injecting per-renderer data outside the standard cbuffer pipeline is an architectural dead end. (2) Unreal's `InitializeScalarParameterAndGetIndex` two-call init-then-use with per-instance index invalidation is too fragile for scale — the simpler intern-at-callsite pattern (Unity `PropertyToID`, bgfx `createUniform`) is cleaner. (3) bgfx/Babylon's manual std140 layout arithmetic in consumer code (`addFloat`/`addVector3` advancing a pointer with manual padding) is *exactly furnace's current magic-index pain* — the worst DX from both, and precisely what the bridge exists to remove.

---

## 6. Generalization to compute & storage buffers — the scaling axis

The user's most-weighted question: does a `@group(1)`-params abstraction **cleanly extend** to storage buffers + compute I/O, and what patterns let one bridge serve both?

**The field's answer: YES it can, but only if the binding descriptor carries address-space intent as a first-class field, not as an implicit assumption.** The systems that generalize cleanly all do the same three things.

**Where it generalizes cleanly:**

- **TypeGPU** is the cleanest demonstration: one `tgpu.bindGroupLayout` with a discriminated entry — `{ uniform: Schema }` | `{ storage: Schema, access: 'readonly' | 'mutable' }` | `{ texture }` | `{ sampler }`. The same `root.createBuffer().$usage('uniform' | 'storage')` and the same `with(bindGroup)` pipeline method serve render *and* compute; `dispatchWorkgroups(x,y,z)` is the only compute-specific call. A particle sim binds `{ params: { uniform: SimParams }, particlesA: { storage: Particles, access: 'readonly' }, particlesB: { storage: Particles, access: 'mutable' } }` through one mechanism. ([tgpuBindGroupLayout.ts](https://github.com/software-mansion/TypeGPU/blob/main/packages/typegpu/src/tgpuBindGroupLayout.ts), [compute pipeline interface](https://docs.swmansion.com/TypeGPU/api/typegpu/interfaces/tgpucomputepipeline/).)
- **Bevy** generalizes via attributes on the same derive: `#[uniform(N)]`, `#[storage(N)]`, `#[storage(N, read_only)]`, `#[storage_texture(N)]` — all on one `#[derive(AsBindGroup)]`, all requiring `T: ShaderType`. The base `ShaderType` follows std430-ish rules; an extra `assert_uniform_compat()` enforces the stricter uniform-only 16-byte-stride rule (panics if array stride < 16). **But** Bevy's *compute* pipelines often bypass `AsBindGroup` for manual `BindGroupLayoutEntries::sequential(ShaderStages::COMPUTE, …)` — the storage *type* is shared, the compute *binding setup* diverges. ([AsBindGroup docs](https://docs.rs/bevy/latest/bevy/render/render_resource/trait.AsBindGroup.html), [game_of_life.rs](https://github.com/bevyengine/bevy/blob/main/examples/shader/compute_shader_game_of_life.rs).)
- **Unity** and **Unreal** fully unify: Unity `Material.SetBuffer(nameID, ComputeBuffer | GraphicsBuffer)` uses the *same* `PropertyToID`-compatible pattern as scalars; Unreal's `SHADER_PARAMETER_UAV` / `SHADER_PARAMETER_RDG_BUFFER_UAV` live in the *same* `BEGIN_SHADER_PARAMETER_STRUCT` family used for vertex/pixel/compute. ([Unity SetBuffer](https://docs.unity3d.com/ScriptReference/Material.SetBuffer.html), [Unreal compute shader example](https://github.com/AyoubKhammassi/CustomComputeShaders/blob/master/Source/CustomShadersDeclarations/Private/ComputeShaderDeclaration.cpp).)
- **sokol-gfx / wgpu** generalize at the substrate: `sg_apply_uniforms(slot, range)` is used identically inside compute passes; wgpu's `BindGroupLayout`/`BindGroup`/`set_bind_group` is identical for compute, storage being just a different `BufferBindingType`. ([sokol_gfx.h compute pass functions](https://raw.githubusercontent.com/floooh/sokol/master/sokol_gfx.h), [wgpu BindGroupLayoutEntry](https://docs.rs/wgpu/latest/wgpu/struct.BindGroupLayoutEntry.html).)

**Where it does NOT generalize — the counter-example to learn from:** **bgfx** keeps uniforms and storage buffers as **parallel, non-unified systems**. Uniforms go through `createUniform`/`setUniform` (scalars/vectors/matrices only); storage goes through `createDynamicVertexBuffer(… BGFX_BUFFER_COMPUTE_READ_WRITE)` + `setBuffer(slot, handle, Access)` — a completely separate call chain that never touches `UniformHandle`. ([nbody.cpp](https://github.com/bkaradzic/bgfx/blob/master/examples/24-nbody/nbody.cpp), [bgfx_compute.sh](https://github.com/bkaradzic/bgfx/blob/master/src/bgfx_compute.sh).) This is the shape to avoid if "one bridge for both" is the goal.

**The three patterns that let one bridge serve both:**

1. **Address space as a first-class field on the binding descriptor**, not implicit — `uniform` | `storage-read` | `storage-readwrite`. The `GPUBindGroupLayout` binding type and the WGSL address space differ, so the descriptor must carry the intent. (TypeGPU's discriminated key; Bevy's attribute arg.)
2. **Layout rules computed per address space.** A single alignment table (as `webgpu-utils`' `wgsl-types.ts` uses) silently produces **invalid** uniform buffers for array-containing structs — both `webgpu-utils` and TypeGPU *delegate* this gap (webgpu-utils to the parsed WGSL's pre-computed offsets, which *do* know the address space; TypeGPU to schema type markers). A furnace bridge that builds layout *independent* of WGSL source must explicitly track which address space it targets, and apply uniform's 16-byte array-stride floor only there.
3. **Staging-buffer readback is a transport concern, invisible to the schema.** Compute output read back to CPU needs the two-buffer pattern: `STORAGE | COPY_SRC` on GPU, a separate `MAP_READ | COPY_DST` staging buffer, `copy_buffer_to_buffer`, then `map_async`. ([wgpu readback example](https://docs.rs/wgpu/latest/wgpu/struct.Buffer.html); [compute readback walkthrough](https://tillcode.com/rust-wgpu-compute-minimal-example-buffer-readback-and-performance-tips/).) The schema still just describes field layout; the bridge owns the copy internally.

**Net for E:** designing the `@group(1)` vec4-param path *in isolation* risks a bgfx-style fork where storage later needs an ad-hoc parallel API. The patterns above show one descriptor *can* span both — at the cost of making address space explicit from day one. The user's stated priority (must scale to compute/storage) argues for at least *shaping* the binding descriptor to admit a storage discriminant now, even if storage support ships later. (Stated as a tradeoff, not a recommendation.)

---

## 7. Build-time vs runtime layout — keeping the reflection door open

**Verification verdict: NUANCED — the dominant production approach is build-time/schema-driven generation, NOT runtime reflection.** The factual core is confirmed; the nuances matter for furnace.

When the surveyed systems compute layout:

- **Build time (true ahead-of-time):** sokol-shdc (offline GLSL→SPIR-V→cross-compile→typed-header compiler — zero runtime functionality, all baked into the generated header); Rust proc-macros — Bevy `AsBindGroup`, `encase` `#[derive(ShaderType)]`, `crevice` `#[derive(AsStd140/AsStd430)]` (expand at `rustc` time; `encase`/`crevice` insert padding to WGSL/std140 rules with **zero runtime parsing**). ([sokol-shdc docs](https://github.com/floooh/sokol-tools/blob/master/docs/sokol-shdc.md), [encase docs](https://docs.rs/encase/latest/encase/), [crevice](https://lib.rs/crates/crevice-derive), [Bevy as_bind_group.rs](https://github.com/bevyengine/bevy/blob/main/crates/bevy_render/macros/src/as_bind_group.rs).)
- **Load time:** TypeGPU schemas (`d.struct` etc. construct layout objects at module load); Babylon `UniformBuffer` (layout frozen after `create()`); wgpu host-declared `BindGroupLayout` at device init.
- **Runtime (parse the shader):** `wgsl_reflect`/`webgpu-utils` (parse on `new WgslReflect`/`makeShaderDataDefinitions`); three.js WebGL (`gl.getActiveUniform` after link). **TypeGPU's WGSL *generation* is JS-runtime** (at pipeline creation via `tgpu.resolve()`), not a separate build step — but fully deterministic from the static TS schema. ([TypeGPU resolve](https://github.com/software-mansion/TypeGPU), [tgpu-gen](https://docs.swmansion.com/TypeGPU/tooling/tgpu-gen/).)

**Two nuances to foreground:**

- "Bevy does NOT use runtime reflection" needs qualifying: Bevy *does* run **naga-oil** at runtime as a WGSL preprocessor (`#import`/`#define` stitching) — but for *include resolution*, **not** layout discovery; bind-group slots come from the proc-macro. A community experimental project does true runtime reflection but it is a dev-time iteration tool, not core. ([This Week in Bevy 2024-08-26](https://thisweekinbevy.com/issue/2024-08-26-shader-reflection-inverse-kinematics-and-the-gmtk-jam).)
- TypeGPU is "schema-as-SSOT generates WGSL," which is accurate — but the generation is JS-runtime, not a Rust/C-style build step. The `tgpu-gen` CLI offers the offline/reverse direction.

**Crucially, every approach satisfies "must not preclude reflection later."** Derive macros, codegen, and schema-driven generation are all **additive over** a reflection layer — none closes it off. They all funnel into the same internal *name → offset* map; reflection just becomes one more way to *populate* that map.

**How furnace could keep the door open without building reflection now:**

- **Shape an internal `name → { offset, size, type, addressSpace }` map as the single chokepoint** that every write routes through, regardless of where the map came from. Today it can be populated from a consumer-declared schema (option A) or, for built-ins, by construction (the engine authored the shader and knows the layout — the backlog's stated exception). Tomorrow `wgsl_reflect` can populate the *same* map by parsing `slot.source`. The write API never changes.
- **The substrate already exists.** D-1's `Shader` slot **retains its WGSL source** ([`typed-uniform-setters.md`](../backlog/engine-architecture/typed-uniform-setters.md) confirms `slot.source` is available). The reflection option's input is already in hand — only the parser call is deferred. Where the param schema attaches (`shader.create` vs `material.create`) is an open sub-question the backlog flags; the layout is a property of the WGSL, so either is defensible.
- **Do not bake magic indices or std140 math into the public surface.** Both sokol-shdc and wgsl_to_wgpu exist specifically to eliminate that. If `@group(1)` writes route through the internal offset map (however populated) rather than consumer-hardcoded indices, the public API is reflection-agnostic from the start.

---

## 8. Implications for furnace — neutral option space

No recommendation, no decision. The tradeoffs the brainstorm should weigh, grounded in the verdicts above:

**On the engine-vs-user fork (§5.1):**
- *Keep the split (typed `@group(0)` setters + separate `@group(1)` mechanism).* Proven by every higher-tier engine but Babylon; matches furnace's existing `@group(0)`/`@group(1)` convention and its sokol/wgpu tier; Unity shows it can be a hard correctness constraint. Cost: two mechanisms to maintain.
- *Unify by-name across engine + consumer.* Possible (Babylon, bgfx-at-tier) but thinly precedented and requires the engine to own the entire bind cycle — a posture shift away from `mesh.setPosition`-style per-resource setters. Not precluded; just the road less traveled.

**On the by-name hot path (§5.2):**
- The interned-handle pattern (Unity `PropertyToID`, bgfx `createUniform`) dissolves the false "typed vs by-name" dichotomy: typed setters become handle-baked wrappers over the same path. Avoid Unreal's fragile per-instance index and Unity's SRP-incompatible `MaterialPropertyBlock`.

**On the layout source (§3):**
- *Consumer-declared schema (A)* — lowest lift, browser-perfect, SSOT-drift cost, doesn't preclude reflection.
- *Pure-JS runtime reflection (B)* — **available today, no wasm, no build step** (the backlog's blocker was false). Tradeoff is dependency posture (dep on `wgsl_reflect`/`webgpu-utils`, or vendor a build-time devDep for zero runtime deps, or write a subset parser). Hard gap: unsized arrays.
- *Build-time codegen (D)* — production-proven but pushes a build dependency onto core's consumers, in tension with core's "any TS bundler consumes plain ESM" contract and the foundational "only `@furnace/tools` ships binaries" rule.
- *TS-schema-as-SSOT (E, TypeGPU-style)* — cleanest long-term type safety, but inverts authoring (params in TS not WGSL), pre-1.0 dep risk, adds prod deps.

**On the scaling axis (§6):**
- If "one bridge for compute/storage" is a goal, make **address space a first-class field on the binding descriptor now**, even if storage ships later — this avoids a bgfx-style parallel API. Apply uniform's 16-byte array-stride floor only to the uniform address space; route tightly-packed small-type arrays to storage. Keep staging-buffer readback as an internal transport concern, out of the schema.

**On built-ins (the bounded reconciliation E inherits from D-1):**
- Built-ins are the *one* place a per-name `setColor`-style convenience is unambiguously fine, **because the engine authored the shader and owns the layout by construction** — no reflection or schema needed. This is independent of which fork the generic consumer path takes.

---

## 9. Sources

**WGSL / WebGPU specification & API**
- WGSL spec §14.4 memory layout — https://www.w3.org/TR/WGSL/#alignment-and-size ; §14.4.5 address-space constraints — https://www.w3.org/TR/WGSL/#address-space-layout-constraints ; §14.2 address spaces — https://www.w3.org/TR/WGSL/#address-spaces ; `@align`/`@size` — https://www.w3.org/TR/WGSL/#align-attr , https://www.w3.org/TR/WGSL/#size-attr ; `uniform_buffer_standard_layout` — https://www.w3.org/TR/WGSL/#language_extension-uniform_buffer_standard_layout
- W3C CRD-WGSL-20260519 — https://www.w3.org/TR/2026/CRD-WGSL-20260519/#alignment-and-size
- WebGPU spec — https://www.w3.org/TR/webgpu/ ; supported-limits — https://www.w3.org/TR/webgpu/#dom-supported-limits-maxuniformbufferbindingsize
- gpuweb editor's draft — GPUShaderModule https://gpuweb.github.io/gpuweb/#gpushadermodule ; GPUBindGroupLayout https://gpuweb.github.io/gpuweb/#gpubindgrouplayout
- gpuweb PR #1215 (layout section) — https://github.com/gpuweb/gpuweb/pull/1215 ; issue #2316 (reflection request, closed) — https://github.com/gpuweb/gpuweb/issues/2316
- MDN — GPUShaderModule https://developer.mozilla.org/en-US/docs/Web/API/GPUShaderModule ; GPUBindGroupLayout https://developer.mozilla.org/en-US/docs/Web/API/GPUBindGroupLayout ; getBindGroupLayout https://developer.mozilla.org/en-US/docs/Web/API/GPURenderPipeline/getBindGroupLayout ; getCompilationInfo https://developer.mozilla.org/en-US/docs/Web/API/GPUShaderModule/getCompilationInfo ; WGSLLanguageFeatures https://developer.mozilla.org/en-US/docs/Web/API/WGSLLanguageFeatures ; WebGL2 getActiveUniforms https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/getActiveUniforms
- Chrome 144 blog — https://developer.chrome.com/blog/new-in-webgpu-144

**Layout references & community**
- teoxoy layout gist — https://gist.github.com/teoxoy/936891c16c2a3d1c3c5e7204ac6cd76c
- sotrh learn-wgpu alignment — https://sotrh.github.io/learn-wgpu/showcase/alignment/ ; uniforms tutorial — https://sotrh.github.io/learn-wgpu/beginner/tutorial6-uniforms/
- webgpufundamentals — memory-layout https://webgpufundamentals.org/webgpu/lessons/webgpu-memory-layout.html ; from-webgl https://webgpufundamentals.org/webgpu/lessons/webgpu-from-webgl.html ; uniforms https://webgpufundamentals.org/webgpu/lessons/webgpu-uniforms.html ; storage-buffers https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-buffers.html ; bind-group-layouts https://webgpufundamentals.org/webgpu/lessons/webgpu-bind-group-layouts.html
- Tour of WGSL (matrices) — https://google.github.io/tour-of-wgsl/types/matrices/
- Slang #4985 (uniform stride error) — https://github.com/shader-slang/slang/issues/4985 ; naga #953 — https://github.com/gfx-rs/naga/issues/953 ; wgpu #8252 — https://github.com/gfx-rs/wgpu/issues/8252 ; wgpu #6696 (expose align constants) — https://github.com/gfx-rs/wgpu/issues/6696 ; wgpu discussion #2190 (layout:auto "misfeature") — https://github.com/gfx-rs/wgpu/discussions/2190

**Pure-JS WebGPU tooling**
- wgsl_reflect — https://github.com/brendan-duncan/wgsl_reflect , https://brendan-duncan.github.io/wgsl_reflect/ , https://registry.npmjs.org/wgsl_reflect/latest
- webgpu-utils — https://github.com/greggman/webgpu-utils , https://github.com/greggman/webgpu-utils/blob/main/src/data-definitions.ts , https://greggman.github.io/webgpu-utils/docs/ , https://registry.npmjs.org/webgpu-utils/latest , https://webgpufundamentals.org/webgpu/lessons/webgpu-utils.html
- TypeGPU — https://github.com/software-mansion/TypeGPU , https://github.com/software-mansion/TypeGPU/blob/main/packages/typegpu/src/tgpuBindGroupLayout.ts , https://docs.swmansion.com/TypeGPU/fundamentals/bind-groups/ , https://docs.swmansion.com/TypeGPU/tooling/tgpu-gen/ , https://docs.swmansion.com/TypeGPU/api/typegpu/interfaces/tgpucomputepipeline/ , https://registry.npmjs.org/typegpu/latest ; typed-binary — https://registry.npmjs.org/typed-binary/latest

**Native low-tier & Rust codegen**
- wgpu — https://docs.rs/wgpu/latest/wgpu/struct.BindGroupLayoutEntry.html , https://docs.rs/wgpu/latest/wgpu/struct.Buffer.html ; compute readback — https://tillcode.com/rust-wgpu-compute-minimal-example-buffer-readback-and-performance-tips/
- sokol-gfx — https://raw.githubusercontent.com/floooh/sokol/master/sokol_gfx.h ; WebGPU backend post — https://floooh.github.io/2023/10/16/sokol-webgpu.html ; storage buffers post — https://floooh.github.io/2024/05/06/sokol-storage-buffers.html
- sokol-shdc — https://github.com/floooh/sokol-tools/blob/master/docs/sokol-shdc.md , https://github.com/floooh/sokol-tools
- naga — https://docs.rs/naga/24.0.0/naga/ , https://docs.rs/naga/24.0.0/naga/proc/struct.Layouter.html
- wgsl_to_wgpu — https://github.com/ScanMountGoat/wgsl_to_wgpu ; wgsl_bindgen — https://docs.rs/wgsl_bindgen/latest/wgsl_bindgen/ , https://github.com/Swoorup/wgsl-bindgen
- encase — https://docs.rs/encase/latest/encase/ , https://crates.io/crates/encase ; crevice — https://github.com/LPGhatguy/crevice , https://lib.rs/crates/crevice-derive ; bytemuck — https://docs.rs/bytemuck/latest/bytemuck/ ; Bevy crevice→encase migration — https://github.com/bevyengine/bevy/issues/4272 ; Slang reflection (scope contrast) — https://shader-slang.org/slang/user-guide/reflection

**High-tier engines**
- three.js — RawShaderMaterial https://raw.githubusercontent.com/mrdoob/three.js/dev/src/materials/RawShaderMaterial.js ; WebGLProgram.js https://raw.githubusercontent.com/mrdoob/three.js/dev/src/renderers/webgl/WebGLProgram.js ; WebGLUniforms.js https://raw.githubusercontent.com/mrdoob/three.js/dev/src/renderers/webgl/WebGLUniforms.js ; WebGLMaterials.js https://raw.githubusercontent.com/mrdoob/three.js/dev/src/renderers/webgl/WebGLMaterials.js ; UniformsLib.js https://raw.githubusercontent.com/mrdoob/three.js/dev/src/renderers/shaders/UniformsLib.js ; UniformsGroup.js https://raw.githubusercontent.com/mrdoob/three.js/dev/src/renderers/common/UniformsGroup.js ; UniformNode.js https://raw.githubusercontent.com/mrdoob/three.js/dev/src/nodes/core/UniformNode.js ; UniformGroupNode.js https://raw.githubusercontent.com/mrdoob/three.js/dev/src/nodes/core/UniformGroupNode.js ; PR #28665 https://github.com/mrdoob/three.js/pull/28665 ; TSL field guide https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/
- Babylon.js — shaderMaterial.pure.ts https://raw.githubusercontent.com/BabylonJS/Babylon.js/master/packages/dev/core/src/Materials/shaderMaterial.pure.ts ; uniformBuffer.ts https://raw.githubusercontent.com/BabylonJS/Babylon.js/master/packages/dev/core/src/Materials/uniformBuffer.ts ; WebGPU WGSL doc https://github.com/BabylonJS/Documentation/blob/master/content/setup/support/webGPU/webGPUWGSL.md
- Bevy — as_bind_group.rs https://github.com/bevyengine/bevy/blob/main/crates/bevy_render/macros/src/as_bind_group.rs ; AsBindGroup docs https://docs.rs/bevy/latest/bevy/render/render_resource/trait.AsBindGroup.html ; Material trait https://docs.rs/bevy/latest/bevy/pbr/trait.Material.html ; material.rs https://github.com/bevyengine/bevy/blob/main/crates/bevy_pbr/src/material.rs ; mesh_view_bindings.wgsl + mesh_bindings.wgsl https://github.com/bevyengine/bevy/blob/main/crates/bevy_pbr/src/render/ ; ViewUniforms https://docs.rs/bevy/latest/bevy/render/view/struct.ViewUniforms.html ; MeshUniform https://docs.rs/bevy/latest/bevy/pbr/struct.MeshUniform.html ; ShaderType https://docs.rs/encase/latest/encase/trait.ShaderType.html ; ShaderStorageBuffer https://docs.rs/bevy/latest/bevy/render/storage/struct.ShaderStorageBuffer.html ; PR #14663 https://github.com/bevyengine/bevy/pull/14663 ; storage_buffer.rs + gpu_readback.rs + compute_shader_game_of_life.rs https://github.com/bevyengine/bevy/blob/main/examples/shader/ ; This Week in Bevy 2024-08-26 https://thisweekinbevy.com/issue/2024-08-26-shader-reflection-inverse-kinematics-and-the-gmtk-jam
- Unity — PropertyToID https://docs.unity3d.com/ScriptReference/Shader.PropertyToID.html ; SetFloat https://docs.unity3d.com/ScriptReference/Material.SetFloat.html ; SetBuffer https://docs.unity3d.com/ScriptReference/Material.SetBuffer.html ; MaterialPropertyBlock https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html ; SRP Batcher https://docs.unity3d.com/6000.3/Documentation/Manual/urp/shaders-in-universalrp-srp-batcher.html ; UnityInput.hlsl https://github.com/Unity-Technologies/Graphics/blob/master/Packages/com.unity.render-pipelines.universal/ShaderLibrary/UnityInput.hlsl ; ReSharper-Unity naming wiki https://github.com/JetBrains/resharper-unity/wiki/Avoid-using-string-based-names-for-setting-and-getting-properties-on-Animators,-Shaders-and-Materials
- Unreal — UMaterialInstanceDynamic https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UMaterialInstanceDynamic ; SetScalarParameterByIndex https://dev.epicgames.com/documentation/en-us/unreal-engine/BlueprintAPI/Rendering/Material/SetScalarParameterbyIndex ; FName https://dev.epicgames.com/documentation/en-us/unreal-engine/fname-in-unreal-engine ; Material Parameter Collections https://dev.epicgames.com/documentation/en-us/unreal-engine/using-material-parameter-collections-in-unreal-engine ; RDG / shader parameter structs https://dev.epicgames.com/documentation/unreal-engine/render-dependency-graph-in-unreal-engine ; FViewUniformShaderParameters https://docs.unrealengine.com/5.2/en-US/API/Runtime/Engine/FViewUniformShaderParameters/ ; compute shader example https://github.com/AyoubKhammassi/CustomComputeShaders/blob/master/Source/CustomShadersDeclarations/Private/ComputeShaderDeclaration.cpp
- Godot — ShaderMaterial https://docs.godotengine.org/en/stable/classes/class_shadermaterial.html ; spatial shader reference https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/spatial_shader.html ; compute shaders https://docs.godotengine.org/en/latest/tutorials/shaders/compute_shaders.html ; RDUniform https://docs.godotengine.org/en/stable/classes/class_rduniform.html ; GlobalShaderParameterType https://godot-rust.github.io/docs/gdext/master/godot/classes/rendering_server/struct.GlobalShaderParameterType.html
- bgfx — bgfx.h https://raw.githubusercontent.com/bkaradzic/bgfx/master/include/bgfx/bgfx.h ; API docs https://bkaradzic.github.io/bgfx/bgfx.html ; bgfx_shader.sh https://github.com/bkaradzic/bgfx/blob/master/src/bgfx_shader.sh ; bgfx_compute.sh https://github.com/bkaradzic/bgfx/blob/master/src/bgfx_compute.sh ; nbody.cpp https://github.com/bkaradzic/bgfx/blob/master/examples/24-nbody/nbody.cpp ; reflectiveshadowmap.cpp https://github.com/bkaradzic/bgfx/blob/master/examples/31-rsm/reflectiveshadowmap.cpp ; issue #1905 https://github.com/bkaradzic/bgfx/issues/1905

**Fed:** the uniform-layout-source decision behind `docs/reference/engine-conventions.md` §Binding contract — specifically the finding that pure-JS reflection is viable, which falsified the backlog's "needs a heavy wasm parser" premise. Cited from `docs/backlog/engine-architecture/shader-substrate-follow-ons.md` §E-C.
