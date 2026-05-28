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

## Device pixel ratio

Default behavior: render at native device resolution (sharp on high-DPI displays). Canvas backing-store size set to `clientWidth * devicePixelRatio × clientHeight * devicePixelRatio`.

Override via `gpu.requestContext(canvas, { pixelRatio: "device" | "css" | number })`.

`gpu.onResize` fires with `{ cssWidth, cssHeight, width, height, pixelRatio }`. The engine's "size truth" for cameras and viewports is the backing-store dimensions.

## Time

Two frame loops:
- `frame.loop(ctx, fn)` — variable timestep RAF wrapper. Use for visual demos with no determinism requirements.
- `frame.fixedLoop(ctx, opts)` — Fix-Your-Timestep accumulator. Use for simulation, physics, networking, replay — anywhere determinism matters.

Both:
- Cap `deltaMs` to a configurable maximum (default 100 ms) to prevent jumps after sleep or visibility changes.
- Auto-pause when the document becomes hidden (Page Visibility API). Configurable via `{ pauseOnHidden: false }`.
- Return a `FrameLoopHandle` with `{ stop, pause, resume }`.

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
- **Resource queries** (`resources.summary`, `resources.list`): destroyed handles never appear in live iteration.

### Idempotent destroy

`module.destroy(ctx, handle)` is silent + idempotent on a stale or destroyed handle (lookup returns null → early return without effect). This matches the WebGPU spec (`GPUBuffer.destroy()` is valid to call multiple times), C#'s `IDisposable`, Java `Closeable`, PixiJS, and TC39 `Symbol.dispose`. All four resource modules (`mesh`, `material`, `mesh.destroyGeometry`, `post`) follow this contract.

### Internal refcount for sharing

`Geometry` and `Material` slots carry an internal `userCount` field. `mesh.create({ geometry, material })` validates BOTH lookups, then increments both counts. `mesh.destroy` decrements both, and if either dependency was marked-destroyed (`destroyGeometry` / `material.destroy` called while a mesh still referenced it) and the refcount hits zero, that dependency's actual GPU teardown runs as part of `mesh.destroy`.

Order-matters footgun is eliminated. Consumers can destroy in any order; the refcount enforces correctness.

The refcount is engine-private. Consumers cannot inspect it; the engine cannot expose it as public API without leaking the manager's internal shape.

### Auto-cleanup on dispose

`gpu.dispose(ctx)` walks every pool in fixed order (meshes → effects → materials → geometries) and runs each live slot's teardown. After the cascade, a single informational warn summarises the cleanup: `"auto-cleaned N live handles on dispose; explicit destroy is an optimization, not a requirement"` — where N is the count of slots the cascade directly freed. Refcount-cascaded slots (slots freed implicitly when a mesh teardown decrements a marked-destroyed geometry/material to zero) are correctly **excluded** from N: they reflect user-requested destroys (`material.destroy(ctx, m)` was called; the actual GPU free was just deferred until the last referencing mesh went away), not engine-rescued leaks. The warn counts what the cascade had to clean up because the user didn't.

Consumer discipline becomes an *optimization* (free early to reduce in-context memory pressure), not a *requirement*.

The pre-manager leak-warn (`stats.resources.entries.size > 0` → "context disposed with resources still registered — leak suspected") is preserved alongside the cascade warn. After Stage 1, all four resource modules are pooled and the cascade auto-unregisters their stats entries, so the leak-warn's count is typically zero. It remains as a safety net for any future non-pooled resource kind.

### Dispose order

`gpu.dispose(ctx)` runs two cascades in fixed order:

1. **`_runDisposeCascade(ctx)` (engine-private cleanup)** — runs first. Tears down engine-private resources that are stats-tracked but NOT pool-tracked: depth texture, per-camera uniform buffers, post intermediates. Each tracks its own stats handle independently of the resource manager.

2. **`disposeAllResources(ctx)` (pool cascade)** — runs second. Walks every live slot in every pool in the cascade order (meshes → effects → materials → geometries) and runs each slot's `_teardown`. Slot teardowns internally call `_unregisterResource` for each stats handle the slot was tracking.

The ordering is load-bearing. Engine-private resources are stats-tracked; running them first means their decrements compose correctly with the pool cascade's subsequent decrements. The pool cascade depends on slot teardowns running their `_unregisterResource` calls successfully — those calls are no-ops if the corresponding stats handle was already cleaned up earlier, but they MUST run in the right order to keep stats's `entries.size` consistent with the cascade's view.

After both cascades complete, `gpu.dispose` runs a final `stats.resources.entries.size > 0` check. In well-behaved teardown this is always zero (both cascades ran cleanly). The check remains as a safety net for any future non-pooled resource kind whose stats handles weren't decremented during either cascade.

### Cross-cutting introspection

`@furnace/core/resources` exposes:

