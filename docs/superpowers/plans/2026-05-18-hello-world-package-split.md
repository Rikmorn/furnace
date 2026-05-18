# Hello-World Package Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `packages/core/` into a headless, consumer-portable `@furnace/core` engine library plus a new `@furnace/hello-world` consumer package that demonstrates the engine by rendering the existing WebGPU triangle with the FPS overlay.

**Architecture:** Core exports primitives (`requestWebGpu`, `runFrameLoop`, `createFpsSystem`) under `src/lib/{gpu,stats}/`. Demo content (HTML, Svelte overlay, triangle WGSL, dev server, pipeline) moves to `packages/hello-world/` and imports core via the workspace's `@furnace/core` alias. A `no-bun-leakage` test enforces that core's public surface contains no `Bun.*` globals or `bun:*` imports.

**Tech Stack:** Bun workspace, TypeScript (strict, noEmit), Svelte 5 (hello-world only), WebGPU, Rust `winit + wry` native window crate (unchanged content, one constant repointed).

**Spec:** `docs/superpowers/specs/2026-05-18-hello-world-package-split-design.md`

**Deviation from spec's commit-order section:** The spec proposes a two-commit sequence for review. This plan uses fine-grained per-task commits (~15) instead. Rationale: TDD-style frequent commits give bisect-friendly history during execution; the "two logical commits" framing is a review-time concern that can be addressed at PR time via squash/reword if needed.

---

## Pre-flight check

Before starting, verify the workspace is clean and on the right branch:

- [ ] **Step 0.1: Verify clean working tree**

```bash
git status
```

Expected: `nothing to commit, working tree clean`. If not clean, stash or commit existing changes first.

- [ ] **Step 0.2: Verify baseline tests pass**

```bash
bun install && bun test && bun run --cwd packages/core typecheck
```

Expected: all tests pass, typecheck succeeds. This is the baseline; if anything fails here, fix it before starting (a regression introduced by this plan would be misattributed).

---

## Phase 1: Add new FpsSystem API in place (TDD)

Add the multi-subscriber `createFpsSystem` API alongside the existing `initStats` in `packages/core/src/stats.ts`. The old API stays for now so the existing `entry.ts` keeps working; we'll remove it in Phase 2 when we move the file.

### Task 1: Add `createFpsSystem` with TDD

**Files:**
- Modify: `packages/core/src/stats.ts` — add new API alongside existing
- Modify: `packages/core/tests/stats.test.ts` — add new tests alongside existing

- [ ] **Step 1.1: Write failing tests for the new API**

Append to `packages/core/tests/stats.test.ts`:

```ts
import { createFpsSystem } from "../src/stats.ts";

test("createFpsSystem: subscribe receives ticks", () => {
  let nowMs = 0;
  const received: number[] = [];
  const system = createFpsSystem({
    intervalMs: 1000,
    now: () => nowMs,
  });
  system.subscribe((fps) => received.push(fps));

  // Mark 60 frames over a 1-second window, then advance the clock.
  for (let i = 0; i < 60; i++) system.frame();
  nowMs = 1000;
  // setInterval would fire on a real timer; we can't easily simulate that
  // without faking timers. Instead, we test computeFps + tick logic via the
  // dispose path: dispose() is a no-op, so this test only verifies that
  // subscribe() doesn't throw and that the listener is wired. The actual
  // tick-firing is exercised by the integration via runFrameLoop in dev.
  expect(typeof system.subscribe).toBe("function");
  expect(typeof system.frame).toBe("function");
  expect(typeof system.dispose).toBe("function");
  expect(system.current).toBe(0);
  system.dispose();
});

test("createFpsSystem: subscribe returns an unsubscribe function", () => {
  const system = createFpsSystem();
  const unsubscribe = system.subscribe(() => {});
  expect(typeof unsubscribe).toBe("function");
  unsubscribe(); // does not throw
  system.dispose();
});

test("createFpsSystem: supports multiple subscribers independently", () => {
  const system = createFpsSystem();
  const a = system.subscribe(() => {});
  const b = system.subscribe(() => {});
  expect(typeof a).toBe("function");
  expect(typeof b).toBe("function");
  a();
  b();
  system.dispose();
});

test("createFpsSystem: current reflects last computed value via injected tick", () => {
  // Test the rollover math directly by injecting a controllable `now`.
  let nowMs = 0;
  const system = createFpsSystem({
    intervalMs: 1000,
    now: () => nowMs,
  });
  // Frame 60 times, then advance virtual time by 1s and call the internal
  // tick directly via dispose+recreate is awkward — easier to assert that
  // `current` starts at 0 and is updated only via internal setInterval
  // (which we can't trigger from a unit test without fake timers).
  // For now, assert the initial state contract.
  expect(system.current).toBe(0);
  system.dispose();
});

test("createFpsSystem: dispose stops the interval (no throws on double dispose)", () => {
  const system = createFpsSystem();
  system.dispose();
  expect(() => system.dispose()).not.toThrow();
});
```

