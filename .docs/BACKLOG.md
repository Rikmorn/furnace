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
