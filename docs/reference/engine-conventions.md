# Engine conventions

This document captures the engine-wide conventions that every module of `@furnace/core` follows. These are committed; deviation requires a deliberate breaking-change decision.

For the *API surface* (module-by-module list of public exports, signatures, and which cookbook demos exercise them), see `core-modules.md`.

## Coordinate system

Right-handed, Y-up world space. WebGPU NDC: +X right, +Y up, Z ∈ [0, 1].
Rotation: counter-clockwise when viewed from the positive axis (standard right-handed).
Matrix layout: column-major (matches WebGPU uniform expectations).

## Color space

Surface format: sRGB by default (`bgra8unorm-srgb` or `rgba8unorm-srgb`). Shaders write linear color values; the GPU applies sRGB encoding on output.

Texture color-space convention: `textures.load(ctx, url, { colorSpace: "srgb" | "linear" })`. Albedo/diffuse images are sRGB (default). Data textures (normal maps, masks, depth) are linear.

Override the surface format via `gpu.requestContext(canvas, { surfaceFormat: "linear" })` for HDR or custom pipelines.

**Test/prod color-space gap.** GPU tests run under `bun-webgpu` use `surfaceFormat: "linear"` because the mock drops `viewFormats` from canvas context configuration — production's default sRGB format would fail mock validation. sRGB-specific code paths are exercised only by manual Safari / Chrome runs of hello-world and the cookbook. See `packages/core/tests/_helpers/gpu-fixture.ts`.

## MSAA

MSAA is ctx-level and pass-coupled. `gpu.requestContext(canvas, { sampleCount: 1 | 4 })` (default `1`). Core WebGPU only supports these two values; any other value throws `FurnaceGpuError` at request time.

- **Engine-owned targets.** When `sampleCount: 4`, `frame.render` allocates (lazily, reallocated on resize) a multisampled scene-color texture (format = working color format, see §HDR below) and a multisampled depth texture, both matching the canvas backing-store size. The scene renders into the multisampled color target; the pass resolves it into the single-sample destination (swap-chain texture, or post intermediate when effects are present) with `storeOp: "discard"` — tile-memory-friendly on mobile/tiled GPUs.
- **Pipeline coupling.** `sampleCount` is part of the material pipeline-cache key (alongside the working color format). A pipeline built for `sampleCount: 4` can only draw in a 4× multisampled pass; passing it to a single-sample pass (e.g. `frame.renderToTexture`) produces a GPU validation error. `frame.renderToTexture` rejects MSAA contexts setup-loud (throws `FurnaceGpuError`) for this reason — use a `sampleCount: 1` context for off-screen render targets.
- **Depth.** The engine-owned depth texture is also multisampled to match `sampleCount`, using `storeOp: "discard"` in tandem with the color resolve.

## HDR intermediate (working color format)

`gpu.requestContext(canvas, { hdr: true })` (default `false`) selects an `rgba16float` *working color format*. When `hdr: false`, the working color format equals the swap-chain surface format (the LDR path — e.g. `bgra8unorm-srgb`).

The working color format is the format of:
- The engine-owned multisampled scene-color target (MSAA path).
- The scene-color target and every mid-chain intermediate acquired from the per-ctx transient target pool (`post/pool.ts`).
- Every material pipeline's fragment target (keyed alongside `sampleCount` in the cache).
- Consumer-supplied color targets for `frame.renderToTexture` — the target's format must equal the working color format (not the swap-chain format); a mismatch throws `FurnaceGpuError`.

**Tonemap is an effect, not a mandatory stage.** `post.tonemap()` is an ordinary consumer-replaceable effect (see `@furnace/core/post`). The engine does **not** auto-inject it. However, **HDR-on with an empty effect chain is setup-loud**: `frame.render` throws `FurnaceGpuError` when `hdr: true` and no effects are supplied — an `rgba16float` scene target with no effect to reach the LDR swap chain produces incorrect output that would be silent otherwise.

**Color-space interaction.** `post.tonemap` writes **linear** LDR values (no manual `pow(1/2.2)`). When the swap-chain surface format is an `*-srgb` variant (the default `surfaceFormat: "srgb"`), the hardware applies the sRGB OETF automatically on present — this is the same rule as the §Color space section: shaders write linear, the swap-chain encodes.

## Single-encoder / single-submit

`frame.render` records the scene pass and all effect passes into **one `GPUCommandEncoder`** and submits once via `ctx.queue.submit([encoder.finish()])`. All GPU work for a frame — scene draw + post chain — is batched into a single command buffer. `frame.renderToTexture` similarly uses one encoder + one submit for its single off-screen pass.

## Post-chain model

The post chain is a flat list of `PassSlot`s assembled by the chain evaluator (`post/evaluate.ts: _evaluateChain`). Every effect in `RenderOptions.effects` contributes one or more slots (a single-pass `post.create` effect contributes one; a `post.createPasses` chain contributes N; `post.bloom` contributes 1 prefilter + (mips−1) downsamples + (mips−1) upsamples + 1 composite). The evaluator flattens all effects into one linear sequence and records them into the **same** command encoder as the scene pass.

**Transient target pool.** Mid-chain passes render into pool-backed textures (`post/pool.ts`). The pool is keyed by `(width, height, format)` and reuses targets across acquire/release cycles within a frame — a bloom chain with 12 sub-passes doesn't reallocate every frame. The pool frees all live and free textures on `gpu.dispose(ctx)`. **Resize is handled by a frame-boundary trim:** `frame.render` calls `_poolBeginFrame(ctx, canvasW, canvasH)` before acquiring the chain's targets; when the canvas size changes, every free target is stale (all chain sizes derive from the canvas), so the whole free list is destroyed there. Without this trim the differently-keyed old-size targets would never be matched again and would accumulate in the free list until `gpu.dispose` (a per-unique-size leak).

**Pass input semantics:**
- `"scene"` — the **global** original scene-color target (acquired from the pool in the working color format, same as the scene-pass output). Preserved read-only for the *whole* chain — it does NOT advance as effects run, so it is always the original scene, never an upstream effect's output.
- `"prev"` — the output of the immediately preceding pass. For the first pass in the chain, `"prev"` resolves to the scene target (same as `"scene"`).
- `{ intermediate: name }` — a named target produced by a strictly earlier pass's `output.intermediate`. Forward references throw at `createPasses` time (setup-loud).

