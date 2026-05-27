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

## Disposal

Explicit destroy model.

`gpu.dispose(ctx)`:
- Calls `device.destroy()` (WebGPU frees GPU memory).
- Clears internal bookkeeping (caches, registries, emitters). Engine modules with ctx-bound lazy allocations (`frame.render`'s depth texture and per-camera uniform buffers, `post`'s scene intermediates) self-register their teardown internally — the consumer destroy contract for owned resources (meshes, materials, geometries, effects) is unchanged.
- Subsequent calls taking the disposed ctx throw "context disposed".
- `module.destroy(handle)` on handles tied to a disposed ctx is a no-op (safe to call).
- Idempotent: calling `dispose` twice is safe.

Consumer-facing resources (meshes, textures, buffers) have `module.destroy(handle)`. Pipelines / bind-group-layouts are internal — cached by the engine; never destroyed by the consumer.

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
- **Lifetime**: explicit destroy. `mesh.destroy`, `mesh.destroyGeometry`, `material.destroy`. Pipelines are refcounted internally and freed when the last material referencing them is destroyed. Custom material's group-1 bind-group resources (buffers, textures the consumer passed in `MaterialDescriptor.bindings`) are consumer-owned — destroy them yourself after `material.destroy`.

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

The engine follows one rule for GPU resource lifetime:

> **Pass a GPU handle in, or get one back, → you own it.**

- A constructor that returns a handle (`createGeometry`, `material.create`, `mesh.create`, etc.) hands ownership to the caller. The caller calls the corresponding `destroy*` on teardown.
- A constructor that takes a handle in its descriptor (`mesh.create(ctx, { geometry, material })`) does **not** take ownership — the caller still owns the handle they passed in.
- A factory that takes only configuration values (no handles) and returns a handle (`material.unlit(ctx, { color })`) keeps its internal allocations private. They are freed by the corresponding `destroy*`. The caller never receives a separately-disposable handle to those internals.

There is no "managed mesh" or "factory-owned" middle category. The engine surface either gives you handles you own, or it returns opaque results whose internals you can't reach.

### Mapping per public API

| API | Inputs | Returns | Caller owns | Engine owns (private) |
|---|---|---|---|---|
| `createGeometry(ctx, data)` | typed-array values | `Geometry` | the Geometry | — |
| `cubeGeometry(ctx, opts?)` | size value | `Geometry` | the Geometry | — |
| `planeGeometry(ctx, opts?)` | size value | `Geometry` | the Geometry | — |
| `mesh.create(ctx, { geometry, material })` | two handles | `Mesh` | Mesh + the passed geometry + the passed material | mesh's object buffer |
| `material.create(ctx, { vertex, fragment, bindings })` | strings + buffer handles | `Material` | Material + each binding buffer | pipeline (refcounted) |
| `material.unlit(ctx, { color })` | vec4 value | `Material` | the Material | pipeline + color uniform buffer |
| `material.normalColor(ctx, opts?)` | options | `Material` | the Material | pipeline |
| `post.create(ctx, { shader, bindings? })` | string + optional handles | `Effect` | Effect + each binding buffer | pipeline + intermediate textures |

### Sharing

To share one geometry across multiple meshes, allocate it via the explicit flow (`cubeGeometry` / `planeGeometry` / `createGeometry`) and pass the handle into every `mesh.create` that should bind it. You destroy it ONCE on teardown, after all dependent meshes are destroyed. See `packages/cookbook/src/demos/custom-stats/entry.ts` for a worked example (one geometry, N cubes).

### Historical note

Earlier engine versions exposed `mesh.cube` and `mesh.plane` convenience factories that returned a `Mesh` with an internally-allocated geometry. They violated the rule above — the geometry was *publicly visible* on `mesh.geometry` but `mesh.destroy` did not free it, leaking 3 GPU resources per mesh on dispose. Removed in Tranche B-1 (2026-05-27). To get the same shape today, allocate the geometry explicitly: `mesh.create(ctx, { geometry: mesh.cubeGeometry(ctx), material })`.

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
