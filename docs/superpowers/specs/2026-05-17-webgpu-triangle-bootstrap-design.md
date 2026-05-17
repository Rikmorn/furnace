# WebGPU Triangle Bootstrap — Design Spec

**Date:** 2026-05-17
**Status:** Approved (pending user review of this written form)
**Inspired by:** [`.docs/shallot-and-game-engine-architecture.md`](../../../.docs/shallot-and-game-engine-architecture.md) (Shallot/game-engine notes)

## Summary

Bootstrap the `furnace` repo to render a single triangle on screen via WebGPU, in **two runtime targets** with **shared application code**: a browser tab (served by Bun) and a native desktop window (a Rust binary that hosts a webview). Mirror Shallot's actual native strategy (`winit` + `wry`) rather than direct `bun-webgpu` FFI, so the same TS/HTML/WGSL renders identically in both contexts.

Scope is deliberately minimal. No engine abstractions (no `Renderer`, no `Surface`, no `Pipeline` wrapper), no ECS, no physics, no second example. The triangle is a vertical slice that proves WebGPU + the browser/native parity story, and gives us a baseline to grow from.

Alongside the triangle, this spec includes the AI-friendliness fixes the repo currently needs (CLAUDE.md/rules duplicate, broken `biome.json` extends, missing scripts, missing AGENTS.md/README) and a new `.docs/BACKLOG.md` convention for tracking deferred work across sessions.

## Goals

- A working WebGPU triangle, rendered on screen in **both** a browser and a native window on macOS Tahoe 26+ and Windows.
- **Same TS, HTML, and WGSL files** between browser and native — no `if (isNative)` branches.
- A monorepo layout (`packages/core/`) that's usable today and won't need to be re-shaped when actual engine code arrives.
- Discoverable npm scripts (`dev:web`, `dev:native`, `build:native`, `typecheck`, `check`, `test`) so a fresh AI agent or human contributor can find the entry points by running `bun run`.
- A `.docs/BACKLOG.md` register so deferred work is captured rather than lost, with workflow guidance loaded into the AI agent context.

## Non-goals

- Engine abstractions (`Renderer`, `Surface`, `Pipeline`, ECS, scene graph, etc.) — explicitly deferred until there's a concrete second use case.
- Linux support for the native target. `cef` adds significant Chromium-runtime weight; deferred to BACKLOG.
- Window resize, device-lost recovery, robust child-process cleanup on Rust panic. All deferred to BACKLOG.
- Playwright visual regression, mitata benchmarks, Svelte editor. Deferred to BACKLOG.
- CI pipeline (GitHub Actions). Deferred to BACKLOG.

## Architecture

One package (`packages/core`), one HTML page, one TS entry, one WGSL shader, one Rust native host.

The browser-vs-native split is handled at the **outermost** layer only:

- **Browser:** Bun dev server (`Bun.serve()`) serves `index.html`; browser loads it like any web page; `navigator.gpu` is provided by Chrome/Safari/Firefox.
- **Native:** The same Bun dev server runs as a **child process of the Rust binary**; the Rust binary opens a `winit` window containing a `wry` webview pointing at `http://127.0.0.1:<port>`; `navigator.gpu` is provided by the platform's webview (WKWebView on macOS Tahoe 26+, WebView2 on Windows).

This means **TS, HTML, and WGSL are 100% shared** between browser and native. The Rust crate is a window host, not a renderer — there is no Rust code that touches WebGPU.

### Mirror of Shallot's strategy (verified)

Shallot's `packages/shallot/rust/window/Cargo.toml` uses `winit = "0.30"` + `wry = "0.48"` on macOS/Windows, and `cef = 145` on Linux. The architecture doc at `.docs/shallot-and-game-engine-architecture.md` §4 inferred that `bun-webgpu` provides the native WebGPU surface; reading the actual `window/Cargo.toml` shows the native path is a webview shell, and the webview's built-in WebGPU is what renders. This spec mirrors the verified Shallot approach.

## Components

### Workspace root

