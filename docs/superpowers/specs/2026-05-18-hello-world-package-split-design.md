# Hello-World Package Split — Design Spec

**Date:** 2026-05-18
**Status:** Approved (pending user review of this written form)
**Builds on:** [`2026-05-17-webgpu-triangle-bootstrap-design.md`](./2026-05-17-webgpu-triangle-bootstrap-design.md), [`2026-05-17-ui-foundation-design.md`](./2026-05-17-ui-foundation-design.md)
**Inspired by:** [`.docs/shallot-and-game-engine-architecture.md`](../../../.docs/shallot-and-game-engine-architecture.md) §1, §10

## Summary

Split `packages/core/` into **two packages** to separate engine code from demonstration code:

- **`@furnace/core`** — the engine library. Headless. Web-platform APIs only. No framework dependencies. Consumer-portable (any modern bundler that ships ESM + TS).
- **`@furnace/hello-world`** — the first consumer. A working WebGPU triangle with an FPS overlay, used to prove core works end-to-end in both browser and native runtimes.

The triangle's pipeline/draw code, WGSL shader, HTML page, dev server, FPS Svelte overlay, and bunfig.toml all move to hello-world. Core keeps the WebGPU bootstrap helper, frame loop helper, FPS system, the native crate (location-only — Cargo content unchanged), and the tests for engine logic.

A new `no-bun-leakage` test enforces that core's `src/lib/` and `src/index.ts` contain zero `Bun.*` references and no `bun:*` imports. This makes consumer-portability a durable claim instead of a discipline.

## Goals

- `@furnace/core` exports a small, framework-free public API: `requestWebGpu`, `runFrameLoop`, `createFpsSystem`, `computeFps`, plus their types.
- `packages/hello-world/` is a self-contained consumer package that imports only `@furnace/core`'s public entry — no reaching into `core/src/internal/*` or any other workspace insider path.
- `bun run dev:web` and `bun run dev:native` continue to work end-to-end and produce the same on-screen output as before the split.
- The Svelte FPS overlay continues to display live frame counts; the underlying data source is now multi-subscriber so additional consumers (tests, telemetry) can attach in the future.
- Existing tests (`stats.test.ts`, `entry.test.ts`) survive the move with their assertions intact.
- A `no-bun-leakage` test prevents Bun coupling from being added to core's public surface in future work.

## Non-goals

- **Editor/inspector UI.** Stays deferred. When it lands, it goes in a separate package (e.g. `@furnace/inspector`) that's free to depend on Svelte. Core does not gain a UI framework dep here.
- **Build orchestrator (Shallot-style `scripts/build.ts`).** Out of scope for this spec; tracked in BACKLOG ("Build system revisit") with rising-priority signal.
- **Svelte precompilation in core.** Not needed — core ships no Svelte. Only relevant when the inspector package ships, and its build is its own concern.
- **Native runner consuming built output instead of spawning the dev server.** Principled fix, but deferred — tracked in BACKLOG ("Native binary bundling"). For now the Rust crate keeps spawning `bun serve.ts`, just from `packages/hello-world/` instead of `packages/core/`.
- **Generalizing the native runner across multiple examples.** Hardcoded to hello-world for now; tracked in BACKLOG.
- **Validating core in a non-Bun consumer (e.g., Vite).** The honest portability test happens when `@furnace/core` first publishes — at that point a CI smoke-test fixture in a different toolchain validates it for real. Until then, the `no-bun-leakage` test plus source-level audit is the contract.
- **Renaming or relocating the native crate.** Stays at `packages/core/native/`. The "native crate logically belongs neither to core nor to hello-world" concern is real but a different change.

## Architecture

