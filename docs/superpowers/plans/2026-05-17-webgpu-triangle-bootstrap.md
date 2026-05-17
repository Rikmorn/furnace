# WebGPU Triangle Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a single WebGPU triangle on screen via two runtime targets (browser + native window) sharing identical TS/HTML/WGSL, with AI-friendliness fixes and a `.docs/BACKLOG.md` convention applied to the repo.

**Architecture:** One workspace package (`packages/core`) contains all triangle code. Browser path serves `index.html` via `Bun.serve()`. Native path is a small Rust binary (`winit` + `wry`) that spawns the Bun server as a child process and points a webview at the printed port. Same TS/HTML/WGSL renders in both.

**Tech Stack:** Bun 1.3.14, TypeScript 6.0.3 (strict, noEmit), Biome 2.4.15, WebGPU/WGSL, Rust (cargo, winit 0.30, wry 0.48).

**Spec reference:** `docs/superpowers/specs/2026-05-17-webgpu-triangle-bootstrap-design.md`.

---

## File Structure Overview

**Created:**
- `.docs/BACKLOG.md`
- `AGENTS.md`
- `packages/core/package.json`
- `packages/core/index.html`
- `packages/core/serve.ts`
- `packages/core/src/entry.ts`
- `packages/core/src/triangle.wgsl`
- `packages/core/tests/entry.test.ts`
- `packages/core/native/Cargo.toml`
- `packages/core/native/.gitignore`
- `packages/core/native/src/main.rs`

**Modified:**
- `package.json` (add scripts, remove `module` field)
- `biome.json` (remove broken `extends`, broaden includes glob)
- `README.md` (replace bun-init default with dev-terse content)
- `.claude/CLAUDE.md` (add BACKLOG workflow guidance)
- `.gitignore` (add `target/`)

**Deleted:**
- `index.ts` (root hello-world)
- `.claude/rules/bun.md` (duplicate of CLAUDE.md)
- `.claude/rules/` (directory, after the file is gone)

---

## Task 1: Initialize git repository and baseline commit

**Goal:** Establish git so subsequent task commits have somewhere to go. The user confirmed git isn't set up yet.

**Files:**
- Modify: `.gitignore` (already exists; verify contents)

- [ ] **Step 1: Initialize git**

```bash
cd /Users/roberto.sousa/Documents/Projects/furnace
git init
```

Expected: `Initialized empty Git repository in .../furnace/.git/`

- [ ] **Step 2: Verify `.gitignore` covers what we need**

Open `.gitignore` and confirm it includes at minimum: `node_modules`, `.DS_Store`, `.env*`, `.claude/settings.local.json`. It already does — no edit required at this step.

- [ ] **Step 3: Stage the entire current scaffold**

```bash
git add -A
git status --short | head -30
```

Expected: a listing of all tracked files (package.json, tsconfig.json, biome.json, bun.lock, index.ts, README.md, .claude/, .docs/, .vscode/, packages/core/ as an empty dir, etc.).

- [ ] **Step 4: Create the baseline commit**

```bash
git commit -m "chore: initial commit (bun init scaffold + planning docs)"
```

Expected: a single commit summary with the existing scaffold.

- [ ] **Step 5: Verify the commit landed**

```bash
git log --oneline
```

Expected: one line, the message above.

---

## Task 2: Clean up bun-init artifacts and broken configs

**Goal:** Remove the hello-world file, fix the broken biome extends, broaden biome's includes glob to cover nested files, remove the vestigial `module` field, and delete the duplicate `rules/bun.md`. Add `target/` to gitignore for the upcoming Rust crate.

**Files:**
- Delete: `index.ts`
- Delete: `.claude/rules/bun.md`
- Delete: `.claude/rules/` (after the file is gone)
- Modify: `package.json` (remove `module` field)
- Modify: `biome.json` (remove broken extends, broaden includes)
- Modify: `.gitignore` (add `target/`)

- [ ] **Step 1: Delete `index.ts`**

```bash
rm /Users/roberto.sousa/Documents/Projects/furnace/index.ts
```

- [ ] **Step 2: Delete `.claude/rules/bun.md` and the now-empty `rules/` dir**

```bash
rm /Users/roberto.sousa/Documents/Projects/furnace/.claude/rules/bun.md
rmdir /Users/roberto.sousa/Documents/Projects/furnace/.claude/rules
```

Expected: both commands succeed silently. `rmdir` fails if the directory has other contents — at the time of writing it does not.

- [ ] **Step 3: Update root `package.json` — remove `module`, keep workspaces, no scripts yet**

Replace the entire contents of `/Users/roberto.sousa/Documents/Projects/furnace/package.json` with:

```json
{
  "name": "furnace",
  "type": "module",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "devDependencies": {
    "@biomejs/biome": "^2.4.15",
    "@types/bun": "^1.3.14",
    "typescript": "^6.0.3"
  }
}
```

(Scripts get added in Task 4 once `packages/core` exists to delegate to.)