**Composition gotcha.** An effect that should *transform the running chain image* (a blur, color grade, vignette) must read **`"prev"`** as its first input — reading `"scene"` re-reads the original and silently discards whatever ran upstream. An effect that *composites onto its own input* (`post.bloom` = `input + glow`) reads `"scene"` for its composite base (within a multi-pass effect `"prev"` rolls forward through the effect's own passes, so it can't reference the effect's input by the composite pass). Consequence: such an effect only behaves correctly as the **first** scene-reading effect — placing an effect *before* bloom is currently ignored by bloom. See `docs/backlog/engine-architecture/post-chain-effect-input-composability.md` (the per-effect-input fix).

**Final pass.** The last pass in the flattened sequence always writes to the swap-chain texture (`ctx.format`, full canvas size), regardless of the pass's `output.scale` / `output.format`. All preceding passes write to pool-backed targets, which are released back to the free list at the end of the chain.

**Two-layer ownership:**
- **Pool** owns the transient scratch targets (reused across frames; freed on resize collision + `gpu.dispose`).
- **Effect** owns its per-instance `@group(1)` bindings created by built-in factories (`post.tonemap`, `post.bloom`). These are registered via `_setOwnedBindings` and freed by `post.destroy`.
- **Ctx** owns the shared per-ctx shaders for built-in effects (tonemap, bloom). They are freed by the dispose cascade at `gpu.dispose(ctx)`, not by `post.destroy`.

Consumer-supplied `binding`/`bindings` (passed to `post.create` or via `PassDescriptor`) are consumer-owned: `post.destroy` never touches them.

## Device pixel ratio

Default behavior: render at native device resolution (sharp on high-DPI displays). Canvas backing-store size set to `clientWidth * devicePixelRatio × clientHeight * devicePixelRatio`.

Override via `gpu.requestContext(canvas, { pixelRatio: "device" | "css" | number })`.

`gpu.onResize` fires with `{ cssWidth, cssHeight, width, height, pixelRatio }`. The engine's "size truth" for cameras and viewports is the backing-store dimensions.

## Time

One render loop + a separable fixed-step clock:
- `frame.loop(ctx, fn)` — the variable-timestep RAF wrapper (the single render loop). Caps `deltaMs` to a configurable maximum (default 100 ms) to prevent jumps after sleep/visibility changes; auto-pauses when the document becomes hidden (Page Visibility API, configurable via `{ pauseOnHidden: false }`); returns a `FrameLoopHandle` with `{ stop, pause, resume }`.
- `frame.fixedClock({ fixedDtMs, maxCatchupTicks? })` — a "Fix Your Timestep" accumulator, decoupled from loop ownership. `clock.advance(deltaMs, onTick) → alpha` runs `onTick(dtSeconds)` zero-or-more times (catch-up capped by `maxCatchupTicks`, default 8, with a spiral-of-death guard) and returns the interpolation `alpha ∈ [0,1)`. `fixedDtMs` is runtime-settable via `setFixedDtMs`. Use for simulation/physics/networking/replay — anywhere determinism matters.

A fixed-step game is `frame.loop` + `frame.fixedClock`, composed — the same composition whether a consumer owns the loop directly or a shell owns it and dispatches a per-scene frame callback. See `fixed-step-interpolation.md`.

### Time scaling (slow-mo / pause / single-step)

Time dilation needs no engine surface — scale the `deltaMs` fed to `frame.fixedClock.advance`:
- **slow-mo / fast-forward:** `clock.advance(info.deltaMs * timeScale, onTick)` (`timeScale < 1` slows, `> 1` speeds). Render keeps running every frame; only the simulation rate changes. `alpha` interpolation stays correct (it is derived from the sim clock, not real time).
- **pause:** `timeScale = 0` → `advance(0, …)` runs zero ticks; render still draws the frozen, interpolated pose.
- **single-step:** `clock.advance(clock.fixedDtMs, onTick)` runs exactly one tick. The accumulator is always `< fixedDtMs` after any `advance` (it holds only the sub-tick remainder), so feeding exactly one step advances the sim by precisely one tick — clean step-debug with no `tick()`/`setTimeScale` method.

Input handlers and `frame.loop` are unaffected; only the fixed-step sim clock scales. See the bowling demo's debug controls for a worked example.

## Resource manager

`@furnace/core` centralises GPU-backed consumer-resource lifecycles in a per-context resource manager. Every consumer-facing resource — `Mesh`, `Material`, `Geometry`, `Effect` — is allocated through the manager, tracked in a typed pool, and freed via a synchronous teardown that runs atomically with the slot's destroy.

### Handle representation

A handle is a branded `uint48` — a plain JS `number` within the IEEE 754 safe-integer range:

- bits  0–15: slot index (0..65535; slot 0 reserved as the invalid sentinel)
- bits 16–31: generation counter (bumped on each alloc and destroy)
- bits 32–47: context id (assigned per Context at construction; 0 reserved)

JS bitwise ops truncate to int32, which cleanly drops the ctxId in the upper bits — so `decodeSlotIndex` and `decodeGeneration` stay as simple bitwise decoders. `decodeCtxId` uses arithmetic (`Math.floor(handle / 0x100000000)`) because bitwise can't reach the upper bits.

The brand is type-level only — at runtime, all handles are plain numbers. Brands prevent passing a `MeshHandle` where a `MaterialHandle` is expected; the ctxId catches the harder case of passing one context's handle to another context's lookup (which would otherwise silently resolve to a wrong-but-live slot in the recipient pool — handle collisions across contexts are otherwise frequent at startup when both pools begin at slot 1 generation 1).

Public API (example):

```ts
const cube: MeshHandle = mesh.create(ctx, { geometry, material });
mesh.setPosition(ctx, cube, vec3.fromValues(1, 0, 0));
mesh.destroy(ctx, cube);
```

Consumers treat handles as opaque — no field access, no deref. All state mutation goes through the typed accessor functions (`mesh.setPosition`, `mesh.getPosition`, `material.destroy`, etc.).

### Pool model

One pool per resource kind. Backing arrays plus a `Uint32Array` of generation counters plus a LIFO free stack. Pools auto-grow on allocation when the free stack is empty; pools never shrink (high-water-mark capacity stays for the context's lifetime). Initial capacity is 64 slots per pool. **Hard ceiling: pools cannot grow beyond 65536 slots — the uint48 handle encoding reserves 16 bits for the slot index. Hitting the ceiling throws `FurnaceError` at allocation time, not silently corrupting handles.**

### Lookup, ctxId guard, and use-after-destroy

Every operation against a handle does a lookup. The lookup compares the handle's encoded ctxId to the context's ctxId; on mismatch (cross-context misuse), returns null. Then bounds check + generation match against the pool; on mismatch (stale handle, recycled slot, destroyed handle, invalid input), also returns null.

The call-site contract decides the response to null:

- **Cold-path setters** (`mesh.setPosition`, `module.destroy`): silent no-op. Idempotent.
- **Warm-path render** (`frame.render`): throws `FurnaceGpuError` with `draw[i]:` / `effects[i]:` prefix. The single error covers stale, destroyed, cross-context, and never-existed — the handle-pool generation counter does not distinguish those at runtime.

### Idempotent destroy

`module.destroy(ctx, handle)` is silent + idempotent on a stale or destroyed handle (lookup returns null → early return without effect). This matches the WebGPU spec (`GPUBuffer.destroy()` is valid to call multiple times), C#'s `IDisposable`, Java `Closeable`, PixiJS, and TC39 `Symbol.dispose`. All four resource modules (`mesh`, `material`, `geometry.destroy`, `post`) follow this contract.

### Internal refcount for sharing

`Geometry` and `Material` slots carry an internal `userCount` field. `mesh.create({ geometry, material })` validates BOTH lookups, then increments both counts. `mesh.destroy` decrements both, and if either dependency was marked-destroyed (`geometry.destroy` / `material.destroy` called while a mesh still referenced it) and the refcount hits zero, that dependency's actual GPU teardown runs as part of `mesh.destroy`.

Order-matters footgun is eliminated. Consumers can destroy in any order; the refcount enforces correctness.

The refcount is engine-private. Consumers cannot inspect it; the engine cannot expose it as public API without leaking the manager's internal shape.

### Auto-cleanup on dispose

`gpu.dispose(ctx)` walks every pool in fixed order (meshes → effects → materials → geometries) and runs each live slot's teardown. After the cascade, a single informational warn summarises the cleanup: `"auto-cleaned N live handles on dispose; explicit destroy is an optimization, not a requirement"` — where N is the count of slots the cascade directly freed. Refcount-cascaded slots (slots freed implicitly when a mesh teardown decrements a marked-destroyed geometry/material to zero) are correctly **excluded** from N: they reflect user-requested destroys (`material.destroy(ctx, m)` was called; the actual GPU free was just deferred until the last referencing mesh went away), not engine-rescued leaks. The warn counts what the cascade had to clean up because the user didn't.

Consumer discipline becomes an *optimization* (free early to reduce in-context memory pressure), not a *requirement*.

The leak-warn (`sum(stats.resources.counts.*) > 0` → "context disposed with live resource-manager slots — leak suspected") is preserved alongside the cascade warn. (`stats.resources.counts.*` is the engine-internal registry; consumers read the same data via `stats.snapshot(ctx).resources.*`.) With all pool kinds tracked and the cascade firing each slot's stats decrement, the leak-warn's count is typically zero. It remains as a safety net for any future non-pooled resource kind.

### Dispose order

`gpu.dispose(ctx)` runs two cascades in fixed order:

1. **`_runDisposeCascade(ctx)` (engine-private cleanup)** — runs first. Tears down engine-private resources that are stats-tracked but NOT pool-tracked: depth texture, per-camera uniform buffers, post intermediates. Each calls `_recordDestroy` directly because it doesn't flow through a pool slot.

2. **`disposeAllResources(ctx)` (pool cascade)** — runs second. Walks every live slot in every pool in the cascade order (meshes → effects → materials → geometries → shaders → bindings) and runs each slot's `_teardown`. The manager's destroy path fires the single `_recordDestroy` call for each pool-tracked slot.

The ordering is load-bearing. Engine-private decrements run first; pool-cascade decrements follow. Together they bring stats's `resources.counts.*` back to zero in well-behaved teardown.

After both cascades complete, `gpu.dispose` reads `stats.resources.counts.{meshes|materials|geometries|effects|shaders|bindings}` and warns if the sum is non-zero. In well-behaved teardown this is always zero (both cascades ran cleanly). The check remains as a safety net for any future non-pooled resource kind whose stats decrements weren't fired during either cascade.

### Cross-cutting introspection

`@furnace/core/resources` exposes:

- `disposeAll(ctx) → void` — explicit cascade trigger; identical to what `gpu.dispose(ctx)` does internally. Use when freeing handles ahead of a context transition without dropping the `GPUDevice`.

Branded handle types (`MeshHandle`, `MaterialHandle`, `GeometryHandle`, `EffectHandle`, `ShaderHandle`, `BindingHandle`, `AnyResourceHandle`) and the `ResourceKind` discriminator are re-exported from this module for type-level use.

For per-kind live counts and memory totals, see `stats.snapshot(ctx).resources.*` and `stats.snapshot(ctx).memory.*`. RM-4 deleted the prior `resources.summary`, `resources.list`, and `resources.snapshot` exports because no consumer used them; restoration is tracked in `docs/backlog/engine-architecture/resources-introspection-restore.md` for any future external consumer trigger.

### Stats relationship

The resource manager is the **single writer of slot-kind counts** (`mesh`, `material`, `geometry`, `effect`, `shader`, `binding`). Its alloc and destroy wrappers fire `_recordAlloc(ctx, kind, 0)` and `_recordDestroy(ctx, kind, 0)`; no other code path increments those counts.

**Memory totals** (`buffer`, `texture` bytes) are written directly by whichever site owns the GPU resource — slot-owned buffer/texture bytes by the resource module that creates them (`mesh.ts` object uniforms, `geometry.ts` vertex/index buffers, `binding/binding.ts` uniform buffer — the colour buffer behind an unlit material is binding-owned; teardown paths decrement the matching bytes: `material.ts` via `ownedBufferBytes`, `binding/binding.ts` via `_teardown`), ctx-owned bytes by the engine-internal site that creates them (`frame/render.ts` depth texture + camera uniforms, `post/pool.ts` transient chain targets). Bytes flow through the same `_recordAlloc` / `_recordDestroy` API.

A `Binding` slot owns one `GPUBuffer`; its byte size is recorded at `createBuffer` time via `_recordAlloc(ctx, "buffer", byteSize)` and decremented in `_teardown` via `_recordDestroy(ctx, "buffer", byteSize)`. The slot count itself is tracked separately as `_recordAlloc(ctx, "binding", 0)` (single-writer rule). Consumers read both via `stats.snapshot(ctx).resources.bindings` (slot count) and `stats.snapshot(ctx).memory.bufferBytes` (byte total).

Stats's snapshot reads these two registries — counts and memory — and surfaces them at `stats.snapshot(ctx).resources.*` and `stats.snapshot(ctx).memory.*`.

**The principle:** internal-to-core consumers use sync direct calls. Events are reserved for external-consumer subscription channels with a real consumer trigger. RM-4 considered an events-based decoupling between the manager and stats and rejected it as speculative scaffolding — both modules ship in the same package, both evolve together, and no external consumer of resource lifecycle events exists. See `docs/backlog/engine-architecture/resource-lifecycle-events-external-consumer.md` for the trigger that would re-open the question.

### Failure-policy alignment

The manager's contract slots into the four-stance taxonomy of §Failure policy:

- Allocation (`mesh.create`, `material.create`, etc.) — cold-path; throws on bad input or unavailable handle.
- Destroy (`mesh.destroy`, etc.) — cold-path; silent + idempotent on stale/destroyed handle. Override of cold-path default because the bug class is benign and the industry default is silent.
- Setters / getters (`mesh.setPosition`, etc.) — hot-path; silent on stale/destroyed handle.
- Refcount-mutating setters (`mesh.setMaterial`) — cold-path-validate; throws on null or stale new-resource handle, silent no-op on stale owner handle. Asymmetric with the pose setters above because refcount-mutation needs validation that pose-mutation doesn't — bad refcount state is harder to recover from than a non-finite position. See `mesh.setMaterial` TSDoc for the precise contract.
- Render-time validation (`frame.render` `validateDraw` / `validateEffects`) — warm-path; throws with positional context.
- Diagnostics (cascade summary warn, leak-warn fallback, generation-overflow debug warn) — observability stance.

### Why this shape

See `docs/research/destroy-ownership-prior-art.md` and `docs/research/resource-manager-prior-art.md` for the prior-art research that drove the choice. Short version: the Sokol pool + generation counter pattern is unusually well-suited to JS-on-WebGPU because (a) WebGPU's spec already handles mid-frame destroy safely, (b) the JS layer provides cheap `Uint32Array`-backed counters, and (c) the alternative refcount-handle pattern (wgpu-style `Arc`) has no JS equivalent. The ctxId extension to uint48 was a Session 1 discovery — uint32 alone collides across multiple `Context`s on a single page.

## Disposal

Superseded by §Resource manager (2026-05-28). `gpu.dispose(ctx)` cascades through the resource manager; explicit `module.destroy(ctx, handle)` is an optimization rather than a requirement. The idempotent-on-second-dispose contract on `gpu.dispose` itself is unchanged.

## Cameras

`@furnace/core/camera` provides perspective and orthographic projection helpers. Cameras are pure data with cached matrices — no GPU resources owned.

- Pose is expressed via `position` / `target` / `up` (lookAt-style). Quaternion-driven cameras are not provided.
- Setters mutate in place and flip internal dirty bits. `getMatrices(cam)` recomputes only dirty matrices and returns the same frozen wrapper across calls (the inner `Float32Array` references are stable; the engine writes into them in place).
- Projection-shape updates are split by kind. Perspective cameras carry an aspect ratio updated via `camera.setAspect`; orthographic cameras carry a `fitPolicy` updated via `camera.setFitPolicy` (see §Camera resize policy below). Both kinds are accepted by `camera.bindToCanvas(ctx, cam)`, the one-line helper that subscribes to `gpu.onResize` and runs `updateForSize` on every event. The returned function unsubscribes — call it for early/manual unsubscribe; `gpu.dispose` auto-disconnects the binding per-context. The manual pattern (`gpu.onResize` + `camera.updateForSize`) remains available for consumers needing finer control (multi-camera coordination, custom dispatch, conditional updates).
- The camera's uniform buffer is engine-managed inside `frame.render` (allocated lazily, written each frame from `getMatrices`). The Camera handle itself remains data-only — no GPU resources owned.

### Camera resize policy

Orthographic cameras opt into engine-managed bounds via a `fitPolicy` field.
The policy determines how bounds respond to canvas resize; the consumer wires
it via `camera.bindToCanvas(ctx, cam)`, which subscribes to `gpu.onResize`
and runs the policy on every resize event.

**Variants (first wave):**

- `stretch` — bounds preserved literally on resize; the rendered scene
  distorts when canvas aspect changes. Use when you have explicit literal
  bounds and want them held even as the canvas changes (e.g. UI overlay,
  shadow mapping, mini-maps).
- `preserve-height` — vertical world extent fixed at `height`; horizontal
  extent recomputed from canvas aspect on resize. The 2D-game default.
- `preserve-width` — mirror of preserve-height. Useful for vertically
  scrolling content where horizontal extent is the primary axis.

**Anchor.** `preserve-height` and `preserve-width` carry an `anchor: { x, y }`
with components in `[0, 1]`. `(0.5, 0.5)` (default) centers the world origin
in the visible rect; `(0, 0)` puts the world origin at the bottom-left
corner of the visible rect; `(1, 1)` puts it at the top-right. Y-up. The
`stretch` variant doesn't carry an anchor because bounds are literal.

**Scale.** `camera.scale` (default 1) is a uniform zoom multiplier
independent of the policy. `setScale(cam, n)` re-derives bounds immediately.
For consumers wanting a zoom slider, this is the canonical mutator.

**`setAspect` is perspective-only.** Orthographic cameras must use
`setFitPolicy` for bounds management. Calling `setAspect` on an orthographic
camera throws.

**DPR.** `updateForSize` operates on the canvas's backing-store dimensions
(`canvas.width` / `canvas.height` — CSS-pixel-size × DPR per the HTML canvas
spec). Aspect derives from these; aspect is invariant under DPR.

See `core-modules.md` (`camera` module) for the function/type table.

## Drawables

`@furnace/core/geometry`, `@furnace/core/mesh`, and `@furnace/core/material` define the engine's drawable model: a Mesh is a Geometry + a Material + a Transform.

- **Geometry** (raw GPU resource): vertex buffer + optional index buffer + fixed vertex layout. Created via `geometry.create(ctx, { positions, normals, uvs, indices? })` for custom data, or via built-in factories `geometry.cube` / `geometry.plane`. Geometries are shareable — one Geometry can back many Meshes with different materials and transforms.
- **Material** (shader + pipeline + group-1 bind group): `material.create(ctx, descriptor)` accepts a `Shader` resource (from `shader.create`/`load`) respecting the engine's binding contract (§Binding contract). An unlit material is `shader.unlit(ctx)` (a shared `Shader<{ color: "vec4f" }>`) + a colour `Binding` (`binding.create(ctx, shader)` then `binding.set(ctx, b, { color })`) passed to `material.create(ctx, { shader, binding })`; the normal-debug material is `material.create(ctx, { shader: await shader.normalColor(ctx) })`. The engine's built-in shaders are publicly exposed as `shader.unlit`/`shader.normalColor` (engine-owned, shared per ctx; `destroy` no-ops). The mechanical-tier `material.createPipeline` is the documented escape hatch for raw WebGPU pipelines. Setting `depth: false` in the descriptor enables genuine depth-less rendering: the pipeline is built with no depth-stencil block and can only be drawn into a pass with no depth attachment (`renderToTexture` without a `depthTexture`). It is NOT a way to ignore depth within a depth-having pass — for that, use `depth: { write: false, compare: "always" }` on a normal depth-enabled material.
- **Mesh** (drawable): `mesh.create(ctx, { geometry, material })` combines a Geometry + a Material + an identity transform. The caller allocates the geometry (via `geometry.cube` / `geometry.plane` / `geometry.create`) and the material (via `material.create`) and passes them in — see §Resource ownership.
- **Transform**: mutated via setters — `mesh.setPosition`, `setRotation`, `setScale`. Setters flip an internal dirty flag; the engine recomputes the model matrix and writes the per-object uniform buffer lazily in `frame.render`. Initial transform is identity.
- **Lifetime**: explicit destroy — `mesh.destroy(ctx, m)`, `geometry.destroy(ctx, g)`, `material.destroy(ctx, m)`, and (for post-effects) `post.destroy(ctx, e)`. All four are silent on stale or already-destroyed handles (idempotent — the per-ctx handle pool's generation counter is the liveness source of truth). Geometry and Material both refcount inbound Mesh references: calling `destroy` on a still-referenced handle defers the actual GPU teardown until the last referencing mesh is destroyed. Pipelines are refcounted internally in a per-ctx cache (separate cache per consumer-facing kind: material pipelines vs post-effect pipelines) and freed when the last material/effect referencing them is destroyed. Custom material's and post-effect's `@group(1)` resources are consumer-owned — the typed `binding` (a `Binding` owning its buffer) and the raw `bindings` (`GPUBindGroupEntry[]`) are both destroyed by the consumer after `material.destroy` / `post.destroy`.

## Binding (uniform bridge)

A `Binding` owns a CPU scratch buffer + a matching `GPUBuffer` for a declared `@group(1)` uniform-buffer layout. The write path is **lazy**:

- `binding.set(ctx, b, values)` — batch-writes multiple fields into the CPU scratch and marks the binding dirty.
- `binding.setUniform(ctx, b, name, value)` — single-field write, **zero-alloc** hot path; writes directly into the cached typed-array view at the pre-computed byte offset.
- Neither call touches the GPU. Both are **runtime-quiet**: silent no-op on a stale or destroyed binding.
- `frame.render` (and future compute dispatches) calls `_flushDirtyBindings(ctx)` **before any draw work** on every render call. This drains the per-ctx dirty-binding set: one `queue.writeBuffer(slot.buffer, 0, slot.scratch)` per dirty binding, then `slot.dirty = false` and the set is cleared.
- The flush is **per-ctx** (not per-draw): a binding not yet attached to any drawn material is still flushed, keeping it compute-ready.
- A binding destroyed after being marked dirty is silently skipped (warn-skip) at flush time — the slot lookup returns `null` and the handle is removed with `dirty.clear()`.
- **Lifetime rule**: destroy `binding.destroy(ctx, b)` after (or alongside) destroying any material or effect that references it. A destroyed binding skips silently at flush; an orphaned live binding is cleaned by the dispose cascade on `gpu.dispose`.

This generalises the existing per-mesh transform dirty-flush (`transformDirty` → `_recomputeModelIfDirty` per draw) to the binding layer.

## Binding contract

Every Material's WGSL must respect the engine's binding contract:

| Slot | Type | Owner | Written by |
|---|---|---|---|
| `@group(0) @binding(0)` | `Camera { viewProjection: mat4x4<f32>, position: vec4<f32> }` | engine (per-frame) | `frame.render` (once per frame, from `camera.getMatrices` + `camera.position`) |
| `@group(0) @binding(1)` | `Scene { ambientSky: vec4<f32>, ambientGround: vec4<f32>, lightCount: vec4<u32>, fog: vec4<f32>, lights: array<Light, 16>, shadowMatrices: array<mat4x4<f32>, 4> }` (the `fog` lane packs `rgb` = fog color, `a` = density; density `0` = disabled) | engine (per-frame) | `frame.render` (once per frame, from `RenderOptions.lights`/`ambient`/`fog`) — bound only for pipelines whose shader declares `usesScene` |
| `@group(0) @binding(2)` | `texture_depth_2d_array` (engine shadow maps; `MAX_SHADOW_CASTERS` layers, `depth32float`) | engine (per-frame) | `frame.render` (depth-only caster passes) — bound only for pipelines whose shader declares `usesShadows` |
| `@group(0) @binding(3)` | `sampler_comparison` (PCF comparison sampler, `compare: "less"`) | engine (per-ctx) | `frame.render` — bound only for pipelines whose shader declares `usesShadows` |
| `@group(1) @binding(N)` | consumer-defined | material | `MaterialDescriptor.bindings` |
| `@group(2) @binding(0)` | `Object { model: mat4x4<f32>, normalMatrix: mat4x4<f32> }` | engine (per-draw) | `frame.render` (per mesh, when transform is dirty) |

Groups are split by update cadence: `@group(0)` per-frame (scene/camera), `@group(1)` per-material, `@group(2)` per-draw (object). `@group(0) @binding(0)` carries the camera (`viewProjection` + the world-space eye `position`, the latter read by lit shaders for specular; `.w` unused). `@group(0) @binding(1)` carries the Scene UBO — hemisphere ambient + a fixed `array<Light, 16>` + a `shadowMatrices` tail (`array<mat4x4<f32>, 4>`, one per shadow caster) — landed in Stage 3 Phase 2 (lighting) and extended in Stage 4 (the `shadowMatrices` tail; see §Lighting / §Shadows). The Scene binding is engine-managed and bound only for pipelines whose shader sets `usesScene` (see `_usesSceneOf`); pipelines that don't never see it, so their `@group(0)` bind group has only binding 0. `@group(0)` bindings 2 (`texture_depth_2d_array`) and 3 (`sampler_comparison`) carry the engine shadow maps + comparison sampler; both are engine-managed and bound only for pipelines whose shader sets `usesShadows` (see `_usesShadowsOf`). The per-draw `Object` adds `normalMatrix` (the inverse-transpose of `model`, for correct normals under non-uniform scale; shaders read its upper 3×3).

The engine's built-in shaders compose the `Camera`/`Object` binding preamble from shared `shader.source` fragments in `packages/core/src/shader/preamble.ts` (single source of truth for the standard binding structs).

**Material-less shaders are supported.** A shader may declare no `@group(1)` (e.g. `normalColor`, or a custom camera+object-only shader). Since the per-draw object lives at `@group(2)`, `@group(1)` then becomes an empty *intermediate* bind-group slot — and WebGPU rejects a draw that leaves an intermediate slot unbound below a bound higher slot. `frame.render` handles this transparently by binding an empty bind group at `@group(1)` when the material has none, so material-less shaders Just Work. (See `docs/learnings/webgpu-empty-intermediate-bind-group.md`.)

**Vertex format** (every vertex buffer carries this interleaved layout):
- `@location(0)`: position, `vec3<f32>`, offset 0
- `@location(1)`: normal, `vec3<f32>`, offset 12
- `@location(2)`: uv, `vec2<f32>`, offset 24
- `arrayStride: 32` bytes

**Stability:** additive changes are non-breaking — per-frame scene data extends `@group(0)` (the Scene UBO at binding 1 landed in Stage 3 Phase 2; the shadow maps at binding 2 + comparison sampler at binding 3 landed in Stage 4; binding 4, … remain available for future per-frame data) and per-draw object data lives in `@group(2)`. Changes that rename or repurpose the camera at `@group(0) @binding(0)` or the object at `@group(2) @binding(0)` break every shader respecting the contract — including the SDF triangle in hello-world. With few private consumers today, a contract change is a small migration.

**Post-effect contract** (distinct `@group(0)`, shared `@group(1)`): a post effect's WGSL binds the engine-provided scene input at `@group(0) @binding(0)` (`texture_2d<f32>`) and a sampler at `@group(0) @binding(1)` — NOT camera/object. The fragment entry must be `fs_main`; the fullscreen vertex stage is engine-supplied. Consumer params live at `@group(1)`, written via the **same** typed-`Binding` path as materials: `post.create(ctx, { shader, binding })` retains the binding's `GPUBuffer` and builds the `@group(1)` `GPUBindGroup` lazily at first render (per resolved target colour format — the effect pipeline itself builds lazily then too, so under HDR a mid-chain effect targets the `rgba16float` intermediate and the final pass targets the swap-chain `ctx.format`), and `binding.set`/`setUniform` lazily flush at the render boundary (§Binding). The binding OWNS its buffer; `post.destroy` does not free it. The raw `EffectDescriptor.bindings` path (consumer-owned `GPUBindGroupEntry[]`) is retained for textures/samplers/advanced cases. Same completeness check as material: a shader declaring a `@group(1)` layout with neither `binding` nor `bindings` supplied throws at create (setup-loud); the inverse mismatch (`binding`/`bindings` supplied but the shader declares no `@group(1)`) surfaces at first render, when the bind group is built.

**Entry-point defaults** for `material.create`:
- `entryPoints.vertex` defaults to `"vs_main"`, `entryPoints.fragment` defaults to `"fs_main"`. Override to use any name, or to pinpoint one entry in a multi-entry module.

**Render-state defaults** for `material.create`:
- `primitive.cullMode: "back"` — back-face culling on by default. Override to `"none"` for covering triangles or two-sided geometry.
- `primitive.topology: "triangle-list"`
- `depth` omitted → depth test + write enabled (`write: true`, `compare: "less"`). Set `depth: false` for genuine depth-less rendering (only valid in a pass with no depth attachment — `renderToTexture` without a `depthTexture`); see §Depth buffer. Supply `depth: { write?, compare? }` to enable depth with overrides.
- When `depth: false`, `write` and `compare` are normalized out of the pipeline-cache key so they don't produce spurious cache misses.

**Depth buffer:** the engine owns one `depth24plus` texture per context, resized when the canvas backing-store size changes. `frame.render` always uses it; no consumer-visible API. Materials declare depth-stencil state unless created with `depth: false` (e.g. `material.create(ctx, { shader, depth: false })`). `frame.render` (always depth) and `frame.renderToTexture` (depth optional) now throw `FurnaceGpuError` on a material↔pass depth/attachment mismatch — what was previously a silent WebGPU validation failure. Any consumer-supplied `depthTexture` passed to `renderToTexture` must be format `depth24plus` (same as the engine-managed depth texture); a different format throws immediately.

## Lighting

Multi-light Blinn-Phong lighting landed in Stage 3 Phase 2. Lights and ambient are **per-frame value-type data** (`Light` / `Ambient`, no handle or lifecycle — same posture as `Camera`), passed each frame via `RenderOptions.lights` / `RenderOptions.ambient`. The engine packs them into the Scene UBO (§Binding contract, `@group(0) @binding(1)`) and binds it only for pipelines whose shader declares `usesScene` (the built-in `shader.lit` / `shader.texturedLit`, or any custom shader composing the public `shader.sceneBinding` / `shader.lightingHelpers` fragments).

**Light cap and overflow policy.** `MAX_LIGHTS = 16` (`frame/lights.ts`) — the fixed `array<Light, 16>` in the Scene UBO. Overflow is **clamped, not rejected**: `frame.render` packs only the first 16 lights and, on the first frame where more are supplied, emits a single `log.warn` (`warnedLightOverflow` latch in `frame/render.ts: _writeSceneBuffer`). It **never throws** — light count is a per-frame hot-path quantity, so the policy is runtime-quiet (clamp + warn-once). The Scene UBO is **engine-managed**, not a `Binding<L>`: the binding layout system has no array support, so the engine owns the packer (`_packScene`) and the per-ctx buffer directly.

**Light kinds and direction convention.** `Light` is a discriminated union on `type`:
- `directional` — infinitely-far parallel rays. `direction` is the world-space **travel** direction (a sun pointing straight down is `[0, -1, 0]`); the shader uses `L = -direction` to get the surface→light vector.
- `point` — radiates from `position` with a windowed inverse-square falloff cut off at `range`.
- `spot` — a point light constrained to a cone; `direction` is the **cone axis** (also a travel direction), with `innerAngle` (full intensity inside) / `outerAngle` (zero by outer), both half-angles in radians.

`Ambient` is hemisphere ambient: `{ sky, ground, intensity }`, where `intensity` scales both sky and ground (kept a small fraction of the key light so it doesn't eat HDR headroom). Omitting `ambient` uses a neutral low default (`intensity ≈ 0.05`).

**World-space normals.** Lighting is computed in world space. The per-draw `Object` UBO carries `normalMatrix` — the inverse-transpose of `model` (`mat4.normalFromMat4`, which falls back to identity on a singular matrix) — so normals stay correct under non-uniform scale. Lit shaders transform `v.normal` by `normalMatrix` and renormalize per fragment.

**HDR calibration.** The model is calibrated for an HDR working color format (no `1/π` Lambertian normalization): a white surface lit by a single key light peaks at ≈1.0, leaving room above 1.0 for additive specular and multiple lights. Specular is **additive** half-vector Blinn-Phong (`fr_shade` in `shader/lighting.ts`). Render into an HDR context (`hdr: true`) with a tone-map effect to bring the result back to LDR (see §HDR intermediate); under an LDR context bright sums clip.

**Per-material specular posture differs by built-in:**
- `shader.lit` — `@group(1)` carries `{ color, specular }` (both `vec4f`); `specular.rgb` is the specular color and `specular.w` is the shininess exponent. The default is **matte**: an unset (zero-initialized) `specular` yields zero highlight, so a `{ color }`-only binding keeps working. Opt into a highlight by setting both `specular.rgb` and `specular.w`. (`max(shininess, 1.0)` in the shader guards `pow(0,0)` NaN on the matte path.)
- `shader.texturedLit` — albedo is sampled from the texture and shaded with the **same** Blinn-Phong model, but specular is a **fixed engine default** (0.04 grey, shininess 32). Its `@group(1)` is sampler + texture only (a texture binding is mutually exclusive with a uniform binding), so per-material specular can't be supplied here; per-material textured specular is a backlog item.

Supplying no lights renders ambient-only (the surface still shows hemisphere ambient × albedo).

## Shadows

Shadow mapping landed in Stage 4. It extends the lighting model without changing the `Light` posture: lights stay **per-frame value data** (a `directional`/`spot` light opts in by carrying a `shadow` config; presence = casts). The shadow maps themselves are **engine-owned**, not light-attached: the engine keeps one `texture_depth_2d_array` indexed by *slot* (the Bevy/ECS render-layer model, not a per-light texture). A light's chosen slot is published into its Scene-UBO `shadow` lane; the receiver shader reads `slot` and samples the matching array layer.

**Opt-in and caster cap.** Only `directional` and `spot` lights cast — a `point` light never does (cube shadows are a fence, below). `MAX_SHADOW_CASTERS = 4` (`frame/lights.ts`): `_collectShadowCasters` assigns slots `0..N-1` in light order and **clamps** the surplus. Overflow is **runtime-quiet** (clamp + warn-once at the caller; never throws on the render path — it runs per frame, so a throw would crash the loop).

**Format and resolution.** `SHADOW_FORMAT = depth32float`, fixed `SHADOW_MAP_SIZE = 2048` (`frame/shadow-map.ts`). The array texture is `2048 × 2048 × MAX_SHADOW_CASTERS` layers, allocated once per ctx (lazily) and freed by the dispose cascade. Configurable resolution / format is a fence.

**Technique.** Forward shadow mapping with a depth-only pass per caster:
- One **depth-only render pass per caster** into its array layer, drawing every resolved mesh with a single shared caster pipeline (`_ensureShadowCasterPipeline`, per-ctx singleton, vertex-only, no fragment/color target, single-sample). The caster pass writes from the light's POV.
- Fixed **slope-scaled hardware bias** on the caster pipeline: `depthBiasSlopeScale = SHADOW_SLOPE_SCALE = 2.0`, `depthBias = SHADOW_CONST_BIAS = 2` (`frame/shadow-map.ts`). This is the primary acne defense.
- The **receiver** samples the depth array with the comparison sampler (`compare: "less"`, linear) using **3×3 PCF** (9 `textureSampleCompareLevel` taps, averaged) — `fr_shadowFactor` in `shader/shadows.ts`. A `slot < 0` (light not casting) returns `1.0` (fully lit); a receiver outside the shadow frustum (UV out of `[0,1]` or `ndc.z > 1`) also returns `1.0`.

**Light view-projection convention (important).** The per-caster matrix stored in `scene.shadowMatrices[slot]` is **raw `proj · view` — light CLIP space** (NDC: `.xy ∈ [-1, 1]`, `.z ∈ [0, 1]`). It is the SAME matrix used two ways:
- the depth-pass **vertex** shader uses it directly as the clip-space transform (`_shadowCasterSrc`: `lightVP.viewProj * object.model * pos`);
- the **receiver** applies the NDC → shadow-map-UV remap **in-shader** inside `fr_shadowFactor` (`uv = ndc.xy * vec2(0.5, -0.5) + vec2(0.5, 0.5)`, y flipped).

There is **no baked clip→UV matrix** — both endpoints share the raw clip-space matrix and the receiver does the remap. (This is the corrected design; an earlier version baked a `CLIP_TO_UV` remap into the stored matrix, which broke the depth pass.) Projection per kind (`frame/shadow-projection.ts`):
- **spot** — perspective from the cone: `fovY = 2 · outerAngle` (outerAngle is the half-angle), aspect 1, `near` (default `0.1`) / `far` (default the light's `range`);
- **directional** — orthographic from a consumer-specified `orthoHalfExtent` (the ortho half-extent in world units), `near`/`far`, looking at `target` (default origin) from `distance` back along `-direction` (default `far/2`).

**Bias (three knobs).** Acne is fought at three points:
1. the fixed slope-scaled **hardware** bias on the caster pipeline (above) — the primary defense;
2. a per-light in-shader **`depthBias`** — subtracted from the receiver's compare depth (`refDepth = ndc.z - depthBias` in `fr_shadowFactor`). This is **normalized `[0,1]` depth**, so it must be *small* (≈ `0.001`–`0.01`); a value near `1` disables shadows entirely. Defaults to `0`;
3. a per-light texel-scaled **`normalBias`** — a normal-offset applied to the receiver world position before sampling (`worldPos + n * normalBias * (1/2048)` in `fr_shade`), fighting acne at grazing angles. Defaults to `1.5` when the caster omits it.

**Shadow term in `fr_shade`.** Shadowing folds into the existing Blinn-Phong `fr_shade` (`shader/lighting.ts`): each casting light's visibility (`fr_shadowFactor`) **multiplies only its DIRECT term** (diffuse + specular). **Ambient is never shadowed** — `fr_ambient` is added once, before the light loop, with no visibility factor. A light that casts no shadow (`slot < 0`) contributes `vis = 1.0`, so non-casting lights are unaffected.

**Fences (deferred to backlog):** point-light cube shadows, cascaded shadow maps (CSM), auto-fit ortho frustum, configurable resolution / PCF kernel, per-mesh cast/receive opt-in, transparent casters.

## Textures

`@furnace/core/texture` provides GPU 2D textures (rgba8 only). The following conventions apply engine-wide.

### Texture resource ownership

Extends the general resource-manager ownership rule: the engine does **not** free consumer-created textures. A `Texture` handle returned by `texture.create` or `texture.load` is the consumer's responsibility — call `texture.destroy(ctx, tex)` when done. `material.destroy` does **not** free a texture (the `texture` field of `MaterialDescriptor` is consumer-owned, symmetrically with how `binding`'s `GPUBuffer` is consumer-owned). `gpu.dispose(ctx)` cascades through the textures pool and frees every live slot — so explicit destroy is an optimization (reduce in-context VRAM pressure), not a requirement.

### colorSpace / sRGB-by-format

`TextureDescriptor.colorSpace` drives GPU format selection:

- `"srgb"` (default) → `rgba8unorm-srgb`: hardware applies sRGB linearisation on each `textureSample`. Use for albedo/diffuse textures.
- `"linear"` → `rgba8unorm`: samples are taken as-is. Use for data textures (normal maps, masks, metalness/roughness).

Shader-side decode (`pow(sample, 2.2)`) is the avoid-path — let the GPU format do the job. The mipmap blit kernel relies on the same hardware decode: `_generateMipmaps` uses the texture's own `format` (e.g. `rgba8unorm-srgb`) for both the source view and the render target — no linear `viewFormats` override. So sampling the source level decodes sRGB→linear, the GPU downsamples in **linear** space, and the write re-encodes linear→sRGB. That sRGB→linear→sRGB round-trip per mip level is intentional: it is exactly what makes mip generation gamma-correct (averaging in linear light, not in perceptual sRGB).

### Sampler-cache stance

`GPUSampler` objects are engine-cached and deduplicated per `SamplerParams` descriptor, per context. The cache lives on `ctx._internal.resources.samplerCache`; its entries are GC'd with the `GPUDevice` (WebGPU specifies no `GPUSampler.destroy()`). There is no public `Sampler` handle — the cache is a correctness mechanism (WebGPU limits `maxSamplersPerShaderStage` to 16; uncached consumer creation exhausts the limit under moderate multi-material scenes) as well as an ergonomic one.

The default sampler (`DEFAULT_SAMPLER` in `texture/sampler-cache.ts`): `magFilter: "linear"`, `minFilter: "linear"`, `mipmapFilter: "linear"`, `addressU: "repeat"`, `addressV: "repeat"`, `maxAnisotropy: 1`. An omitted `SamplerParams` resolves to this default.

### Anisotropic filtering (AF) setup-loud rule

`maxAnisotropy > 1` requires `magFilter`, `minFilter`, **and** `mipmapFilter` all set to `"linear"`. This is a WebGPU spec rule (see `GPUSamplerDescriptor`). The engine enforces it at `material.create` time (via `_getSampler`) with a setup-loud throw (`FurnaceError`). Passing `maxAnisotropy > 1` with any non-`"linear"` filter throws; fix the filter or drop the anisotropy.

### Mipmaps

Mipmap generation is opt-in (`mipmaps: true` on `TextureDescriptor`). When enabled:

- The GPU texture is created with `RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_DST`.
- A render-pass blit kernel (`_generateMipmaps` in `texture/mipmap.ts`) downsamples each level from the previous: a single full-screen-triangle blit (one 3-vertex `triangle-list` draw) per level, with one linear `textureSample` per fragment. The 2×2 box average comes from the GPU's linear minification filter, not from multiple shader taps.
- The pipeline is built per-call (create-time cost, not hot-path; caching is a deferred optimisation).
- `mipLevelCount = floor(log2(max(width, height))) + 1`.

**Stats caveat.** `memory.textureBytes` records **base-level bytes only** — a mipmapped texture undercounts by roughly 33% (the geometric-series tail: ~`width*height*4 * (1 + 1/4 + 1/16 + …) ≈ base * 4/3`). The recorded `byteLength` is symmetric across create and teardown, so leak detection is unaffected; only the absolute byte figure is low for mipmapped resources. See `docs/backlog/engine-architecture/mipmap-texture-bytes-undercount.md`.

---

## Input

`@furnace/core/input` is a module-level singleton with explicit `attach(canvas)` /
`detach()` lifecycle. Keyboard listeners are window-bound; pointer and wheel are
canvas-bound. Subscriptions (`onKeyDown`, `onPointerMove`, …) work before attach;
they just don't fire until DOM listeners are installed.

- **Identification**: keys are identified by DOM `event.code` (layout-independent —
  WASD works on AZERTY). `event.key` (the produced character) is exposed in the
  event payload but is not the snapshot lookup key. Pointer buttons use the
  standard 0/1/2 mapping (primary/middle/secondary).
- **Coordinate convention**: pointer and wheel events expose both CSS-pixel
  coordinates (`x`, `y`) and device-pixel coordinates (`xDevice`, `yDevice`).
  CSS pixels match the DOM and what the user visually points at; device pixels
  match the backing-store the GPU writes into. Picking and UI hit-tests use CSS;
  framebuffer-direct reads use device. The two are co-equal in the input domain
  — distinct from rendering, where backing-store dimensions are the singular
  size truth (see `gpu.onResize` above).
- **Level vs edge**: `isKeyDown(code)` / `isPointerButtonDown(btn)` /
  `getPointer()` read the current *held* (level) state. The `was*` reads —
  `wasKeyPressed` / `wasKeyReleased` / `wasPointerButtonPressed` /
  `wasPointerButtonReleased` — read per-frame *edge* (transition) state, plus
  the lower-level `onKeyDown` / `onKeyUp` / `onPointerDown` / `onPointerUp`
  subscriptions for consumers wanting the full event payload. Edge mechanics:
  - **Set by the synchronous DOM handlers**, so a sub-frame press *and* release
    both register in the same frame (no edge is lost to a fast tap).
  - **Cleared once per render frame by `frame.loop`**, after the frame callback
    has run. This is the `frame → input` per-frame coupling — an acyclic
    cross-module dependency analogous to the `stats` instrumentation exception
    documented in §Instrumentation below. Edges only reset correctly when the
    consumer drives `frame.loop`; reading `was*` outside a running loop leaves
    edges latched until the next loop tick (or `detach`).
  - **Per-frame, not per-tick.** A single render frame may advance a
    `frame.fixedClock` 0, 1, or 2+ times. Reading an edge *inside* `onTick`
    would miss it (0 ticks that frame) or double-fire it (2+ ticks) — the Unity
    `Input.GetKeyDown`-in-`FixedUpdate` bug. **Latch recipe:** read the edge
    once at frame level, store it in a local flag, and consume that flag in the
    sim. Example — read at frame level: `if (input.wasKeyReleased("Space"))
    launchRequested = true;` then apply `launchRequested` at the next
    `fixedClock` `onTick` and clear it.
- **Stuck-key behavior**: on `window` blur the engine clears `keysDown` and
  pointer button state. `onKeyUp` events are *not* synthesized for the cleared
  keys; consumers requiring symmetric event streams subscribe to a future
  `onBlur` (backlog: `input-stuck-key-recovery.md`).
- **Default browser behaviors are not suppressed**: arrows scroll, right-click
  opens the context menu, Cmd+S opens save. Hello-world's full-viewport canvas
  is unaffected; embedded consumers need the future config option tracked in
  `input-prevent-default-config.md`.

## Instrumentation

`@furnace/core/stats` is the single source of truth for engine-wide metrics. Other modules in core call underscore-prefixed `stats._*` hooks (`_frameStart`, `_recordDraw`, `_recordAlloc`, `_recordDestroy`, `_recordEmission`, etc.) to feed snapshots. This is the one documented exception to the no-cross-module-imports rule (master spec § 3).

Consumers observe via `stats.snapshot(ctx)`, `stats.onFrame(ctx, fn)`, or `stats.get(ctx, path)` (type-safe dotted-path). Custom metrics via `stats.gauge`, `stats.increment`, `stats.measure`.

Stance: observability per §Failure policy. Setup ops (`stats.onFrame`) throw on disposed ctx; runtime reads return zero/null defaults silently on disposed; runtime writes silently no-op on disposed and emit a `warn`-level log entry on bad inputs (routed via `@furnace/core/log`). Functions wrapping consumer code (`stats.measure`) record what they can and re-throw consumer errors.

## Failure policy

Engine modules pick one of four behavioural stances per export, driven
by how often the function is called and what cost validation adds.

### Cold-path validate (setup, teardown, rare config events)

Functions called once at setup, once at teardown, or rarely on config
events (resize, device-lost) validate inputs synchronously and throw
on bad input or disposed ctx. Validation cost is irrelevant — these
do not run in the draw loop. The caller learns about the bug
immediately, at construction time, with a stack trace pointing at
the bad call site.

Threshold: ≤1 call/frame.

Applies to: `gpu.requestContext`, `gpu.dispose`,
`gpu.onResize`/`onDeviceLost`/`onUncapturedError`,
`camera.perspective`/`orthographic` constructors,
`camera.setAspect`/`setNearFar`/`setFov`/`setFitPolicy`/`setScale`,
`camera.bindToCanvas`/`updateForSize`,
`material.create`/`unlit`/`normalColor`,
`mesh.create`, `geometry.create`/`cube`/`plane`,
`post.create`,
`frame.loop`/`fixedClock` constructors + `fixedClock.setFixedDtMs`,
`input.attach`/`detach`,
`stats.onFrame`.

### Warm-path validate (per-frame orchestration, ≤100 calls/frame)

Functions called per-frame but in bounded numbers (typically 1–3
calls/frame for top-level orchestration) validate cheaply: O(1)
checks on individual fields, O(N) checks over bounded lists like
the draw list or effects chain. Validation cost stays below the
noise floor at this call frequency (~300 ns/frame at 100 calls
× 3 ns/check, or ~20 μs/frame for O(N) over a 10,000-element
draw list — 0.12% of a 16.67ms budget).

Threshold: 1–100 calls/frame.

Applies to: `frame.render`, `frame.renderToTexture`, `frame.encode`,
`gpu.getCurrentTextureView`.

### Hot-path trust (math primitives, per-frame setters, >100 calls/frame)

Functions called per-frame in tight loops trust the caller — no
input validation, no logging, no exceptions. Degenerate input is
handled with a documented sentinel value, set out in each function's
TSDoc precondition. The function never throws, never logs.

This is a deliberate performance contract. At hot-path call
frequencies (1,000–100,000 calls/frame for math primitives in real
scenes), a `Number.isFinite` guard per call costs 3 μs – 300 μs per
frame — enough to eat 1–18% of a 16.67ms budget at the high end.
The convention also matters for future Rust+wasm SIMD math kernels:
a JS-side validation guard at the wasm boundary would erase most
of the SIMD gain.

When the caller violates a precondition, the engine produces a
downstream-safe sentinel — identity matrix, zero vector, NaN
propagation for projection — whichever keeps subsequent operations
valid. Choosing "still a valid object" sentinels (identity
quaternion, identity matrix) over "trivially-zero" sentinels (zero
quaternion, zero matrix) is preferred because they don't cascade
into NaN downstream.

Threshold: >100 calls/frame.

Applies to: all `transform/*` math primitives (`vec3.*`, `quat.*`,
`mat4.*`, `vec4.*`), per-mesh pose setters
(`mesh.setPosition`/`setRotation`/`setScale`), per-camera pose
setters (`camera.setPosition`/`setTarget`/`setUp`),
`camera.projectToScreen`, the per-frame body of `frame.loop`'s tick
callback.

### Observability (stats, log)

Diagnostics modules must never affect the host program. Setup
throws on disposed ctx; runtime writes silently no-op on disposed
ctx and emit a `warn`-level log entry on bad input; runtime reads
return zero/null defaults silently on disposed ctx. Subscriber
callbacks that throw are caught and routed via the log helper at
`error` level; iteration continues.

Applies to: `stats.*`, `log.*`.

### Subscriber dispatch (events)

Emitters and subscriber loops catch each subscriber's throw, route
it to the log helper at `error` level, and continue iteration. One
bad subscriber must not break the rest of the dispatch or the host
frame.

Applies to: `events.createEmitter.emit`, `stats.onFrame` dispatch,
`gpu.onResize`/`onDeviceLost`/`onUncapturedError` emitters.

### Reference table

| Stance | Threshold | Posture | Cost class at scale |
|---|---|---|---|
| Cold-path | ≤1 call/frame | Throw on bad input | One-time; irrelevant |
| Warm-path | 1–100 calls/frame | Throw on bad input; O(N) over bounded lists | ~300 ns/frame at threshold |
| Hot-path | >100 calls/frame | Trust caller; sentinel on degenerate; TSDoc contract | Up to 5–18% of 16.67ms budget if validated |
| Observability | n/a | No-op + warn (writes), zero defaults (reads) | Existing |
| Subscriber | n/a | Catch + log + continue | Existing |

Tranche 5 (stats) is the reference observability example. Tranche 6
(post) is the reference warm-path example. Tranche A-4 (2026-05-28)
codified the four-stance taxonomy. Diagnostics extend the failure
policy via `@furnace/core/log`; see §Diagnostics for routing and
sink semantics.

### Authority over the generic contributor rules

This section is the **single source of truth** for where the generic
contributor rules (`.claude/rules/typescript.md`, `.claude/rules/clean-code.md`)
are overridden by performance needs. `.claude/rules/working-standards.md`
links here as the authority; the rule files are not edited to restate the
stances. The overrides the stances sanction, by stance:

- **Hot-path** waives, for the named functions only: "fix the types
  instead of bypassing the compiler" (intentional bypass classes —
  e.g. hot-path typed-array indexing casts), "don't mutate parameters"
  and "commands vs queries" (the `(out, a, b) => out` math convention),
  and "prefer functional pipelines over `for` loops" (index loops in
  math kernels).
- **Warm-path** waives "prefer functional pipelines" for the bounded
  per-frame validation/scene-pass loops in `frame.render`.
- **Cold-path** waives nothing — the generic rules apply in full.

When a generic rule and a performance need conflict, this section
decides. Change it here; `.claude/rules/working-standards.md` links
here rather than restating. Reconciled in A-6 (2026-05-29) after the
audit found the generic rules silently contradicting the committed
stances.

## Resource ownership

Superseded by §Resource manager (2026-05-28). The manager is the single source of truth for resource lifecycle; "who owns what" reduces to "the manager owns every consumer-facing slot; the consumer holds opaque handles." A factory that allocates its own GPU buffers attaches them to the slot's `ownedBuffers` array, so factory-allocated internals are freed alongside the public handle. (No current factory uses this — the typed-`Binding` path, where the binding owns its buffer, superseded `material.unlit`'s owned color buffer.)

The original ownership rule ("Pass a handle in, or get one back → you own it") still describes consumer-side intent — you destroy what you explicitly created. Enforcement and refcount tracking now live in the manager rather than in consumer discipline; the cascade-on-dispose path safeguards against forgotten destroys.

## Diagnostics

The engine emits diagnostics through `@furnace/core/log`. A single
consumer-replaceable sink receives every entry. Default sink writes to
`console.*` with the `[furnace/<module>]` prefix.

**Pipeline:**

```
engine call site         log/internal.ts          current sink (1 active)
─────────────────────    ────────────────────     ──────────────────────────
warn("gpu", "leak", 3)  ▶ warn(...)         ▶ LogEntry ▶ sink(entry)
                           builds entry
                                                            │ (default)
                                                            ▼
                                                     consoleSink:
                                                     console.warn(
                                                       "[furnace/gpu]",
                                                       "leak", 3,
                                                     )
```

**Levels and engine usage:**

| Level | Engine usage |
|---|---|
| `error` | Subscriber-throw catches, GPU uncaptured errors, device lost. |
| `warn`  | Recoverable misuse (resource-leak warnings on dispose, double-destroy guards, bad-input no-op warnings). |
| `info`  | Reserved for future engine setup notifications. No current call sites. |
| `debug` | Reserved for future engine verbose state. No current call sites. |

**Sink semantics:**

- `setSink(custom)` — install a custom sink. Default is silenced for as long as `custom` is installed.
- `setSink(null)` — silence the engine. Entries are not built; no sink is invoked.
- `setSink(consoleSink)` — restore the default explicitly after a silence or custom replacement.
- Replacement, not augmentation. Exactly one sink at any moment. Consumers wanting "telemetry + console" compose:

```ts
import { setSink, consoleSink } from "@furnace/core/log";
setSink(entry => { consoleSink(entry); telemetry(entry); });
```

- A throwing sink propagates to the caller. The engine does not swallow consumer-supplied callback failures — same posture as event subscribers.

**Module-level mutable-state exception:**

The active sink is a module-level mutable variable. This is the second documented exception to master spec §1.3.

Justification: logging is process-level, not context-level. A pre-context call site (e.g. a future `requestContext` validation failure) has no `Context` available. Per-context sinks would force every log site to plumb `Context`; many engine warn/error paths have no context available (subscriber-throw catches, double-destroy guards, bad-input warnings).

The exception is named explicitly so it can't extend casually. The test for a new module-level singleton: it must be process-level, must have no per-context semantics, and must work before any `ctx` exists.

**Failure-policy alignment:**

Diagnostics extend the existing failure policy, they don't replace it:
- **Cold-path:** still throws. `gpu.requestContext` throws `FurnaceGpuError` on adapter/device/context failure — not converted to a log call. `gpu.onUncapturedError`, `gpu.onDeviceLost`, `stats.onFrame` throw `FurnaceGpuError` on disposed ctx.
- **Observability:** still warns through the sink. The 7 internal call sites are all observability sites; semantics unchanged, only transport.
- **No silent failures:** consumer-supplied sinks and emitter subscribers that throw propagate, never swallowed.

## References

- Engine architecture exploration notes: `docs/reference/engine-architecture.md`
- Packaging and distribution: `docs/reference/packaging-and-distribution.md`
- API surface taxonomy & naming posture: `api-posture.md` (the taxonomy maps each concept kind to a default failure-policy stance; this section remains the authority on the stances themselves).