> **Note on test scope:** Bun's test runner doesn't ship fake timers out of the box, and adding a third-party fake-timer dep for this single use case is overkill. The tests above verify the API surface (subscribe returns unsubscribe, multi-subscribers don't interfere, dispose is idempotent, initial current is 0). The rollover math (frames → fps over an interval) is already covered by the existing `computeFps` tests. The end-to-end integration is verified manually in Phase 11 (the on-screen FPS counter updates).

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
bun test packages/core/tests/stats.test.ts
```

Expected: 5 FAIL lines mentioning `createFpsSystem is not a function` or similar import error.

- [ ] **Step 1.3: Implement `createFpsSystem` in `stats.ts`**

Append to `packages/core/src/stats.ts` (keep existing exports — `initStats` stays for now):

```ts
export interface FpsSystemOptions {
  intervalMs?: number;
  now?: () => number;
}

export interface FpsSystem {
  frame(): void;
  subscribe(listener: (fps: number) => void): () => void;
  readonly current: number;
  dispose(): void;
}

export function createFpsSystem(options: FpsSystemOptions = {}): FpsSystem {
  const intervalMs = options.intervalMs ?? 1000;
  const now = options.now ?? (() => performance.now());

  let frames = 0;
  let lastTickAt = now();
  let current = 0;
  let disposed = false;
  const listeners = new Set<(fps: number) => void>();

  const tick = (): void => {
    const nowMs = now();
    const elapsedSeconds = (nowMs - lastTickAt) / 1000;
    current = computeFps(frames, elapsedSeconds);
    frames = 0;
    lastTickAt = nowMs;
    for (const listener of listeners) listener(current);
  };

  const intervalId = setInterval(tick, intervalMs);

  return {
    frame: () => {
      frames++;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get current() {
      return current;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearInterval(intervalId);
      listeners.clear();
    },
  };
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
bun test packages/core/tests/stats.test.ts
```

Expected: all tests pass (including the 4 existing `computeFps` tests and the 5 new ones — 9 total).

- [ ] **Step 1.5: Run typecheck**

```bash
bun run --cwd packages/core typecheck
```

Expected: no errors.

- [ ] **Step 1.6: Commit**

```bash
git add packages/core/src/stats.ts packages/core/tests/stats.test.ts
git commit -m "feat(core): add createFpsSystem multi-subscriber API alongside initStats"
```

---

## Phase 2: Reshape core's source layout into `lib/`

Move `stats.ts` into `lib/stats/fps.ts`, drop the legacy `initStats` API (and its types), and update the existing `entry.ts` to use `createFpsSystem`.

### Task 2: Move stats + update entry.ts

**Files:**
- Move: `packages/core/src/stats.ts` → `packages/core/src/lib/stats/fps.ts`
- Move: `packages/core/tests/stats.test.ts` → `packages/core/tests/lib/stats/fps.test.ts`
- Modify: the moved `fps.ts` — drop `initStats`, `StatsCallback`, `FpsStats`, `StatsOptions`
- Modify: the moved test — drop `initStats`/old-API tests, keep `computeFps` + `createFpsSystem` tests, update import path
- Modify: `packages/core/src/entry.ts` — use `createFpsSystem` instead of `initStats`, import from new path

- [ ] **Step 2.1: Create the new directory structure and git-mv the source file**

```bash
mkdir -p packages/core/src/lib/stats packages/core/tests/lib/stats
git mv packages/core/src/stats.ts packages/core/src/lib/stats/fps.ts
git mv packages/core/tests/stats.test.ts packages/core/tests/lib/stats/fps.test.ts
```

- [ ] **Step 2.2: Drop the legacy API from the moved `fps.ts`**

Overwrite `packages/core/src/lib/stats/fps.ts` to contain only the new API + `computeFps`:

```ts
export function computeFps(frames: number, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0) return 0;
  return Math.round(frames / elapsedSeconds);
}

export interface FpsSystemOptions {
  intervalMs?: number;
  now?: () => number;
}

export interface FpsSystem {
  frame(): void;
  subscribe(listener: (fps: number) => void): () => void;
  readonly current: number;
  dispose(): void;
}

export function createFpsSystem(options: FpsSystemOptions = {}): FpsSystem {
  const intervalMs = options.intervalMs ?? 1000;
  const now = options.now ?? (() => performance.now());

  let frames = 0;
  let lastTickAt = now();
  let current = 0;
  let disposed = false;
  const listeners = new Set<(fps: number) => void>();

  const tick = (): void => {
    const nowMs = now();
    const elapsedSeconds = (nowMs - lastTickAt) / 1000;
    current = computeFps(frames, elapsedSeconds);
    frames = 0;
    lastTickAt = nowMs;
    for (const listener of listeners) listener(current);
  };

  const intervalId = setInterval(tick, intervalMs);

  return {
    frame: () => {
      frames++;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get current() {
      return current;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearInterval(intervalId);
      listeners.clear();
    },
  };
}
```

- [ ] **Step 2.3: Update the moved test's import path and drop legacy-API tests**

Overwrite `packages/core/tests/lib/stats/fps.test.ts` to contain only the live tests against the new module path:

```ts
import { expect, test } from "bun:test";
import { computeFps, createFpsSystem } from "../../../src/lib/stats/fps.ts";

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

test("createFpsSystem: subscribe returns an unsubscribe function", () => {
  const system = createFpsSystem();
  const unsubscribe = system.subscribe(() => {});
  expect(typeof unsubscribe).toBe("function");
  unsubscribe();
  system.dispose();
});

test("createFpsSystem: supports multiple subscribers independently", () => {
  const system = createFpsSystem();
  const a = system.subscribe(() => {});
  const b = system.subscribe(() => {});
  expect(typeof a).toBe("function");
  expect(typeof b).toBe("function");
  a();
  b();
  system.dispose();
});

test("createFpsSystem: current is 0 before any tick has fired", () => {
  const system = createFpsSystem();
  expect(system.current).toBe(0);
  system.dispose();
});

test("createFpsSystem: dispose is idempotent", () => {
  const system = createFpsSystem();
  system.dispose();
  expect(() => system.dispose()).not.toThrow();
});

test("createFpsSystem: exposes frame/subscribe/dispose/current contract", () => {
  const system = createFpsSystem();
  expect(typeof system.frame).toBe("function");
  expect(typeof system.subscribe).toBe("function");
  expect(typeof system.dispose).toBe("function");
  expect(system.current).toBe(0);
  system.dispose();
});
```

- [ ] **Step 2.4: Update `entry.ts` to use the new API + new path**

Edit `packages/core/src/entry.ts`. Replace the `initStats` import block and the FPS wiring:

```diff
- import { initStats } from "./stats.ts";
+ import { createFpsSystem } from "./lib/stats/fps.ts";
```

And in the body of `main()`, replace:

```diff
-   const stats = initStats({
-     onTick: (fps) => {
-       overlayState.fps = fps;
-     },
-   });
+   const stats = createFpsSystem();
+   stats.subscribe((fps) => {
+     overlayState.fps = fps;
+   });
```

- [ ] **Step 2.5: Run tests**

```bash
bun test
```

Expected: 9 tests pass (4 computeFps + 5 createFpsSystem + the existing `triangle WGSL` test from `entry.test.ts`).

- [ ] **Step 2.6: Run typecheck**

```bash
bun run --cwd packages/core typecheck
```

Expected: no errors.

- [ ] **Step 2.7: Commit**

```bash
git add packages/core/src/lib/stats/fps.ts \
        packages/core/src/entry.ts \
        packages/core/tests/lib/stats/fps.test.ts
git rm --cached packages/core/src/stats.ts packages/core/tests/stats.test.ts 2>/dev/null || true
git commit -m "refactor(core): move stats.ts to lib/stats/fps.ts; drop legacy initStats API"
```

(The `git rm --cached` lines are defensive — the `git mv` in Step 2.1 already staged the renames; this catches the case where the moves landed as add+delete instead.)

---

## Phase 3: Extract the WebGPU bootstrap helper

Pull the adapter/device/context/DPR/format setup out of `entry.ts` into a reusable `requestWebGpu` function under `lib/gpu/`.

### Task 3: Create `lib/gpu/requestWebGpu.ts` and use it from entry.ts

**Files:**
- Create: `packages/core/src/lib/gpu/requestWebGpu.ts`
- Modify: `packages/core/src/entry.ts` — replace inline setup with a call to `requestWebGpu`

- [ ] **Step 3.1: Create the new file**

```bash
mkdir -p packages/core/src/lib/gpu
```

Write `packages/core/src/lib/gpu/requestWebGpu.ts`:

```ts
export interface WebGpuContext {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly canvas: HTMLCanvasElement;
}

export async function requestWebGpu(
  canvas: HTMLCanvasElement,
): Promise<WebGpuContext> {
  if (!navigator.gpu) {
    throw new Error(
      "WebGPU unavailable. Need a recent Chrome/Safari/Firefox, or macOS Tahoe 26+ inside the native webview.",
    );
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("WebGPU adapter not available. GPU may not be supported.");
  }

  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu");
  if (!context) {
    throw new Error("Couldn't get WebGPU canvas context.");
  }

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  return { device, context, format, canvas };
}
```

- [ ] **Step 3.2: Update `entry.ts` to use `requestWebGpu`**

Edit `packages/core/src/entry.ts`. Replace the imports block at the top:

```diff
  import { mountFpsOverlay } from "./overlay/mount.ts";
  import { overlayState } from "./overlay/state.svelte.ts";
  import { createFpsSystem } from "./lib/stats/fps.ts";
+ import { requestWebGpu } from "./lib/gpu/requestWebGpu.ts";
  import shaderUrl from "./triangle.wgsl";
```

Replace the inline WebGPU setup (the block from `if (!navigator.gpu)` through `context.configure(...)`) with:

```ts
  let webgpu: import("./lib/gpu/requestWebGpu.ts").WebGpuContext;
  try {
    webgpu = await requestWebGpu(canvas);
  } catch (e) {
    document.body.innerText = e instanceof Error ? e.message : String(e);
    return;
  }
  const { device, context, format } = webgpu;
```

Keep the shader-fetch block, pipeline creation, and draw loop unchanged.

- [ ] **Step 3.3: Verify typecheck**

```bash
bun run --cwd packages/core typecheck
```

Expected: no errors.

- [ ] **Step 3.4: Run tests**

```bash
bun test
```

Expected: all tests pass (no test changes; just verifying no regressions).

- [ ] **Step 3.5: Commit**

```bash
git add packages/core/src/lib/gpu/requestWebGpu.ts packages/core/src/entry.ts
git commit -m "refactor(core): extract requestWebGpu helper to lib/gpu/"
```

---

## Phase 4: Extract the frame loop wrapper

### Task 4: Create `lib/gpu/runFrameLoop.ts` and use it from entry.ts

**Files:**
- Create: `packages/core/src/lib/gpu/runFrameLoop.ts`
- Modify: `packages/core/src/entry.ts` — replace inline RAF with `runFrameLoop`

- [ ] **Step 4.1: Create the new file**

Write `packages/core/src/lib/gpu/runFrameLoop.ts`:

```ts
export type FrameCallback = (timestampMs: number) => void;

export interface FrameLoopHandle {
  stop(): void;
}

export function runFrameLoop(onFrame: FrameCallback): FrameLoopHandle {
  let rafId = 0;
  let stopped = false;

  const tick = (timestampMs: number): void => {
    if (stopped) return;
    onFrame(timestampMs);
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(rafId);
    },
  };
}
```

- [ ] **Step 4.2: Update `entry.ts` to use `runFrameLoop`**

Edit `packages/core/src/entry.ts`. Add to the imports:

```diff
  import { requestWebGpu } from "./lib/gpu/requestWebGpu.ts";
+ import { runFrameLoop } from "./lib/gpu/runFrameLoop.ts";
```

Replace the bottom of `main()` (the `const draw = (): void => {...}; requestAnimationFrame(draw);` block) with:

```ts
  runFrameLoop(() => {
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
  });
```

- [ ] **Step 4.3: Verify typecheck**

```bash
bun run --cwd packages/core typecheck
```

Expected: no errors.

- [ ] **Step 4.4: Run tests**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add packages/core/src/lib/gpu/runFrameLoop.ts packages/core/src/entry.ts
git commit -m "refactor(core): extract runFrameLoop helper to lib/gpu/"
```

---

## Phase 5: Create the public surface for `@furnace/core`

### Task 5: Create `src/index.ts` with all public exports

**Files:**
- Create: `packages/core/src/index.ts`

- [ ] **Step 5.1: Create the public-surface file**

Write `packages/core/src/index.ts`:

```ts
export { requestWebGpu } from "./lib/gpu/requestWebGpu.ts";
export type { WebGpuContext } from "./lib/gpu/requestWebGpu.ts";

export { runFrameLoop } from "./lib/gpu/runFrameLoop.ts";
export type { FrameCallback, FrameLoopHandle } from "./lib/gpu/runFrameLoop.ts";

export { computeFps, createFpsSystem } from "./lib/stats/fps.ts";
export type { FpsSystem, FpsSystemOptions } from "./lib/stats/fps.ts";
```

- [ ] **Step 5.2: Verify typecheck**

```bash
bun run --cwd packages/core typecheck
```

Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): add public surface (src/index.ts)"
```

---

## Phase 6: Create the hello-world package skeleton

### Task 6: Create `packages/hello-world/package.json`

**Files:**
- Create: `packages/hello-world/package.json`

- [ ] **Step 6.1: Create the package directory**

```bash
mkdir -p packages/hello-world/src/overlay packages/hello-world/tests
```

- [ ] **Step 6.2: Write the package.json**

Write `packages/hello-world/package.json`:

```jsonc
{
  "name": "@furnace/hello-world",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --hot serve.ts",
    "dev:native": "bun run --cwd ../core build:native && ../../dist/native/furnace-window",
    "build:web": "bun build index.html --outdir ../../dist/web --minify --sourcemap=external",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  },
  "dependencies": {
    "@furnace/core": "workspace:*"
  },
  "devDependencies": {
    "bun-plugin-svelte": "^0.0.6",
    "svelte": "^5.55.7"
  }
}
```

- [ ] **Step 6.3: Run `bun install` from the workspace root to create workspace symlinks**

```bash
bun install
```

Expected: install succeeds, output mentions the new workspace package. Verify the symlink:

```bash
ls -la packages/hello-world/node_modules/@furnace/core
```

Expected: symlink target points at `../../../core`.

- [ ] **Step 6.4: Commit**

```bash
git add packages/hello-world/package.json bun.lock
git commit -m "feat(hello-world): scaffold @furnace/hello-world package with @furnace/core dep"
```

---

## Phase 7: Move demo files from core to hello-world

This is the bulk move. Files are relocated with `git mv` so history is preserved.

### Task 7: Move HTML, dev server, bunfig, triangle, overlay, type decls

**Files moved (all with `git mv`):**
- `packages/core/index.html` → `packages/hello-world/index.html`
- `packages/core/serve.ts` → `packages/hello-world/serve.ts`
- `packages/core/bunfig.toml` → `packages/hello-world/bunfig.toml`
- `packages/core/src/triangle.wgsl` → `packages/hello-world/src/triangle.wgsl`
- `packages/core/src/svelte.d.ts` → `packages/hello-world/src/svelte.d.ts`
- `packages/core/src/wgsl.d.ts` → `packages/hello-world/src/wgsl.d.ts`
- `packages/core/src/overlay/FpsOverlay.svelte` → `packages/hello-world/src/overlay/FpsOverlay.svelte`
- `packages/core/src/overlay/mount.ts` → `packages/hello-world/src/overlay/mount.ts`
- `packages/core/src/overlay/state.svelte.ts` → `packages/hello-world/src/overlay/state.svelte.ts`
- `packages/core/src/entry.ts` → `packages/hello-world/src/entry.ts`
- `packages/core/src/bootstrap.ts` → DELETED (collapsed into the moved entry.ts in Task 8)
- `packages/core/tests/entry.test.ts` → `packages/hello-world/tests/triangle-shader.test.ts`

- [ ] **Step 7.1: Move all files with `git mv`**

```bash
git mv packages/core/index.html packages/hello-world/index.html
git mv packages/core/serve.ts packages/hello-world/serve.ts
git mv packages/core/bunfig.toml packages/hello-world/bunfig.toml
git mv packages/core/src/triangle.wgsl packages/hello-world/src/triangle.wgsl
git mv packages/core/src/svelte.d.ts packages/hello-world/src/svelte.d.ts
git mv packages/core/src/wgsl.d.ts packages/hello-world/src/wgsl.d.ts
git mv packages/core/src/overlay/FpsOverlay.svelte packages/hello-world/src/overlay/FpsOverlay.svelte
git mv packages/core/src/overlay/mount.ts packages/hello-world/src/overlay/mount.ts
git mv packages/core/src/overlay/state.svelte.ts packages/hello-world/src/overlay/state.svelte.ts
git mv packages/core/src/entry.ts packages/hello-world/src/entry.ts
git mv packages/core/tests/entry.test.ts packages/hello-world/tests/triangle-shader.test.ts
git rm packages/core/src/bootstrap.ts
```

- [ ] **Step 7.2: Remove now-empty core directories**

```bash
rmdir packages/core/src/overlay 2>/dev/null || true
```

(`packages/core/tests/` is not empty — `lib/stats/fps.test.ts` still lives there.)

- [ ] **Step 7.3: Do NOT commit yet — broken state**

The moved `entry.ts`, `state.svelte.ts`, and test files have stale relative imports (pointing at `./lib/...` which no longer exists in their new location). Phase 8 fixes those before any commit.

---

## Phase 8: Rewire moved files to use `@furnace/core` and the new local layout

### Task 8: Update hello-world's entry.ts, state.svelte.ts, overlay, serve.ts, index.html, and test

**Files:**
- Modify: `packages/hello-world/src/entry.ts` — collapse bootstrap.ts into it; switch to `@furnace/core` imports
- Modify: `packages/hello-world/src/overlay/state.svelte.ts` — own the FpsSystem instance, change state shape to `{value: number}`
- Modify: `packages/hello-world/src/overlay/FpsOverlay.svelte` — match the new state shape
- Modify: `packages/hello-world/index.html` — point `<script>` at `./src/entry.ts` (no more bootstrap.ts)
- Modify: `packages/hello-world/serve.ts` — add `FURNACE_PORT` env-var override
- Modify: `packages/hello-world/tests/triangle-shader.test.ts` — update import path

- [ ] **Step 8.1: Rewrite `packages/hello-world/src/entry.ts`**

Overwrite the file (it's been moved; this is the final post-collapse form). The UI subscribe lives in `state.svelte.ts` (Step 8.2) — `entry.ts` only needs the `fpsSystem` instance to call `frame()` in the render loop:

```ts
import { requestWebGpu, runFrameLoop } from "@furnace/core";
import { mountFpsOverlay } from "./overlay/mount.ts";
import { fpsSystem } from "./overlay/state.svelte.ts";
import shaderUrl from "./triangle.wgsl";

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#gpu");
  const uiRoot = document.querySelector<HTMLElement>("#ui-root");
  if (!canvas) throw new Error("canvas#gpu not found");
  if (!uiRoot) throw new Error("#ui-root not found");

  const shaderResponse = await fetch(shaderUrl);
  if (!shaderResponse.ok) {
    document.body.innerText = `Couldn't load shader (HTTP ${shaderResponse.status}): ${shaderUrl}`;
    return;
  }
  const shaderSource = await shaderResponse.text();

  let device: GPUDevice;
  let context: GPUCanvasContext;
  let format: GPUTextureFormat;
  try {
    ({ device, context, format } = await requestWebGpu(canvas));
  } catch (e) {
    document.body.innerText = e instanceof Error ? e.message : String(e);
    return;
  }

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

  mountFpsOverlay(uiRoot);

  runFrameLoop(() => {
    fpsSystem.frame();
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
  });
}