- [ ] **Step 4: Fix `biome.json` — remove broken extends, broaden includes**

Replace the entire contents of `/Users/roberto.sousa/Documents/Projects/furnace/biome.json` with:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.15/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": false
  },
  "files": {
    "ignoreUnknown": true,
    "includes": [
      "**/*.ts",
      "**/*.json",
      "**/*.html",
      "**/*.css",
      "!**/node_modules/**",
      "!**/target/**",
      "!**/dist/**",
      "!**/out/**",
      "!package.json",
      "!bun.lock"
    ]
  },
  "formatter": {
    "enabled": true,
    "useEditorconfig": true,
    "formatWithErrors": false
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "noNamespace": "error",
        "useAsConstAssertion": "error",
        "noInferrableTypes": "error",
        "useConsistentArrayType": "error",
        "useForOf": "error",
        "useNodejsImportProtocol": "off"
      },
      "correctness": {
        "noUndeclaredVariables": "error",
        "noUnusedVariables": "warn",
        "noUnusedFunctionParameters": "warn"
      },
      "suspicious": {
        "noEmptyBlockStatements": "error",
        "useAwait": "warn",
        "useIterableCallbackReturn": "off"
      }
    }
  },
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteProperties": "asNeeded",
      "trailingCommas": "all",
      "semicolons": "always",
      "arrowParentheses": "always",
      "quoteStyle": "double"
    }
  },
  "json": {
    "parser": {
      "allowComments": true
    },
    "formatter": {
      "enabled": true
    }
  }
}
```

Changes from the original:
- Removed `extends: ["./biome.test.json"]` (file didn't exist).
- Broadened `files.includes` so nested files in `packages/` get linted.
- Excluded `target/`, `dist/`, `out/`, `node_modules/`, and `bun.lock` explicitly.

- [ ] **Step 5: Add `target/` to `.gitignore` for the Rust crate**

Edit `/Users/roberto.sousa/Documents/Projects/furnace/.gitignore`, add the lines below before the "Claude Code personal overrides" section:

```
# Rust build artifacts
target
*.rs.bk
Cargo.lock.bak
```

Note: we don't ignore `Cargo.lock` — for binaries, committing the lockfile is the standard recommendation.

- [ ] **Step 6: Verify nothing is broken**

```bash
cd /Users/roberto.sousa/Documents/Projects/furnace
bun install
```

Expected: succeeds without errors (only reinstall of existing devDeps).

```bash
bunx biome check
```

Expected: exits 0 (no files left to check after deletion of `index.ts`, or it lists no problems).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove bun-init hello-world, fix broken biome config, dedupe claude rules"
```

---

## Task 3: Create `.docs/BACKLOG.md` with seed entries

**Goal:** Establish the deferred-work register with the seeds identified during brainstorming.

**Files:**
- Create: `.docs/BACKLOG.md`

- [ ] **Step 1: Write `.docs/BACKLOG.md`**

Create `/Users/roberto.sousa/Documents/Projects/furnace/.docs/BACKLOG.md` with the contents below:

```markdown
# Backlog

Deferred work, productionalization tasks, and ideas worth keeping. Not a to-do list — a holding area for work that has been **consciously deferred** so the reasoning survives between sessions.

## How to use this file

- **When deferring mid-session:** add an entry before moving on. Don't lose context that took a conversation to surface.
- **Don't put bugs here:** fix urgent bugs; use GitHub Issues for non-urgent ones once the repo exists.
- **Don't put decisions here:** decisions go in architecture docs (`.docs/`) or ADRs.
- **Don't put in-progress work here:** that's `TaskCreate`'s job — within-session only.
- **Prune on entry:** when starting new work, scan for items that just became actionable; promote them out.

Entry shape:

```markdown
### <short title>
**Context:** Why we deferred / what it is / link to relevant doc section.
**Trigger to revisit:** Concrete signal (e.g., "first time we render >1 mesh", "before public release").
**Reference:** Optional pointer to Shallot, a paper, an issue, etc.
```

Group by category. Add categories as needed; don't pre-create empty ones.

---

## Native runtime

### Linux / cef support
**Context:** Native host is currently macOS + Windows only. Linux deferred because `cef` (Chromium Embedded Framework) pulls a heavy Chromium runtime as a build dependency. Shallot uses `cef = 145` on Linux because GTK WebKit's WebGPU support is weak.
**Trigger to revisit:** A Linux user wants to run the native target, or a contributor offers to wire it up.
**Reference:** `packages/shallot/rust/window/Cargo.toml` in dylanebert/shallot — `[target.'cfg(target_os = "linux")'.dependencies]` block.

### Window resize → swap chain recreation
**Context:** Triangle is squished on window resize because the WebGPU canvas swap chain isn't recreated. Acceptable for one static triangle, embarrassing the moment we render anything else.
**Trigger to revisit:** When a second example is added, or when the squish becomes annoying enough to fix.

### Device-lost handling
**Context:** No recovery if the GPU device is lost (driver crash, alt-tab on integrated GPU). The engine just stops rendering silently.
**Trigger to revisit:** First time it actually happens during development, or before any public release.

### Robust child-process cleanup on Rust panic
**Context:** The native binary uses a best-effort `Drop` impl to kill the Bun child when the window closes. If Rust panics mid-frame or the OS kills the parent with SIGKILL, the child may leak. Also: spawning `bun` directly (not via `bun run`) gives us clean kill semantics, but signal handling is still incomplete.
**Trigger to revisit:** First time we see a leaked Bun process during dev.

### Native binary bundling
**Context:** Currently the native binary requires the source tree (it references `packages/core` via `CARGO_MANIFEST_DIR`). For distribution we need to bundle the web assets into the binary (or ship the dev server alongside). Mirror Shallot's approach if/when revisited.
**Trigger to revisit:** First Windows verification (which requires shipping a binary to that machine), or any user-facing release.

---

## Engine architecture

### ECS / data-oriented SoA layout
**Context:** The vision from `.docs/shallot-and-game-engine-architecture.md` §11 — SoA `Float32Array`s for positions/velocities/etc., with systems declaring read/write component sets for parallel scheduling. Not relevant until we render >1 entity.
**Trigger to revisit:** First time we render multiple meshes or want to manage entities.

### GPU-resident physics
**Context:** Shared GPU buffers for solver writes and renderer reads, no CPU↔GPU state copy per frame. From architecture doc §6.
**Trigger to revisit:** When physics is on the table at all.

### Rust transforms wasm crate
**Context:** Shallot's hot scene-graph matrix loop runs in wasm via `wasm-pack`. Not relevant until we have a scene graph at all.
**Trigger to revisit:** When transforms become a hot path.

### AudioWorklet + audio DSP
**Context:** Audio is a separate workstream entirely. Architecture doc §13 covers the AudioWorklet thread model.
**Trigger to revisit:** When audio is on the roadmap.

---

## Testing & quality

### Playwright visual regression for browser path
**Context:** Pixel-snapshot comparison of the rendered triangle to catch shader regressions. Shallot uses Playwright for this. Overkill for one triangle, important when there's more.
**Trigger to revisit:** When we have ≥2 examples to compare, or any non-trivial shader work.

### mitata microbenchmarks
**Context:** Shallot uses `mitata` for hot-loop microbenchmarks (transform updates, etc.). Need it only once we have hot loops worth measuring.
**Trigger to revisit:** When the Rust transforms wasm crate or the ECS loop arrives.

### Pixel-perfect snapshot testing
**Context:** Reference-image comparison for the rendered output. Closely tied to the Playwright setup above.
**Trigger to revisit:** Same as Playwright entry.

---

## Editor & tooling

### Svelte-based editor / scene inspector
**Context:** Architecture doc §10 — Shallot uses Svelte for fine-grained reactivity + no virtual-DOM overhead, which coexists nicely with a WebGPU render loop. Worth considering when we need any UI to inspect engine state.
**Trigger to revisit:** When we need any in-app UI, remote inspector, or scene-tree visualization.

### Hot-reload for WGSL shaders
**Context:** `bun --hot` reloads TS/HTML, but a WGSL text-import change requires recreating the WebGPU pipeline. Currently you need a full page reload to pick up shader edits.
**Trigger to revisit:** When iterating heavily on a shader and the friction shows.

---

## AI / agents

### LLM-as-planner experiments
**Context:** Architecture doc §16. Hand a foundation model structured scene state, get JSON actions back, execute via classical layer (A*, animation, physics). Far future.
**Trigger to revisit:** When we have a scene with enough state to be interesting (entities, world, NPCs).

### WebNN tensor / NPU acceleration
**Context:** Web Neural Network API. Spec partially in Chrome. Architecture doc §14.
**Trigger to revisit:** When ML inference is on the path.

---

## Infrastructure

### GitHub Actions CI
**Context:** Pipeline running `bun run check`, `bun run typecheck`, `bun test` on PR. No CI configured yet.
**Trigger to revisit:** First external contribution, or before public release.

### Per-package CLAUDE.md
**Context:** When `packages/core` has real engine code (multiple modules, established patterns), it needs its own CLAUDE.md describing local conventions. Root CLAUDE.md handles cross-cutting concerns.
**Trigger to revisit:** When `packages/core` has more than ~5 files of engine code.
```

- [ ] **Step 2: Commit**

```bash
git add .docs/BACKLOG.md
git commit -m "docs: add BACKLOG.md with seed entries for deferred work"
```

---

## Task 4: Update `.claude/CLAUDE.md` with BACKLOG workflow guidance

**Goal:** Add the BACKLOG convention to the canonical Claude guidance file so future Claude sessions follow it automatically.

**Files:**
- Modify: `.claude/CLAUDE.md`

- [ ] **Step 1: Read current `.claude/CLAUDE.md`**