```
packages/
  core/                                  ← engine library (consumer-portable)
    src/
      index.ts                           ← public exports only
      lib/
        gpu/
          requestWebGpu.ts
          runFrameLoop.ts
        stats/
          fps.ts                         ← createFpsSystem + computeFps
    tests/
      lib/stats/fps.test.ts              ← moved + renamed from tests/stats.test.ts
      no-bun-leakage.test.ts             ← NEW
    native/                              ← unchanged location; CORE_DIR const repointed
    package.json                         ← exports: { ".": "./src/index.ts" }
    (no index.html, no serve.ts, no bunfig.toml, no bootstrap.ts, no entry.ts,
     no triangle.wgsl, no overlay/, no svelte.d.ts, no wgsl.d.ts, no svelte devDep)

  hello-world/                           ← NEW — first consumer
    src/
      entry.ts                           ← composes core's API
      triangle.wgsl                      ← moved from packages/core/src/
      overlay/
        FpsOverlay.svelte                ← moved from packages/core/src/overlay/
        mount.ts                         ← moved
        state.svelte.ts                  ← rewired: subscribes to core's FpsSystem
      svelte.d.ts                        ← moved (ambient module decl for *.svelte)
      wgsl.d.ts                          ← moved (ambient module decl for *.wgsl)
    tests/
      triangle-shader.test.ts            ← moved + renamed from packages/core/tests/entry.test.ts
    index.html                           ← moved from packages/core/
    serve.ts                             ← NEW (~8 lines, inline; no shared helper)
    bunfig.toml                          ← moved (registers bun-plugin-svelte)
    package.json                         ← NEW (workspace dep on @furnace/core)
```

### Engine vs consumer — the boundary that justifies the split

- **`@furnace/core` is headless and framework-free.** It exports primitives consumers compose. It uses only web-platform APIs (`navigator.gpu`, `requestAnimationFrame`, `setInterval`, `performance.now`). It has no opinion about UI framework, dev server, bundler, or runtime.
- **`@furnace/hello-world` is a normal consumer.** It imports only `@furnace/core`'s public entry. It picks its own bundler (Bun), dev server (Bun.serve), UI framework (Svelte). It owns its HTML, its overlay component, its WGSL shader, and the pipeline that draws the triangle.
- **The asymmetry is the point.** A future second example could use the same core with completely different choices. Core doesn't care.

### Why the FPS overlay moved out of core

In the brainstorm we initially considered keeping the Svelte overlay in core as "engine-owned debug UI." The distribution lens reversed it: shipping a `.svelte` source file from core forces every consumer to install `bun-plugin-svelte` (or its equivalent for whatever bundler they use), have a `bunfig.toml` registering it, and depend on Svelte's runtime — substantial setup for an FPS counter.

The cleaner factoring: **core ships the system; consumers ship the visualization.** `createFpsSystem` returns a multi-subscriber service producing fps values. How those values are displayed is somebody else's job — hello-world's Svelte overlay, a test's expect-assertion, a future telemetry sink. Same data source, multiple consumers, no framework opinion in core.

## Components

### `packages/core/`

**`src/index.ts`** — the entire published surface:

```ts
export { requestWebGpu } from "./lib/gpu/requestWebGpu.ts";
export type { WebGpuContext } from "./lib/gpu/requestWebGpu.ts";

export { runFrameLoop } from "./lib/gpu/runFrameLoop.ts";
export type { FrameCallback, FrameLoopHandle } from "./lib/gpu/runFrameLoop.ts";

export { createFpsSystem, computeFps } from "./lib/stats/fps.ts";
export type { FpsSystem, FpsSystemOptions } from "./lib/stats/fps.ts";
```

**`src/lib/gpu/requestWebGpu.ts`** — adapter/device/context/DPR/format in one async call:

```ts
export interface WebGpuContext {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly canvas: HTMLCanvasElement;
}

export async function requestWebGpu(canvas: HTMLCanvasElement): Promise<WebGpuContext>;
```

Internals: resolves `navigator.gpu`, requests adapter + device, sizes the canvas drawing buffer to `clientWidth * dpr × clientHeight * dpr` (carrying the fix from commit `f3e9323`), resolves preferred format, configures the context. Throws `Error` with descriptive messages on missing WebGPU, missing adapter, or missing context. Callers (including hello-world) catch and surface the message however they want.

**`src/lib/gpu/runFrameLoop.ts`** — RAF wrapper with explicit lifecycle:

```ts
export type FrameCallback = (timestampMs: number) => void;
export interface FrameLoopHandle {
  stop(): void;
}
export function runFrameLoop(onFrame: FrameCallback): FrameLoopHandle;
```

Implementation: schedules `requestAnimationFrame` and re-schedules from inside the callback. `stop()` cancels the next-scheduled frame. The `timestampMs` parameter is what RAF passes in (DOMHighResTimeStamp).

**`src/lib/stats/fps.ts`** — multi-subscriber FPS service + the pure `computeFps` helper:

```ts
export interface FpsSystemOptions {
  intervalMs?: number;     // default 1000
  now?: () => number;      // default () => performance.now()
}

export interface FpsSystem {
  frame(): void;
  subscribe(listener: (fps: number) => void): () => void;
  readonly current: number;
  dispose(): void;
}

export function createFpsSystem(options?: FpsSystemOptions): FpsSystem;
export function computeFps(frames: number, elapsedSeconds: number): number;
```

