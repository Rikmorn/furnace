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

### WebView `console.log` bridge to host stdout
**Context:** Today `console.log`/`warn`/`error` calls from JS running inside the WKWebView don't reach the host process's stdout. The runtime enables `with_devtools(true)` and has an error-capture init script that turns *uncaught* errors into a red body overlay, but ordinary `console.log` is invisible unless you attach Safari Web Inspector (Develop menu → [machine] → app entry). Every plugin/feature verification step (e.g. confirming the Phase 4 wasm log line "demo-wasm: 2 + 3 = 5") currently requires Safari to be open. The plan's instruction to "check Console.app for the wasm log" was misleading — Console.app catches WKWebView errors/warnings via unified logging, not arbitrary `console.log` calls.

**Concrete shape:** Inject a JS init script (sibling of `ERROR_CAPTURE_SCRIPT` in `packages/tools/crates/furnace-runtime/src/lib.rs`) that wraps `console.{log,warn,error,info,debug}` to also call `window.ipc.postMessage(JSON.stringify({level, args}))`. Install an IPC handler in `WebViewBuilder::with_ipc_handler` (wry 0.55) that parses the message and `println!`s it as `[js {level}] {args}`. Keep the original `console.*` behaviour intact so Safari Web Inspector still works for richer inspection.

**Trigger to revisit:** Next time native-runtime work is in scope, OR when manual-verification friction during a phase becomes annoying enough to fix. Roughly 30 lines of Rust + JS; small follow-up.
**Reference:** Surfaced during Phase 4 (wasm plugin) manual verification, 2026-05-20. Wry's IPC handler docs: <https://docs.rs/wry/0.55/wry/struct.WebViewBuilder.html#method.with_ipc_handler>.

### Native window: focus/activation triggers server respawn
**Context:** When the native `wry` window loses or regains focus (e.g., clicking outside the window and back in), the native binary attempts to bind a new dev server or spawn another Bun child, conflicting with the existing one. Observed during the UI foundation milestone's Phase 1 manual verification (2026-05-17). Prevents reliably testing native HMR end-to-end (full page reload remains a documented fallback per spec risk #3).
**Trigger to revisit:** Next time work touches the native runtime (`packages/tools/native/`), or when reliable native HMR testing becomes a blocker.
**Reference:** Manual verification step of `docs/superpowers/specs/2026-05-17-ui-foundation-design.md`.

### Runtime Contract Spec
**Context:** The native-shell distribution design (Section 5) introduces the Runtime Contract as the abstraction boundary between the JS engine / wasm plugin layer and any compliant native shell implementation. The spec establishes the contract exists, what it covers (filesystem, dialogs, window control, lifecycle, IPC, asset access), and its versioning principles — but the *exhaustive method list, signatures, IPC protocol, error semantics, and async behaviour* are deliberately deferred to a separate spec. This is one of the larger design surfaces in the project; it warrants its own session.
**Trigger to revisit:** When implementation of milestone 1 (end-to-end macOS) needs more contract methods than the bare minimum, OR when a second alternative runtime implementation is considered.
**Reference:** Section 5 of `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md`.

### Native packaging — `.app` wrapping + asset bundling (PAIRED)