```bash
cat /Users/roberto.sousa/Documents/Projects/furnace/.claude/CLAUDE.md
```

Expected: contains the existing Bun/runtime/APIs/testing guidance.

- [ ] **Step 2: Append a new section to `.claude/CLAUDE.md`**

Add the section below to the end of the file (after the "Testing" section):

```markdown
## Deferred work — `.docs/BACKLOG.md`

The repo uses `.docs/BACKLOG.md` to track deferred work and ideas across sessions. This is durable, multi-session storage — distinct from `TaskCreate` (within-session only) and from architecture docs (decisions, not tasks).

**When working in this repo:**
- **Defer something mid-session?** Add an entry to `.docs/BACKLOG.md` before moving on. Use the entry shape documented in that file (title, Context, Trigger to revisit, Reference).
- **Starting new work?** Scan `.docs/BACKLOG.md` first for items that just became actionable. Promote them out by removing the entry and tracking the work in the current session.
- **Don't put bugs there** — fix urgent bugs; use GitHub Issues for non-urgent ones once the repo is on GitHub.
- **Don't put decisions there** — decisions go in `.docs/` notes or ADRs.

When the BACKLOG file grows past ~100 entries or one category exceeds ~20, prune by promoting actionable items out and consolidating context-decayed items.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs(claude): add BACKLOG workflow guidance"
```

---

## Task 5: Add `AGENTS.md` at root

**Goal:** Cross-tool agent convention file (Cursor, Codex CLI, Gemini CLI, etc.) pointing at the canonical guidance.

**Files:**
- Create: `AGENTS.md`

- [ ] **Step 1: Write `AGENTS.md`**

Create `/Users/roberto.sousa/Documents/Projects/furnace/AGENTS.md` with the contents below:

```markdown
# AGENTS.md

Cross-tool AI agent guidance for the `furnace` repo. Canonical agent context lives in `.claude/CLAUDE.md` — this file points there to keep one source of truth.

## TL;DR

- **Runtime is Bun.** Use `bun <file>`, `bun test`, `bun build`, `bun install`. Do **not** use Node, npm, jest, vitest, webpack, esbuild, or ts-node.
- **APIs:** prefer `Bun.serve`, `bun:sqlite`, `Bun.redis`, `Bun.sql`, `Bun.file`, `Bun.$\`...\`` over their Node equivalents.
- **Workspace:** monorepo via Bun workspaces — packages live in `packages/*`. Run package scripts via `bun run --cwd packages/<name> <script>`.
- **Before commit:** run `bun run check` (biome) and `bun run typecheck`. Fix anything flagged.
- **Deferred work:** new items go in `.docs/BACKLOG.md` (see the convention in `.claude/CLAUDE.md`).

## Canonical references

- `.claude/CLAUDE.md` — full agent guidance (Bun runtime rules, API preferences, testing).
- `.docs/shallot-and-game-engine-architecture.md` — architectural vision and inspiration notes.
- `.docs/BACKLOG.md` — deferred work register.
- `docs/superpowers/specs/` — design specs for major changes.
- `docs/superpowers/plans/` — implementation plans for major changes.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add AGENTS.md cross-tool agent pointer"
```

---

## Task 6: Replace `README.md` with project-shaped content

**Goal:** Replace the `bun init` default README with terse, dev-focused content describing what the project is and how to run it.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md`**

Replace the entire contents of `/Users/roberto.sousa/Documents/Projects/furnace/README.md` with:

```markdown
# furnace

A WebGPU exploration project. Currently bootstrapped to render a single triangle to (a) a browser tab and (b) a native desktop window, sharing the same TS/HTML/WGSL code in both contexts. Inspired by [Shallot](https://github.com/dylanebert/shallot); see `.docs/shallot-and-game-engine-architecture.md` for the broader architectural vision.

## Requirements

- [Bun](https://bun.com) 1.3+
- macOS Tahoe 26+ for the native target (Windows is supported in principle but unverified pending bundling — see `.docs/BACKLOG.md`)
- Rust toolchain (cargo) for the native target

## Run

```bash
bun install                  # install workspace deps
bun run dev:web              # browser path; open the URL it prints
bun run dev:native           # native window path (mac/windows only)
bun run check                # biome lint + format
bun run typecheck            # tsc --noEmit
bun test                     # smoke tests
```

## Layout

- `packages/core/` — engine code and the triangle demo (HTML + TS + WGSL).
- `packages/core/native/` — Rust crate (`winit` + `wry`) that opens a native window hosting the same web app.
- `.docs/` — architecture notes, BACKLOG, and other planning context.
- `docs/superpowers/specs/`, `docs/superpowers/plans/` — design specs and implementation plans.
- `.claude/CLAUDE.md`, `AGENTS.md` — agent guidance.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: replace bun-init README with project-shaped content"
```

---

## Task 7: Create `packages/core/package.json`

**Goal:** Establish the workspace package with its own scripts. Root scripts (next task) delegate here.

**Files:**
- Create: `packages/core/package.json`

