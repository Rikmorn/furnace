# UI Foundation — Design Spec

**Date:** 2026-05-17
**Status:** Approved (pending user review of this written form)
**Builds on:** [`2026-05-17-webgpu-triangle-bootstrap-design.md`](./2026-05-17-webgpu-triangle-bootstrap-design.md) — WebGPU triangle bootstrap
**References:** [`.docs/shallot-and-game-engine-architecture.md`](../../../.docs/shallot-and-game-engine-architecture.md) §10, §12. [`.docs/BACKLOG.md`](../../../.docs/BACKLOG.md) — "UI framework + in-app surfaces (Svelte leaning)" (to be superseded by this work).

## Summary

Establish furnace's two UI rendering paths and validate both end-to-end with the smallest credible test that exercises each: a **screen-space Svelte FPS counter overlay** (corner-pinned DOM, mounted over the canvas) and an **in-scene WGSL UI primitive** (a textured quad in 3D, depth-tested with the existing triangle, displaying the same FPS via an `OffscreenCanvas`-rasterized texture).

The FPS counter is the deliberately-trivial test vehicle. The objective is the integration: that Svelte coexists cleanly with the WebGPU canvas via `bun-plugin-svelte` + Bun's static-routes dev server, and that a depth-tested WGSL textured plane can be added to the existing render pass without architectural strain. Both surfaces consume a single FPS data source — same number, two render paths.

The spec also documents the broader research that grounded the design: why DOM/CSS3D is the wrong primitive for occluded in-scene UI on today's web platform, what Rust-side options exist for in-scene UI and why none of them are a silver bullet given furnace's device-sharing constraint, and the two-tool split (Svelte for heavy DOM UI, WGSL-native primitives for in-scene content) that emerges from those constraints.

## Goals

1. Validate Svelte integration with Bun's static-routes dev server end-to-end — **browser and native webview, HMR, biome, tsc, mount/dispose**.
2. Validate the WGSL-native UI primitive path — a **textured quad in 3D with depth participation**, distinguishing this approach from DOM/CSS3D's no-depth-buffer limitation.
3. Show the **same FPS data in both surfaces from a single source** — the architectural statement that different rendering primitives serve different needs but share data.
4. **Document the research** (the two-tool split, the device-sharing constraint, the in-scene UI options γ/δ/ε, the emerging-tech watch) so it isn't rediscovered later when an in-scene UI need surfaces.

## Non-goals

- World-space camera or projection matrices. Both primitives stay in NDC for this milestone. Camera + projection lands with the ECS work (BACKLOG).
- Window resize handling for either primitive. Already deferred to BACKLOG (the bootstrap entry covers it). Both primitives will squish equally.
- A real font/glyph system (SDF atlas, vector primitives, UI compositor). Text rendering for the in-scene plane uses `OffscreenCanvas.fillText` → `copyExternalImageToTexture`. The 2D canvas does the rasterization; WGSL does the 3D composition. Honest framing — this is the "canvas as transient asset" pattern, not a pretend WGSL text renderer.
- SSR, Svelte routing, Svelte stores beyond the `$state` rune. The runes model is sufficient for our scope.
- Component-level tests, Playwright HMR regression, `svelte-check` integration, Prettier setup.
- Rust-side UI work in this milestone. Not a goal even though the research considers it.

## Research write-up — why this design

This milestone's design rests on three findings, each with confidence levels marked.

### 1. The Svelte ↔ Bun.serve integration is a supported happy path (not a spike).

Verified from `bun-plugin-svelte` npm docs and Bun's Fullstack Dev Server documentation:

- `bun-plugin-svelte` integrates with Bun's static-routes dev server via `bunfig.toml`:
  ```toml
  [serve.static]
  plugins = ["bun-plugin-svelte"]
  ```
