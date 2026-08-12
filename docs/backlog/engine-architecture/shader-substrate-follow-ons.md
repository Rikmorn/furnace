---
summary: what the `Shader` substrate deliberately did not ship: WGSL→TS schema codegen with a staleness gate, `// @include` composition, a reload path, a refcount on the resource
---

# Shader substrate follow-ons

Tracker for the deferred halves of the `Shader` resource and its composition substrate
(Tranche D-1 landed `@furnace/core/shader`; Tranche E-B landed `@furnace/core/binding` and
the typed `Shader<L>` layout parameter). Each section is one previously standalone entry
with its Context, *Trigger to revisit* and *Reference* preserved.

They are merged because they are the four things that substrate deliberately did **not**
ship, all keyed to the same source of truth (WGSL text plus its declared layout): no
build-time schema derivation from the WGSL, no `// @include`-style composition step, no
reload path, and no refcount on the resource itself. `core-modules.md`'s `shader.load` row
cites the composition entry by name for the `// @include` deferral. Sections are ordered
build-time → authoring-time → dev-loop → lifetime.

## E-C — naga WGSL→TS schema codegen + build-time staleness gate

**Deferred 2026-05-31 with a trigger (user's call at E-B close).** Tranche E-B shipped the entire *runtime* JS↔WGSL bridge (`@furnace/core/binding`: `Binding<L>`, the WGSL layout calculator, `set`/`setUniform`, lazy-flush; `Shader<L>`/`Material<L>/Effect<L>`). E-C is the *tooling* layer that was always the third sub-tranche of E. Supersedes the codegen/reflection-future thread of the now-deleted `typed-uniform-setters.md` + `material-uniform-setters.md` (both resolved by E-A + E-B).

### Context — what E-B left open

E-B's `L` (the `@group(1)` schema, e.g. `{ stripes: "f32", hue: "f32", softness: "f32" }`) is **hand-written** by the consumer alongside the WGSL struct. It gives compile-time `L` **and** runtime-correct layout with **zero deps and zero parser** — but at a **dual-spelling cost**: the TS `L` and the WGSL `struct` can silently drift (rename a field in the `.wgsl`, forget the schema, and the binding writes to the wrong offset with no error). E-B accepted this; the layout calculator at least guarantees the *bytes* are WGSL-correct *for the schema as written* — it cannot know the schema disagrees with the shader.

### What E-C is

A **build-time** generator + gate in `@furnace/tools` (the harness — consistent with furnace = library + harness; keeps `@furnace/core` zero-runtime-dep):
- **Codegen:** parse the WGSL with **naga** (Rust; naga parses but has **no TS backend** — the TS emitter is ours to write) and emit the `L` schema (or assert it) from the `@group(1)` struct. Kills dual-spelling: the WGSL becomes the single source of truth.
- **Staleness gate:** a build-time check that fails if a hand-written `L` disagrees with its shader's actual `@group(1)` layout. Turns `L` from a *hopeful annotation* into a *verified contract*.

Rejected alternatives (decided in the E brainstorm, see overarching design): TypeGPU (authors shaders in TS — furnace keeps WGSL as source); vendoring a pure-JS reflector into `@furnace/core` as a runtime dep (`wgsl_reflect`/`webgpu-utils` are viable MIT zero-runtime-dep options, but that's a *core posture* change, not the harness-tooling path E chose).

### Trigger to revisit

Either of:
- **Dual-spelling drift actually bites** — a real bug where `L` and the WGSL `@group(1)` struct disagree and a binding writes wrong offsets (the failure E-C prevents), **or**
- **First consumer asks for generated types** / explicitly wants the WGSL to be the SSOT for `L`.

Until then, hand-written `L` + the runtime calculator is sufficient (E-B shipped the whole runtime bridge regardless).

### Why deferred, not done

Low immediate appetite at E-B close; it's a Rust/tooling build in a different package (`crates/` in `@furnace/tools`) — a context-switch from the `@furnace/core` bridge work, and the bridge ships fully without it. The overarching E design explicitly recommended backlog-with-trigger here.

### Reference

- Overarching E design: E5 = the codegen decision; E4 = reflection-deferred-not-precluded; "the chokepoint" = `slot.layout.fields` is the additive seam all populators feed.
- Research (committed): `docs/research/uniform-params-prior-art.md` §3 (layout-source options matrix), §3.1 (pure-JS reflection is viable — the backlog's "needs heavy wasm parser" was FALSE), §7 (keeping the reflection door open).
- `@furnace/tools` architecture: `docs/reference/packaging-and-distribution.md`.

## Shader composition — deferred follow-ons

**The composition spine LANDED as Visual Fidelity Stage 2.5 (2026-06-07):** `ShaderSource`
(`shader.source` tagged + call forms) → `toWgsl()` (DFS, dedup by object identity) →
`shader.create` accepts `ShaderSource | string`. Composition is pure in-memory JS string
work — NOT runtime URL fetch. The earlier framing in this file (a runtime
`new URL(spec, includingUrl)` `// @include` resolver) was **retired**: it is verified-broken
under Bun's `file` loader (build-time content-hash + flatten severs sibling paths, and
include-only `.wgsl` files are never emitted).

The `toWgsl`/dedup core operates on the `ShaderSource` DAG independent of how the DAG was
built, so the items below slot in without reshaping it.

**Deferred follow-ons (each with its own trigger):**

1. **Runtime live-editor resolver** — `// @include "name"` string syntax resolved against a
   `name → ShaderSource` registry, building a DAG from live-edited text + the registry and
   reusing the dedup core. Live-typed text has no JS import graph, so this is a distinct
   consumer from the authoring path. *Trigger:* shader-editor work begins.

2. **Build-time validation tool / CLI** — `toWgsl()` + a WGSL compile-check (naga-wasm, or a
   `*.gpu.test.ts` using bun-webgpu's validation error scope — available today) so broken
   composition fails the build, not the frame. Composition is already prod-safe (JS imports
   are bundler-inlined; `toWgsl` is in-memory concat, no runtime file I/O) — this item is about
   *validation*, not avoiding I/O. *Trigger:* prod-hardening / unvalidated-composition pain.

3. **`ShaderSource.load(url)`** — lazy runtime fetch of a fragment; a dev/editor convenience
   that must not leak into prod (the prod-safe path is static import + bundler inline). A
   future lint/CLI could flag `.load` in prod builds. *Trigger:* a concrete runtime-fetched-
   composition need.

**Not planned:** node-graph / typed-IO shader editor (Unreal Material Function / Unity Sub
Graph) — a higher layer that *generates* `ShaderSource`; out of the Visual Fidelity epic.

**Reference:** Stage 2.5 spec (above); `docs/research/shader-resource-prior-art.md`.

## Hot reload of shaders

**Unblocked by Tranche D-1, landed 2026-05-31.** The `Shader` resource substrate is now in place: `shader.load(ctx, url)` is the load path, `Shader` handles are poolable uint48 handles, and the engine retains the WGSL `source` on the `ShaderSlot` (hot-reload-ready). Building HMR itself stays here as a later dev-tooling tranche. Trigger (below) has NOT fired.

In dev mode, when a `.wgsl` file changes on disk, the engine recompiles the shader and swaps pipelines without restarting the app. Wires into Bun's HMR (`bun --hot serve.ts`) — Bun already notifies on file changes; the engine listens and propagates.

Implementation sketch: shaders loaded via `shader.load(ctx, url)` are tracked in a dev-mode registry (url → handle); on HMR file change, the engine re-fetches the source, calls `shader.create` with the new code to get a new handle, and for every material referencing the old handle re-builds the pipeline via `material.create` with the new `Shader`. State held in the running app (camera position, mesh transforms, animation progress) is preserved. The retained `ShaderSlot.source` string supports a revert-to-last-good path if the new WGSL fails to compile.

Open design questions: how to handle shaders with compile errors after edit (revert to last-good? show error overlay?); how to handle pipeline-layout changes (uniform/binding mismatches force a re-create with potential data loss); whether this is dev-only (build flag) or always-on with a small cost; whether bind groups need rebuilding too.

Should be off in production (no `import.meta.hot` access, no dev-server listeners).

**Trigger to revisit:** When shader iteration becomes a friction point — typically when working on a real post-process pipeline or experimenting with shader effects where the round-trip "edit, save, refresh, re-set-up scene" is noticeable.

**Reference:** Core architecture design § "Deferred decisions".

## Shader resource — revisit the no-refcount decision

**Filed 2026-05-30 (D-1 brainstorm).** D-1 ships the `Shader` resource with **no reference count** (unlike `Geometry`/`Material`, which Mesh refcounts). This entry records *why*, and the exact conditions that would flip the decision — so the assumption is falsifiable, not silent.

### The decision and its basis

`Shader` carries no refcount because **nothing depends on its `GPUShaderModule` after `material.create`**:

- A WebGPU pipeline **captures the compiled module at creation time** — once `material.create` builds the pipeline, the `Shader`'s module is irrelevant to rendering (the pipeline in the GPU process is self-contained).
- `GPUShaderModule` has **no `.destroy()`** (unlike `GPUBuffer`/`GPUTexture`) — it is GC-reclaimed when unreferenced. There is no GPU-timeline free to schedule or defer.

`Geometry`/`Material` are refcounted because their GPU resources (vertex buffer, pipeline) are read **every frame** — destroying them mid-render breaks drawing. A `Shader` has a **create-time-only** dependency, so the refcount rationale does not transfer. Consumer-owned shaders get an idempotent immediate `destroy`; built-in shaders are engine-owned (shared per-ctx, freed by the dispose cascade). See `docs/research/shader-resource-prior-art.md` §Q1 (the GC + pipeline-capture observation; sokol is also non-refcounted).

### Trigger to revisit

Revisit (add an `Arc`-style refcount, à la wgpu/bevy) **only if** furnace adds any of:

1. **Lazy / deferred pipeline creation** — if `material.create` stops building the pipeline eagerly and defers it (e.g. to first-draw or async pipeline creation), the Material would need its `Shader` alive until the pipeline is built.
2. **Pipeline rebuild-from-shader** — shader *specialization* (pipeline variants, à la bevy `shader_defs`) or WGSL `override` constants baked into the pipeline, where changing a value re-derives the pipeline from the shader source. **Note: the params/uniform session (E) does NOT trigger this** — E writes uniform *values* into bind-group buffers, which never rebuild a pipeline.
3. **Always-on (production) hot-reload** — dev-only hot-reload uses its own dev registry (see the *Hot reload of shaders* section); a production rebuild-on-change path would need a `Shader → Materials` reverse map and the shader kept alive.

None of these are in furnace's current or planned design as of 2026-05-30.

**Reference:** D-1 brainstorm 2026-05-30; `docs/research/shader-resource-prior-art.md` §Q1. Cross-refs the *Hot reload of shaders* section.