- [ ] **Step 1: Write `packages/core/package.json`**

Create `/Users/roberto.sousa/Documents/Projects/furnace/packages/core/package.json` with the contents below:

```json
{
  "name": "@furnace/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/entry.ts",
  "scripts": {
    "dev": "bun --hot serve.ts",
    "dev:native": "bun run build:native && ./native/target/release/furnace-window",
    "build:native": "cargo build --release --manifest-path native/Cargo.toml",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  }
}
```

- [ ] **Step 2: Wire workspace**

```bash
cd /Users/roberto.sousa/Documents/Projects/furnace
bun install
```

Expected: bun recognizes `@furnace/core` as a workspace package.

```bash
bun pm ls
```

Expected: lists `@furnace/core` somewhere in the output.

- [ ] **Step 3: Commit**

```bash
git add packages/core/package.json bun.lock
git commit -m "feat(core): add @furnace/core workspace package"
```

---

## Task 8: Add root `package.json` scripts that delegate to `@furnace/core`

**Goal:** Make `bun run dev:web`, `bun run dev:native`, etc. work from the workspace root.

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update root `package.json`**

Replace the entire contents of `/Users/roberto.sousa/Documents/Projects/furnace/package.json` with:

```json
{
  "name": "furnace",
  "type": "module",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "dev:web": "bun run --cwd packages/core dev",
    "dev:native": "bun run --cwd packages/core dev:native",
    "build:native": "bun run --cwd packages/core build:native",
    "typecheck": "bun run --cwd packages/core typecheck",
    "test": "bun test",
    "check": "biome check"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.15",
    "@types/bun": "^1.3.14",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2: Verify scripts are discoverable**

```bash
cd /Users/roberto.sousa/Documents/Projects/furnace
bun run
```

Expected: prints the list of scripts (`dev:web`, `dev:native`, `build:native`, `typecheck`, `test`, `check`).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(root): add workspace-level scripts delegating to @furnace/core"
```

---

## Task 9: Add the triangle WGSL shader

**Goal:** Drop in the smallest valid WGSL that draws a triangle from `@builtin(vertex_index)`.

**Files:**
- Create: `packages/core/src/triangle.wgsl`

- [ ] **Step 1: Write `packages/core/src/triangle.wgsl`**

