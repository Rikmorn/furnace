# API posture & concept taxonomy

This document is the canonical set of rules for **what kinds of concept `@furnace/core` exposes to consumers, and how they are named and shaped.** Its purpose is so contributors adding new surface don't re-derive these decisions each time.

It is the companion to two siblings:
- `engine-conventions.md` — *behavioural* contracts (coords, color, DPR, lifecycle, **failure policy**). That document's §Failure policy remains the **authority** on the four performance stances; this document maps each concept kind to a *default* stance, it does not override them.
- `core-modules.md` — the module-by-module *inventory* of public exports.

The evidence behind these rules — a six-engine survey (bevy, raylib, three.js, PixiJS, wgpu, sokol-gfx) — is in `docs/research/api-posture-prior-art.md`.

## Guiding principle — the abstraction tier

> **`@furnace/core` is a low-level, handle-based GPU-resource layer** (the sokol-gfx / wgpu tier). The bias is **performance, generality, and unopinionated primitives + piping.**

Three consequences that pre-answer recurring questions:

1. **Higher abstractions build *on top*, not *into*.** Scene graphs, ECS, retained render lists, render graphs — these are higher-tier conveniences. They belong in their own modules layered over the core surface; they do **not** alter the low-level vocabulary. A proposed new concept that is a higher-tier convenience goes to its own module (or a triggered backlog entry), never folded into the core resource/value vocabulary. Building those modules *from* the public core surface is also a forcing function: if a convenience like `core/scene` can't be composed cleanly from the handle vocabulary, the primitives are missing something — treat that friction as a primitive-gap signal, not a reason to reach into internals.
2. **The raw escape hatch is always preserved.** Power users can always drop to raw WebGPU (R7). Adding ergonomic sugar never removes the primitive underneath it.
3. **Foreignness to scene-graph engines is expected, not a defect.** The free-function `fn(ctx, handle)` shape (R2/R3) is unfamiliar to three.js/PixiJS developers — that is the deliberate cost of sitting at the GPU-resource tier rather than the retained-scene tier. The prior art confirms this is where furnace sits; own it.

## The two-axis taxonomy

