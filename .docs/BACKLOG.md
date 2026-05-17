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

### UI framework + in-app surfaces (Svelte leaning)
**Context:** No UI yet — just the WebGPU canvas. As soon as we need any DOM surface (debug overlay, FPS counter, controls panel, scene inspector, settings menu, editor) we'll have to pick a framework and decide how it coexists with the render loop. **Leaning toward Svelte**, same reasons as Shallot (architecture doc §10): compiles to direct DOM updates, no virtual-DOM reconciler stealing main-thread time per frame, runes/signals model maps cleanly to ECS-style state subscription. Anticipated surfaces in rough order of likely need: (1) debug overlay (FPS, draw call count, GPU memory), (2) inline controls for tweaking shader/scene values during dev, (3) scene/entity inspector, (4) full editor. The first two are small and could land before committing to a framework; (3) and (4) force the commitment.
**Trigger to revisit:** First time we want any DOM element beyond the canvas (FPS counter is the likely first), OR when ECS lands and we need state subscriptions for an inspector.
**Reference:** Architecture doc §10. Shallot uses Svelte 5 with the runes/signals model.

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

### Build system revisit
**Context:** Current setup is minimal: `bun build` → `dist/web/`, `cargo build` → `target/` then `cp` to `dist/native/`, all orchestrated via `package.json` scripts. Works for one workspace package + one Rust crate, but several known weak points will likely force a rework: (1) the `cp` from `target/release/` to `dist/native/` is a stable-Rust workaround for the unstable `cargo build --out-dir`; (2) no dev/prod variants for the web build — always minified; (3) no watch mode for a prod-build dev loop; (4) `bun build` (production) and `Bun.serve` static-routes (dev) are two separate code paths that share the same HTML entry but could drift; (5) `package.json` scripts will get hard to read once we add wasm-pack steps or a second Rust crate (Shallot moved to a `scripts/build.ts` Bun.$ orchestrator for this exact reason — see architecture doc §1).
**Trigger to revisit:** First of these to happen — adding a wasm-pack crate (`transforms`/`audio` style); needing an unminified web build for bundle inspection; `cargo --out-dir` stabilizing; CI landing and exposing parallelism / caching needs; package.json scripts crossing ~10 entries.
**Reference:** Shallot's `packages/shallot/scripts/build.ts` is the canonical pattern when this revisit happens. Architecture doc §1 ("How Shallot is set up") covers the high-level orchestration.
