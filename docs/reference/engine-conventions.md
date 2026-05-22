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
- For now, hello-world / consumer code manages the camera's uniform buffer and bind group manually. Tranche 4's `frame.render` will hide this plumbing.

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

## References

- Master architecture spec: `docs/superpowers/specs/2026-05-21-core-architecture-design.md` (gitignored — local design history)
- Tranche 1 implementation spec: `docs/superpowers/specs/2026-05-22-core-tranche-1-gpu-foundation-design.md` (gitignored)
- Engine architecture exploration notes: `docs/reference/engine-architecture.md`
- Packaging and distribution: `docs/reference/packaging-and-distribution.md`