Create the file with these contents (note the `src/` subdir doesn't exist yet — `bun`/`mkdir` handles that on first write):

```bash
mkdir -p /Users/roberto.sousa/Documents/Projects/furnace/packages/core/src
```

Then write `/Users/roberto.sousa/Documents/Projects/furnace/packages/core/src/triangle.wgsl`:

```wgsl
@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(
    vec2f( 0.0,  0.5),
    vec2f(-0.5, -0.5),
    vec2f( 0.5, -0.5),
  );
  return vec4f(pos[vi], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return vec4f(1.0, 0.4, 0.2, 1.0);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/triangle.wgsl
git commit -m "feat(core): add triangle WGSL shader"
```

---

## Task 10: Add `index.html` and `src/entry.ts` (browser entry)

**Goal:** The full browser-side render path. After this task, only the dev server (Task 11) is missing for the browser to work.

**Files:**
- Create: `packages/core/index.html`
- Create: `packages/core/src/entry.ts`

- [ ] **Step 1: Write `packages/core/index.html`**

Create `/Users/roberto.sousa/Documents/Projects/furnace/packages/core/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>furnace</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        height: 100%;
        overflow: hidden;
        background: #0d0d12;
        color: #ddd;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      #gpu {
        display: block;
        width: 100vw;
        height: 100vh;
      }
    </style>
  </head>
  <body>
    <canvas id="gpu"></canvas>
    <script type="module">
      import { main } from "./src/entry.ts";
      main().catch((e) => {
        document.body.innerText = `Error: ${e?.message ?? e}`;
      });
    </script>
  </body>
</html>
```

- [ ] **Step 2: Write `packages/core/src/entry.ts`**

Create `/Users/roberto.sousa/Documents/Projects/furnace/packages/core/src/entry.ts`:

```ts
import shader from "./triangle.wgsl" with { type: "text" };

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
  const shaderModule = device.createShaderModule({ code: shader });
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

  const draw = (): void => {
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

Note: `entry.ts` exports `main` but does **not** call it on load — the HTML's `<script type="module">` calls it. This makes the module safely importable from `bun test` (which has no `document` / `navigator.gpu`).

- [ ] **Step 3: Typecheck**

```bash
cd /Users/roberto.sousa/Documents/Projects/furnace
bun run typecheck
```

Expected: exits 0. If there are errors about `WebGPU` types or `with { type: "text" }`, the `@types/bun` package should provide them — verify it's installed.

If typecheck complains about `document` / `navigator` not existing, the project's `tsconfig.json` lacks DOM types. The current tsconfig has `"lib": ["ESNext"]` and `"types": ["bun"]`. We need `"DOM"` in lib for browser globals. Update `tsconfig.json`:

Read `/Users/roberto.sousa/Documents/Projects/furnace/tsconfig.json` and change:

```json
    "lib": ["ESNext"],
```

to:

```json
    "lib": ["ESNext", "DOM"],
```

Then rerun `bun run typecheck`. Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/core/index.html packages/core/src/entry.ts tsconfig.json
git commit -m "feat(core): add browser entry — index.html and entry.ts (WebGPU triangle)"
```

---

## Task 11: Add the `Bun.serve` dev server

**Goal:** A 10-line `serve.ts` that binds a free port, prints `PORT=<n>`, and serves `index.html` via Bun's static-routes feature.

**Files:**
- Create: `packages/core/serve.ts`

- [ ] **Step 1: Write `packages/core/serve.ts`**

Create `/Users/roberto.sousa/Documents/Projects/furnace/packages/core/serve.ts`:

```ts
import indexHtml from "./index.html";

const server = Bun.serve({
  port: 0,
  routes: {
    "/": indexHtml,
  },
});

console.log(`PORT=${server.port}`);
console.log(`Serving at ${server.url}`);
```

Why `port: 0`: lets the OS assign a free port so the browser path and native path can run side by side without colliding. The Rust binary parses the printed `PORT=<n>` line to discover the chosen port.

- [ ] **Step 2: Smoke-test the dev server**

```bash
cd /Users/roberto.sousa/Documents/Projects/furnace
bun run --cwd packages/core dev &
DEV_PID=$!
sleep 2
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
```

Expected output: `PORT=<some number>` then `Serving at http://localhost:<n>/`. The server gets killed after 2 seconds.

- [ ] **Step 3: Run typecheck again to verify the new file**

```bash
cd /Users/roberto.sousa/Documents/Projects/furnace
bun run typecheck
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/core/serve.ts
git commit -m "feat(core): add Bun.serve dev server with port=0 + PORT= protocol"
```

---

## Task 12: Add the smoke test

**Goal:** A `bun test` that verifies the entry module loads and the WGSL shader text is well-formed. Doesn't render — there's no WebGPU in `bun test`.

**Files:**
- Create: `packages/core/tests/entry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `/Users/roberto.sousa/Documents/Projects/furnace/packages/core/tests/entry.test.ts`:

```ts
import { expect, test } from "bun:test";
import shader from "../src/triangle.wgsl" with { type: "text" };
import { main } from "../src/entry.ts";

test("entry exports main", () => {
  expect(typeof main).toBe("function");
});

test("triangle WGSL declares vertex and fragment entry points", () => {
  expect(shader.length).toBeGreaterThan(0);
  expect(shader).toContain("@vertex");
  expect(shader).toContain("@fragment");
  expect(shader).toContain("vs_main");
  expect(shader).toContain("fs_main");
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
cd /Users/roberto.sousa/Documents/Projects/furnace
bun test
```

Expected: 2 tests pass.

If they fail with `document is not defined` from importing `entry.ts`, double-check that `entry.ts` only **exports** `main` rather than calling it on module load (see Task 10 step 2's note).

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/entry.test.ts
git commit -m "test(core): add entry smoke test (WGSL shape + main export)"
```

---

## Task 13: Manual verification of the browser path

**Goal:** Confirm the browser triangle actually renders. No code changes unless something is broken.

**Files:** None (verification only).

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/roberto.sousa/Documents/Projects/furnace
bun run dev:web
```

Expected: prints `PORT=<n>` and `Serving at http://localhost:<n>/`.

- [ ] **Step 2: Open the URL in a browser**

Open the URL printed by step 1 (e.g., `http://localhost:3000`) in Chrome, Safari (Tahoe), or Firefox.

Expected: a window with a dark background and an orange triangle pointing up.

If the page shows an error message instead, read it — the entry.ts deliberately writes failure reasons to `document.body.innerText`. Common causes:
- "WebGPU unavailable" → browser is too old, or `navigator.gpu` isn't enabled. Try Chrome 113+.
- "Pipeline error: ..." → WGSL doesn't compile. Re-check `triangle.wgsl`.
- "canvas#gpu not found" → the HTML didn't load properly. Re-check the static-routes setup.

- [ ] **Step 3: Stop the dev server**

In the terminal running `dev:web`, press `Ctrl-C`. Expected: server exits.

- [ ] **Step 4: No commit unless a fix was needed**

If everything worked, no changes to commit. If a fix was needed, commit it with a descriptive message before moving on.

---

## Task 14: Add the Rust native window host

**Goal:** A small Rust binary (`furnace-window`) that spawns `bun serve.ts` as a child, reads the port, and opens a `wry` webview in a `winit` window pointing at it.

**Files:**
- Create: `packages/core/native/Cargo.toml`
- Create: `packages/core/native/.gitignore`
- Create: `packages/core/native/src/main.rs`

- [ ] **Step 1: Make the `native/` directory structure**

```bash
mkdir -p /Users/roberto.sousa/Documents/Projects/furnace/packages/core/native/src
```

- [ ] **Step 2: Write `packages/core/native/Cargo.toml`**

Create `/Users/roberto.sousa/Documents/Projects/furnace/packages/core/native/Cargo.toml`:

```toml
[package]
name = "furnace-window"
version = "0.0.0"
edition = "2021"
publish = false

[[bin]]
name = "furnace-window"
path = "src/main.rs"

[dependencies]
winit = "0.30"
wry = "0.48"
```

Note: no Linux-specific `cef` dependency — `main.rs` has a `compile_error!` for Linux. See `.docs/BACKLOG.md` "Linux / cef support".

- [ ] **Step 3: Write `packages/core/native/.gitignore`**

Create `/Users/roberto.sousa/Documents/Projects/furnace/packages/core/native/.gitignore`:

```
/target
```

(The root `.gitignore` already excludes `target` globally as of Task 2 — this is belt-and-braces, and a common Rust crate convention.)

- [ ] **Step 4: Write `packages/core/native/src/main.rs`**

Create `/Users/roberto.sousa/Documents/Projects/furnace/packages/core/native/src/main.rs`:

```rust
#[cfg(target_os = "linux")]
compile_error!(
    "Linux native target is not yet supported. See .docs/BACKLOG.md (Native runtime > Linux / cef support)."
);

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};
use winit::{
    application::ApplicationHandler,
    dpi::LogicalSize,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop},
    window::{Window, WindowId},
};
use wry::{WebView, WebViewBuilder};

const CORE_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/..");
const PORT_DEADLINE_SECS: u64 = 5;

struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct App {
    url: String,
    window: Option<Window>,
    _webview: Option<WebView>,
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title("furnace")
            .with_inner_size(LogicalSize::new(1280.0, 720.0));
        let window = event_loop
            .create_window(attrs)
            .expect("failed to create window");
        let webview = WebViewBuilder::new()
            .with_url(&self.url)
            .build(&window)
            .expect("failed to create webview");
        self.window = Some(window);
        self._webview = Some(webview);
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        if matches!(event, WindowEvent::CloseRequested) {
            event_loop.exit();
        }
    }
}

fn spawn_bun_dev() -> Child {
    // Note: no `--hot`. Hot reload + `port: 0` could pick a different port on each
    // re-execution, leaving the webview pointing at a dead address. The browser
    // path uses `--hot` directly; the native window simply restarts when needed.
    Command::new("bun")
        .current_dir(CORE_DIR)
        .args(["serve.ts"])
        .stdout(Stdio::piped())
        .spawn()
        .expect("failed to spawn `bun serve.ts`. Is bun installed and on PATH?")
}

fn read_port(child: &mut Child) -> Option<u16> {
    let stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let deadline = Instant::now() + Duration::from_secs(PORT_DEADLINE_SECS);
    while Instant::now() < deadline {
        let remaining = deadline - Instant::now();
        match rx.recv_timeout(remaining) {
            Ok(line) => {
                if let Some(rest) = line.strip_prefix("PORT=") {
                    if let Ok(p) = rest.trim().parse::<u16>() {
                        return Some(p);
                    }
                }
            }
            Err(_) => return None,
        }
    }
    None
}

fn main() {
    let mut child = spawn_bun_dev();
    let port = match read_port(&mut child) {
        Some(p) => p,
        None => {
            eprintln!(
                "Bun dev server failed to print PORT=<n> within {PORT_DEADLINE_SECS}s. Check `bun run --cwd packages/core dev` works standalone."
            );
            let _ = child.kill();
            let _ = child.wait();
            std::process::exit(1);
        }
    };
    println!("furnace-window: connected to bun on port {port}");

    let url = format!("http://127.0.0.1:{port}");
    let _guard = ChildGuard(child);

    let event_loop = EventLoop::new().expect("failed to create event loop");
    let mut app = App {
        url,
        window: None,
        _webview: None,
    };
    event_loop.run_app(&mut app).expect("event loop failure");
}
```

- [ ] **Step 5: Build the crate (first build is slow — winit and wry pull a lot)**

```bash
cd /Users/roberto.sousa/Documents/Projects/furnace
bun run build:native
```

Expected: cargo compiles a few hundred crates and emits `packages/core/native/target/release/furnace-window`. First build can take 3-8 minutes; subsequent rebuilds are seconds.

If build fails:
- Missing cargo? Install via `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`.
- macOS toolchain missing? `xcode-select --install`.
- Specific crate version mismatch? Check that `winit = "0.30"` and `wry = "0.48"` are honored — bump if cargo says otherwise.

- [ ] **Step 6: Commit**

```bash
git add packages/core/native/
git commit -m "feat(native): add furnace-window Rust binary (winit + wry, spawns Bun child)"
```

---

## Task 15: Manual verification of the native path

**Goal:** Confirm the native window opens and renders the same triangle as the browser. No code unless something needs fixing.

**Files:** None (verification only).

- [ ] **Step 1: Run `bun run dev:native`**

```bash
cd /Users/roberto.sousa/Documents/Projects/furnace
bun run dev:native
```

Expected:
1. Cargo finishes (instant if Task 14 left the build cached).
2. The binary spawns Bun (you'll see `PORT=<n>` and `Serving at ...` in stdout).
3. A native window titled "furnace" (1280x720) opens.
4. The window shows the same orange triangle on a dark background as the browser did.

- [ ] **Step 2: Close the window, verify the Bun child dies**

Close the native window via its OS close button.

In a separate terminal, immediately check no orphan Bun child remains:

```bash
ps -ef | grep "bun serve.ts" | grep -v grep
```

Expected: empty output. The `ChildGuard::drop` should have killed the child.

If there is an orphan, kill it manually (`kill <pid>`) and add a follow-up entry to `.docs/BACKLOG.md` under "Native runtime > Robust child-process cleanup on Rust panic" describing the leak.

- [ ] **Step 3: No commit unless a fix was needed**

---

## Task 16: Final acceptance criteria sweep

**Goal:** Walk through every acceptance criterion in the spec; commit anything left.

**Files:** None unless a check exposes something missing.

- [ ] **Step 1: Run the full quality gates**

```bash
cd /Users/roberto.sousa/Documents/Projects/furnace
bun install
bun run check
bun run typecheck
bun test
```

Expected: all four exit 0. If `bun run check` complains, run `bunx biome check --write` to auto-format, review the diff, commit.

- [ ] **Step 2: Walk the spec's acceptance criteria**

Open `docs/superpowers/specs/2026-05-17-webgpu-triangle-bootstrap-design.md`. For each unchecked item in "Acceptance criteria", verify it's true. The list (mirrored here for convenience):

- [ ] `bun install` succeeds at the workspace root with no errors.
- [ ] `bun run check` passes (biome lint + format).
- [ ] `bun run typecheck` passes (`tsc --noEmit`).
- [ ] `bun test` passes (the single smoke test).
- [ ] `bun run dev:web` starts the dev server, prints a `PORT=` line, and a triangle is visible at the printed URL in Chrome.
- [ ] On macOS Tahoe 26+: `bun run dev:native` opens a native window with the same triangle visible.
- [ ] Closing the native window terminates the Bun child process (verified in Task 15).
- [ ] `.docs/BACKLOG.md` exists with the seed entries.
- [ ] `AGENTS.md` exists at root.
- [ ] `README.md` describes the project and the four-line run instructions.
- [ ] `.claude/rules/bun.md` is deleted.
- [ ] `index.ts` is deleted from the workspace root.
- [ ] `biome.json` no longer extends a non-existent file.
- [ ] Root `package.json` no longer has the vestigial `"module": "index.ts"` field.

- [ ] **Step 3: Commit any final adjustments**

If any check exposed a missed step, fix it and commit with a descriptive message. If everything is green, no commit needed.

- [ ] **Step 4: Print a final summary**

```bash
git log --oneline
```

Expected: ~12-15 commits, one per task. This is the "done" state.

---

## Self-Review

(For the plan author. Not an execution step.)

**Spec coverage check:**

| Spec section | Plan tasks |
|---|---|
| Architecture (one package, browser+native via shared code) | Tasks 7-14 (whole stack) |
| Components: root `package.json` scripts | Task 8 |
| Components: `packages/core/package.json` | Task 7 |
| Components: `serve.ts` (port=0, PORT= protocol) | Task 11 |
| Components: `index.html` | Task 10 |
| Components: `entry.ts` | Task 10 |
| Components: `triangle.wgsl` | Task 9 |
| Components: smoke test | Task 12 |
| Components: Rust `Cargo.toml`, `main.rs`, Linux hard-fail | Task 14 |
| AI-friendliness: biome fix | Task 2 |
| AI-friendliness: rules/bun.md delete | Task 2 |
| AI-friendliness: `module` field removed | Task 2 |
| AI-friendliness: discoverable scripts | Task 8 |
| AI-friendliness: `AGENTS.md` | Task 5 |
| AI-friendliness: `README.md` | Task 6 |
| AI-friendliness: `index.ts` delete | Task 2 |
| `.docs/BACKLOG.md` convention | Tasks 3, 4 |
| Browser verification | Task 13 |
| Native verification | Task 15 |
| Final acceptance sweep | Task 16 |

All spec sections traced to tasks. Bundle item (Windows verification deferred until bundling) is in BACKLOG, no task needed.

**Placeholder scan:** None. Every code block has actual content; every command has expected output.

**Type/name consistency:** `main()` consistent across `entry.ts`, `index.html`, and `tests/entry.test.ts`. `PORT=<n>` protocol consistent between `serve.ts` (writer) and `main.rs` (reader). Working directory for the Bun child consistent: `CARGO_MANIFEST_DIR/..` in Rust resolves to `packages/core/`, where `serve.ts` lives.
