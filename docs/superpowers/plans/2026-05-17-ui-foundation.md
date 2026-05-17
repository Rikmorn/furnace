# UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate Svelte integration with Bun's static-routes dev server AND a depth-tested WGSL UI primitive, both proven by shipping an FPS counter rendered through both surfaces from one shared data source.

**Architecture:** Two atomic commits. Commit 1 (Phase 1) adds Svelte via `bun-plugin-svelte`, a `FpsStats` source, and an `FpsOverlay.svelte` component mounted into `#ui-root` (sibling of the canvas). Commit 2 (Phase 2) adds a depth attachment to the WebGPU render pass, a textured-quad primitive (`scene/plane.{ts,wgsl}`) that interleaves with the existing triangle in depth, and an `OffscreenCanvas` → GPU-texture rasterizer (`scene/text-canvas.ts`) that draws the FPS string for the in-scene plane.

**Tech Stack:** Bun 1.3.14, TypeScript (strict, `noUncheckedIndexedAccess`), Svelte 5 (runes), `bun-plugin-svelte`, WebGPU, WGSL, Biome 2.4, `bun:test`.

**Spec:** [`docs/superpowers/specs/2026-05-17-ui-foundation-design.md`](../specs/2026-05-17-ui-foundation-design.md).

---

## Phase 1 — Svelte integration + FPS counter overlay

### Task 1: Install Svelte dependencies and register the Bun plugin

**Files:**
- Modify: `packages/core/package.json` (via `bun add`)
- Create: `packages/core/bunfig.toml`
- Modify: `bun.lock` (auto)

- [ ] **Step 1: Install svelte and bun-plugin-svelte as dev dependencies in the core workspace**

Run from the project root:
```bash
cd packages/core && bun add -d svelte bun-plugin-svelte && cd ../..
```

Expected: install succeeds. `packages/core/package.json` gains a `devDependencies` block containing `svelte` (5.x) and `bun-plugin-svelte` (latest). `bun.lock` is updated.

- [ ] **Step 2: Create the bunfig.toml that registers the plugin**

Create `packages/core/bunfig.toml`:
```toml
[serve.static]
plugins = ["bun-plugin-svelte"]
```

This registers the Svelte plugin with Bun's static-routes dev server (what `serve.ts` ends up using via `Bun.serve({ routes })`).

- [ ] **Step 3: Verify install resolves cleanly**

Run from project root:
```bash
bun install
```

Expected: succeeds with no errors. Resolves `svelte` and `bun-plugin-svelte` for the `@furnace/core` workspace.

---

### Task 2: Implement FpsStats with TDD

**Files:**
- Create: `packages/core/src/stats.ts`
- Create: `packages/core/tests/stats.test.ts`

- [ ] **Step 1: Write the failing tests for `computeFps`**

Create `packages/core/tests/stats.test.ts`:
```ts
import { expect, test } from "bun:test";
import { computeFps } from "../src/stats.ts";

test("computeFps: zero elapsed time returns 0", () => {
  expect(computeFps(60, 0)).toBe(0);
});

test("computeFps: negative elapsed time returns 0 (clock anomaly guard)", () => {
  expect(computeFps(60, -0.5)).toBe(0);
});

test("computeFps: rounds frames-per-second to nearest integer", () => {
  expect(computeFps(60, 1)).toBe(60);
  expect(computeFps(120, 1)).toBe(120);
  expect(computeFps(59, 1.01)).toBe(58);
});

test("computeFps: zero frames over a positive interval returns 0", () => {
  expect(computeFps(0, 1)).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from project root:
```bash
bun test packages/core/tests/stats.test.ts
```

Expected: FAIL with `Cannot find module '../src/stats.ts'` (or similar — the import path can't resolve).

- [ ] **Step 3: Implement `stats.ts`**

Create `packages/core/src/stats.ts`:
```ts
export type StatsCallback = (fps: number) => void;

export interface FpsStats {
  frame(): void;
  dispose(): void;
}

export interface StatsOptions {
  onTick: StatsCallback;
  intervalMs?: number;
  now?: () => number;
}

export function computeFps(frames: number, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0) return 0;
  return Math.round(frames / elapsedSeconds);
}

