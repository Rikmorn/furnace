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

### Native window: focus/activation triggers server respawn
**Context:** When the native `wry` window loses or regains focus (e.g., clicking outside the window and back in), the native binary attempts to bind a new dev server or spawn another Bun child, conflicting with the existing one. Observed during the UI foundation milestone's Phase 1 manual verification (2026-05-17). Prevents reliably testing native HMR end-to-end (full page reload remains a documented fallback per spec risk #3).
**Trigger to revisit:** Next time work touches the native runtime (`packages/core/native/`), or when reliable native HMR testing becomes a blocker.
**Reference:** Manual verification step of `docs/superpowers/specs/2026-05-17-ui-foundation-design.md`.

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

### Camera + projection matrices for in-scene primitives
**Context:** Both the triangle and the WGSL UI plane currently render in NDC space — no view, no projection. Once we need to position content in world space (which is approximately when ECS lands and entities have transforms), we need a camera with view/projection matrices and a uniform buffer pattern shared across pipelines.
**Trigger to revisit:** First surface needing world-space positioning, typically aligned with ECS arrival.

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

### Svelte formatting (Prettier or biome upgrade)
**Context:** Biome 2.x has partial `.svelte` support; the ecosystem standard is Prettier + the Svelte plugin. Currently `.svelte` files are not in biome's `files.includes` list, so they go unformatted. Acceptable for one ~25-line component; not at scale.
**Trigger to revisit:** `.svelte` content grows past ~3 components or ~200 lines total.

---

## Editor & tooling

### Svelte editor / inspector surfaces
**Context:** Svelte 5 is now the committed framework for screen-space DOM UI (see `docs/superpowers/specs/2026-05-17-ui-foundation-design.md`). The remaining work is editor and inspector surfaces that need to subscribe to engine state — particularly ECS components and entities once those exist.
**Trigger to revisit:** When ECS lands and we need fine-grained state subscription for an entity inspector, OR when the first interactive control panel (shader uniform tweaks, scene parameters) is needed.
**Reference:** Architecture doc §10. Shallot uses Svelte 5 with the runes/signals model.

### Hot-reload for WGSL shaders
**Context:** `bun --hot` reloads TS/HTML, but a WGSL text-import change requires recreating the WebGPU pipeline. Currently you need a full page reload to pick up shader edits.
**Trigger to revisit:** When iterating heavily on a shader and the friction shows.

### In-scene UI primitive — for occluded cases only (γ)
**Context:** Architecture committed to Svelte + screen-space projection (CSS2DRenderer-style) for world-tracked UI without occlusion needs — HUDs, labels, panels that float above 3D content. For the rare case where 3D geometry must occlude UI per-pixel (a touchpanel on a wall a character can walk in front of), the chosen approach is a WGSL textured-plane primitive — proven end-to-end in commit `7249001` (UI Foundation Phase 2) before being reverted from the tree pending a real use case. The `OffscreenCanvas → texture` content pipeline used in the proof had a non-obvious bug (see `.docs/render-to-texture-learnings.md`); a future implementation should use `device.queue.writeTexture` directly. Options δ (static SVG asset pipeline) and ε (resvg in wasm) are no longer in active consideration — the screen-space-projection approach covers the common cases more cleanly.
**Trigger to revisit:** First concrete need for in-scene UI that 3D geometry must occlude per-pixel. Not before — the projection-helper approach handles the common cases.
**Reference:** `docs/superpowers/specs/2026-05-17-ui-foundation-design.md`, `.docs/render-to-texture-learnings.md`, commit `7249001`.

