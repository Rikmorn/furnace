# API posture & concept taxonomy

This document is the canonical set of rules for **what kinds of concept `@furnace/core` exposes to consumers, and how they are named and shaped.** Its purpose is so contributors adding new surface don't re-derive these decisions each time.

It is the companion to two siblings:
- `engine-conventions.md` — *behavioural* contracts (coords, color, DPR, lifecycle, **failure policy**). That document's §Failure policy remains the **authority** on the four performance stances; this document maps each concept kind to a *default* stance, it does not override them.
- `core-modules.md` — the module-by-module *inventory* of public exports.

The evidence behind these rules — a six-engine survey (bevy, raylib, three.js, PixiJS, wgpu, sokol-gfx) — is in `docs/research/api-posture-prior-art.md`.

## Guiding principle — the abstraction tier

> **`@furnace/core` is a low-level, handle-based GPU-resource layer** (the sokol-gfx / wgpu tier). The bias is **performance, generality, and unopinionated primitives + piping.**

Three consequences that pre-answer recurring questions:

1. **Higher abstractions build *on top*, not *into*.** Scene graphs, ECS, retained render lists, render graphs — these are higher-tier conveniences. They belong in their own modules layered over the core surface; they do **not** alter the low-level vocabulary. A proposed new concept that is a higher-tier convenience goes to its own module (or a triggered backlog entry), never folded into the core resource/value vocabulary.
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
  - **Construct** → `create` (the module's primary resource) / `create<Noun>` (a module constructing multiple kinds) / a domain-shape ctor (`camera.perspective`, `geometry.cube`, `material.unlit`) / a platform-mirror (`gpu.requestContext` ← WebGPU's `request*`).
  - **Single-resource teardown** → `destroy`.
  - **Root/aggregate teardown** → `dispose` (`gpu.dispose`, `resources.disposeAll`) — for the context root or a whole-pool cascade, *not* a single resource.
  - **DOM coupling** → `attach` / `detach` (`input.*`).
  - **Loop** → `loop` / `fixedLoop`, returning a handle with `stop` / `pause` / `resume`. (`loop` = variable timestep; `fixedLoop` = fixed timestep — the unqualified-default + `fixed`-qualified pairing mirrors Unity's `Update`/`FixedUpdate`.)
  - **Subscription** → `on<Event>(…)` returning an idempotent `() => void` unsubscribe.
  - **Field** → `set<X>` / `get<X>` (boolean query → `is<X>`).
  - **Per-frame execution** → `render` / `render<Target>` (Command kind).

- **R5 — Input-bundle naming.** `*Descriptor` = the full specification passed to a low-level `create()` for a custom resource (`MaterialDescriptor`, `EffectDescriptor`). `*Options` = a (usually defaulted) config bundle for a factory / command / setup function (`UnlitOptions`, `RenderOptions`, `LoopOptions`, …). `*Data` = raw buffer contents, not a config spec (`GeometryData`). Sibling descriptors that share fields extract a common **internal** base type (e.g. the render commands share an internal `RenderPassBase`); the named public types remain the surface.

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
- **Async vs sync factories.** A factory is `async` (returns `Promise<T>`) **iff it compiles a pipeline or shader** (`shader.create`/`load`/`unlit`/`normalColor`, `material.create`/`unlit`/`normalColor`, `post.create`, `material.createPipeline`). Pure-data/buffer factories are synchronous (`mesh.create`, `geometry.create`/`cube`/`plane`, `camera.perspective`/`orthographic`).
- **Custom-metric verbs.** `stats.gauge` / `increment` / `measure` follow the statsd/Datadog metric-type vocabulary; they are kept as-is despite `gauge` reading as a noun, because they match the convention practitioners already know.
- **Generic vs concrete subscription.** A concrete event subscription is `on<Event>` (`gpu.onResize`, `input.onKeyDown`, …). The generic `Emitter.on` building block — which the concrete subscriptions delegate to — keeps the bare `on`.

## Classification of the current surface

Every `@furnace/core` public export, by kind. (Function-kind verbs in **bold** the first time.)

| Kind | Members |
|---|---|
| **Resource** | `Mesh`, `Material`, `Geometry`, `Effect`, `Shader`; the re-exported `*Handle` aliases (`MeshHandle`, `MaterialHandle`, `GeometryHandle`, `EffectHandle`, `ShaderHandle`), `AnyResourceHandle`, `ResourceKind` |
| **Value-type** | `Camera`, `Context`; the `transform` types (`Vec2`/`Vec3`/`Vec4`/`Quat`/`Mat3`/`Mat4`) + `CameraMatrices`; `FitPolicy`/`Anchor`/`OrthographicBounds`/`ScreenProjection`; event records (`FrameInfo`/`FixedLoopInfo`/`ResizeEvent`/`KeyEvent`/`PointerEvent`/`WheelEvent`/`PointerSnapshot`); `Snapshot`/`Measurement`/`Path`/`PathValue`; `LogLevel`/`LogEntry`/`LogSink` + `consoleSink`; `FrameLoopHandle`/`Emitter`; the error classes (`FurnaceError`/`FurnaceGpuError`/`FurnaceInputError`); `KeyCode`/`PointerButton`/`PointerType` |
| **Descriptor** | `MaterialDescriptor`, `EffectDescriptor` (create-specs); `RequestContextOptions`/`LoopOptions`/`FixedLoopOptions`/`RenderOptions`/`RenderToTextureOptions`/`PerspectiveOptions`/`OrthographicOptions`/`UnlitOptions`/`NormalColorOptions` (config); `GeometryData` (raw data). Note: `Shader` has no public descriptor — the source string is passed directly to `shader.create`/`load`. |
| **Factory** | `gpu.requestContext`; `shader.create`/`load` (async — compile from WGSL source / fetch + compile) / `shader.unlit`/`shader.normalColor` (async — engine-owned built-in shaders, shared per ctx); `material.create`/`unlit`/`normalColor`; `mesh.create`; `geometry.create`/`cube`/`plane`; `post.create`; `camera.perspective`/`orthographic`; `events.createEmitter`; `stats.snapshot`/`startMeasurement` |
| **Core-mutator** | `mesh.set{Position,Rotation,Scale,Material}` / `get{Position,Rotation,Scale}`; `camera.set{Position,Target,Up,Aspect,NearFar,Fov,FitPolicy,Scale}` / `get{Position,Target,Up,Bounds,Matrices}` / `updateForSize` / `projectToScreen`; all `transform.*` ops; `stats.gauge`/`increment`/`get`; `log.setSink`; the `is*` reads (`gpu.isDisposed`, `input.isAttached`/`isKeyDown`/`isPointerButtonDown`) |
| **Command** | `frame.render`, `frame.renderToTexture` |
| **Sugar-helper** | `camera.policy.{stretch,preserveHeight,preserveWidth}`; `material.blend.{straightAlpha,premultiplied,additive}` |
| **Escape-hatch** | `material.createPipeline`; `frame.encode`; `gpu.getCurrentTextureView`; `stats.recordDraw`; `stats.markFrameBoundary` (see R7 table) |
| **Lifecycle-op** | `gpu.dispose`; `resources.disposeAll`; `shader.destroy`; `mesh.destroy`; `geometry.destroy`; `material.destroy`; `post.destroy`; `input.attach`/`detach`; `frame.loop`/`fixedLoop` (+ `stop`/`pause`/`resume`); all `on*` subscriptions (`gpu.onResize`/`onDeviceLost`/`onUncapturedError`, `input.on*`, `stats.onFrame`); `camera.bindToCanvas`; `Emitter.on`/`clear`; `Measurement.end` |

## References

- `docs/research/api-posture-prior-art.md` — the six-engine prior-art survey + comparison table this posture is grounded in.
- `engine-conventions.md` §Failure policy — the authority on the four performance stances R9 maps kinds onto.
- `core-modules.md` — the full signature-level inventory of the surface classified above.