main().catch((e: unknown) => {
  document.body.innerText = `Error: ${e instanceof Error ? e.message : String(e)}`;
});
```

- [ ] **Step 8.2: Rewrite `packages/hello-world/src/overlay/state.svelte.ts`**

Overwrite with:

```ts
import { createFpsSystem } from "@furnace/core";

export const fpsSystem = createFpsSystem();
export const fps = $state({ value: 0 });

fpsSystem.subscribe((v) => {
  fps.value = v;
});
```

- [ ] **Step 8.3: Update `packages/hello-world/src/overlay/FpsOverlay.svelte`**

Edit the `<script>` block and template:

```svelte
<script lang="ts">
  import { fps } from "./state.svelte.ts";
</script>

<div class="fps-overlay">{fps.value} fps</div>

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

(The only change from the moved version is `{overlayState.fps}` → `{fps.value}` and the import path/name.)

- [ ] **Step 8.4: Update `packages/hello-world/index.html`**

Change the `<script>` tag:

```diff
-     <script type="module" src="./src/bootstrap.ts"></script>
+     <script type="module" src="./src/entry.ts"></script>
```

- [ ] **Step 8.5: Update `packages/hello-world/serve.ts`**

Overwrite with the spec's 8-line inline version:

```ts
import indexHtml from "./index.html";

const PORT = Number(Bun.env.FURNACE_PORT ?? 8765);
const server = Bun.serve({
  port: PORT,
  routes: { "/": indexHtml },
});

console.log(`PORT=${server.port}`);
console.log(`Serving at ${server.url}`);
```