`computeFps` is the existing pure function — kept public because its tests already exercise it as a unit. `createFpsSystem` replaces the current `initStats({ onTick })` API:

- **Multi-consumer.** Returns an unsubscribe function. The overlay, a test, and a telemetry sink can all subscribe independently.
- **Imperative read.** `system.current` exposes the most recent value for callers that want it on demand instead of via push.
- **Same internals.** A frame counter, a `setInterval` tick, `computeFps` to roll over each interval — identical math to today's `initStats`.

**`package.json`** — public surface is the single `"."` entry:

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

Notes:
- The current `"main": "./src/entry.ts"` is replaced by the `exports` map. `main` is legacy resolution; `exports` is the modern equivalent and is what enables a clean public boundary.
- The `dev`, `dev:native`, `build:web` scripts are **removed** from core. Those concerns belong to hello-world now. `build:native` stays because the Rust crate still lives here.
- `bun-plugin-svelte` and `svelte` devDeps are **removed** from core.

**`tests/no-bun-leakage.test.ts`** — enforces consumer-portability:

```ts
import { expect, test } from "bun:test";
import { Glob } from "bun";

test("core's public surface has no Bun coupling", async () => {
  const scanRoots = ["src/index.ts", "src/lib/**/*.ts"];
  const offenders: { file: string; line: number; snippet: string }[] = [];

  for (const pattern of scanRoots) {
    const glob = new Glob(pattern);
    for await (const file of glob.scan(".")) {
      const text = await Bun.file(file).text();
      text.split("\n").forEach((line, i) => {
        // Flags: `Bun.` (global usage), `from "bun"` or `from "bun:..."` (imports), `import "bun..."`.
        if (/\bBun\.|from\s+["']bun(:[^"']+)?["']|import\s+["']bun(:[^"']+)?["']/.test(line)) {
          offenders.push({ file, line: i + 1, snippet: line.trim() });
        }
      });
    }
  }

  if (offenders.length > 0) {
    const report = offenders.map((o) => `  ${o.file}:${o.line} → ${o.snippet}`).join("\n");
    throw new Error(`core's public surface must not use Bun APIs:\n${report}`);
  }
});
```

The test itself uses Bun (`bun:test`, `Bun.Glob`, `Bun.file`) — that's fine. `tests/` is workspace internal, not the published surface. The scan is restricted to `src/index.ts` and `src/lib/**`.

**`tests/lib/stats/fps.test.ts`** — moved from `tests/stats.test.ts`, mirrors the new source path, import updated:

```ts
import { computeFps } from "../../../src/lib/stats/fps.ts";
// rest of file unchanged
```

**`native/`** — unchanged Cargo content. One line in `src/main.rs`:

```diff
- const CORE_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/..");
+ const CORE_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../hello-world");
```

The constant name `CORE_DIR` becomes misleading after this edit. Renaming it to `EXAMPLE_DIR` or similar is a small follow-up worth doing in the same commit.

### `packages/hello-world/` (NEW)

**`package.json`:**

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

`dev:native` triggers core's `build:native` (since the Rust crate still lives there), then runs the resulting binary. The binary spawns `bun serve.ts` from `packages/hello-world/` because of the `CORE_DIR` repointing above.

**`bunfig.toml`** (moved from core, content unchanged):

```toml
[serve.static]
plugins = ["bun-plugin-svelte"]
```

**`index.html`** (moved from core, content unchanged) — references `./src/entry.ts` (no separate bootstrap.ts):

```diff
- <script type="module" src="./src/bootstrap.ts"></script>
+ <script type="module" src="./src/entry.ts"></script>
```

The 3-line `bootstrap.ts` is collapsed into the bottom of `entry.ts` — there's no reason for two files now that nothing else imports `main()`.

**`serve.ts`** (NEW, ~8 lines inline; no shared helper):

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

Differences from the old `packages/core/serve.ts`:
- Adds `FURNACE_PORT` env-var override (fixes the dev:web + dev:native port-conflict noted in the old file's comment).
- The `PORT=…` and `Serving at …` log format is preserved verbatim — the native crate's stdout parser depends on it (`packages/core/native/src/main.rs:67-79`).

**`src/entry.ts`** (NEW — replaces the old `packages/core/src/entry.ts` + `bootstrap.ts`):

```ts
import {
  createFpsSystem,
  requestWebGpu,
  runFrameLoop,
} from "@furnace/core";
import { mountFpsOverlay } from "./overlay/mount.ts";
import { fps } from "./overlay/state.svelte.ts";
import shaderUrl from "./triangle.wgsl";

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#gpu");
  const uiRoot = document.querySelector<HTMLElement>("#ui-root");
  if (!canvas) throw new Error("canvas#gpu not found");
  if (!uiRoot) throw new Error("#ui-root not found");

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

  const { device, context, format } = await requestWebGpu(canvas);

  device.pushErrorScope("validation");
  const shaderModule = device.createShaderModule({ code: shaderSource });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex:   { module: shaderModule, entryPoint: "vs_main" },
    fragment: { module: shaderModule, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const validationError = await device.popErrorScope();
  if (validationError) {
    document.body.innerText = `Pipeline error: ${validationError.message}`;
    return;
  }

  mountFpsOverlay(uiRoot);
  const stats = createFpsSystem();
  stats.subscribe((v) => { fps.value = v; });

  runFrameLoop(() => {
    stats.frame();
    const view = context.getCurrentTexture().createView();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0.05, g: 0.05, b: 0.07, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
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

Notes:
- Pipeline validation (`pushErrorScope` / `popErrorScope`) **stays in hello-world**, not in `requestWebGpu`. That kind of error scope is per-call-site discipline; baking it into core's bootstrap would either always-on (wasteful) or never-on (misleading).
- The WebGPU-unavailable and shader-fetch-failed branches stay as direct `document.body.innerText` writes, matching the current behavior.
- `bootstrap.ts` is gone — `main().catch(…)` is the last line of this file.

**`src/triangle.wgsl`** — moved from `packages/core/src/triangle.wgsl`, content unchanged.

**`src/wgsl.d.ts`, `src/svelte.d.ts`** — moved from `packages/core/src/`, content unchanged. Ambient module declarations for `*.wgsl` and `*.svelte` imports respectively.

**`src/overlay/state.svelte.ts`** — rewired to subscribe to core's FpsSystem instead of being mutated by a callback:

```ts
import { createFpsSystem } from "@furnace/core";

export const fpsSystem = createFpsSystem();
export const fps = $state({ value: 0 });
fpsSystem.subscribe((v) => {
  fps.value = v;
});
```

Caller (`entry.ts`) still has to call `fpsSystem.frame()` in its render loop — that's why `fpsSystem` is exported, not just internal. Alternatively `entry.ts` could call `createFpsSystem` itself and pass the instance to a setup function in `state.svelte.ts` — the version above is shorter; either is defensible.

**`src/overlay/FpsOverlay.svelte`** — moved unchanged. The `{fps}` in the markup references the imported `fps` from `state.svelte.ts`:

```svelte
<script lang="ts">
  import { fps } from "./state.svelte.ts";
</script>
<div class="fps-overlay">{fps.value} fps</div>
<style>/* unchanged */</style>
```

(The reactive expression changes from `{overlayState.fps}` to `{fps.value}` — both are valid Svelte 5 runes patterns; this one matches the new state shape.)

**`src/overlay/mount.ts`** — moved unchanged.

**`tests/triangle-shader.test.ts`** — moved from `packages/core/tests/entry.test.ts`, import path updated to point at the local WGSL:

```ts
import { expect, test } from "bun:test";
import triangleShader from "../src/triangle.wgsl" with { type: "text" };
// rest of file unchanged
```

### Workspace root

**`package.json` scripts** — re-point at hello-world:

```diff
  "scripts": {
-   "dev:web": "bun run --cwd packages/core dev",
-   "dev:native": "bun run --cwd packages/core dev:native",
-   "build": "bun run build:web && bun run build:native",
-   "build:web": "bun run --cwd packages/core build:web",
-   "build:native": "bun run --cwd packages/core build:native",
-   "typecheck": "bun run --cwd packages/core typecheck",
+   "dev:web": "bun run --cwd packages/hello-world dev",
+   "dev:native": "bun run --cwd packages/hello-world dev:native",
+   "build": "bun run build:web && bun run build:native",
+   "build:web": "bun run --cwd packages/hello-world build:web",
+   "build:native": "bun run --cwd packages/core build:native",
+   "typecheck": "bun run --cwd packages/core typecheck && bun run --cwd packages/hello-world typecheck",
    "test": "bun test",
    "check": "biome check",
    "clean": "rm -rf dist target"
  }