export function initStats({
  onTick,
  intervalMs = 1000,
  now = () => performance.now(),
}: StatsOptions): FpsStats {
  let frames = 0;
  let lastTickAt = now();

  const tick = (): void => {
    const nowMs = now();
    const elapsedSeconds = (nowMs - lastTickAt) / 1000;
    onTick(computeFps(frames, elapsedSeconds));
    frames = 0;
    lastTickAt = nowMs;
  };

  const intervalId = setInterval(tick, intervalMs);

  return {
    frame: () => {
      frames++;
    },
    dispose: () => {
      clearInterval(intervalId);
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from project root:
```bash
bun test packages/core/tests/stats.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Run typecheck**

Run from project root:
```bash
bun run typecheck
```

Expected: PASS.

---

### Task 3: Implement Svelte overlay (state, component, mount)

**Files:**
- Create: `packages/core/src/svelte.d.ts`
- Create: `packages/core/src/overlay/state.svelte.ts`
- Create: `packages/core/src/overlay/FpsOverlay.svelte`
- Create: `packages/core/src/overlay/mount.ts`

- [ ] **Step 1: Add the ambient `*.svelte` type declaration**

Create `packages/core/src/svelte.d.ts`:
```ts
declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
}
```

Mirrors `wgsl.d.ts` so TypeScript can resolve `import App from "./Foo.svelte"`.

- [ ] **Step 2: Create the reactive state container**

Create `packages/core/src/overlay/state.svelte.ts`:
```ts
export const overlayState = $state({ fps: 0 });
```

The `.svelte.ts` extension is what enables rune syntax (`$state`) outside `.svelte` components. The Svelte plugin transpiles `.svelte.ts` files at import time.

- [ ] **Step 3: Create the FPS overlay Svelte component**

Create `packages/core/src/overlay/FpsOverlay.svelte`:
```svelte
<script lang="ts">
  import { overlayState } from "./state.svelte.ts";
</script>

<div class="fps-overlay">{overlayState.fps} fps</div>

<style>
  .fps-overlay {
    position: fixed;
    top: 8px;
    left: 8px;
    color: #fff;
    background: rgba(0, 0, 0, 0.5);
    padding: 4px 8px;
    font: 12px/1.2 ui-monospace, monospace;
    pointer-events: none;
    user-select: none;
  }
</style>
```

`pointer-events: none` ensures the overlay never intercepts canvas-bound input (important for future drag/click handling).

- [ ] **Step 4: Create the mount wrapper**

Create `packages/core/src/overlay/mount.ts`:
```ts
import { mount, unmount } from "svelte";
import FpsOverlay from "./FpsOverlay.svelte";

export function mountFpsOverlay(target: HTMLElement): () => void {
  const app = mount(FpsOverlay, { target });
  return () => unmount(app);
}
```

Centralizes the Svelte runtime import (entry.ts never imports `svelte` directly) and provides a dispose handle.

- [ ] **Step 5: Run typecheck**

Run from project root:
```bash
bun run typecheck
```

Expected: PASS.

If TS complains with `Cannot find name '$state'` (or any other rune isn't recognized in `state.svelte.ts`), Svelte's ambient rune types aren't being auto-included. Add `"svelte"` to the `types` array in `tsconfig.json`:
```json
"types": ["bun", "@webgpu/types", "svelte"]
```
Re-run typecheck, expect PASS. (If errors persist, the next fallback is adding `/// <reference types="svelte" />` to `packages/core/src/svelte.d.ts` above the existing module declaration.)

---

### Task 4: Integrate overlay in entry.ts and index.html; decouple test from entry.ts

**Files:**
- Modify: `packages/core/index.html`
- Modify: `packages/core/tests/entry.test.ts`
- Modify: `packages/core/src/entry.ts`

- [ ] **Step 1: Add the `#ui-root` mount point to `index.html`**

Replace the `<body>` block in `packages/core/index.html` with:
```html
<body>
  <canvas id="gpu"></canvas>
  <div id="ui-root"></div>
  <script type="module" src="./src/bootstrap.ts"></script>
</body>
```

`#ui-root` is a sibling of the canvas. The Svelte component uses `position: fixed`, so DOM stacking is independent of source order.

- [ ] **Step 2: Decouple `entry.test.ts` from `entry.ts`**

Once `entry.ts` imports `./overlay/mount.ts` (next step), it pulls a `.svelte` file into the import chain. `bun test` does NOT honor the `[serve.static]` plugin block in `bunfig.toml`, so the import will fail at test time.

The existing `entry exports main` assertion was a weak guarantee (typecheck catches that better). Replace `packages/core/tests/entry.test.ts` content with:
```ts
import { expect, test } from "bun:test";
import triangleShader from "../src/triangle.wgsl" with { type: "text" };

test("triangle WGSL declares vertex and fragment entry points", () => {
  expect(triangleShader.length).toBeGreaterThan(0);
  expect(triangleShader).toContain("@vertex");
  expect(triangleShader).toContain("@fragment");
  expect(triangleShader).toContain("vs_main");
  expect(triangleShader).toContain("fs_main");
});
```

(Plane shader will be added to this file in Task 10.)

- [ ] **Step 3: Modify `entry.ts` to mount the overlay and wire `FpsStats`**

Replace the contents of `packages/core/src/entry.ts` with:
```ts
// Bun's dev server (Bun.serve static-routes) doesn't inline `with { type: "text" }`
// imports — it exposes them as asset URLs. `bun build` does inline. Fetching the URL
// at runtime works in both modes (and matches the WebGPU sample convention).
import shaderUrl from "./triangle.wgsl";
import { initStats } from "./stats.ts";
import { mountFpsOverlay } from "./overlay/mount.ts";
import { overlayState } from "./overlay/state.svelte.ts";

export async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#gpu");
  if (!canvas) {
    throw new Error("canvas#gpu not found");
  }

  if (!navigator.gpu) {
    document.body.innerText =
      "WebGPU unavailable. Need a recent Chrome/Safari/Firefox, or macOS Tahoe 26+ inside the native webview.";
    return;
  }

  const shaderResponse = await fetch(shaderUrl);
  if (!shaderResponse.ok) {
    document.body.innerText = `Couldn't load shader (HTTP ${shaderResponse.status}): ${shaderUrl}`;
    return;
  }
  const shaderSource = await shaderResponse.text();

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    document.body.innerText =
      "WebGPU adapter not available. GPU may not be supported.";
    return;
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  if (!context) {
    document.body.innerText = "Couldn't get WebGPU canvas context.";
    return;
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  device.pushErrorScope("validation");
  const shaderModule = device.createShaderModule({ code: shaderSource });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: shaderModule, entryPoint: "vs_main" },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
  });
  const validationError = await device.popErrorScope();
  if (validationError) {
    document.body.innerText = `Pipeline error: ${validationError.message}`;
    return;
  }

  const uiRoot = document.querySelector<HTMLElement>("#ui-root");
  if (uiRoot) {
    mountFpsOverlay(uiRoot);
  } else {
    console.warn("#ui-root not found; skipping FPS overlay mount.");
  }

  const stats = initStats({
    onTick: (fps) => {
      overlayState.fps = fps;
    },
  });

  const draw = (): void => {
    stats.frame();
    const view = context.getCurrentTexture().createView();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0.05, g: 0.05, b: 0.07, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}