> **The two entries below should be tackled in a single session.** They share the same build-time machinery (a packager that produces `MyApp.app/Contents/{Info.plist, MacOS, Resources}`), the same reference (Shallot's `packages/shallot/bin/native.ts`), and the same trigger. Splitting them in implementation would mean writing the same `.app` builder twice.

#### a) Native dev: macOS opens Terminal.app to host the launcher binary
**Paired with:** the "Native binary bundling" entry directly below.

**Context:** During the 2026-05-18 build-tooling work, the stdio-leakage fix in `packages/tools/native/src/main.rs` (commits `d780d58` + `2c7d754`) pipes Bun's stderr to null and gates the launcher's diagnostic `eprintln!` behind `FURNACE_VERBOSE=1`. Verified post-shipping that a Terminal window still appears when `bun run dev:native` is run. The original symptom was not (only) stdio bleed — macOS hosts the unbundled Mach-O binary in `Terminal.app` because it lacks a proper `.app` wrapper.

**Concrete recipe (cribbed from Shallot's `packages/shallot/bin/native.ts` `bundleNativeMac` function):**

1. Build the cargo binary as usual for `aarch64-apple-darwin`.
2. Create the `.app` directory tree:
   ```
   {name}.app/
   ├── Contents/
   │   ├── Info.plist
   │   ├── MacOS/
   │   │   └── {name}              ← cargo binary, chmod 0o755
   │   └── Resources/
   │       ├── app.icns            ← optional; built from PNG via sips + iconutil
   │       └── payload.bin         ← release only — see (b) below for what goes inside
   ```
3. Write a minimal `Info.plist` — Shallot's plist has only `CFBundleExecutable`, `CFBundleIdentifier`, `CFBundleName`, `CFBundleVersion`, `CFBundlePackageType=APPL`, `CFBundleIconFile`, `NSHighResolutionCapable=true`. **No `LSUIElement` needed** — the `.app` structure alone is enough; macOS treats the binary as a GUI app and skips the Terminal host.
4. Run `codesign --force --sign - "${appDir}"` (ad-hoc local signing) to avoid Gatekeeper warnings during local execution.

**Additional fixes worth doing in the same session:**

- **Windows console suppression** — Shallot's `main.rs` has `#![cfg_attr(windows, windows_subsystem = "windows")]` at the very top. One-line fix; tells the linker to mark the binary as a GUI subsystem so no console pops up on Windows. Add to `packages/tools/native/src/main.rs`.
- **Release-profile tightening** — Shallot's `Cargo.toml` has `[profile.release]` with `opt-level=3`, `lto=true`, `codegen-units=1`, `panic="abort"`, `strip=true`. Smaller, faster binary with no debug info.

**Trigger to revisit:** Next session that touches the native runtime, OR before the first user-facing release where the stray terminal would be embarrassing.

**Reference:** `docs/superpowers/specs/2026-05-18-build-tooling-design.md` "Native dev UX fix" anticipated this branch. The Shallot recipe lives at `https://github.com/dylanebert/shallot/blob/main/packages/shallot/bin/native.ts` (`bundleNativeMac`). Now also the implementation starting point for Milestone 1 of `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md` — when that milestone begins, this entry gets promoted out of backlog. Investigation might still want to confirm: whether `dev:native` via VS Code's integrated terminal exhibits the same behaviour vs a standalone terminal, and whether `bun run dev:native` vs double-clicking the binary in Finder produce the same Terminal pop-up.

#### b) Native binary bundling
**Paired with:** the "Native dev" entry directly above — they share the `.app` builder and should land together.

**Context:** Furnace's launcher binary today spawns a `bun` child pointed at `packages/hello-world/serve.ts`, then loads the served URL into a `wry` window. That's fine for dev, but for distribution the binary needs to be self-contained: the consumer's machine won't have the source tree, won't have Bun, and shouldn't need them.

Two halves of the work:

1. **Build-time:** the same `.app` builder from entry (a) writes `payload.bin` into `Contents/Resources/`. Shallot's recipe: tar the production `dist/web/` output (or equivalent), zstd-compress it (`Bun.zstdCompressSync(tar, { level: 19 })`), write to `Resources/payload.bin`. On Windows/Linux they instead append the payload to the exe with a magic-number footer (`0x544C4853 = "SHLT"`); macOS uses the bundle path because `.app`-resident files are the idiomatic carrier.
2. **Runtime:** the binary needs to detect "am I bundled?" at startup and, if so, decompress `payload.bin` to a cache dir (`~/Library/Application Support/furnace/<exe-name>/` on macOS) and point the embedded server at that cache instead of spawning Bun. Shallot's `extract_bundle_payload` in `packages/shallot/rust/window/src/main.rs` is the canonical implementation:
   ```rust
   #[cfg(all(not(debug_assertions), target_os = "macos"))]
   pub(crate) fn extract_bundle_payload(exe: &std::path::Path) -> Option<PathBuf> {
       let payload_path = exe.parent()?.parent()?.join("Resources").join("payload.bin");
       let data = std::fs::read(&payload_path).ok()?;
       let name = exe.file_stem()?.to_str()?;
       unpack_to_cache(&data, name, data.len() as u64)
   }
   ```
   The `unpack_to_cache` helper uses a marker file with the payload size as a content hash to skip redundant extractions across runs.

**Furnace-specific deltas from Shallot's recipe:**

- Furnace's binary currently *spawns* Bun rather than reading served assets directly. Decision needed: keep spawning Bun (and have Bun serve the unpacked `payload.bin` cache dir) or switch to serving in-process from Rust. Shallot does the latter (their `wry_backend.rs` registers a custom protocol handler against the unpacked dir).
- Furnace's launcher uses `EXAMPLE_DIR = "../../hello-world"` hardcoded. Bundling forces this to become "wherever `dist/` was packed from" — either an env var or a build-time constant.

**Trigger to revisit:** Same as entry (a) — next native-runtime session OR pre-release. Don't split.

**Reference:** Same Shallot files as (a). Also see `packages/shallot/rust/window/src/main.rs` (`unpack_to_cache`, `cache_dir`, `extract_bundle_payload`). Now also the implementation starting point for Milestone 1 of `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md` — when that milestone begins, this entry gets promoted out of backlog.

### Per-platform binary packages — biome-style migration
**Context:** Today's plan ships `@furnace/tools` as a single npm package containing the host-platform CLI binary inline. When furnace gains a second platform target (likely Windows after macOS is proven), the right move is to migrate to the biome distribution pattern: thin `@furnace/tools` shim package + `@furnace/tools-<os>-<arch>` per-platform packages as `optionalDependencies`. Verified to work in Bun workspaces during the 2026-05-19 brainstorming (test in `/tmp/bun-optdeps-test/`). Migration is mechanical — the JS shim changes ~5 lines.
**Trigger to revisit:** Second platform binary (Windows almost certainly first) needs to ship.
**Reference:** Section 2 "Artifact model" of `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md`; biome's `@biomejs/biome` npm package layout as the precedent.

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

### Plugin API Spec
**Context:** The native-shell distribution design (Plugin Model section) establishes that plugins are Rust crates compiled to wasm running inside the JS layer (chosen over the Tauri-style Rust-in-runtime model to preserve cross-platform reach). The plugin *mechanism* is decided; the full `Plugin` trait shape, payload schemas, async patterns, lifecycle hooks, and JS-side IPC contract are deliberately deferred. Tauri's `command!` macro is a strong precedent to crib from.
**Trigger to revisit:** First plugin authored in earnest (likely after filesystem or audio is needed as a furnace-first-party plugin), OR when a third-party wants to publish a `furnace-plugin-*` crate.
**Reference:** Plugin Model section of `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md`.

### `@furnace/native` JS package — separate contract-mediated APIs from pure browser surface
**Context:** The native-shell design (Section 5) introduces a runtime contract — a set of OS-bridge APIs (filesystem, dialogs, native window control, lifecycle) the runtime exposes to the JS layer. Putting these in `@furnace/core` would break its "pure browser-only, runs without any runtime" guarantee — anyone using core in a plain browser would import APIs that throw at runtime. Splitting them into a sibling `@furnace/native` npm package keeps core honest as a portable library; consumers opt in by importing `@furnace/native` only when they're inside a compliant runtime.
**Trigger to revisit:** First time a contract-mediated API gets implemented (likely `fs.readFile`). Decide whether to land it in core, `@furnace/native`, or somewhere else before more APIs follow the same pattern.
**Reference:** Section 5 of the native-shell distribution design (the runtime contract concept). The doc lives at `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md` once written.

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

### Fake-timer integration for FpsSystem tick coverage
**Context:** `createFpsSystem` in `packages/core/src/lib/stats/fps.ts` (after Task 2 moves it there) exposes `subscribe`, `current`, and `dispose` — the API surface and initial state are unit-tested, but the actual `setInterval`-driven tick behaviour (frames-per-second math rolling over each second, listeners receiving values) is only covered by the end-to-end on-screen FPS counter. Bun's test runner doesn't ship fake timers; adding a third-party fake-timer dep just for this is overkill today.
**Trigger to revisit:** Second consumer of `createFpsSystem` lands (e.g., a telemetry sink, a test fixture), OR a regression in the tick math escapes to dev because there was no unit test catching it, OR Bun's test runner gains a built-in fake-timer API.
**Reference:** `packages/core/tests/lib/stats/fps.test.ts` (will live there after Task 2). The end-to-end on-screen FPS counter in `packages/hello-world` is the integration verification today.

### Svelte formatting (Prettier or biome upgrade)
**Context:** Biome 2.x has partial `.svelte` support; the ecosystem standard is Prettier + the Svelte plugin. Currently `.svelte` files are not in biome's `files.includes` list, so they go unformatted. Acceptable for one ~25-line component; not at scale.
**Trigger to revisit:** `.svelte` content grows past ~3 components or ~200 lines total.

---

## Editor & tooling

### `furnace.config.json` schema
**Context:** The native-shell distribution design uses `furnace.config.json` as the L1 declarative customisation surface — covering app identity, window defaults, plugin registration, signing config, and source/output paths. Sample structure is sketched in the spec but the full schema (field-by-field definitions, validation rules, schema versioning, platform-specific override semantics) is deferred until the first implementation milestone forces the choices.
**Trigger to revisit:** Start of milestone 1 implementation (end-to-end macOS). The schema design happens BEFORE writing the Rust struct that deserialises it, so the choices are explicit rather than implicit.
**Reference:** Customization Layers Section 4 of `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md`.

### Svelte editor / inspector surfaces
**Context:** Svelte 5 is now the committed framework for screen-space DOM UI (see `docs/superpowers/specs/2026-05-17-ui-foundation-design.md`). The remaining work is editor and inspector surfaces that need to subscribe to engine state — particularly ECS components and entities once those exist.
**Trigger to revisit:** When ECS lands and we need fine-grained state subscription for an entity inspector, OR when the first interactive control panel (shader uniform tweaks, scene parameters) is needed.
**Reference:** Architecture doc §10. Shallot uses Svelte 5 with the runes/signals model.

### Hot-reload for WGSL shaders
**Context:** `bun --hot` reloads TS/HTML, but a WGSL text-import change requires recreating the WebGPU pipeline. Currently you need a full page reload to pick up shader edits.
**Trigger to revisit:** When iterating heavily on a shader and the friction shows.

### CLI binary target-dir mismatch when iterating with `cargo build` directly
**Context:** The repo's `.cargo/config.toml` redirects cargo's `target-dir` so that builds from anywhere in the workspace write to `dist/rust/<profile>/`. Running `cargo build --manifest-path packages/tools/crates/Cargo.toml` from a shell whose CWD is outside that ambient-config path bypasses the redirect and writes to `target/debug/` instead. Meanwhile `packages/tools/shim.js` only looks in `dist/rust/{debug,release}/`. Net: someone iterating on the CLI directly can end up with the shim resolving a stale binary (or none at all) while a fresh one sits unused under `target/`. The full build pipeline (`bun run --cwd packages/hello-world build:macos`) handles this correctly because `build/macos.rs` sets `CARGO_TARGET_DIR` explicitly; the friction only hits during direct iteration.

**Concrete fix options:** (a) Extend `shim.js`'s candidate list to also check `target/{debug,release}/furnace`; (b) document the `CARGO_TARGET_DIR=dist/rust` requirement in `packages/tools/README.md` for direct iteration; (c) move the target-dir redirect from `.cargo/config.toml` into a `packages/tools/crates/.cargo/config.toml` scoped to the CLI workspace so it always applies regardless of invoking CWD.
**Trigger to revisit:** Next time someone iterates on the CLI directly and trips over a stale binary, OR before publishing where the dist/-only resolution becomes consumer-facing.
**Reference:** Surfaced during Phase 5.2.5 implementation, 2026-05-20.

### Bun ↔ wasm-bindgen generator — maintenance surface
**Context:** Bun's bundler treats `import * as wasm from "./*.wasm"` as an asset import — the namespace resolves to `{default: "url-string"}` at runtime, not an instantiated WebAssembly.Instance. wasm-bindgen's `--target bundler` (and `--target web` in current versions) split-files glue assumes the bundler performs webpack-style instantiation that Bun doesn't. The CLI sidesteps this by rewriting `pkg/<crate>.js` and `pkg/<crate>.d.ts` after `wasm-pack` runs — see `rewrite_wrapper` in `packages/tools/crates/furnace-cli/src/wasm.rs`. Consumers import the typed exports + a `ready` promise; the manual `WebAssembly.instantiateStreaming` dance lives in the generated wrapper.

**Trigger to revisit:** wasm-pack/wasm-bindgen output shape changes break the generator template, OR a second bundler is integrated (vite/webpack handle wasm-bindgen natively, so the generator should branch and emit nothing for them), OR the typed-export shape proves insufficient and consumers want richer control. Alternatives if the generator approach falls down: a standalone Bun build plugin handling wasm-bindgen output (reusable beyond furnace), upstream Bun support for the split-files convention (out of our hands), or switching bundler for wasm-plugin projects (loses Bun's speed).
**Reference:** Generator landed in commit `f133341`. The hand-written workaround that preceded it (and explains the diagnosis) lives in commit `92061f7`.

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