- `summary(ctx) → ResourceSummary` — counts per kind. O(N) over each pool's slot table; suitable for debug overlays, not per-frame gameplay.
- `list<H>(ctx, kind) → IterableIterator<H>` — iterate live handles of the given kind. Caller narrows `H` to one of the branded handle types.
- `snapshot(ctx) → ResourceSnapshot` — structured dump (per-kind handle arrays). Intended for dev tools and post-mortem dumps.
- `disposeAll(ctx) → void` — explicit cascade trigger; identical to what `gpu.dispose(ctx)` does internally. Use when freeing handles ahead of a context transition without dropping the `GPUDevice`.

Branded handle types (`MeshHandle`, `MaterialHandle`, `GeometryHandle`, `EffectHandle`, `AnyResourceHandle`) and the `ResourceKind` discriminator are re-exported from this module for type-level use.

`AnyResourceHandle` (the union) is named to disambiguate from `stats.ResourceHandle` (the engine-internal stats opaque token — a `Readonly<{ kind; bytes? }>`). The two have different shapes and live in different modules; the naming makes the disambiguation explicit.

### Stats relationship

Two parallel registries track allocations today: the resource manager's per-kind pools, and the stats module's `_registerResource` / `_unregisterResource` calls. Each resource module's create function calls BOTH; each slot's teardown decrements BOTH.

This is intentional **transitional state**, not a bug. The manager tracks slot identity, refcount, and lifecycle (what is in scope to destroy?). Stats tracks memory bytes, leak counts, and cumulative resource-type counters for the FPS overlay (what is using how much?). They overlap in what they register but not in what they track.

The forward direction is event-driven loose coupling: the manager emits resource-lifecycle events, stats subscribes, and resource modules stop calling stats directly for pool-tracked kinds. See `docs/backlog/engine-architecture/resource-manager-stats-events-integration.md` (RM-4) for the design.

Until RM-4 lands, every resource module imports `_registerResource` / `_unregisterResource` from `stats/internal.ts` and the slot teardown closures invoke them. This is documented surface; readers seeing the dual-tracking pattern in source should not interpret it as a bug.

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
- Projection-shape updates are split by kind. Perspective cameras carry an aspect ratio updated via `camera.setAspect`; orthographic cameras carry a `fitPolicy` updated via `camera.setFitPolicy` (see §Camera resize policy below). Both kinds are accepted by `camera.bindToCanvas(cam, ctx)`, the one-line helper that subscribes to `gpu.onResize` and runs `updateForSize` on every event. The returned function unsubscribes — call it in dispose. The manual pattern (`gpu.onResize` + `camera.updateForSize`) remains available for consumers needing finer control (multi-camera coordination, custom dispatch, conditional updates).
- The camera's uniform buffer is engine-managed inside `frame.render` (allocated lazily, written each frame from `getMatrices`). The Camera handle itself remains data-only — no GPU resources owned.

### Camera resize policy

Orthographic cameras opt into engine-managed bounds via a `fitPolicy` field.
The policy determines how bounds respond to canvas resize; the consumer wires
it via `camera.bindToCanvas(cam, ctx)`, which subscribes to `gpu.onResize`
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

`@furnace/core/mesh` and `@furnace/core/material` define the engine's drawable model: a Mesh is a Geometry + a Material + a Transform.