```

(Note: Phase 2 adds depth attachment, plane creation, and plane draw to this same file.)

- [ ] **Step 4: Run all Phase 1 quality gates**

Run from project root:
```bash
bun run check
```
Expected: PASS (biome lint + format).

```bash
bun run typecheck
```
Expected: PASS.

```bash
bun test
```
Expected: PASS — the new `stats.test.ts` (4 tests) and the rewritten `entry.test.ts` (1 test) both pass.

---

### Task 5: Manual verification of Phase 1

**Files:** none. Verification only.

- [ ] **Step 1: Run `dev:web` and verify the overlay renders**

Run from project root:
```bash
bun run dev:web
```

Open `http://localhost:8765` in Chrome (or any browser with WebGPU support).

Expected:
- The triangle renders as before.
- A small monospace label appears in the top-left corner, e.g. `60 fps`.
- The label updates roughly once per second; the number should be close to the display refresh rate.

If the dev server logs an error like "no loader for .svelte" or "plugin not found," the fallback per spec risk 1 is to migrate from `serve.ts` to a direct `bun index.html` CLI invocation, reworking `PORT=` discovery. Stop here and consult the spec's risks section before proceeding.

- [ ] **Step 2: Verify browser HMR**

While `bun run dev:web` is running, edit `packages/core/src/overlay/FpsOverlay.svelte`. Change:
```css
top: 8px;
```
to:
```css
top: 24px;
```
Save the file.

Expected: the label moves down to 24px **without a full page reload** — the triangle stays continuously rendered (the canvas does not flash to its clear color).

If you see a full reload instead (canvas flashes, FPS resets), HMR is not active. This is a degraded but acceptable state for Phase 1 — note it.

Revert the change before continuing.

- [ ] **Step 3: Stop `dev:web` and run `dev:native`**

```bash
# Stop dev:web (Ctrl-C)
bun run dev:native
```

Expected (on macOS Tahoe 26+):
- A native window opens showing the same triangle and FPS overlay.
- Closing the window terminates the Bun child process. Run `ps aux | grep '[b]un'` after closing — there should be no leftover `bun` running serve.ts.

- [ ] **Step 4: Verify native HMR**

While `bun run dev:native` is running, edit `FpsOverlay.svelte` again — change `background: rgba(0, 0, 0, 0.5);` to `background: rgba(0.5, 0, 0, 0.5);` (red tint). Save.