- **`package.json`** — workspaces stay as-is (`packages/*`). Add scripts:
  - `dev:web`, `dev:native`, `build:native`, `typecheck`, `check`, `test`
  - Each delegates to the workspace package via `bun run --cwd packages/core <script>`.
  - Remove the vestigial `"module": "index.ts"` field — the root package is `private: true` and `index.ts` is being deleted.
- **`biome.json`** — remove the broken `extends: ["./biome.test.json"]` line. The referenced file doesn't exist and `biome check` will fail when first invoked.
- **`tsconfig.json`** — unchanged. Project references not needed for one package.
- **`AGENTS.md`** — new, ~10 lines, see "AI-friendliness" below.
- **`README.md`** — replace bun-init default with a project-shaped README. Terse, for developers. One paragraph on what `furnace` is, four-line run instructions for web + native, pointer to `.docs/` for architecture context. No marketing tone.

### `packages/core/`

- **`package.json`**: `name: "@furnace/core"`, `private: true`, `type: "module"`, `main: "./src/entry.ts"`. Scripts:
  - `dev` — runs `bun --hot serve.ts`
  - `build:native` — `cargo build --release --manifest-path native/Cargo.toml`
  - `dev:native` — builds (if needed) then runs `./native/target/release/furnace-window`

  No runtime deps. `@types/bun` at root suffices.

- **`serve.ts`** (~15 lines) — uses `Bun.serve({ port: 0, routes: { "/": indexHtml } })`. Port `0` asks the kernel for any free port; the actual port is read from the returned `Server` and printed as `PORT=<n>` on the first stdout line so the native binary can parse it. Bun 1.3's static-routes feature handles HTML, TS transpilation, and asset serving in one call.

  **Reload layering** (clarified to avoid confusion):
  - `bun --hot serve.ts` (the `dev` script) — restarts `serve.ts` itself when it or its imports change. Useful while iterating on routes.
  - Bun's static-routes feature — provides browser-side HMR for the served HTML/TS/CSS automatically. This is what reloads the page when `entry.ts` or `triangle.wgsl` changes.
  - WGSL hot-reload (re-creating the pipeline when the shader changes without a full page reload) is **deferred to BACKLOG**.

- **`index.html`** (~20 lines) — doctype, viewport meta, full-viewport `<canvas id="gpu">`, `<script type="module" src="./src/entry.ts">`, inline CSS to remove scrollbars and stretch canvas to 100%.

- **`src/entry.ts`** (~100 lines) — `async function main()` that:
  1. Gets canvas, checks `navigator.gpu`, requests adapter + device.
  2. Configures `canvas.getContext("webgpu")` with device + `navigator.gpu.getPreferredCanvasFormat()`.
  3. Wraps `createShaderModule` + `createRenderPipeline` in `device.pushErrorScope("validation")` / `popErrorScope()` so WGSL errors surface visibly.
  4. Runs a `requestAnimationFrame` loop that encodes one pass: `loadOp: "clear"`, `setPipeline`, `draw(3)`, `endPass`, `queue.submit`.

  Exports `main` and calls it on module load. Failures are written to `document.body.innerText` so they're visible without devtools open.

- **`src/triangle.wgsl`** (~15 lines) — `@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f` reads from a `var<private>` array of three positions; `@fragment fn fs_main() -> @location(0) vec4f` returns a fixed RGB color. Imported as text: `import shader from "./triangle.wgsl" with { type: "text" };`

- **`tests/entry.test.ts`** (~10 lines) — single `bun test` smoke test: imports `entry.ts` and asserts the WGSL string is non-empty and `main` is a function. Doesn't validate WebGPU itself (bun-test has no `navigator.gpu`). Catches import-shape regressions only.

### `packages/core/native/` (Rust crate)

- **`Cargo.toml`** — binary crate `furnace-window`. Dependencies:
  - `winit = "0.30"`
  - `wry = "0.48"`
  - On Linux, a `compile_error!` macro keeps the bootstrap honest: this crate doesn't build on Linux yet. See BACKLOG.