Every public concept is classified on **two axes** — what it *is* (a noun) and/or what it *does* (a verb). Separating these mirrors the cleanest prior-art taxonomy (bevy's Component/Resource/Asset data kinds vs spawn/insert/add verb families) and avoids the category error of a single flat list mixing "things" with "operations."

### Data kinds (nouns — what a concept *is*)

| Kind | Test | Representation |
|---|---|---|
| **Resource** | Owns GPU memory tracked by the resource manager | opaque branded `uint48` handle |
| **Value-type** | Pure data the consumer holds; no GPU ownership, not manager-tracked | a record/object or `Float32Array` |
| **Descriptor** | Pure-data bundle passed *into* a factory at construction | plain options object |

### Function kinds (verbs — what a function *does*)

| Kind | Test | Verb / naming |
|---|---|---|
| **Factory** | Constructs and returns a resource or value-type | `create` / domain-shape ctor / platform-mirror |
| **Core-mutator** | Minimal set/get of one field of an existing resource/value | `set<X>` / `get<X>` (`is<X>` for booleans) |
| **Command** | Per-frame execution that consumes resources + descriptors and drives the GPU | `render` / `renderToTexture` |
| **Sugar-helper** | Validated convenience producing a well-formed descriptor/value input | grouped sub-namespace |
| **Escape-hatch** | Standalone door to raw WebGPU or the manual path, bypassing managed bookkeeping | standalone fn, TSDoc-marked |
| **Lifecycle-op** | Starts/ends an ongoing process, binding, subscription, or resource existence | family by sub-kind (see R4) |

**Observability is not a separate class.** `stats.*` and `log.*` members each fall into the kinds above (e.g. `stats.snapshot` = factory, `stats.gauge` = core-mutator, `stats.onFrame` = lifecycle-op, `stats.recordDraw` = escape-hatch) and additionally carry the *observability posture* defined in `engine-conventions.md §Failure policy`. The taxonomy and the failure policy compose; neither subsumes the other.

## Forward-looking rules

When adding or changing public surface, apply these.

- **R1 — Classify first.** Place every new concept on the two axes (§"The two-axis taxonomy") using the one-line tests before naming it. The kind determines the verb, the failure-policy stance, and whether it is manager-tracked.

- **R2 — Resources are opaque `uint48` handles.** No field access, no deref; all state flows through accessor functions. This is a deliberate, load-bearing choice (the Sokol pool+generation model). **Why** (so it is never re-litigated):
  - *zero-allocation* handles — a `uint48` is a plain `number`, no object per resource;
  - *dense typed-array storage* — handles pack into `Uint32Array` free-stacks and consumer collections;
  - *generation-counter use-after-free safety* — the handle encodes slot + generation; the lookup validates it;
  - *multi-context honesty* — the encoded ctxId lets one handle-number be validated against the right `Context`;
  - *wasm-boundary-friendly* — passing a number across the future JS↔wasm hot-path boundary is free; marshaling method-objects is not;
  - *tree-shaking* — namespaced free functions dead-code-eliminate better than class methods.

  This is *why the call shape is free functions, not methods* — you cannot hang a method on a `number`. Method/OO ergonomics are a higher-tier concern (R8); a future facade or Scene layer may add them on top, never replacing the handle.

- **R3 — Call shape & ctx-threading.** Public operations are namespaced free functions. **`ctx` is the first parameter whenever an operation requires a `Context`;** pure value-type operations take no `ctx`. The presence or absence of a leading `ctx` is a *readable signal* of whether the operation is context-coupled (e.g. `camera.setPosition(cam, v)` is pure data; `camera.bindToCanvas(ctx, cam)` reaches into the context's resize stream).

- **R4 — Verb family per kind.** Pick the verb from the concept's kind:
  - **Construct** → `create` (the module's primary resource) / `create<Noun>` (a module constructing multiple kinds) / a domain-shape ctor (`camera.perspective`, `geometry.cube`) / a platform-mirror (`gpu.requestContext` ← WebGPU's `request*`).
  - **Single-resource teardown** → `destroy`.
  - **Root/aggregate teardown** → `dispose` (`gpu.dispose`, `resources.disposeAll`) — for the context root or a whole-pool cascade, *not* a single resource.
  - **DOM coupling** → `attach` / `detach` (`input.*`).
  - **Loop** → `loop`, returning a handle with `stop` / `pause` / `resume`. (One render loop; fixed-step simulation composes `loop` with the separable `frame.fixedClock` accumulator — see `core-modules.md`.)
  - **Subscription** → `on<Event>(…)` returning an idempotent `() => void` unsubscribe.
  - **Field** → `set<X>` / `get<X>` (boolean query → `is<X>`).
  - **Per-frame execution, managed scene** → `render` / `render<Target>` (Command kind) — consumes Resources (Meshes).
  - **Per-frame execution, immediate primitive** → `draw<Primitive>` (Command kind) — consumes raw buffers, not Resources (`frame.drawLines`). The `draw` verb (vs `render`) marks the immediate, unmanaged-input nature.

- **R5 — Input-bundle naming.** `*Descriptor` = the full specification passed to a low-level `create()` for a custom resource (`MaterialDescriptor`, `EffectDescriptor`). `*Options` = a (usually defaulted) config bundle for a factory / command / setup function (`RenderOptions`, `LoopOptions`, …). `*Data` = raw buffer contents, not a config spec (`GeometryData`). Sibling descriptors that share fields extract a common **internal** base type (e.g. the render commands share an internal `RenderPassBase`); the named public types remain the surface.

- **R6 — Sugar-helper when-rule.** Add a `policy.*`-style validated sugar factory **only when** (a) the value has *multiple equally-valid named construction modes* AND (b) raw construction is error-prone. Otherwise expose the plain descriptor/value (the wgpu/sokol posture — they deliberately have no sugar-factory layer). Group sugar in a sub-namespace: `camera.policy.{stretch,preserveHeight,preserveWidth}`, `material.blend.{straightAlpha,premultiplied,additive}`. **Mutability convention:** when the sub-namespace holds immutable data-preset constants (`material.blend.*`), freeze the namespace object (`Object.freeze`) so members can't be reassigned; when it holds factory functions (`camera.policy.*`), a plain object is fine.

- **R7 — Escape-hatch convention.** Escape hatches (raw-WebGPU access, or the manual instrumentation path that bypasses the managed loop/render) are **standalone functions, never folded into a broader interface**, and **documented as escape hatches in their TSDoc** (open the summary with `**Escape hatch.**`). They stay co-located with their managed sibling (e.g. `material.createPipeline` next to `material.create`), so choosing managed-vs-raw is a local decision. There is deliberately **no `raw.*` namespace and no registry** — that marking would be more opinionated than the tier warrants. The current set:
  | Escape hatch | Drops to |
  |---|---|
  | `material.createPipeline` | a raw `GPURenderPipeline` |
  | `frame.encode` | a raw `GPUCommandEncoder` |
  | `gpu.getCurrentTextureView` | the raw swapchain `GPUTextureView` |
  | `stats.recordDraw` | manual draw instrumentation (outside `frame.render`) |
  | `stats.markFrameBoundary` | manual frame instrumentation (outside `frame.loop`) |

- **R8 — Abstraction tier.** (The guiding principle, restated as a rule.) Keep the core a low-level, unopinionated, performance-first GPU-resource layer. New higher-tier conveniences (Scene, ECS, render-graph) live in their own modules built on top, or as triggered backlog entries — never folded into the core vocabulary.

- **R9 — Failure-policy composition.** Each kind has a default failure-policy stance: Factory → cold-path-validate (throw on bad input); per-frame Core-mutator (pose setters) → hot-path-trust (no validation, sentinel on degenerate); config Core-mutator (`setAspect`, `setFitPolicy`) → cold-path-validate; Command (`render*`) → warm-path-validate (throw with positional context); Lifecycle setup → cold-path; observability cross-cuts (no-op + warn on writes, zero defaults on reads). **`engine-conventions.md §Failure policy` is the authority** — this rule maps kind→default stance; it never overrides the stance definitions.

### Supporting rules (surfaced by the conformance sweep)

- **Out-parameter position.** Out-param functions place `out` **first** (the gl-matrix convention — `vec3.add(out, a, b)`, `camera.getPosition(out, cam)`, `camera.projectToScreen(out, cam, …)`) **unless `ctx` is present**, in which case `ctx` is first and `out` is last (`mesh.getPosition(ctx, mesh, out)`). The two rules interact deterministically: ctx-first dominates; otherwise out-first.
- **Async vs sync factories.** A factory is `async` (returns `Promise<T>`) **iff it must await a one-time system init or compile a pipeline/shader** — current async factories: `shader.create`/`load`/`unlit`/`normalColor`, `material.create`, `post.create`, `material.createPipeline` (shader/pipeline compile); `physics.createWorld` (awaits Rapier's one-time wasm init via `ensureRapierInit`, memoized after first call). Pure-data/buffer factories are synchronous (`mesh.create`, `geometry.create`/`cube`/`plane`/`sphere`/`cylinder`, `camera.perspective`/`orthographic`, `physics.createBody`, `frame.fixedClock`).
- **Custom-metric verbs.** `stats.gauge` / `increment` / `measure` follow the statsd/Datadog metric-type vocabulary; they are kept as-is despite `gauge` reading as a noun, because they match the convention practitioners already know.
- **Generic vs concrete subscription.** A concrete event subscription is `on<Event>` (`gpu.onResize`, `input.onKeyDown`, …). The generic `Emitter.on` building block — which the concrete subscriptions delegate to — keeps the bare `on`.

## Classification of the current surface

Every `@furnace/core` public export, by kind. (Function-kind verbs in **bold** the first time.)

| Kind | Members |
|---|---|
| **Resource** | `Mesh`, `Material<L>` (phantom `L` carries the binding layout; defaults wide), `Geometry`, `Effect<L>` (phantom `L`, same as `Material<L>`), `Shader<L>`, `Binding<L>`, `RigidMesh` (the `@furnace/core/rigid-mesh` composite — owns a `Body` + a `Mesh`); `Texture` (opaque `uint48` handle into the per-ctx textures pool; owns a `GPUTexture` + its view); the re-exported `*Handle` aliases (`MeshHandle`, `MaterialHandle`, `GeometryHandle`, `EffectHandle`, `ShaderHandle`, `BindingHandle`), `AnyResourceHandle`, `ResourceKind`; `World` (= `PhysicsWorldHandle`), `Body` (= `PhysicsBodyHandle`) — opaque `uint48` handles; `World` owns a physics simulation, `Body` a rigid-body slot within one |
| **Value-type** | `Camera`, `Context`; the `transform` types (`Vec2`/`Vec3`/`Vec4`/`Quat`/`Mat3`/`Mat4`) + `CameraMatrices`; `FitPolicy`/`Anchor`/`OrthographicBounds`/`ScreenProjection`; event records (`FrameInfo`/`ResizeEvent`/`KeyEvent`/`PointerEvent`/`WheelEvent`/`PointerSnapshot`); `Snapshot`/`Measurement`/`Path`/`PathValue`; `LogLevel`/`LogEntry`/`LogSink` + `consoleSink`; `FrameLoopHandle`/`Emitter`; the error classes (`FurnaceError`/`FurnaceGpuError`/`FurnaceInputError`); `KeyCode`/`PointerButton`/`PointerType`; `CollisionEvent` (contact begin/end record drained after a `step` — `{ a: Body; b: Body; started: boolean }`); `FixedClock` (the `fixedClock` accumulator object — methods, no lifecycle, like `FrameLoopHandle`/`Emitter`); `DebugLines` (`{ vertices: Float32Array; colors: Float32Array }` — collider wireframe line data, transient, from `physics.getDebugLines`); `SamplerParams` (sampler config — all fields optional; no public `Sampler` handle, engine-cached and deduped per descriptor — see the no-public-Sampler-handle decision in this table); `ProceduralResult` (`{ data: Uint8Array; width: number; height: number }` — pure pixel data, feed to `texture.create`) |
| **Descriptor** | `MaterialDescriptor<L>` (gains `binding?: Binding<L>` — the typed `@group(1)` data path; raw `bindings?` retained for advanced use; gains `texture?: { texture: Texture; sampler?: SamplerParams }` — the `@group(1)` texture path, mutually exclusive with `binding`/`bindings`), `EffectDescriptor<L>` (`shader: Shader<L>` + the same typed `binding?: Binding<L>` / raw `bindings?` `@group(1)` paths as material) (create-specs); `RequestContextOptions`/`LoopOptions`/`RenderOptions`/`RenderToTextureOptions`/`PerspectiveOptions`/`OrthographicOptions`/`DrawLinesOptions` (config); `GeometryData` (raw data); `TextureDescriptor` (discriminated union — `{ data, width, height, colorSpace?, mipmaps? }` or `{ source: ImageBitmap, colorSpace?, mipmaps? }` — passed to `texture.create`); `RigidMeshDescriptor` (`{ body: BodyDescriptor; mesh: { geometry, material } }` — the `rigidMesh.create` create-spec); `WorldDescriptor` (`{ gravity: Vec3Tuple; lengthUnit?: number }` — `physics.createWorld` create-spec); `BodyDescriptor` (type/shape/position/rotation/velocities/density + the four pass-through material scalars `friction`/`restitution`/`linearDamping`/`angularDamping` — `physics.createBody` create-spec); `ShapeDescriptor` (`{ ball: number } | { cuboid: Vec3Tuple } | { cylinder: { halfHeight: number; radius: number } }` — collider shape used inside `BodyDescriptor`). Note: `Shader` has no public descriptor — the source string is passed directly to `shader.create`/`load`. |
| **Factory** | `gpu.requestContext`; `shader.create`/`load` (async — compile from WGSL source / fetch + compile; accept optional `opts?: ShaderCreateOpts<L>` to declare the `@group(1)` layout schema, still classified Factory) / `shader.unlit`/`shader.lit`/`shader.normalColor`/`shader.textured`/`shader.texturedLit` (async — engine-owned built-in shaders, shared per ctx; `textured`/`texturedLit` carry `textureBinding: true` instead of a uniform layout) / `shader._layoutOf` (internal accessor, see `@furnace/core/shader` Internal table in `core-modules.md`); `binding.create` (sync — allocates a `GPUBuffer` + CPU scratch from a shader or explicit layout; see `@furnace/core/binding`); `texture.create` (async — uploads rgba8 data or `ImageBitmap` as a GPU texture; setup-loud) / `texture.load` (async — fetch → decode → `create`; setup-loud); `texture.checkerboard` / `texture.uvGrid` (sync, **pure** — generate rgba8 pixel buffers, no GPU involvement; classified Factory because they produce the data bundle that feeds `texture.create`); `material.create`; `mesh.create`; `geometry.create`/`cube`/`plane`/`sphere`/`cylinder`; `post.create`; `camera.perspective`/`orthographic`; `rigidMesh.create` (sync — builds + owns a `Body` + a `Mesh`, seeds the interpolation buffers); `events.createEmitter`; `stats.snapshot`/`startMeasurement`; `physics.createWorld` (async — awaits Rapier wasm init, then allocates backend world; cold-path throws on non-finite gravity); `physics.createBody` (sync — allocates body + collider in an existing world; cold-path throws on bad descriptor or stale world handle); `frame.fixedClock` (sync — ctx-less fixed-step accumulator; cold-path throws on non-positive `fixedDtMs` / non-integer `maxCatchupTicks`) |
| **Core-mutator** | `mesh.set{Position,Rotation,Scale,Material}` / `get{Position,Rotation,Scale}`; `camera.set{Position,Target,Up,Aspect,NearFar,Fov,FitPolicy,Scale}` / `get{Position,Target,Up,Bounds,Matrices}` / `updateForSize` / `projectToScreen`; all `transform.*` ops; `stats.gauge`/`increment`/`get`; `log.setSink`; the `is*` reads (`gpu.isDisposed`, `input.isAttached`/`isKeyDown`/`isPointerButtonDown`); the per-frame edge reads `input.wasKeyPressed`/`wasKeyReleased`/`wasPointerButtonPressed`/`wasPointerButtonReleased` (siblings of the `is*` level reads; cleared by `frame.loop` — the acyclic `frame → input` per-frame coupling); `binding.set`/`binding.setUniform` (batch/single-field CPU scratch writes — lazy, flushed at render boundary); `rigidMesh.commit`/`interpolate` (per-frame hot-path mutators — snapshot the body pose / write the blended pose to the mesh) + `getBody`/`getMesh` (hot-path reads, invalid-sentinel on stale); `physics.step` (hot-path — advances the backend world by `dtSeconds`; silent no-op on stale world); `physics.drainCollisions` (hot-path read — returns `[]` on stale world or no collisions); `physics.getBodyTranslation`/`physics.getBodyRotation` (hot-path out-param reads — `out` unchanged on stale body; `ctx` first, `out` last per the out-param rule); `physics.setBodyLinearVelocity` (the first body **setter** — mirrors the two getters; hot-path pass-through to Rapier `setLinvel`; runtime-quiet — log-warns + skips on non-finite `v`, silent no-op on stale body; `ctx` first per the convention); `frame.fixedClock`'s `advance` (hot-path — runs `onTick` 0..N, returns `alpha`) / `setFixedDtMs` (cold-path — runtime dt change); `physics.getDebugLines` (hot-path read — pass-through to Rapier `debugRender`; empty buffers on stale world) |
| **Command** | `frame.render`, `frame.renderToTexture`, `frame.drawLines` |
| **Sugar-helper** | `camera.policy.{stretch,preserveHeight,preserveWidth}`; `material.blend.{straightAlpha,premultiplied,additive}` |
| **Escape-hatch** | `material.createPipeline`; `frame.encode`; `gpu.getCurrentTextureView`; `stats.recordDraw`; `stats.markFrameBoundary` (see R7 table) |
| **Lifecycle-op** | `gpu.dispose`; `resources.disposeAll`; `shader.destroy`; `binding.destroy`; `mesh.destroy`; `geometry.destroy`; `material.destroy`; `post.destroy`; `texture.destroy`; `rigidMesh.destroy` (cascades to the owned body + mesh); `input.attach`/`detach`; `frame.loop` (+ `stop`/`pause`/`resume`); all `on*` subscriptions (`gpu.onResize`/`onDeviceLost`/`onUncapturedError`, `input.on*`, `stats.onFrame`); `camera.bindToCanvas`; `Emitter.on`/`clear`; `Measurement.end`; `physics.destroyWorld` (cascades — destroys every owned body + frees backend world; idempotent silent no-op on stale handle); `physics.destroyBody` (removes body from backend simulation + frees slot; idempotent silent no-op on stale handle) |

### No-public-Sampler-handle decision

`SamplerParams` is a **Value-type** (a plain options object), not a resource handle. There is intentionally no public `Sampler` handle in the current API. The rationale:

WebGPU hardware limits `maxSamplersPerShaderStage` to 16 (typically). With multiple textured materials on screen, a naïve consumer model where each `SamplerParams` usage allocates a new `GPUSampler` would exhaust the limit quickly and produce GPU validation errors. The engine-cached sampler dedup (`_getSampler` in `texture/sampler-cache.ts`) is therefore **a correctness mechanism**, not just an ergonomic one — it ensures that two materials using identical sampler configs share one `GPUSampler` slot.

An explicit public `Sampler` handle (analogous to `Texture`) is the correct expert escape hatch for consumers who need precise sampler lifetime control or want to share a sampler across materials they author. That handle is deferred — add it when there is a confirmed consumer trigger (a multi-texture consumer needing explicit sampler budget management). Until then, `SamplerParams` + the cache is the correct path and is documented as such.

## References

- `docs/research/api-posture-prior-art.md` — the six-engine prior-art survey + comparison table this posture is grounded in.
- `engine-conventions.md` §Failure policy — the authority on the four performance stances R9 maps kinds onto.
- `core-modules.md` — the full signature-level inventory of the surface classified above.