- [ ] **Step 8.6: Update `packages/hello-world/tests/triangle-shader.test.ts`**

Overwrite (only the import path changes from `../src/triangle.wgsl` — it was already a sibling-of-tests path, so the relative path stays the same; verify):

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

- [ ] **Step 8.7: Run typecheck for hello-world**

```bash
bun run --cwd packages/hello-world typecheck
```

Expected: no errors.

- [ ] **Step 8.8: Run tests**

```bash
bun test
```

Expected: all tests pass (the shader-text test should be picked up at its new hello-world location).

- [ ] **Step 8.9: Commit**

```bash
git add packages/hello-world/
git commit -m "feat(hello-world): rewire moved files to consume @furnace/core; collapse bootstrap.ts"
```

---

## Phase 9: Slim core's package.json

### Task 9: Switch core to `exports` field, drop dev script, drop Svelte devDeps

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 9.1: Rewrite `packages/core/package.json`**

Overwrite with the final form:

```jsonc
{
  "name": "@furnace/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build:native": "cargo build --release --manifest-path native/Cargo.toml && mkdir -p ../../dist/native && cp -f ../../target/release/furnace-window ../../dist/native/furnace-window",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  }
}
```

Changes from the prior version:
- `"main"` → `"exports"` map with single `"."` entry
- Removed `dev`, `dev:native`, `build:web` scripts (those concerns are hello-world's now)
- Removed `devDependencies` entirely (Svelte was the only thing in there; now it's a hello-world dep)

- [ ] **Step 9.2: Run `bun install` to update the lockfile**

```bash
bun install
```

Expected: install succeeds. The lockfile loses core's Svelte devDeps.

- [ ] **Step 9.3: Verify core typechecks against its new shape**

```bash
bun run --cwd packages/core typecheck
```

Expected: no errors.

- [ ] **Step 9.4: Verify hello-world still typechecks (resolves `@furnace/core` via the exports field)**

```bash
bun run --cwd packages/hello-world typecheck
```

Expected: no errors. If TS can't resolve `@furnace/core`, add a `"types": "./src/index.ts"` field alongside `"exports"` in core's package.json (see Risks in the spec).

- [ ] **Step 9.5: Run tests**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 9.6: Commit**

```bash
git add packages/core/package.json bun.lock
git commit -m "refactor(core): switch to exports field; drop dev scripts and Svelte devDeps"
```

---

## Phase 10: Repoint workspace root scripts and native crate

### Task 10: Update root `package.json` scripts to delegate to hello-world

**Files:**
- Modify: `package.json` (workspace root)

- [ ] **Step 10.1: Rewrite the `scripts` block**

Replace lines 8–18 of `package.json` with:

```jsonc
  "scripts": {
    "dev:web": "bun run --cwd packages/hello-world dev",
    "dev:native": "bun run --cwd packages/hello-world dev:native",
    "build": "bun run build:web && bun run build:native",
    "build:web": "bun run --cwd packages/hello-world build:web",
    "build:native": "bun run --cwd packages/core build:native",
    "typecheck": "bun run --cwd packages/core typecheck && bun run --cwd packages/hello-world typecheck",
    "test": "bun test",
    "check": "biome check",
    "clean": "rm -rf dist target"
  },
```

(`typecheck` now runs across both packages; `build:web` and `dev` point at hello-world; `build:native` stays in core because the Rust crate lives there.)

- [ ] **Step 10.2: Verify `bun run typecheck` works**

```bash
bun run typecheck
```

Expected: both packages typecheck without errors.

- [ ] **Step 10.3: Commit**

```bash
git add package.json
git commit -m "chore(root): repoint dev/build/typecheck scripts at hello-world; add core typecheck"
```

### Task 11: Repoint the native crate's `CORE_DIR` constant

**Files:**
- Modify: `packages/core/native/src/main.rs:20`

- [ ] **Step 11.1: Edit the constant**

```diff
- const CORE_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/..");
+ const EXAMPLE_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../hello-world");
```

- [ ] **Step 11.2: Rename all `CORE_DIR` references to `EXAMPLE_DIR`**

Search the file for other uses:

```bash
grep -n CORE_DIR packages/core/native/src/main.rs
```

Expected: matches only at the constant definition (already renamed) plus one or more usage sites inside `spawn_bun_dev` (around `Command::new("bun").current_dir(CORE_DIR)`). Update each usage to `EXAMPLE_DIR`.

- [ ] **Step 11.3: Build the native binary**

```bash
bun run --cwd packages/core build:native
```

Expected: cargo build succeeds with no warnings about the rename. Binary appears at `dist/native/furnace-window`.

- [ ] **Step 11.4: Commit**

```bash
git add packages/core/native/src/main.rs
git commit -m "fix(native): repoint dev-server cwd at packages/hello-world (rename CORE_DIR → EXAMPLE_DIR)"
```

---

## Phase 11: Add the no-bun-leakage test

### Task 12: Enforce that core's public surface has no Bun coupling

**Files:**
- Create: `packages/core/tests/no-bun-leakage.test.ts`

- [ ] **Step 12.1: Write the test**

Create `packages/core/tests/no-bun-leakage.test.ts`:

```ts
import { expect, test } from "bun:test";
import { Glob } from "bun";

test("core's public surface has no Bun coupling", async () => {
  const scanPatterns = ["src/index.ts", "src/lib/**/*.ts"];
  const offenders: { file: string; line: number; snippet: string }[] = [];
  // Flags any of:
  //   - `Bun.` (global usage)
  //   - `from "bun"` or `from "bun:..."` (imports)
  //   - `import "bun"` or `import "bun:..."`
  const leakagePattern =
    /\bBun\.|from\s+["']bun(:[^"']+)?["']|import\s+["']bun(:[^"']+)?["']/;

  for (const pattern of scanPatterns) {
    const glob = new Glob(pattern);
    for await (const file of glob.scan(".")) {
      const text = await Bun.file(file).text();
      text.split("\n").forEach((line, i) => {
        if (leakagePattern.test(line)) {
          offenders.push({ file, line: i + 1, snippet: line.trim() });
        }
      });
    }
  }

  if (offenders.length > 0) {
    const report = offenders
      .map((o) => `  ${o.file}:${o.line} → ${o.snippet}`)
      .join("\n");
    throw new Error(
      `core's public surface must not use Bun APIs:\n${report}`,
    );
  }
});
```

- [ ] **Step 12.2: Run the test**

```bash
bun test packages/core/tests/no-bun-leakage.test.ts
```

Expected: PASS (the current `src/index.ts` and `src/lib/**` contain no Bun coupling).

- [ ] **Step 12.3: Sanity-check the test's false-negative behavior**

Temporarily inject a leak to confirm the test catches it:

```bash
echo '// const foo = Bun.env.X;' >> packages/core/src/lib/stats/fps.ts
bun test packages/core/tests/no-bun-leakage.test.ts
```

Expected: FAIL with a message listing the line. (A leak inside a comment still triggers the regex, which is intentional — the rule is "no `Bun.` in the file at all," and comments-that-look-like-code are still a smell.)

Then revert:

```bash
# Open the file and delete the `// const foo = Bun.env.X;` line, or:
git checkout -- packages/core/src/lib/stats/fps.ts
bun test packages/core/tests/no-bun-leakage.test.ts
```

Expected: PASS.

- [ ] **Step 12.4: Commit**

```bash
git add packages/core/tests/no-bun-leakage.test.ts
git commit -m "test(core): enforce consumer-portability via no-bun-leakage test"
```

---

## Phase 12: Update CLAUDE.md to reflect the post-split layout

### Task 13: Final update to `.claude/CLAUDE.md` Project state

**Files:**
- Modify: `.claude/CLAUDE.md` — "Project state" section

- [ ] **Step 13.1: Replace the "Project state" section**

The current text describes a single-package state (correct mid-execution but wrong post-split). Replace it with:

```markdown
## Project state

A Bun workspace (`workspaces: ["packages/*"]`, Bun v1.3.14) experimenting with WebGPU-based engine architecture, split into a headless engine library and a consumer demo.

**Current contents (two workspace packages):**
- `packages/core/` (`@furnace/core`, private) — the engine library. Exports `requestWebGpu`, `runFrameLoop`, `createFpsSystem`, `computeFps`, plus their types. Consumer-portable: no framework deps, no Bun coupling in the public surface (enforced by `tests/no-bun-leakage.test.ts`). Also hosts the Rust `winit + wry` native window crate at `native/` — currently hardcoded to launch the hello-world example.
- `packages/hello-world/` (`@furnace/hello-world`, private) — the first consumer. Renders the WebGPU triangle with the Svelte 5 FPS overlay. Owns its own `index.html`, `bunfig.toml`, `serve.ts`, and dev-server choice. Imports core via `@furnace/core` (workspace symlink).
- Two runtime targets, shared TS/HTML/WGSL between them: `bun run dev:web` (browser tab) and `bun run dev:native` (desktop window — macOS Tahoe 26+ / Windows; Linux deferred per `.docs/BACKLOG.md`).
- Build outputs: `dist/web/` (Bun bundler, hello-world) and `dist/native/` (cargo, core).
- Tooling: Biome for lint, `bun:test` for tests, TypeScript strict mode (noEmit — typechecking only).

For deeper context: `.docs/shallot-and-game-engine-architecture.md` (engine architecture notes), `.docs/BACKLOG.md` (deferred work register), `docs/superpowers/specs/` (design specs for major changes).
```

- [ ] **Step 13.2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs(claude): update Project state to reflect core + hello-world split"
```

---

## Phase 13: Final verification (acceptance criteria)

These are the manual checks from the spec's "Acceptance criteria" section. No commits here.

- [ ] **Step 14.1: `bun install` succeeds with no errors**

```bash
bun install
```

- [ ] **Step 14.2: `bun run typecheck` succeeds (both packages)**

```bash
bun run typecheck
```

- [ ] **Step 14.3: `bun run check` (biome) succeeds**

```bash
bun run check
```

- [ ] **Step 14.4: `bun test` passes**

```bash
bun test
```

Expected: tests from both packages run. Final test count: `computeFps` (4) + `createFpsSystem` (5) + `no-bun-leakage` (1) + `triangle WGSL` (1) = 11 tests, all passing.

- [ ] **Step 14.5: `bun run dev:web` renders the triangle in a browser**

```bash
bun run dev:web
```

Open `http://localhost:8765`. Expected: green triangle on a dark background; FPS counter in the top-left displays a number plausibly close to monitor refresh rate, updating every second. Press Ctrl-C to stop the dev server when done.

- [ ] **Step 14.6: `bun run dev:native` renders the triangle in a native window**

```bash
bun run dev:native
```

Expected: a native window opens (macOS) showing the same triangle and FPS counter. Close the window when done.

- [ ] **Step 14.7: Verify no Bun coupling in core's public surface**

```bash
grep -rE "\bBun\.|from\s+[\"']bun(:|[\"'])" packages/core/src/index.ts packages/core/src/lib/
```

Expected: no matches.

- [ ] **Step 14.8: Verify Svelte is gone from core's package.json**

```bash
grep -i svelte packages/core/package.json
```

Expected: no matches.

- [ ] **Step 14.9: Verify `packages/core/src/internal/` does not exist**

```bash
test ! -d packages/core/src/internal && echo "OK: internal/ absent" || echo "FAIL: internal/ exists"
```

Expected: `OK: internal/ absent`.

- [ ] **Step 14.10: Verify the hello-world package symlink resolves**

```bash
test -L packages/hello-world/node_modules/@furnace/core && echo "OK: symlink present" || echo "FAIL"
ls packages/hello-world/node_modules/@furnace/core/src/index.ts
```

Expected: `OK: symlink present` and the file is listed.

---

## Self-Review Notes

**Spec coverage:** Every section of the spec maps to a task above. The `runFrameLoop` API includes `FrameLoopHandle.stop()` (Task 4); `requestWebGpu` returns the `WebGpuContext` bag with `canvas` field (Task 3); `createFpsSystem` exposes `frame/subscribe/current/dispose` (Tasks 1+2); the `no-bun-leakage` test enforces consumer-portability (Task 12); the native crate's `CORE_DIR` is renamed and repointed (Task 11); CLAUDE.md gets re-updated post-split (Task 13).

**Placeholder scan:** No TBD/TODO/FIXME. All code blocks contain the actual code engineers will paste.

**Type consistency:** `WebGpuContext` is consistent across Task 3 (definition) and Task 8.1 (usage). `FrameCallback`, `FrameLoopHandle` consistent across Task 4 and Task 8.1. `FpsSystem`, `FpsSystemOptions` consistent across Tasks 1, 2, and Task 8.2.

**Known intentional broken state:** Phase 7 (Step 7.3) explicitly does NOT commit — Phase 8 must run before any commit lands. If the workflow is interrupted between Phase 7 and Phase 8, the working tree contains moved-but-not-rewired files. That's acceptable for a single-session execution; for a multi-session execution, finish Phase 8 before pausing.

**Dependency on Bun's exports-field resolution:** Step 9.4 verifies hello-world typechecks against the new `exports` field. If TS misbehaves, the spec's Risks section calls out the fallback (add `"types": "./src/index.ts"` alongside `"exports"`).