### Screen-space projection helper for world-tracked Svelte UI
**Context:** The chosen approach for world-tracked UI is to project world coords to screen coords each frame and position a Svelte overlay element at that screen position, scaled by the projection's `w`-divide so it shrinks naturally with distance. Three.js's `CSS2DRenderer` is the canonical reference. The helper needs reactive access to the camera + projection matrices, must run after physics/animation updates but before render encoding in the same tick (avoid one-frame lag), and must handle behind-camera culling (clip-space `w ≤ 0` → hide). Optional: frustum-side culling for off-screen elements; z-sorting between multiple world-tracked elements that overlap in screen space. Performance ceiling: comfortable up to ~hundreds of elements per frame; thousands would force a different approach.
**Trigger to revisit:** First time we want a label, panel, or HUD anchored to a world-space point. Will likely arrive with ECS, since ECS provides camera transforms and entity positions as first-class concerns.
**Reference:** Three.js `CSS2DRenderer` source. `docs/superpowers/specs/2026-05-17-ui-foundation-design.md`, "Research write-up" section.

### Emerging-tech watch: WICG HTML-in-Canvas / Vello browser readiness
**Context:** The WICG "HTML in Canvas" proposal would let HTML elements live inside a canvas with native rasterization, depth participation, and accessibility object model integration. Linebender's Vello is a GPU vector graphics renderer in Rust+wgpu, but per Linebender's own docs the web is not currently a primary target. Either landing in production would collapse the in-scene UI design space.
**Trigger to revisit:** WICG proposal reaches Stage 2+, or Vello announces production web support.
**Reference:** `docs/superpowers/specs/2026-05-17-ui-foundation-design.md`, "Research write-up" section.

### SDF font atlas + glyph rendering
**Context:** The UI foundation milestone's in-scene plane uses `OffscreenCanvas.fillText` → texture (CPU 2D-canvas rasterization, suitable for 1Hz updates). Sharp text at varying scales or live per-frame text updates need a real SDF font atlas approach. Estimated ~1 week to ship well (atlas generation, glyph layout, distance-field shader).
**Trigger to revisit:** First in-scene surface needing sharp text at varying scales, or live per-frame text updates.

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
**Priority signal:** Rising. Surfaced again during the 2026-05-18 brainstorm for splitting `packages/hello-world` out of `packages/core`. Each time the topic comes up, more pressure points accumulate. Expect the trigger to fire within the next 1–2 phases rather than "eventually."
**Context:** Current setup is minimal: `bun build` → `dist/web/`, `cargo build` → `target/` then `cp` to `dist/native/`, all orchestrated via `package.json` scripts. Works for one workspace package + one Rust crate, but several known weak points will likely force a rework: (1) the `cp` from `target/release/` to `dist/native/` is a stable-Rust workaround for the unstable `cargo build --out-dir`; (2) no dev/prod variants for the web build — always minified; (3) no watch mode for a prod-build dev loop; (4) `bun build` (production) and `Bun.serve` static-routes (dev) are two separate code paths that share the same HTML entry but could drift; (5) `package.json` scripts will get hard to read once we add wasm-pack steps or a second Rust crate (Shallot moved to a `scripts/build.ts` Bun.$ orchestrator for this exact reason — see architecture doc §1); (6) once `packages/hello-world` exists, the root `package.json` scripts become indirection (`bun run dev:web` → `bun run --cwd packages/hello-world dev`) and a second example would double the surface; (7) cross-package source resolution: hello-world imports from `@furnace/core` via workspace linkage today, but a published `@furnace/core` plus a build target for hello-world introduce a dev-vs-published asymmetry that scripts alone won't paper over; (8) multi-platform packaging (Win/Mac/Linux native binaries + web bundles) is an explicit eventual requirement and has no story today.
**Trigger to revisit:** Any one of: adding a wasm-pack crate (`transforms`/`audio` style); needing an unminified web build for bundle inspection; `cargo --out-dir` stabilizing; CI landing and exposing parallelism / caching needs; package.json scripts crossing ~10 entries; adding example #2 (which doubles the per-example boilerplate); first time publishing `@furnace/core` to a registry (which forces the dev-vs-published asymmetry into the open); first time packaging a native binary for distribution.
**Reference:** Shallot's `packages/shallot/scripts/build.ts` is the canonical pattern when this revisit happens. Architecture doc §1 ("How Shallot is set up") covers the high-level orchestration.