Expected: the overlay's background tints red.
- If it tints without window reload: HMR-over-WebSocket works in the native webview. Good.
- If the window full-reloads: HMR-via-WebSocket isn't reaching the webview. This is the documented fallback path; note it but it's acceptable.
- If neither happens: stop and investigate before proceeding.

Revert the change. Stop the native binary.

---

### Task 6: Update BACKLOG for Phase 1 and commit

**Files:**
- Modify: `.docs/BACKLOG.md`

- [ ] **Step 1: Rewrite the existing "Svelte leaning" BACKLOG entry**

Open `.docs/BACKLOG.md`. Find the entry under `## Editor & tooling` that starts with:
```markdown
### UI framework + in-app surfaces (Svelte leaning)
```
Replace that entire entry (its title plus the **Context**, **Trigger to revisit**, **Reference** lines) with:
```markdown
### Svelte editor / inspector surfaces
**Context:** Svelte 5 is now the committed framework for screen-space DOM UI (see `docs/superpowers/specs/2026-05-17-ui-foundation-design.md`). The remaining work is editor and inspector surfaces that need to subscribe to engine state — particularly ECS components and entities once those exist.
**Trigger to revisit:** When ECS lands and we need fine-grained state subscription for an entity inspector, OR when the first interactive control panel (shader uniform tweaks, scene parameters) is needed.
**Reference:** Architecture doc §10. Shallot uses Svelte 5 with the runes/signals model.
```

- [ ] **Step 2: Append three new entries under `## Editor & tooling`**

Append the following three entries to the `## Editor & tooling` section (after the rewritten entry and the existing "Hot-reload for WGSL shaders" entry):

```markdown
### In-scene UI primitive evaluation (γ/δ/ε)
**Context:** Screen-space Svelte covers overlays; world-tracked DOM via CSS3D is constrained by lack of depth-buffer participation. For live, interactive, depth-occluded in-scene UI, the documented options are: γ WGSL-native SDF text + vector primitives (max integration, ~1–2 weeks for SDF text alone), δ static SVG-rasterized texture asset pipeline (cheapest, no live updates), ε `resvg` in wasm → texture (live but throttled <10Hz).
**Trigger to revisit:** First concrete in-game UI requirement — signage, character labels, an interactive panel a character can occlude.
**Reference:** `docs/superpowers/specs/2026-05-17-ui-foundation-design.md`, "Research write-up" section.

### Emerging-tech watch: WICG HTML-in-Canvas / Vello browser readiness
**Context:** The WICG "HTML in Canvas" proposal would let HTML elements live inside a canvas with native rasterization, depth participation, and accessibility object model integration. Linebender's Vello is a GPU vector graphics renderer in Rust+wgpu, but per Linebender's own docs the web is not currently a primary target. Either landing in production would collapse the in-scene UI design space.
**Trigger to revisit:** WICG proposal reaches Stage 2+, or Vello announces production web support.
**Reference:** `docs/superpowers/specs/2026-05-17-ui-foundation-design.md`, "Research write-up" section.

### SDF font atlas + glyph rendering
**Context:** The UI foundation milestone's in-scene plane uses `OffscreenCanvas.fillText` → texture (CPU 2D-canvas rasterization, suitable for 1Hz updates). Sharp text at varying scales or live per-frame text updates need a real SDF font atlas approach. Estimated ~1 week to ship well (atlas generation, glyph layout, distance-field shader).
**Trigger to revisit:** First in-scene surface needing sharp text at varying scales, or live per-frame text updates.
```

- [ ] **Step 3: Append one new entry under `## Testing & quality`**

Append to `## Testing & quality`:
```markdown
### Svelte formatting (Prettier or biome upgrade)
**Context:** Biome 2.x has partial `.svelte` support; the ecosystem standard is Prettier + the Svelte plugin. Currently `.svelte` files are not in biome's `files.includes` list, so they go unformatted. Acceptable for one ~25-line component; not at scale.
**Trigger to revisit:** `.svelte` content grows past ~3 components or ~200 lines total.
```

- [ ] **Step 4: Append one new entry under `## Engine architecture`**

Append to `## Engine architecture`:
```markdown
### Camera + projection matrices for in-scene primitives
**Context:** Both the triangle and the WGSL UI plane currently render in NDC space — no view, no projection. Once we need to position content in world space (which is approximately when ECS lands and entities have transforms), we need a camera with view/projection matrices and a uniform buffer pattern shared across pipelines.
**Trigger to revisit:** First surface needing world-space positioning, typically aligned with ECS arrival.
```