- **Geometry** (raw GPU resource): vertex buffer + optional index buffer + fixed vertex layout. Created via `mesh.createGeometry(ctx, { positions, normals, uvs, indices? })` for custom data, or via built-in factories `mesh.cubeGeometry` / `mesh.planeGeometry`. Geometries are shareable — one Geometry can back many Meshes with different materials and transforms.
- **Material** (shader + pipeline + group-1 bind group): `material.create(ctx, descriptor)` accepts custom WGSL respecting the engine's binding contract (§Binding contract). Built-in factories `material.unlit({ color })` and `material.normalColor()` are thin wrappers over `create` with engine-bundled WGSL. The mechanical-tier `material.createPipeline` is the documented escape hatch for raw WebGPU pipelines.
- **Mesh** (drawable): `mesh.create(ctx, { geometry, material })` combines a Geometry + a Material + an identity transform. The caller allocates the geometry (via `mesh.cubeGeometry` / `mesh.planeGeometry` / `mesh.createGeometry`) and the material (via `material.unlit` / `material.normalColor` / `material.create`) and passes them in — see §Resource ownership.
- **Transform**: mutated via setters — `mesh.setPosition`, `setRotation`, `setScale`. Setters flip an internal dirty flag; the engine recomputes the model matrix and writes the per-object uniform buffer lazily in `frame.render`. Initial transform is identity.
- **Lifetime**: explicit destroy — `mesh.destroy(ctx, m)`, `mesh.destroyGeometry(ctx, g)`, `material.destroy(ctx, m)`, and (for post-effects) `post.destroy(ctx, e)`. All four are silent on stale or already-destroyed handles (idempotent — the per-ctx handle pool's generation counter is the liveness source of truth). Geometry and Material both refcount inbound Mesh references: calling `destroy*` on a still-referenced handle defers the actual GPU teardown until the last referencing mesh is destroyed. Pipelines are refcounted internally in a per-ctx cache (separate cache per consumer-facing kind: material pipelines vs post-effect pipelines) and freed when the last material/effect referencing them is destroyed. Custom material's group-1 bind-group resources and post-effect `EffectDescriptor.bindings` resources are consumer-owned — destroy them yourself after `material.destroy` / `post.destroy`.

## Binding contract

Every Material's WGSL must respect the engine's binding contract:

| Slot | Type | Owner | Written by |
|---|---|---|---|
| `@group(0) @binding(0)` | `Camera { viewProjection: mat4x4<f32> }` | engine | `frame.render` (once per frame, from `camera.getMatrices`) |
| `@group(0) @binding(1)` | `Object { model: mat4x4<f32> }` | engine | `frame.render` (per mesh, when transform is dirty) |
| `@group(1) @binding(N)` | consumer-defined | material | `MaterialDescriptor.bindings` |

**Vertex format** (every vertex buffer carries this interleaved layout):
- `@location(0)`: position, `vec3<f32>`, offset 0
- `@location(1)`: normal, `vec3<f32>`, offset 12
- `@location(2)`: uv, `vec2<f32>`, offset 24
- `arrayStride: 32` bytes

**Stability:** additive changes (a new group-0 binding 2, 3, … in a future tranche) are non-breaking. Changes that rename or repurpose binding 0 or binding 1 break every shader respecting the contract — including the SDF triangle in hello-world. With one consumer today, a contract change is a single-shader migration.

**Defaults** for `material.create`:
- `cullMode: "back"` — back-face culling on by default. Override to `"none"` for covering triangles or two-sided geometry.
- `topology: "triangle-list"`
- `depthWrite: true`, `depthCompare: "less"` — depth testing on; near-pixel wins.

**Depth buffer:** the engine owns one `depth24plus` texture per context, resized when the canvas backing-store size changes. `frame.render` always uses it; no consumer-visible API.

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
- **Snapshot vs event**: `isKeyDown(code)` / `isPointerButtonDown(btn)` /
  `getPointer()` return the current held state. Discrete press/release edges
  live on `onKeyDown` / `onKeyUp` / `onPointerDown` / `onPointerUp` — consumers
  needing "was pressed this frame" helpers maintain their own latched flags
  (deferred per `docs/backlog/engine-architecture/input-edge-snapshot-helpers.md`).
- **Stuck-key behavior**: on `window` blur the engine clears `keysDown` and
  pointer button state. `onKeyUp` events are *not* synthesized for the cleared
  keys; consumers requiring symmetric event streams subscribe to a future
  `onBlur` (backlog: `input-stuck-key-recovery.md`).
- **Default browser behaviors are not suppressed**: arrows scroll, right-click
  opens the context menu, Cmd+S opens save. Hello-world's full-viewport canvas
  is unaffected; embedded consumers need the future config option tracked in
  `input-prevent-default-config.md`.

## Instrumentation

`@furnace/core/stats` is the single source of truth for engine-wide metrics. Other modules in core call underscore-prefixed `stats._*` hooks (`_frameStart`, `_recordDraw`, `_registerResource`, `_recordEmission`, etc.) to feed snapshots. This is the one documented exception to the no-cross-module-imports rule (master spec § 3).

Consumers observe via `stats.snapshot(ctx)`, `stats.onFrame(ctx, fn)`, or `stats.get(ctx, path)` (type-safe dotted-path). Custom metrics via `stats.gauge`, `stats.increment`, `stats.measure`.

Stance: observability per §Failure policy. Setup ops (`stats.onFrame`) throw on disposed ctx; runtime reads return zero/null defaults silently on disposed; runtime writes silently no-op on disposed and emit a `warn`-level log entry on bad inputs (routed via `@furnace/core/log`). Functions wrapping consumer code (`stats.measure`) record what they can and re-throw consumer errors.

Full spec: `docs/superpowers/specs/2026-05-24-core-tranche-5-stats-expansion-design.md`.

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
`mesh.create`/`createGeometry`,
`post.create`,
`frame.loop`/`fixedLoop` constructors,
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

## Resource ownership

Superseded by §Resource manager (2026-05-28). The manager is the single source of truth for resource lifecycle; "who owns what" reduces to "the manager owns every consumer-facing slot; the consumer holds opaque handles." Built-in factories (e.g. `material.unlit`'s color uniform buffer) attach their owned buffers to the slot's `ownedBuffers` array, so factory-allocated internals are freed alongside the public handle.

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

- Master architecture spec: `docs/superpowers/specs/2026-05-21-core-architecture-design.md` (gitignored — local design history)
- Tranche 1 implementation spec: `docs/superpowers/specs/2026-05-22-core-tranche-1-gpu-foundation-design.md` (gitignored)
- Engine architecture exploration notes: `docs/reference/engine-architecture.md`
- Packaging and distribution: `docs/reference/packaging-and-distribution.md`
