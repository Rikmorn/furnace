# Engine conventions

This document captures the engine-wide conventions that every module of `@furnace/core` follows. These are committed; deviation requires a deliberate breaking-change decision.

## Coordinate system

Right-handed, Y-up world space. WebGPU NDC: +X right, +Y up, Z ∈ [0, 1].
Rotation: counter-clockwise when viewed from the positive axis (standard right-handed).
Matrix layout: column-major (matches WebGPU uniform expectations).

## Color space

Surface format: sRGB by default (`bgra8unorm-srgb` or `rgba8unorm-srgb`). Shaders write linear color values; the GPU applies sRGB encoding on output.

Texture color-space convention: `textures.load(ctx, url, { colorSpace: "srgb" | "linear" })`. Albedo/diffuse images are sRGB (default). Data textures (normal maps, masks, depth) are linear.

Override the surface format via `gpu.requestContext(canvas, { surfaceFormat: "linear" })` for HDR or custom pipelines.

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
- Clears internal bookkeeping (caches, registries, emitters).
- Subsequent calls taking the disposed ctx throw "context disposed".
- `module.destroy(handle)` on handles tied to a disposed ctx is a no-op (safe to call).
- Idempotent: calling `dispose` twice is safe.

Consumer-facing resources (meshes, textures, buffers) have `module.destroy(handle)`. Pipelines / bind-group-layouts are internal — cached by the engine; never destroyed by the consumer.

## Cameras

`@furnace/core/camera` provides perspective and orthographic projection helpers. Cameras are pure data with cached matrices — no GPU resources owned.

- Pose is expressed via `position` / `target` / `up` (lookAt-style). Quaternion-driven cameras are not provided.
- Setters mutate in place and flip internal dirty bits. `getMatrices(cam)` recomputes only dirty matrices and returns the same frozen wrapper across calls (the inner `Float32Array` references are stable; the engine writes into them in place).
- Aspect ratio is consumer-managed: subscribe to `gpu.onResize` and call `camera.setAspect(cam, width / height)`. The engine's "size truth" is the backing-store dimensions, not the CSS dimensions.
- The camera's uniform buffer is engine-managed inside `frame.render` (allocated lazily, written each frame from `getMatrices`). The Camera handle itself remains data-only — no GPU resources owned.

## Drawables

`@furnace/core/mesh` and `@furnace/core/material` define the engine's drawable model: a Mesh is a Geometry + a Material + a Transform.

- **Geometry** (raw GPU resource): vertex buffer + optional index buffer + fixed vertex layout. Created via `mesh.createGeometry(ctx, { positions, normals, uvs, indices? })` for custom data, or via built-in factories `mesh.cubeGeometry` / `mesh.planeGeometry`. Geometries are shareable — one Geometry can back many Meshes with different materials and transforms.
- **Material** (shader + pipeline + group-1 bind group): `material.create(ctx, descriptor)` accepts custom WGSL respecting the engine's binding contract (§Binding contract). Built-in factories `material.unlit({ color })` and `material.normalColor()` are thin wrappers over `create` with engine-bundled WGSL. The mechanical-tier `material.createPipeline` is the documented escape hatch for raw WebGPU pipelines.
- **Mesh** (drawable): `mesh.create(ctx, { geometry, material })` combines a Geometry + a Material + an identity transform. Convenience factories `mesh.cube` / `mesh.plane` are the single-call shortcut for the common case.
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

Failure policy: setup operations (`stats.onFrame`) throw on disposed ctx; runtime reads return zero/null defaults; runtime writes silently no-op on disposed and `console.warn` on bad inputs. Functions wrapping consumer code (`stats.measure`) record what they can and re-throw consumer errors.

Full spec: `docs/superpowers/specs/2026-05-24-core-tranche-5-stats-expansion-design.md`.

Failure semantics follow the framework in § Failure policy.

## Failure policy

Engine modules choose between two failure stances based on whether they're foreground
(consumer expects to see the result) or background (observation/instrumentation that
should stay out of the way).

**Foreground modules** (rendering, post, input, mesh, material):
- Setup ops throw on disposed ctx or bad config.
- Runtime ops throw on synchronously-detectable consumer errors (ctx mismatch,
  use-after-free, invalid handle).
- GPU-layer failures we can't catch synchronously fall through to
  `device.uncapturederror`, which is surfaced via stats.

**Background modules** (stats, future logging):
- Setup ops throw on disposed ctx (subscribing to a dead ctx is a bug).
- Runtime reads return zero/null defaults silently on disposed ctx.
- Runtime writes silently no-op on disposed ctx; log-warn on bad inputs.
- Subscriber callbacks throwing are caught + logged; iteration continues.

The distinction is intent: foreground silence is worse than a crash
(broken-looking-deliberate); background loudness corrupts the observed system.
Pick the policy that matches the module's role.

Tranche 5 (stats) is the reference background example. Tranche 6 (post) is the
reference foreground example.

## References

- Master architecture spec: `docs/superpowers/specs/2026-05-21-core-architecture-design.md` (gitignored — local design history)
- Tranche 1 implementation spec: `docs/superpowers/specs/2026-05-22-core-tranche-1-gpu-foundation-design.md` (gitignored)
- Engine architecture exploration notes: `docs/reference/engine-architecture.md`
- Packaging and distribution: `docs/reference/packaging-and-distribution.md`