- **`src/main.rs`** (~60 lines):
  1. Spawn child: `bun run --cwd <abs path to packages/core> serve.ts`, capturing stdout.
  2. Read child stdout lines until one starts with `PORT=`; parse the integer. Time out after 5 seconds with a clear stderr message ("Bun dev server failed to start within 5s — check `bun run dev` works standalone").
  3. Build `winit` `EventLoop` + `Window` (1280x720, title `"furnace"`).
  4. Build `wry` `WebView` attached to the window, navigated to `http://127.0.0.1:<port>`.
  5. On `WindowEvent::CloseRequested`, kill the child and exit.
  6. Best-effort `Drop` impl on a `ChildGuard` wrapper to kill the child if Rust panics — not bulletproof, see BACKLOG.

## Runtime data flow

### Browser path

```
Terminal: bun run dev:web
  → packages/core/serve.ts → Bun.serve binds e.g. :3127, prints "PORT=3127"
User opens http://localhost:3127
  → GET /            → index.html
  → GET /src/entry.ts → Bun transpiles on demand
  → GET /src/triangle.wgsl → served as text
entry.ts main():
  navigator.gpu.requestAdapter → adapter
  adapter.requestDevice → device
  canvas.getContext("webgpu").configure({device, format})
  createShaderModule, createRenderPipeline
  RAF loop: encode pass, setPipeline, draw(3), submit
  → Triangle on screen
```

### Native path

```
Terminal: bun run dev:native
  → cargo builds (if needed) furnace-window binary, then runs it
furnace-window:
  spawn child: bun run --cwd <core> serve.ts
  read child stdout: "PORT=3127"
  winit creates EventLoop + Window
  wry attaches WebView, navigates to http://127.0.0.1:3127
  → WebView loads index.html + entry.ts + triangle.wgsl
  → Same WebGPU code runs, native WebView's WebGPU implementation
  → Triangle on screen, in a native window
User closes window:
  WindowEvent::CloseRequested → kill child, exit
```

### Key invariants

1. **Same code on both paths.** No `if (isNative)` branch in TS/HTML/WGSL.
2. **Native is a thin parent.** Rust's job is window + child process management.
3. **Port discovery is explicit.** `serve.ts` prints `PORT=<n>`; Rust parses that line. Avoids "address in use" failures when both targets are running.
4. **Single source of truth for the dev server.** `dev:web` and `dev:native` both run the same `serve.ts`.

## Error handling

Scope-calibrated. Three failure surfaces handled, the long tail explicitly deferred.

### Handled

1. **`navigator.gpu` missing / adapter null.** Catch in `main()`, write a human-readable message to `document.body.innerText`. Covers browsers without WebGPU, pre-Tahoe macOS in the webview, unsupported GPUs.
2. **WGSL compile / pipeline-creation errors.** Wrap in `pushErrorScope("validation")` / `popErrorScope()`; write the message to `document.body` rather than only `console.error`.
3. **Native: Bun child fails to start or never emits `PORT=`.** Rust path times out after 5 seconds, writes a clear error to stderr, exits non-zero.

### Explicitly deferred (BACKLOG)

- Window resize → swap chain recreation
- Device-lost recovery
- Texture format negotiation beyond `getPreferredCanvasFormat()`
- Bulletproof child-process cleanup on Rust panic (best-effort `Drop` is what we ship)

## Testing

Scope-calibrated to "the smallest verification that catches the regressions you'd actually care about at this stage."

### In scope

1. **`bun test` smoke test** in `packages/core/tests/entry.test.ts` — module loads, `main` is a function, WGSL string non-empty. Catches import-shape regressions.
2. **`bunx tsc --noEmit`** via `bun run typecheck` — catches WGSL text-import typing, WebGPU type usage.
3. **`biome check`** via `bun run check` — formatting + lint.
4. **Manual verification checklist** (also serves as acceptance criteria — see below).

### Out of scope (BACKLOG)