```

Workspaces glob (`"packages/*"`) is unchanged — `packages/hello-world` matches.

**`.claude/CLAUDE.md`** — already edited in the brainstorm. The "Runtime rule: use Bun, not Node" section was rewritten to "Toolchain: Bun is the workspace default" with an explicit carve-out for consumer packages. No further edits needed in this implementation.

**`.docs/BACKLOG.md`** — already edited in the brainstorm. The "Build system revisit" entry gained a "Priority signal: Rising" note and three new pressure points (root-script indirection, dev-vs-published asymmetry, multi-platform packaging). No further edits needed.

## Public API contract for `@furnace/core`

```ts
// packages/core/src/index.ts
export interface WebGpuContext {
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  readonly canvas: HTMLCanvasElement;
}
export function requestWebGpu(canvas: HTMLCanvasElement): Promise<WebGpuContext>;

export type FrameCallback = (timestampMs: number) => void;
export interface FrameLoopHandle { stop(): void; }
export function runFrameLoop(onFrame: FrameCallback): FrameLoopHandle;

export interface FpsSystemOptions { intervalMs?: number; now?: () => number; }
export interface FpsSystem {
  frame(): void;
  subscribe(listener: (fps: number) => void): () => void;
  readonly current: number;
  dispose(): void;
}
export function createFpsSystem(options?: FpsSystemOptions): FpsSystem;
export function computeFps(frames: number, elapsedSeconds: number): number;
```

No other exports. No subpath exports. No Bun coupling.

## Testing

### In scope (must pass after the split)

- **`packages/core/tests/lib/stats/fps.test.ts`** — the four existing `computeFps` cases, unchanged behavior, import path updated.
- **`packages/core/tests/no-bun-leakage.test.ts`** — new. Fails the build if `Bun.*` or `bun:*` shows up in `src/index.ts` or `src/lib/**/*.ts`.
- **`packages/hello-world/tests/triangle-shader.test.ts`** — the existing `triangle.wgsl` assertions, unchanged behavior, import path updated.
- **`bun test` from workspace root** picks up both packages' tests (Bun's workspace test discovery).
- **`bunx tsc --noEmit` in each package** passes with the new layout.

### Manual verification (cannot be automated)

See acceptance criteria below.

### Out of scope (deferred to BACKLOG)

- Playwright visual regression
- mitata microbenchmarks
- Tests for `requestWebGpu`, `runFrameLoop`, `createFpsSystem` behavior beyond `computeFps`. These need a WebGPU-capable test environment (real browser or headless Chromium with WebGPU enabled); not blocking the split.

## Acceptance criteria (manual verification checklist)

After implementation, the following must all be true. Verify in order:

1. `bun install` succeeds from the workspace root with no errors.
2. `bun run typecheck` succeeds.
3. `bun run check` (biome) succeeds.
4. `bun test` passes. Tests run from both `packages/core/` and `packages/hello-world/`. `no-bun-leakage` passes.
5. `bun run dev:web` starts a server on port 8765. Opening `http://localhost:8765` shows the green triangle. The FPS counter in the top-left displays a number that updates every second and is plausibly close to the monitor refresh rate.
6. `bun run dev:native` opens a native window (macOS) showing the same triangle with the same FPS counter.
7. `grep -r "Bun\." packages/core/src/index.ts packages/core/src/lib/` returns no matches.
8. `grep -r "from \"bun" packages/core/src/index.ts packages/core/src/lib/` returns no matches.
9. `grep -r "svelte" packages/core/package.json` returns no matches (Svelte is fully gone from core).
10. `packages/core/src/internal/` does not exist as a directory.