- [ ] **Step 5: Run final Phase 1 quality gates**

Run from project root:
```bash
bun run check && bun run typecheck && bun test
```
Expected: all pass.

- [ ] **Step 6: Commit Phase 1**

Run from project root:
```bash
git add packages/core/package.json packages/core/bunfig.toml packages/core/src/stats.ts packages/core/src/svelte.d.ts packages/core/src/overlay packages/core/tests/stats.test.ts packages/core/tests/entry.test.ts packages/core/src/entry.ts packages/core/index.html bun.lock .docs/BACKLOG.md
```
(If you needed to add `"svelte"` to `tsconfig.json` in Task 3 Step 5, also include `tsconfig.json` in the `git add`.)

```bash
git commit -m "$(cat <<'EOF'
feat(ui): add Svelte FPS counter overlay (Phase 1 of UI foundation)

Wires Svelte 5 into Bun's static-routes dev server via bun-plugin-svelte
(registered in packages/core/bunfig.toml). Adds an FpsStats source that
the RAF loop drives at frame rate; a 1Hz tick reads it and updates a
\$state rune that the FpsOverlay.svelte component subscribes to. The
overlay mounts into #ui-root (sibling of the canvas) and re-renders only
on the 1Hz tick — no DOM writes per frame.

entry.test.ts is decoupled from entry.ts (which now imports a .svelte
file via the overlay chain — bun test does not honor the dev server's
plugin config). The test now smoke-checks only the triangle WGSL source.

BACKLOG: supersedes the "Svelte leaning" entry; adds in-scene UI primitive
options, emerging-tech watch, SDF font atlas, Svelte formatting, and
camera+projection follow-ups.

Phase 2 (depth attachment + WGSL UI primitive) follows in the next commit.
EOF
)"
```
Expected: commit succeeds. `git status` reports a clean working tree.

---

## Phase 2 — WGSL UI primitive (depth-tested textured plane)

### Task 7: Bump triangle Z and add the depth attachment

**Files:**
- Modify: `packages/core/src/triangle.wgsl`
- Modify: `packages/core/src/entry.ts`

- [ ] **Step 1: Bump triangle vertex Z from 0.0 to 0.5**

In `packages/core/src/triangle.wgsl`, change line 8 from:
```wgsl
  return vec4f(pos[vi], 0.0, 1.0);
```
to:
```wgsl
  return vec4f(pos[vi], 0.5, 1.0);
```

This moves the triangle from the near plane (Z=0.0) to the middle of WebGPU's 0..1 depth range, leaving room for the plane to interleave on both sides.

- [ ] **Step 2: Add a depth attachment to `entry.ts` (triangle still the only primitive)**

In `packages/core/src/entry.ts`, make three changes.

**(a)** Add a module-level constant just below the imports (above `export async function main`):
```ts
const DEPTH_FORMAT: GPUTextureFormat = "depth24plus";
```

**(b)** Inside `main()`, after the `context.configure({ device, format, alphaMode: "premultiplied" });` line and BEFORE `device.pushErrorScope("validation");`, insert:
```ts
const depthTexture = device.createTexture({
  size: [canvas.width, canvas.height, 1],
  format: DEPTH_FORMAT,
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
});
const depthView = depthTexture.createView();
```

**(c)** Modify the existing triangle pipeline creation to include `depthStencil` state. Change:
```ts
const pipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: { module: shaderModule, entryPoint: "vs_main" },
  fragment: {
    module: shaderModule,
    entryPoint: "fs_main",
    targets: [{ format }],
  },
  primitive: { topology: "triangle-list" },
});
```
to:
```ts
const pipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: { module: shaderModule, entryPoint: "vs_main" },
  fragment: {
    module: shaderModule,
    entryPoint: "fs_main",
    targets: [{ format }],
  },
  primitive: { topology: "triangle-list" },
  depthStencil: {
    format: DEPTH_FORMAT,
    depthWriteEnabled: true,
    depthCompare: "less",
  },
});
```

**(d)** Modify the render pass inside `draw` to include the depth attachment. Change:
```ts
const pass = encoder.beginRenderPass({
  colorAttachments: [
    {
      view,
      clearValue: { r: 0.05, g: 0.05, b: 0.07, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    },
  ],
});
```
to:
```ts
const pass = encoder.beginRenderPass({
  colorAttachments: [
    {
      view,
      clearValue: { r: 0.05, g: 0.05, b: 0.07, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    },
  ],
  depthStencilAttachment: {
    view: depthView,
    depthLoadOp: "clear",
    depthClearValue: 1.0,
    depthStoreOp: "store",
  },
});
```

- [ ] **Step 3: Run quality gates**