- HMR is included.
- The supported pattern today is the **HTML-rooted triplet**: an HTML route imports a TS file, the TS file does `import App from "./App.svelte"; mount(App, { target })`. This matches our existing `index.html → bootstrap.ts → main()` shape exactly.
- Direct `.svelte` route handlers (`routes: { "/": MyComponent }`) are an open feature request (oven-sh/bun#18120), not yet implemented. We do not need that capability — we use client-side mounting.
- The plugin does not yet support SSR. We do not need SSR.

**Unverified, deferred to execution:** whether `[serve.static] plugins = [...]` in `bunfig.toml` is honored by our existing `Bun.serve({ routes: { "/": indexHtml } })` programmatic call (vs `bun index.html` CLI invocation). Strongly suspect yes — `bunfig.toml` is the global config and `[serve.static]` is the config section for that feature — but it's a verification point in execution, not a blocker.

### 2. There is no clean "live, interactive, depth-occluding DOM-in-3D" answer on the web platform today.

- **CSS3D / `CSS3DRenderer` (Three.js, Drei `<Html>`):** DOM tracks world-space coordinates via `transform: matrix3d(...)`. Verified across multiple Three.js maintainer and Drei issue threads: **"HTML elements rendered with CSS3DRenderer are not drawn to the depth buffer and cannot participate in occlusion and lighting like THREE.Mesh objects."** Drei's `<Html occlude>` is a binary on/off, not per-pixel. Workarounds (mask-image, layered renderers) approximate but don't solve depth occlusion.
- **DOM → live WebGPU texture:** Not solved on today's web platform. `html2canvas` and SVG `<foreignObject>` are snapshot-style, lose interactivity when sampled to a texture. No spec API takes a live `HTMLElement` and exposes it as a continuously-updating GPU texture handle.
- **Emerging: WICG "HTML in Canvas":** A real proposal that would allow HTML elements inside a canvas with native rasterization, depth participation, and accessibility object model integration. Not shipping broadly as of May 2026; medium confidence on the proposal existing, low confidence on shipping timeline. Tracked in BACKLOG.

**Implication:** DOM/Svelte is the right tool for screen-space UI and for world-tracked UI where "DOM is always on top of the canvas as a layer" is acceptable (HUDs, debug labels, panels that don't need to be walked behind). DOM/Svelte is **the wrong tool** for in-scene UI that must be occluded by 3D geometry. For that case, the answer is rendering UI natively in WGSL.

### 3. Rust-side options exist but no Rust silver bullet for furnace's dual-runtime setup.

**The device-sharing constraint** (verified by architecture): in both runtimes (browser + native `wry` webview), `navigator.gpu` lives in JS-land — that's where `entry.ts:25-32` requests its `GPUDevice`. Rust compiled to wasm32 with `wgpu` would request *its own* `GPUDevice` from the same `navigator.gpu`. Two devices in the same page cannot directly share buffers or textures. The only bridges are external textures (`ImageBitmap`, `GPUExternalTexture`), CSS layering, or "Rust produces draw commands, JS executes them."

**Five concrete options for in-scene UI**, with verdicts:

| Option | What it is | Verdict for furnace |
|---|---|---|
| **α** egui via wasm + JS renderer adapter | Compile egui's core to wasm; consume its `FullOutput` shape lists from JS; render via furnace's existing WebGPU device. Mature, editor-ready, immediate-mode style. | Interesting future option for editor surfaces. Not better than Svelte for that role. |
| **β** Vello (Rust GPU vector graphics) | Production-quality 2D vector rendering via wgpu compute shaders. | Linebender's own docs: "the web is not currently a primary target for Vello, and WebGPU implementations are incomplete." Watch, don't adopt. |
| **γ** WGSL-native UI primitive | SDF text + vector primitives implemented in WGSL. Single device, no bridging. | The only fully-integrated answer for live, depth-occluded UI. Significant engineering (1–2 weeks for SDF text alone). The right destination when in-scene UI matters. |
| **δ** Static SVG → texture asset pipeline | Author UI as SVG, rasterize at build/startup, upload as texture, render on 3D planes. | Cheapest. No live updates. Excellent for signs, decals, decorations. |
| **ε** resvg in wasm → texture | Rust SVG renderer compiled to wasm; CPU-rasterize SVG → ImageData → texture every N frames. | Reasonable fallback when SVG fidelity matters and update frequency is low (<10Hz). |

**There is no Rust silver bullet for live, interactive, depth-occluding in-scene UI that integrates with our JS-side WebGPU device.** The constraint isn't Rust — it's device sharing. Rust helps compute things cheaper but doesn't change the GPU compositing architecture.

### The resulting two-tool split

| Surface | Tool | Justification |
|---|---|---|
| Editor, FPS counter, inspector, control panels | Svelte (DOM, screen-space) | What this milestone validates |
| Static in-scene art (signs, decals, decorations) | δ — SVG → texture asset pipeline | Cheapest; future BACKLOG item |
| Live interactive in-scene UI (touchpanels, depth-occluded HUDs) | γ — WGSL-native primitive | The only fully-integrated answer; future BACKLOG item |
| Live in-scene UI with lower update freq | ε — resvg in wasm → texture | Reasonable fallback if WGSL-native is too much |

For this milestone, the in-scene primitive is a **minimal version of γ**: an `OffscreenCanvas`-rasterized texture (text from the 2D canvas API) on a depth-tested quad. It demonstrates the primitive's existence and depth participation without paying for a full SDF text system.

## Architecture

### Two surfaces, one FPS source

```
                  ┌────────────────────────┐
        ┌─────────│  FpsStats (singleton)  │─────────┐
        │         │  - frame counter       │         │
        │         │  - 1Hz tick → onTick   │         │
        │         └────────────────────────┘         │
        │                    ▲                       │
   reads│                    │writes                 │reads
        │                    │                       │
        ▼                    │                       ▼
 ┌──────────────┐   ┌────────┴───────────┐   ┌──────────────────┐
 │ Svelte state │   │ entry.ts           │   │ text-canvas      │
 │ (rune $state)│   │ - RAF loop         │   │ (OffscreenCanvas │
 │              │   │ - calls stats.frame│   │  → GPU texture)  │
 └──────┬───────┘   │ - on tick:         │   └────────┬─────────┘
        │           │   * write rune     │            │
        ▼           │   * update canvas  │            ▼
 ┌──────────────┐   └─────────┬──────────┘   ┌──────────────────┐
 │ FpsOverlay   │             │              │ WGSL plane       │
 │ .svelte      │             ▼              │ - textured quad  │
 │ (mounted in  │   ┌──────────────────┐     │ - depth-tested   │
 │  #ui-root)   │   │ <canvas #gpu>    │     │ - samples texture│
 │              │   │ WebGPU pipelines │     │   from text-canvas│
 │              │   │ - triangle       │◄────│                  │
 │              │   │ - text plane     │     │                  │
 └──────────────┘   └──────────────────┘     └──────────────────┘
```

### Data flow per second

1. RAF loop in `entry.ts` calls `stats.frame()` per frame. Single integer increment, no allocation.
2. `setInterval(1000)` inside `stats.ts` computes `fps = framesSinceLastTick / elapsedSeconds`, calls the registered `onTick(fps)` callback, resets the frame counter.
3. The `onTick` callback (registered from `entry.ts`):
   - Writes `overlayState.fps = fps` (Svelte reactive update — DOM re-renders).
   - Calls `textCanvas.update(fps)` which paints text into the `OffscreenCanvas` and uploads via `copyExternalImageToTexture`.
4. RAF continues drawing both WGSL pipelines every frame. The plane samples whatever's currently in its texture binding — no per-frame texture upload.

### Key invariants

1. **One source of FPS data.** Both surfaces consume it; neither computes it independently. Verifiable by reading the code — no duplicated frame counting.
2. **No DOM writes in the RAF loop.** Reactive updates happen only at the 1Hz tick.
3. **No texture uploads in the RAF loop.** The plane samples a texture that updates at 1Hz, not 60Hz.
4. **Both primitives draw in a single render pass with shared depth buffer.** The architectural statement: in-scene primitives can interleave with engine geometry per-pixel.

## Components — file layout

### New files

```
packages/core/
├── bunfig.toml                         # plugin registration for bun-plugin-svelte
├── src/
│   ├── stats.ts                        # FpsStats singleton; counter + 1Hz tick
│   ├── overlay/
│   │   ├── FpsOverlay.svelte           # corner-pinned div, monospace text
│   │   ├── state.svelte.ts             # $state rune for reactive FPS
│   │   └── mount.ts                    # mount/unmount Svelte component
│   ├── scene/
│   │   ├── plane.ts                    # WGSL plane: pipeline, buffers, draw
│   │   ├── plane.wgsl                  # textured quad shader
│   │   └── text-canvas.ts              # OffscreenCanvas → GPU texture pipeline
│   └── svelte.d.ts                     # ambient *.svelte type declaration
└── tests/
    └── stats.test.ts                   # smoke test for FpsStats math
```

### Modified files

| File | Change |
|---|---|
| `packages/core/package.json` | Add devDeps: `svelte`, `bun-plugin-svelte` |
| `packages/core/index.html` | Add `<div id="ui-root">` sibling to canvas |
| `packages/core/src/entry.ts` | Add depth attachment; wire stats; mount overlay; draw plane |
| `packages/core/src/triangle.wgsl` | Change vertex Z from `0.0` to `0.5` so plane can interleave around it |
| `biome.json` | Add `*.svelte` to ignores |
| `tsconfig.json` | Likely no change; verify in execution |

### File-by-file justification

- **`bunfig.toml`** — single concern: `[serve.static] plugins = ["bun-plugin-svelte"]`. Lives in `packages/core/` next to `serve.ts` so it applies to that workspace.
- **`stats.ts`** — keeps shared FPS state isolated from `entry.ts`'s rendering concerns. Exports `initStats({ onTick }): { frame(): void; dispose(): void }`. The RAF loop calls `frame()`; the 1Hz `setInterval` is internal to `stats.ts`.
- **`overlay/FpsOverlay.svelte`** (~25 lines) — single `<div>` with `position: fixed; top: 8px; left: 8px`. Monospace font. `pointer-events: none` so the overlay never intercepts canvas-bound input.
- **`overlay/state.svelte.ts`** (~5 lines) — `export const overlayState = $state({ fps: 0 })`. The `.svelte.ts` extension unlocks rune syntax in non-component files. Component reads `overlayState.fps`; `entry.ts` mutates it; Svelte handles propagation.
- **`overlay/mount.ts`** (~10 lines) — wraps `mount()` / `unmount()` so `entry.ts` doesn't import Svelte's runtime directly. Returns a dispose function.
- **`scene/plane.ts`** (~80 lines) — encapsulates the WGSL plane: pipeline creation, vertex/index buffer (one quad), bind group with sampler + texture, draw helper. Exported so `entry.ts` orchestrates the render pass.
- **`scene/plane.wgsl`** (~25 lines) — vertex shader with hardcoded NDC positions and UVs, fragment shader samples the bound texture.
- **`scene/text-canvas.ts`** (~40 lines) — owns the `OffscreenCanvas`, the destination `GPUTexture`, and an `update(fps)` method that paints + uploads. Lives under `scene/` because it's a content pipeline for in-scene primitives; the WGSL plane is its only current consumer.
- **`svelte.d.ts`** (~5 lines) — ambient declaration so `import App from "./Foo.svelte"` typechecks. Mirrors `wgsl.d.ts`.

### Folder convention

- `src/overlay/` — screen-space DOM UI surfaces. Future editor / inspector / control panels live here.
- `src/scene/` — in-scene WebGPU render primitives. Future SDF text, vector UI, particle systems live here.
- Top-level `src/` files (`stats.ts`, `svelte.d.ts`) — genuinely shared or build-system concerns, owned by neither folder.

This is the seed of the eventual engine layering. Don't over-formalize it now; let the folders accumulate content before deciding on more structure.

## WGSL plane design

### Coordinate space — NDC

Both primitives stay in NDC. No camera, no view/projection matrix. Adding MVP infrastructure to the plane while the triangle stays in NDC would create false asymmetry; world-space positioning is a separate concern that lands with ECS (BACKLOG).

### Geometry

4 vertices, 6 indices (two triangles). Vertex attributes:
- `position: vec3<f32>` — NDC coordinates. Z chosen to interleave visibly with the triangle.
- `uv: vec2<f32>` — 0–1 range, corners.

### Depth attachment

- **Format:** `depth24plus` (widely supported, standard).
- **Lifetime:** Created once on startup, sized to the canvas. Resize handling deferred (BACKLOG covers it).
- **Pipeline state for both pipelines:** `depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }`.
- **Render pass:** adds `depthStencilAttachment` with `depthLoadOp: "clear"`, `depthClearValue: 1.0`, `depthStoreOp: "store"`.

### Z placement — interleave proof

WebGPU's NDC z-range is **0 → 1** (0 = near, 1 = far), unlike OpenGL's −1 → 1. Currently `triangle.wgsl` outputs `z = 0.0` — the triangle sits at the near plane, leaving no room for "in front."

**Required change:** `triangle.wgsl` updates to `return vec4f(pos[vi], 0.5, 1.0);` — triangle sits in the middle of the depth range.

**For depth-interleave to be visible, the plane must overlap with the triangle in screen space (XY) AND span Z values around the triangle's Z=0.5.** Target placement (exact values tuned during execution):

- Top-left corner:    `( 0.0,  0.2,  0.3)` — overlaps triangle's right side, in front
- Top-right corner:   `( 0.8,  0.2,  0.7)` — past triangle's right edge, behind plane's near edge
- Bottom-left corner: `( 0.0, -0.4,  0.3)`
- Bottom-right corner:`( 0.8, -0.4,  0.7)`

The plane is tilted in Z across its width (near on the left, far on the right). It overlaps the right half of the triangle's body in screen space — the overlap zone is where depth-interleave shows: the plane's left edge (Z=0.3) renders in front of the triangle, the plane's middle (Z~0.5) is at the same depth and edges between front/behind, and the plane's right edge (Z=0.7) is fully behind. Beyond the triangle's right edge (x > 0.5) the plane has clear view and just renders normally. This gives both proofs in one image: depth-interleave inside the overlap zone, plus the plane rendering cleanly on its own outside it.

### Texture binding

- **Format:** `rgba8unorm`. `OffscreenCanvas` is the source; standard path with `copyExternalImageToTexture`.
- **Size:** 512×128. One line of FPS text at ~48px with headroom.
- **Filtering:** linear min/mag, clamp-to-edge.
- **No mipmaps** for this size at this scale.

### Bind group layout

```
@group(0) @binding(0): texture_2d<f32>  // the FPS-text texture
@group(0) @binding(1): sampler          // linear, clamp-to-edge
```

No uniforms. World-space MVP joins later when camera lands.

### Render pass shape (in `entry.ts`)

```ts
const pass = encoder.beginRenderPass({
  colorAttachments: [{ view, loadOp: "clear", clearValue: ..., storeOp: "store" }],
  depthStencilAttachment: {
    view: depthView,
    depthLoadOp: "clear",
    depthClearValue: 1.0,
    depthStoreOp: "store",
  },
});
pass.setPipeline(trianglePipeline);
pass.draw(3);
pass.setPipeline(planePipeline);
pass.setBindGroup(0, planeBindGroup);
pass.setVertexBuffer(0, planeVertexBuffer);
pass.setIndexBuffer(planeIndexBuffer, "uint16");
pass.drawIndexed(6);
pass.end();
```

### Text-canvas update (every 1Hz tick)

```ts
textCtx.clearRect(0, 0, 512, 128);
textCtx.fillStyle = "rgba(0,0,0,0.65)";  // semi-transparent backdrop
textCtx.fillRect(0, 0, 512, 128);
textCtx.fillStyle = "#fff";
textCtx.font = "48px ui-monospace, monospace";
textCtx.fillText(`${fps} fps`, 16, 80);
device.queue.copyExternalImageToTexture(
  { source: offscreenCanvas, flipY: true },
  { texture },
  [512, 128]
);
```

`flipY: true` matches WebGPU's NDC orientation (positive Y up) vs canvas (positive Y down).

### Webview compatibility notes

- `copyExternalImageToTexture` from `OffscreenCanvas` is spec-blessed and works in Chromium / Safari TP / WebView2. WKWebView on macOS Tahoe 26+ should support it (the WebGPU implementation is Chromium-class). Confidence: high but not session-verified.
- Fallback (~5 line change): use a hidden on-screen `<canvas>` element via `HTMLCanvasElement` instead of `OffscreenCanvas`. Same `copyExternalImageToTexture` API works with both.

## Svelte integration

### Plugin registration

`packages/core/bunfig.toml`:
```toml
[serve.static]
plugins = ["bun-plugin-svelte"]
```

### Dependencies

In `packages/core/package.json`:
- `svelte` — runtime + compiler. Pin to current major (5.x).
- `bun-plugin-svelte` — devDep, only used by Bun.

No `svelte-check` for now; ambient declaration + tsc handles imports.

### Shared reactive state

`packages/core/src/overlay/state.svelte.ts`:
```ts
export const overlayState = $state({ fps: 0 });
```

The `.svelte.ts` extension unlocks rune syntax outside `.svelte` components. Component reads `overlayState.fps`; `entry.ts` mutates it. Svelte's reactivity handles re-render.

### The component

`packages/core/src/overlay/FpsOverlay.svelte`:
```svelte
<script lang="ts">
  import { overlayState } from "./state.svelte.ts";
</script>

<div class="fps-overlay">{overlayState.fps} fps</div>

<style>
  .fps-overlay {
    position: fixed; top: 8px; left: 8px;
    color: #fff; background: rgba(0,0,0,0.5);
    padding: 4px 8px;
    font: 12px/1.2 ui-monospace, monospace;
    pointer-events: none; user-select: none;
  }
</style>
```

### Mount wrapper

`packages/core/src/overlay/mount.ts`:
```ts
import { mount, unmount } from "svelte";
import FpsOverlay from "./FpsOverlay.svelte";

export function mountFpsOverlay(target: HTMLElement): () => void {
  const app = mount(FpsOverlay, { target });
  return () => unmount(app);
}
```

### Ambient types

`packages/core/src/svelte.d.ts`:
```ts
declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
}
```

### HTML mount point

`packages/core/index.html` adds:
```html
<div id="ui-root"></div>
```
as a sibling of the canvas. Empty until `bootstrap.ts` mounts into it.

### Biome

Add `*.svelte` to biome's `files.ignore` list. Biome 2.x has partial `.svelte` support but not full ecosystem parity. Svelte's ecosystem typically uses Prettier with the Svelte plugin for formatting; we defer that until `.svelte` content grows past one ~25-line file.

### tsconfig

No changes expected. `svelte` ships its own type definitions; the ambient `*.svelte` declaration handles imports. If `tsc --noEmit` complains in execution, the likely fix is adding `"types": ["svelte", ...]` to compilerOptions.

### HMR verification

- **Browser path:** edit `FpsOverlay.svelte`, expect Bun's dev server to push the update via WebSocket; component re-renders without page reload. Almost certainly works.
- **Native webview path:** same Bun dev server, same WebSocket connection. The `wry`-hosted webview should behave identically. **Flag for explicit verification during execution.** Fallback: page reload via `bun --hot serve.ts` (acceptable for dev).

### What this integration does not include

- No SSR (plugin doesn't support it; we don't need it).
- No SPA routing.
- No Svelte stores beyond `$state`.
- No component-level testing.
- No Prettier or `svelte-check`.

## Error handling

Scope-calibrated additions to the existing posture from the bootstrap spec.

### Handled

- **Svelte `mount()` throws** → caught by `bootstrap.ts`'s existing error handler; message written to `document.body.innerText`. No new path.
- **Missing `#ui-root`** → log a console warning, skip overlay mount. Non-fatal: WGSL primitive still demonstrates the in-scene path.
- **`copyExternalImageToTexture` not supported / throws** → catch in `text-canvas.ts`, log, leave the plane's texture blank. The WGSL plane still renders (proving the depth-tested primitive exists); only the text content is absent. This is the explicit fallback for unverified webview behavior.
- **WGSL plane pipeline creation fails** → existing `pushErrorScope("validation")` pattern, message to `document.body`.

### Explicitly deferred (BACKLOG)

Everything from the bootstrap spec's deferred list (resize, device-lost recovery, robust child-process cleanup) plus:
- Component-level error boundaries inside Svelte.
- Per-pipeline error scopes (the existing global validation scope is sufficient for two pipelines).

## Testing

Scope-calibrated.

### In scope

1. **`tests/stats.test.ts`** — single smoke test of `FpsStats` math. Inject a controllable clock, call `frame()` N times, assert `currentFps` calculation matches expectation. The frame-counter and 1Hz tick are the only logic with non-trivial math.
2. **`tests/entry.test.ts`** — unchanged. Continues to verify module loads + WGSL string non-empty.
3. **`bunx tsc --noEmit`** via `bun run typecheck` — now also typechecks `.svelte` imports through the ambient declaration.
4. **`biome check`** via `bun run check` — runs over `.ts` files; `.svelte` excluded.
5. **Manual verification checklist** — see Acceptance criteria below.

### Out of scope (BACKLOG)

- Svelte component tests (would need `@testing-library/svelte`).
- WGSL plane render tests (no `navigator.gpu` in bun-test).
- HMR regression tests (would need Playwright; already in BACKLOG).
- `text-canvas` tests (depend on `OffscreenCanvas` + WebGPU; browser-only).

## Acceptance criteria (manual verification checklist)

The milestone is complete when:

- [ ] `bun install` succeeds with the new Svelte deps.
- [ ] `bun run check` passes (biome lint + format; `.svelte` ignored).
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes (existing entry test + new stats test).
- [ ] `bun run dev:web` shows:
  - [ ] The triangle.
  - [ ] Svelte FPS overlay top-left, updating roughly once per second, displaying an integer FPS value.
  - [ ] WGSL textured plane bottom-right, displaying the same FPS number rendered via `OffscreenCanvas`.
  - [ ] The plane visibly **z-interleaves** with the triangle — one part of the plane is in front of the triangle, the opposite part is behind it.
- [ ] `bun run dev:native` on macOS Tahoe 26+ shows the same three elements identically.
- [ ] **Both overlay and plane display the same FPS number.** Single source verifiable by reading the code (one frame counter, one 1Hz tick).
- [ ] **HMR**: edit `FpsOverlay.svelte`, save, see the update without page reload — verified in **both** browser and native webview.
- [ ] DOM is not written during the RAF loop; texture is not uploaded during the RAF loop. Verifiable by reading the code.
- [ ] Closing the native window terminates the Bun child process (unchanged invariant from the bootstrap milestone).
- [ ] No new entries appear in `.docs/BACKLOG.md` beyond those listed below.
- [ ] The existing "UI framework + in-app surfaces (Svelte leaning)" BACKLOG entry is superseded (rewritten as "Svelte editor / inspector surfaces" with updated trigger).

## BACKLOG additions

### New entries

1. **In-scene UI primitive evaluation (γ/δ/ε)** — under Editor & tooling. Trigger: first concrete in-game UI requirement (signage, character labels, interactive panel). Reference: this spec's research write-up.
2. **Emerging-tech watch: WICG HTML-in-Canvas / Vello browser readiness** — under Editor & tooling. Trigger: WICG proposal reaches Stage 2+ or Vello announces production web support.
3. **SDF font atlas + glyph rendering** — under Editor & tooling. Trigger: first in-scene surface needing sharp text at varying scales, or live per-frame text updates (current `OffscreenCanvas.fillText` path is 1Hz-bounded and uses 2D-canvas rasterization).
4. **Camera + projection matrices for in-scene primitives** — under Engine architecture. Trigger: first surface needing world-space positioning (typically aligned with ECS arrival).
5. **Svelte formatting (Prettier or biome upgrade)** — under Testing & quality. Trigger: `.svelte` content grows past ~3 components or ~200 lines.

### Existing entry to update

**"UI framework + in-app surfaces (Svelte leaning)"** under Editor & tooling — rewrite as **"Svelte editor / inspector surfaces"** (or similar). The framework is no longer leaning; it's committed via this milestone. The remaining work is editor/inspector surfaces that need ECS state subscription. New trigger: ECS lands.

## Risks & constraints

1. **`bunfig.toml` plugin config + programmatic `Bun.serve()`.** Unverified that `[serve.static] plugins = [...]` applies to `Bun.serve({ routes })` calls vs only `bun index.html` CLI. Strongly suspect yes. **Mitigation:** verify early in execution. Fallback: migrate `dev` script from `bun --hot serve.ts` to `bun index.html` direct, rework `PORT=` discovery for the native runtime (~30 min of work).
2. **`copyExternalImageToTexture` from `OffscreenCanvas` on `wry` WebView (macOS Tahoe 26+ / Windows WebView2).** Both are recent Chromium-class; should work. **Mitigation:** fall back to hidden on-screen `<canvas>` source (~5 line change).
3. **HMR through `wry` webview.** Same WebSocket-based path as Chrome; should work. **Mitigation:** page reload via `bun --hot serve.ts` if HMR-over-WebSocket misbehaves.
4. **`.svelte.ts` rune support in `bun-plugin-svelte`.** The plugin supports Svelte 5; the runes-outside-components feature is newer. **Mitigation:** if it fails, fall back to a Svelte writable-store pattern (still works in Svelte 5).
5. **Depth-interleave visibility.** Z values in this spec are example placements; exact values may need tuning during execution to make the interleave read clearly. ~1 line change expected.
6. **Native webview WebGPU support for the new APIs.** WKWebView on macOS Tahoe 26+ supports WebGPU per the bootstrap spec's verification, but `copyExternalImageToTexture` from an `OffscreenCanvas` specifically is not session-verified for that platform. **Mitigation:** the hidden-canvas fallback above covers this case.

## Out of scope (will not be done in implementation)

Everything listed in "Non-goals" plus every BACKLOG entry. Explicit deferrals:

- World-space camera and projection matrices.
- SDF text or vector primitives.
- Resize handling for either primitive.
- Svelte stores beyond `$state`.
- `svelte-check` integration.
- Prettier setup.
- Component-level tests.
- Playwright HMR regression.
- Static-route plugin migration to `bun index.html` direct (only if bunfig path fails — keep `serve.ts` otherwise).

## What changes when this spec is implemented

**Files created:**
- `docs/superpowers/specs/2026-05-17-ui-foundation-design.md` (this file)
- `packages/core/bunfig.toml`
- `packages/core/src/stats.ts`
- `packages/core/src/svelte.d.ts`
- `packages/core/src/overlay/FpsOverlay.svelte`
- `packages/core/src/overlay/state.svelte.ts`
- `packages/core/src/overlay/mount.ts`
- `packages/core/src/scene/plane.ts`
- `packages/core/src/scene/plane.wgsl`
- `packages/core/src/scene/text-canvas.ts`
- `packages/core/tests/stats.test.ts`

**Files modified:**
- `packages/core/package.json` (add `svelte`, `bun-plugin-svelte` devDeps)
- `packages/core/index.html` (add `<div id="ui-root">`)
- `packages/core/src/entry.ts` (depth attachment, stats wiring, overlay mount, plane draw)
- `packages/core/src/triangle.wgsl` (vertex Z `0.0` → `0.5`)
- `biome.json` (ignore `*.svelte`)
- `tsconfig.json` (only if `tsc --noEmit` requires it — verify in execution)
- `.docs/BACKLOG.md` (5 new entries, 1 rewrite)
- `bun.lock` (new deps)

**Files deleted:**
- None.

**Files untouched** (notable ones to confirm):
- `packages/core/serve.ts` — stays as-is unless the bunfig-plus-programmatic-serve fallback is needed.
- `packages/core/src/bootstrap.ts` — unchanged.
- `packages/core/native/` — Rust crate untouched.
- `AGENTS.md`, `README.md`, `.claude/CLAUDE.md` — no edits needed; the work is internal to `packages/core/`.

## Commit order

Two atomic commits, in this order:

1. **Svelte integration + FPS counter overlay.** All Svelte-related files, plus `stats.ts`, the BACKLOG additions, and the `entry.ts` changes for mounting the overlay (but NOT the WGSL plane). After this commit, `bun run dev:web` shows the triangle + overlay (no in-scene plane). All quality gates pass.

2. **WGSL UI primitive: depth attachment + textured plane + text-canvas.** All `scene/` files, `text-canvas.ts`, the `entry.ts` changes for depth + plane draw, and the `triangle.wgsl` Z change. After this commit, both surfaces show.

The order is chosen so that the more invasive change (depth attachment, second pipeline, modifying the existing triangle shader) lands second, with the simpler Svelte integration providing a stable known-good waypoint. If anything in commit 2 turns out harder than estimated, we have the option to pause-and-ship commit 1 alone — half a milestone is better than zero.