## Risks & constraints

- **Workspace dependency resolution.** `@furnace/hello-world` declares `"@furnace/core": "workspace:*"`. Bun workspaces support this; verify on the first `bun install` that the symlink is created correctly in `packages/hello-world/node_modules/@furnace/core`. If Bun behaves unexpectedly here, fall back to `"workspace:^"` or an explicit version match.
- **`exports` field + TS resolution.** Switching from `"main": "./src/entry.ts"` to `"exports": { ".": "./src/index.ts" }` requires TS `moduleResolution: "bundler"` (which the root tsconfig already has) to follow `exports` correctly. If TS can't resolve `@furnace/core`, the fallback is to add a `"types": "./src/index.ts"` field alongside `exports`.
- **`bunfig.toml` resolution from `dev:native`.** When the native Rust crate spawns `bun serve.ts` from `packages/hello-world/`, Bun must find `packages/hello-world/bunfig.toml` (Bun walks up from cwd). This works in dev; verify by running `bun run dev:native` and confirming the Svelte overlay renders (it won't if `bun-plugin-svelte` isn't loaded).
- **Native crate's `CORE_DIR` constant becomes misleading.** After the repoint, `CORE_DIR` points at hello-world, not core. Rename to `EXAMPLE_DIR` (or similar) in the same commit to avoid confusion later.
- **`pushErrorScope` validation in hello-world's entry.** Carrying this over keeps the failure-mode messages users see today identical. Don't move it into `requestWebGpu` — that would either run validation always (wasteful) or never (misleading).
- **`bootstrap.ts` collapse.** The old `bootstrap.ts` was a 3-line `main().catch(…)`. Folding it into `entry.ts` simplifies the file count; verify `index.html` is updated to point at `entry.ts` directly in the same commit.