```bash
bun run check && bun run typecheck && bun test
```
Expected: all pass. The shader smoke test still passes (the Z change adds a value but keeps `@vertex`, `@fragment`, `vs_main`, `fs_main`).

- [ ] **Step 4: Visual smoke check — triangle still renders correctly with depth enabled**

```bash
bun run dev:web
```
Open `http://localhost:8765`.

Expected: triangle still renders. The Z=0.5 change does not visually move the triangle (clip space is normalized for X/Y display; Z affects depth ordering only). FPS overlay still works.

If the triangle disappears: `depthClearValue: 1.0` (far) plus `depthCompare: "less"` plus triangle at Z=0.5 should pass the depth test (0.5 < 1.0). If it doesn't render, double-check those values.

Stop the dev server.

---

### Task 8: Implement the plane shader and pipeline module

**Files:**
- Create: `packages/core/src/scene/plane.wgsl`
- Create: `packages/core/src/scene/plane.ts`

- [ ] **Step 1: Create the plane shader**

Create `packages/core/src/scene/plane.wgsl`:
```wgsl
struct VertexInput {
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
};

struct VertexOutput {
  @builtin(position) clip_position: vec4f,
  @location(0) uv: vec2f,
};

@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.clip_position = vec4f(in.position, 1.0);
  out.uv = in.uv;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  return textureSample(tex, samp, in.uv);
}
```

- [ ] **Step 2: Create the plane pipeline module**

Create `packages/core/src/scene/plane.ts`:
```ts
import shaderUrl from "./plane.wgsl";

export interface UiPlane {
  draw(pass: GPURenderPassEncoder): void;
  dispose(): void;
}

interface CreatePlaneOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
  depthFormat: GPUTextureFormat;
  texture: GPUTexture;
  sampler: GPUSampler;
}

// Quad vertices: position (x, y, z) + uv. Z varies left-to-right so the plane
// tilts in depth and visibly interleaves with the triangle (Z=0.5).
const VERTICES = new Float32Array([
  // x,    y,    z,   u,   v
   0.0,  0.2, 0.3,  0.0, 0.0, // top-left
   0.8,  0.2, 0.7,  1.0, 0.0, // top-right
   0.0, -0.4, 0.3,  0.0, 1.0, // bottom-left
   0.8, -0.4, 0.7,  1.0, 1.0, // bottom-right
]);
const INDICES = new Uint16Array([
  0, 2, 1,
  1, 2, 3,
]);

export async function createUiPlane({
  device,
  format,
  depthFormat,
  texture,
  sampler,
}: CreatePlaneOptions): Promise<UiPlane> {
  const shaderResponse = await fetch(shaderUrl);
  if (!shaderResponse.ok) {
    throw new Error(
      `Couldn't load plane shader (HTTP ${shaderResponse.status}): ${shaderUrl}`,
    );
  }
  const shaderSource = await shaderResponse.text();

  const shaderModule = device.createShaderModule({ code: shaderSource });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });

  device.pushErrorScope("validation");
  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: "vs_main",
      buffers: [
        {
          arrayStride: 5 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 3 * 4, format: "float32x2" },
          ],
        },
      ],
    },
    fragment: {
      module: shaderModule,
      entryPoint: "fs_main",
      targets: [{ format }],
    },
    primitive: { topology: "triangle-list" },
    depthStencil: {
      format: depthFormat,
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });
  const validationError = await device.popErrorScope();
  if (validationError) {
    throw new Error(
      `Plane pipeline validation: ${validationError.message}`,
    );
  }

  const vertexBuffer = device.createBuffer({
    size: VERTICES.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, VERTICES);

  const indexBuffer = device.createBuffer({
    size: INDICES.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, INDICES);

  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: texture.createView() },
      { binding: 1, resource: sampler },
    ],
  });

  return {
    draw(pass) {
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.setIndexBuffer(indexBuffer, "uint16");
      pass.drawIndexed(INDICES.length);
    },
    dispose() {
      vertexBuffer.destroy();
      indexBuffer.destroy();
    },
  };
}
```

- [ ] **Step 3: Run quality gates**

```bash
bun run check && bun run typecheck
```
Expected: PASS. (Tests don't cover the plane module — it requires a WebGPU device, which is browser-only.)

---

### Task 9: Implement the text-canvas module

**Files:**
- Create: `packages/core/src/scene/text-canvas.ts`

- [ ] **Step 1: Create `text-canvas.ts`**

Create `packages/core/src/scene/text-canvas.ts`:
```ts
const WIDTH = 512;
const HEIGHT = 128;

export interface TextCanvas {
  texture: GPUTexture;
  update(fps: number): void;
  dispose(): void;
}