- Playwright visual regression / pixel snapshots
- mitata microbenchmarks
- Native binary integration tests

## AI-friendliness fixes (bundled with triangle work)

1. **Delete `.claude/rules/bun.md`.** Currently byte-identical to `.claude/CLAUDE.md` (both 1973 bytes). Two copies guarantees drift. `CLAUDE.md` is canonical because Claude Code auto-loads it.
2. **Fix `biome.json`.** Remove `extends: ["./biome.test.json"]` — file doesn't exist.
3. **Add npm scripts** to root `package.json`: `dev:web`, `dev:native`, `build:native`, `typecheck`, `check`, `test`. AI agents discover the menu via `bun run` (no args).
4. **Add `AGENTS.md`** at root, ~10 lines, pointing at `.claude/CLAUDE.md` as canonical. This is the cross-tool convention (Cursor, Codex CLI, Gemini CLI all read `AGENTS.md`).
5. **Update `README.md`** — one paragraph on what `furnace` is, four-line run instructions for web + native, pointer to `.docs/` for architecture context.
6. **Add BACKLOG workflow guidance to `.claude/CLAUDE.md`** — see next section.

## `.docs/BACKLOG.md` — convention for deferred work

### Purpose

A single holding area for deferred work, productionalization tasks, and ideas worth keeping across sessions. Captures work that's been **consciously deferred** so the reasoning isn't lost between sessions.

### Distinction from other tracking surfaces

| Where | What it tracks | Lifespan |
|---|---|---|
| `.docs/BACKLOG.md` | Deferred work, ideas, productionalization | Multi-session, durable |
| `TaskCreate` / TodoWrite | In-progress, current-session tasks | Within-session, ephemeral |
| `.docs/shallot-...md`, future ADRs | Decisions, exploration notes | Durable, **not** a task list |

### Entry shape

Each entry is ~5-10 lines:

```markdown
### <short title>
**Context:** Why we deferred / what it is / link to relevant doc section.
**Trigger to revisit:** Concrete signal (e.g., "first time we render >1 mesh", "before public release").
**Reference:** Optional pointer to Shallot, a paper, an issue, etc.
```

### Grouping

Section by category. Add categories as needed; don't pre-create empty ones.

Initial categories: `Native runtime`, `Engine architecture`, `Testing & quality`, `Editor & tooling`, `AI / agents`, `Infrastructure`.

### Workflow guidance (loaded into AI agent context via CLAUDE.md)

- **When deferring mid-session** → add a BACKLOG entry before moving on.
- **Don't put bugs here** — fix urgent bugs; use GitHub Issues for non-urgent ones once we have a repo.
- **Don't put decisions here** — decisions go in architecture docs / ADRs.
- **Don't put in-progress work here** — that's `TaskCreate`'s job.
- **Prune on entry** — when starting new work, scan BACKLOG for items that just became actionable; promote them out.

### Initial BACKLOG seeds (created as part of this work)

#### Native runtime
- Linux/cef support (currently Mac+Windows only)
- Window resize → swap chain recreation
- Device-lost handling
- Robust child-process cleanup on Rust panic

