# UI Foundation

Furnace uses **Svelte 5** for all DOM-based UI, paired with **screen-space projection** for UI that tracks world-space points. In-scene UI that must be occluded per-pixel by 3D geometry is a separate, deferred path. This document covers what to reach for when adding UI to a consumer today.

## Framework

Furnace is committed to Svelte 5 with the runes/signals reactivity model. State lives in `.svelte.ts` modules using `$state`; components read those values directly and re-render reactively. Engine code mutates the state objects — no stores, no event buses for UI plumbing.

Constraints baked into this choice:

- **Client-side mounting only.** Consumers import their root component and call `mount(Component, { target })`. No SSR, no Svelte routing — `bun-plugin-svelte` doesn't support SSR and we don't need it.
- **Runes outside components.** The `.svelte.ts` extension unlocks rune syntax in plain TS files. Use it for shared reactive state.
- **No Svelte stores.** `$state` is the only reactivity primitive in scope.

The reference integration lives in `packages/hello-world/src/overlay/`:

- `FpsOverlay.svelte` — a ~20-line component reading reactive state.
- `state.svelte.ts` — `$state` declaration plus the engine subscription that writes into it.
- `mount.ts` — wraps `mount()` / `unmount()` so the consumer doesn't import Svelte's runtime directly.

`@furnace/core` exposes the engine-side primitive (`stats.onFrame(ctx, fn)`) that the overlay subscribes to — each snapshot carries frame timing, GPU counters, resource counts, and memory totals. The consumer owns the Svelte side.

## Screen-space DOM UI

This is the default. Use it for HUDs, menus, debug overlays, inspectors, control panels — anything that lives in a corner of the screen or floats above the canvas as a 2D layer.

**Pattern:**

1. The consumer's HTML has a `<div id="ui-root">` (or similar) as a sibling of the WebGPU `<canvas>`.
2. A Svelte component is mounted into that div via `mount(Component, { target })`.
3. The component reads from a `$state` object in a `.svelte.ts` module.
4. The engine's RAF loop (or any subsystem) writes to that state at whatever cadence makes sense — typically at sub-frame rates (e.g. 1Hz for an FPS counter) to avoid touching the DOM every frame.

**Invariants worth preserving:**

- **No DOM writes inside the RAF loop.** Drive reactive updates at the rate the user can perceive, not the render rate.
- **`pointer-events: none` on passive overlays.** Otherwise the overlay swallows canvas-bound input.
- **DOM lives as a sibling of the canvas, not a child.** Layering is handled by stacking order + CSS, not by injecting elements into the WebGPU surface.

See `packages/hello-world/src/overlay/` for the end-to-end pattern.

## World-tracked UI (screen-space projection)

For UI anchored to a point in the 3D scene that does NOT need per-pixel occlusion — floating labels, character name tags, info panels, world-anchored HUDs — Furnace will use screen-space projection (Three.js's `CSS2DRenderer` pattern):

1. Each tick, project the world-space anchor through the camera's view + projection matrices.
2. Position a Svelte (DOM) element at the resulting screen coords with CSS `transform: translate(...)`.
3. Scale by the projection's `w`-divide so the element shrinks naturally with distance.
4. Hide elements whose clip-space `w ≤ 0` (behind the camera).

The projection step must run after physics/animation but before render encoding in the same tick — otherwise the DOM lags the 3D content by one frame.

The projection helper ships in `@furnace/core/camera` as `projectToScreen(out, cam, worldPoint, viewportWidth, viewportHeight)`. The cookbook `animation` demo is the first consumer; see `docs/reference/core-modules.md` for the API.

Performance envelope: comfortable up to a few hundred elements per frame. Thousands would force a different approach (instanced GPU-side rendering of the labels themselves).

## In-scene UI (occlusion cases — deferred)

When a UI surface must be occluded per-pixel by 3D geometry — a touchpanel on a wall a character can walk in front of, an in-world screen that should be partially hidden by a foreground prop — DOM-based approaches do not work. CSS3D / `CSS3DRenderer` does not participate in the depth buffer; DOM → live GPU texture is not solved on today's web platform.

For those cases, Furnace will use a **WGSL-native textured-plane primitive**: a depth-tested quad rendered in the same render pass as scene geometry, sampling a texture that's populated by whatever content pipeline fits (offscreen 2D-canvas rasterization at low frequencies; an SDF font atlas for sharp text at varying scales; etc.).

This path was proven end-to-end in commit `7249001` (depth interleave with the triangle, FPS text from a 2D canvas) then reverted from the working tree pending a real use case. The render-to-texture pipeline has one known gotcha: `device.queue.copyExternalImageToTexture` silently no-ops on macOS WKWebView WebGPU — use `device.queue.writeTexture` with raw `ImageData` bytes instead. Full notes in `docs/learnings/2026-05-17-render-to-texture.md`.

When the first concrete in-scene UI need surfaces, see `docs/backlog/editor-and-tooling/occluded-in-scene-ui-primitive.md` and start from the reverted commit.

## What's not in consideration

A handful of approaches were evaluated and rejected:

- **Static SVG → texture asset pipeline.** Cheapest path for static in-scene art (signs, decals). Dropped from active consideration: screen-space projection covers the world-tracked-UI common case more cleanly, and static decorations aren't a near-term need.
- **resvg in wasm → texture.** SVG rasterized in wasm, uploaded as a texture at low frequencies. Reasonable fallback for a narrow case; same reasoning — screen-space projection wins for live UI, and we'd reach for the WGSL primitive before this for occluded cases.
- **CSS3D / `CSS3DRenderer` / Drei `<Html>`.** DOM elements transformed into 3D do not write to the depth buffer and cannot be occluded per-pixel by `THREE.Mesh` objects. Workarounds (mask-image, layered renderers) approximate but don't solve it. Right out for occluded in-scene UI.
- **Rust-side UI rendering (egui via wasm, Vello).** No silver bullet given Furnace's device-sharing constraint: `navigator.gpu` lives in JS-land and a Rust+wgpu wasm module would request a second `GPUDevice` that cannot directly share buffers or textures with the JS-side device. Vello also explicitly does not target the web today. Tracked as an emerging-tech watch (see `docs/backlog/editor-and-tooling/html-in-canvas-and-vello-watch.md`) alongside the WICG "HTML in Canvas" proposal.

## See also

- `packages/hello-world/src/overlay/` — live Svelte 5 + `@furnace/core` integration.
- `docs/learnings/2026-05-17-render-to-texture.md` — render-to-texture gotchas from the WGSL primitive proof.
- `docs/backlog/editor-and-tooling/occluded-in-scene-ui-primitive.md` — WGSL textured-plane primitive, deferred.
- `docs/backlog/editor-and-tooling/sdf-font-atlas-and-glyph-rendering.md` — sharp text at varying scales, deferred.
- `docs/backlog/editor-and-tooling/html-in-canvas-and-vello-watch.md` — the emerging-tech watch.