export function createTextCanvas(device: GPUDevice): TextCanvas {
  const offscreen = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = offscreen.getContext("2d");
  if (!ctx) {
    throw new Error("OffscreenCanvas 2D context unavailable");
  }

  const texture = device.createTexture({
    size: [WIDTH, HEIGHT, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  return {
    texture,
    update(fps) {
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = "#fff";
      ctx.font = "48px ui-monospace, monospace";
      ctx.fillText(`${fps} fps`, 16, 80);
      try {
        // flipY left at its default (false). Texture row 0 maps to canvas row 0
        // (canvas top), and UV.y=0 samples texture row 0. The plane's top edge
        // has UV.y=0, so the text painted near the canvas top appears at the
        // plane's top edge. If the visual reads upside-down in execution, set
        // `flipY: true` here.
        device.queue.copyExternalImageToTexture(
          { source: offscreen },
          { texture },
          [WIDTH, HEIGHT],
        );
      } catch (e) {
        console.warn("text-canvas: copyExternalImageToTexture failed:", e);
      }
    },
    dispose() {
      texture.destroy();
    },
  };
}
```

- [ ] **Step 2: Run quality gates**

```bash
bun run check && bun run typecheck
```
Expected: PASS.

---

### Task 10: Wire plane and text-canvas into entry.ts; add plane WGSL to smoke test

**Files:**
- Modify: `packages/core/src/entry.ts`
- Modify: `packages/core/tests/entry.test.ts`

- [ ] **Step 1: Add plane WGSL to the shader smoke test**

Replace `packages/core/tests/entry.test.ts` contents with:
```ts
import { expect, test } from "bun:test";
import triangleShader from "../src/triangle.wgsl" with { type: "text" };
import planeShader from "../src/scene/plane.wgsl" with { type: "text" };

test("triangle WGSL declares vertex and fragment entry points", () => {
  expect(triangleShader.length).toBeGreaterThan(0);
  expect(triangleShader).toContain("@vertex");
  expect(triangleShader).toContain("@fragment");
  expect(triangleShader).toContain("vs_main");
  expect(triangleShader).toContain("fs_main");
});

test("plane WGSL declares vertex and fragment entry points", () => {
  expect(planeShader.length).toBeGreaterThan(0);
  expect(planeShader).toContain("@vertex");
  expect(planeShader).toContain("@fragment");
  expect(planeShader).toContain("vs_main");
  expect(planeShader).toContain("fs_main");
});
```

- [ ] **Step 2: Add plane and text-canvas wiring to entry.ts**

In `packages/core/src/entry.ts`:

**(a)** Add two new imports below the existing imports:
```ts
import { createUiPlane } from "./scene/plane.ts";
import { createTextCanvas } from "./scene/text-canvas.ts";
```

**(b)** Inside `main()`, after the existing `validationError` check (i.e., after the triangle pipeline is verified), add:
```ts
const textCanvas = createTextCanvas(device);
const sampler = device.createSampler({
  magFilter: "linear",
  minFilter: "linear",
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge",
});
const uiPlane = await createUiPlane({
  device,
  format,
  depthFormat: DEPTH_FORMAT,
  texture: textCanvas.texture,
  sampler,
});
```

**(c)** Update the existing `initStats` call so it also updates the text canvas. Change:
```ts
const stats = initStats({
  onTick: (fps) => {
    overlayState.fps = fps;
  },
});
```
to:
```ts
const stats = initStats({
  onTick: (fps) => {
    overlayState.fps = fps;
    textCanvas.update(fps);
  },
});
```

**(d)** Update the `draw` function to draw the plane after the triangle. Inside `draw`, after `pass.draw(3);` and before `pass.end();`, insert:
```ts
uiPlane.draw(pass);
```

- [ ] **Step 3: Run all Phase 2 quality gates**

```bash
bun run check && bun run typecheck && bun test
```
Expected: PASS (existing stats tests + 2 shader smoke tests).

---

### Task 11: Manual verification of Phase 2

**Files:** none. Verification only.

- [ ] **Step 1: Run `dev:web` and verify both surfaces**

```bash
bun run dev:web
```

Open `http://localhost:8765`.

Expected:
- Triangle visible (now at Z=0.5).
- Svelte FPS overlay in the top-left corner, updating ~1Hz.
- WGSL textured plane visible in the right half of the canvas, partially overlapping the triangle's right side.
- The plane shows `N fps` text on a semi-transparent dark backdrop.
- **Both numbers match** the FPS overlay.
- **Depth interleave is visible:** in the overlap zone between plane and triangle, the plane's left edge renders **in front** of the triangle (covers it), and the plane's right edge renders **behind** the triangle (hidden by it). Beyond the triangle's right boundary, the plane renders cleanly on its own.

- [ ] **Step 2: If interleave doesn't read clearly, tune the plane Z values**

If the plane renders entirely in front of, or entirely behind, the triangle (no visible per-pixel interleave), open `packages/core/src/scene/plane.ts` and adjust the Z components in the `VERTICES` array:

- Plane always in front → increase right-edge Z. Try `0.7 → 0.85`.
- Plane always behind → decrease left-edge Z. Try `0.3 → 0.15`.
- If interleave is visible, no change needed.

(The acceptance criterion is "visible depth interleave with the triangle." Z values are tuning variables.)

If the text appears upside-down in the plane, edit `packages/core/src/scene/text-canvas.ts`, and change:
```ts
{ source: offscreen },
```
to:
```ts
{ source: offscreen, flipY: true },
```

- [ ] **Step 3: Verify FPS values match between overlay and plane**

Visually compare the integer in the top-left overlay vs the integer in the plane. They should be the same number. If they differ, both surfaces should be reading from the same `fps` parameter in the `onTick` callback — re-check `entry.ts`.

- [ ] **Step 4: Run `dev:native` and verify the same scene**

```bash
# Stop dev:web (Ctrl-C)
bun run dev:native
```

Expected on macOS Tahoe 26+:
- Identical scene to browser — triangle, overlay, plane, depth interleave, matching FPS numbers.

**Watch the dev server stdout** for any `text-canvas: copyExternalImageToTexture failed` warnings. If the plane is visible but its text region is blank (uniform dark backdrop with no visible "N fps" label), `copyExternalImageToTexture` is failing in this webview. Fallback per spec risk 2: edit `text-canvas.ts` to replace the `OffscreenCanvas` with a hidden `HTMLCanvasElement`:
```ts
const offscreen = document.createElement("canvas");
offscreen.width = WIDTH;
offscreen.height = HEIGHT;
```
And change the type annotation accordingly. Same `copyExternalImageToTexture` API call should then succeed.

- [ ] **Step 5: Verify Svelte HMR still works in the native runtime**

While `dev:native` is running, edit `FpsOverlay.svelte` (e.g., change `background:` color). Save.
Expected: overlay updates (HMR) or window reloads (fallback). Either is acceptable per spec.

Revert the change. Stop the native binary.

- [ ] **Step 6: Confirm clean child-process exit**

After stopping `dev:native`, run:
```bash
ps aux | grep '[b]un'
```
Expected: no orphaned `bun` processes serving `serve.ts`. (The Rust host's best-effort `Drop` impl should have killed it.)

---

### Task 12: Commit Phase 2

**Files:** none — only commits already-edited files.

- [ ] **Step 1: Stage Phase 2 files**

From project root:
```bash
git add packages/core/src/triangle.wgsl packages/core/src/entry.ts packages/core/src/scene packages/core/tests/entry.test.ts
```

(If you needed to tune Z values in plane.ts or switch to HTMLCanvasElement in text-canvas.ts during verification, those files are already inside `packages/core/src/scene` and will be staged.)

- [ ] **Step 2: Commit Phase 2**

```bash
git commit -m "$(cat <<'EOF'
feat(scene): add WGSL UI plane primitive (Phase 2 of UI foundation)

Introduces depth-tested in-scene rendering. scene/plane.{ts,wgsl}
defines a textured-quad pipeline that renders a 2D-canvas-rasterized
FPS label on a Z-tilted quad. scene/text-canvas.ts owns an
OffscreenCanvas + GPUTexture pair; the 1Hz stats tick paints the FPS
number into the canvas via the 2D Canvas API and uploads via
copyExternalImageToTexture — the canvas is the text rasterizer, WGSL
is the in-scene compositor.

triangle.wgsl's vertex Z bumps from 0.0 to 0.5 so the plane can sit on
both sides of it in WebGPU's 0..1 depth range. entry.ts gains a
depth24plus attachment shared by both pipelines, so the plane and the
triangle interleave per-pixel in the same render pass.

Both surfaces (Svelte overlay, WGSL plane) display the same FPS number
from one FpsStats source. DOM is never written, texture is never
uploaded, inside the RAF loop — only on the 1Hz tick.

Completes the UI foundation milestone per
docs/superpowers/specs/2026-05-17-ui-foundation-design.md.
EOF
)"
```
Expected: commit succeeds.

- [ ] **Step 3: Final verification**

```bash
bun run check && bun run typecheck && bun test
git status
```
Expected: all checks pass; working tree is clean. Milestone complete.