## Out of scope (will not be done in this implementation)

- Adding a second example package.
- Generalizing the native runner with a CLI flag or env var to choose which example to serve.
- Bundling a "real" build orchestrator (`scripts/build.ts` Bun.$ style).
- Publishing `@furnace/core` to a registry.
- Setting up a non-Bun consumer smoke-test fixture for portability validation.
- Editor/inspector packages.
- Renaming the native crate or moving it out of `packages/core/native/`.

## What changes when this spec is implemented

**Repo layout changes:**
- New `packages/hello-world/` directory with ~12 files
- `packages/core/src/` reshaped: `lib/{gpu,stats}/` subdirs, `entry.ts` + `bootstrap.ts` + `overlay/` + `triangle.wgsl` + `*.d.ts` removed
- `packages/core/tests/` reshaped: `lib/stats/fps.test.ts` + `no-bun-leakage.test.ts`
- `packages/core/native/src/main.rs` one-line change to `CORE_DIR` constant (plus optional rename)
- Workspace root `package.json` scripts re-pointed
- `packages/core/package.json` slimmed (drop dev script, drop svelte devDeps, switch `main` → `exports`)

**Behavior changes the user will notice:**
- `bun run dev:web` and `bun run dev:native` produce the same on-screen output (triangle + FPS) as before
- `FURNACE_PORT` env var now overrides the dev server port (8765 default)
- Nothing else visible changes

**Future-work surface created:**
- The `no-bun-leakage` test pattern can be extended to other leakage checks (no Svelte imports in core, no Node.js imports in browser-only code, etc.) as the contract grows
- The `lib/{gpu,stats}/` namespace pattern is established for where new engine modules go
- `@furnace/hello-world` is a working template for example #2

## Commit order

Implementing this in a single commit is plausible (the changes are tightly coupled), but a two-commit sequence is cleaner for review:

1. **`refactor(core): extract WebGpuContext, FrameLoop, FpsSystem; reshape into lib/{gpu,stats}/`**
   - Move `stats.ts` → `lib/stats/fps.ts`, rename `initStats` → `createFpsSystem`, add `subscribe`/`current`/`dispose`
   - Create `lib/gpu/requestWebGpu.ts` (extract from current `entry.ts`)
   - Create `lib/gpu/runFrameLoop.ts` (extract RAF wrapper)
   - Create `src/index.ts` with public re-exports
   - Update `package.json` to use `exports` field, drop dev script
   - Update `tests/stats.test.ts` → `tests/lib/stats/fps.test.ts`
   - Add `tests/no-bun-leakage.test.ts`
   - **Verify:** `bun test` and `bun run typecheck` pass; the demo is temporarily broken (no entry exists yet to render).
2. **`feat(hello-world): split demo into packages/hello-world, repoint dev scripts and native runner`**
   - Create `packages/hello-world/` with full structure above
   - Move HTML/serve/bunfig/overlay/triangle from core into hello-world
   - Repoint root scripts to hello-world
   - Repoint `CORE_DIR` constant in native crate (optionally rename)
   - Drop Svelte devDeps from core; add to hello-world
   - Update `.claude/CLAUDE.md` "Project state" section to reflect the two-package layout (pre-split text was edited as part of the brainstorm; this commit updates it again to describe the post-split contents — `@furnace/core` as headless engine + `@furnace/hello-world` as first consumer).
   - **Verify:** All acceptance criteria pass.