#### Engine architecture
- ECS / data-oriented SoA layout (see architecture doc §11)
- GPU-resident physics (architecture doc §6)
- Rust transforms wasm crate (Shallot's hot scene-graph matrix loop)
- AudioWorklet + audio DSP (separate workstream entirely)

#### Testing & quality
- Playwright visual regression for browser path
- mitata microbenchmarks
- Pixel-snapshot tests

#### Editor & tooling
- Svelte-based editor / scene inspector (architecture doc §10)
- Hot-reload for WGSL shader files (current `bun --hot` only reloads TS/HTML)

#### AI / agents
- LLM-as-planner experiments (architecture doc §16)
- WebNN tensor / NPU acceleration

#### Infrastructure
- GitHub Actions CI (`bun run check`, `typecheck`, `test` on PR)
- Per-package CLAUDE.md once `packages/core` has real engine code
- **Native binary bundling** — package the Rust binary with the web assets embedded (or with the dev server starter) so it's distributable as a single executable. Required before Windows verification is practical. Mirror Shallot's approach if/when revisited.

## Acceptance criteria (manual verification checklist)

The bootstrap is complete when:

- [ ] `bun install` succeeds at the workspace root with no errors.
- [ ] `bun run check` passes (biome lint + format).
- [ ] `bun run typecheck` passes (`tsc --noEmit`).
- [ ] `bun test` passes (the single smoke test).
- [ ] `bun run dev:web` starts the dev server, prints a `PORT=` line, and a triangle is visible at the printed URL in Chrome.
- [ ] On macOS Tahoe 26+: `bun run dev:native` opens a native window with the same triangle visible.
- [ ] Closing the native window terminates the Bun child process (verify with `ps`/`bun pm ls`).
- [ ] `.docs/BACKLOG.md` exists with the seed entries listed above.
- [ ] `AGENTS.md` exists at root.
- [ ] `README.md` describes the project and the four-line run instructions.
- [ ] `.claude/rules/bun.md` is deleted.
- [ ] `index.ts` is deleted from the workspace root.
- [ ] `biome.json` no longer extends a non-existent file.
- [ ] Root `package.json` no longer has the vestigial `"module": "index.ts"` field.

## Risks & constraints

1. **macOS Tahoe 26+ requirement for native.** WebGPU in WKWebView is only available on macOS Tahoe 26 / iOS 26 and later — verified via Apple Developer forums. Older macOS versions running the native binary will see "WebGPU unavailable" rendered into the webview body. **Mitigation:** the on-screen error message will make this self-diagnosing. Documented in README and BACKLOG.
2. **Windows test gap.** This spec assumes `wry`'s WebView2 path on Windows just works with WebGPU. Verified at the spec level: WebView2 is Chromium-based with WebGPU. **Mitigation:** Windows verification is deferred until bundling is implemented (running `cargo build` on a Windows machine without bundling is awkward); the acceptance criteria explicitly call out macOS only. Bundling tracked in BACKLOG.
3. **`wry` 0.48 + `winit` 0.30 version coupling.** Mirroring Shallot's pinned versions reduces risk. **Mitigation:** keep these pinned; revisit if Shallot moves.
4. **Bun static-routes API maturity.** Bun 1.3.14 ships static-routes; if any rough edges appear (e.g., WGSL text imports), fallback is a manual route handler in `serve.ts` (still 30 lines instead of 15).

## Out of scope (will not be done in the implementation)

Everything listed in "Non-goals" above and every BACKLOG seed entry. The point of writing the BACKLOG concurrently with the spec is that these aren't surprises — they're explicit deferrals.

## What changes when this spec is implemented

**Files created:**
- `docs/superpowers/specs/2026-05-17-webgpu-triangle-bootstrap-design.md` (this file)
- `.docs/BACKLOG.md`
- `AGENTS.md`
- `packages/core/package.json`
- `packages/core/index.html`
- `packages/core/serve.ts`
- `packages/core/src/entry.ts`
- `packages/core/src/triangle.wgsl`
- `packages/core/tests/entry.test.ts`
- `packages/core/native/Cargo.toml`
- `packages/core/native/src/main.rs`
- `packages/core/native/.gitignore` (ignore `target/`)

**Files modified:**
- `package.json` (add scripts, remove vestigial `module` field)
- `biome.json` (remove broken `extends`)
- `README.md` (replace bun-init default with terse, dev-focused content)
- `.claude/CLAUDE.md` (add BACKLOG workflow guidance, slight reword of the duplicated content)

**Files deleted:**
- `.claude/rules/bun.md` (duplicate of `.claude/CLAUDE.md`)
- `.claude/rules/` directory if empty after the delete
- `index.ts` (the original `bun init` hello-world — not needed, root stays clean after bootstrap)

**Files untouched:**
- `tsconfig.json`
- `.editorconfig`
- `.gitignore`
- `.vscode/settings.json`
- `.claude/settings.json`
