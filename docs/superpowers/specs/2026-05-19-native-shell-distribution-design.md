# Native Shell Distribution — Design Spec

**Date:** 2026-05-19
**Status:** Drafted (pending user review)
**Builds on:** [`2026-05-18-build-tooling-design.md`](./2026-05-18-build-tooling-design.md)
**References:**
- [`.docs/packaging-and-distribution.md`](../../../.docs/packaging-and-distribution.md) §6 — the section this design rewrites
- [`.docs/research/2026-05-19-build-distribution/`](../../../.docs/research/2026-05-19-build-distribution/) — three research artifacts grounding this design
- [`.docs/BACKLOG.md`](../../../.docs/BACKLOG.md) — "Native runtime" section entries (a)+(b) get promoted out by the first implementation milestone

## Summary

Furnace's native shell follows a **Tauri 2-style architecture, scoped to a WebGPU game engine**: consumers' apps are primarily JS using `@furnace/core`, with a small Rust shell underneath. The shell runtime is a Rust crate **vendored** into the consumer's repo on `furnace init` (not published separately). The `@furnace/tools` CLI is a **Rust binary distributed via npm using a biome-style shim**. Plugins are **Rust crates compiled to wasm** — they run inside the JS layer, achieving cross-platform portability by construction. OS-level integration lives behind a documented **Runtime Contract**; the default Rust implementation can be swapped, forked, or reimplemented as long as the contract is satisfied.

The first implementation milestone is **end-to-end macOS `.app` building** (`furnace build --platform=macos`). It absorbs the deferred backlog work under "Native packaging — `.app` wrapping + asset bundling" and serves as the proof of the architecture.

This design displaces the previous plan-of-record in `.docs/packaging-and-distribution.md` §6 (per-platform binary subpackages via `optionalDependencies` for the runtime itself). That pattern is right for embeddable tooling (esbuild, swc, sharp) but the research found it uncommon for shell runtimes — Tauri, RN, Capacitor, Flutter, and Expo all source-ship the shell or use hybrid models. The previous framing cited the wrong precedents.

## Background

Furnace was on a trajectory where `@furnace/tools` would ship as an npm package containing a vendored Rust launcher, with eventual per-platform binary subpackages (`@furnace/tools-darwin-arm64` etc.) distributed via `optionalDependencies`. A retrospective question — "this feels overcomplicated for what it does, are there standard tools that can help?" — surfaced two parallel issues:

1. **Confused precedent.** The cited industry pattern (`esbuild`, `swc`, `sharp`) is for compilation tooling, not shell runtimes. Shell-runtime ecosystems take different approaches.
2. **No customisation story.** The docs never said what consumers can change about the shell, or how shipping their own branded native app fits in.

Both feed into the same architectural question: what *shape* is furnace's native distribution? Three research artifacts (native shell distribution survey, Node CLI library survey, per-platform build structure survey) grounded the design space. This spec captures the resulting architecture.

## Goals

- **Production-deployment-grade architecture for desktop today, mobile when WebGPU-in-WebView matures.** Consumers should be able to ship store-submittable apps (`.app`, `.ipa`, `.apk`, `.msi`, etc.) through `furnace build --platform=<X>`.
- **Cross-platform extensibility without restructuring.** Adding Windows, iOS, Android later is a localised change (one platform module + scaffold templates), not a refactor.
- **Honest precedent grounding.** Cite the ecosystems that actually do shell-runtime distribution; document why furnace picks Tauri 2's archetype.
- **Customisation surface defined.** Four explicit layers, from declarative config to forking the runtime, with clear tradeoffs.
- **No publishing required immediately.** The architecture must support in-repo dev today (no npm publish needed) and graduate cleanly to npm publishing later when furnace is ready.
- **JS engine stays portable.** `@furnace/core` remains browser-only and runtime-agnostic. The contract-mediated APIs split out to a separate package (`@furnace/native`, deferred) when the first one lands.

## Non-goals

- **iOS/Android implementation.** Architecture supports them; this spec doesn't ship them. WebGPU-in-WebView is the gating dependency on mobile and isn't verified.
- **Plugin marketplace / registry.** Cargo + npm handle discovery. No furnace-specific registry.
- **The Runtime Contract's exhaustive method list.** Section 5 establishes the contract exists and what it covers; the full spec is its own session.
- **The wasm bundler choice (esbuild vs oxc vs swc).** Implementation detail decided when implementation starts.
- **The Rust-side packaging tool choice (cargo-packager vs tauri-bundler).** Same — deferred to implementation.
- **CI matrix design.** Deferred until publishing matters.
- **Web build pipeline.** Consumer's domain entirely. Furnace doesn't bundle JS for web targets and doesn't run the consumer's web bundler.
- **Automatic three-way merge for L4 forkers.** Forking the runtime accepts upgrade pain.

## Archetype

Furnace's native shell follows **Tauri 2's architecture, scoped to a WebGPU game engine**.

The model:
- The consumer's app is *primarily* a JS/TS game using `@furnace/core`. They write web code.
- Underneath, their project is also a small Rust project depending on a vendored `furnace-runtime` crate. They commit a thin Rust entrypoint + per-platform native projects.
- `@furnace/tools`'s CLI orchestrates the build: compile plugin wasm → bundle web app → cargo cross-compile Rust → invoke platform packaging (xcodebuild / Gradle / cargo-packager) → emit final shippable artifact.
- No intermediate prebuilts ship to consumers. The runtime is source. The final artifact is what `furnace build --platform=X` outputs, ready to sign + submit.

**Rejected: per-platform binary subpackages for the runtime via `optionalDependencies`** (the `esbuild`/`swc`/`sharp` pattern). The research surfaced that this pattern is dominant for tooling but rare for shell runtimes — Electron is the closest (and uses `@electron/get`, not `optionalDependencies`); Tauri/RN/Capacitor/Flutter all source-ship or hybrid. The runtime *must* compile into the consumer's final binary because it's the shell of their app; a prebuilt binary distributed separately doesn't fit the use case.

**Kept: the per-platform-subpackage pattern for the CLI** (biome's model). The `furnace` CLI itself is a Rust binary; biome's pattern (thin JS shim + per-platform `optionalDependencies`) is the correct precedent here because the CLI is invoked standalone, not compiled into the consumer's app. This is deferred until furnace has a second platform; single-package is simpler day 1.

## Artifact model

### What furnace publishes

| Artifact | Channel | Role |
|---|---|---|
| `@furnace/core` | npm | Browser-only ESM JS engine. Treated like any JS library. |
| `@furnace/tools` | npm | The `furnace` CLI + vendored Rust runtime source + scaffold templates. Today: single package with host-platform binary inside. Future: biome-style per-platform packages when platform #2 ships. |

Two npm artifacts consumers see. No separate Rust crate published. The runtime source is vendored *inside* `@furnace/tools`'s npm package as files; `furnace init` copies it into the consumer's repo.

### In-repo workspace layout

```
packages/
├── core/                              # @furnace/core — JS engine (unchanged)
├── tools/                             # @furnace/tools — npm package + Cargo workspace
│   ├── package.json                   # bin: { furnace: ./shim.js }
│   ├── shim.js                        # ~3-line JS shim, finds binary + execs (no deps)
│   ├── furnace                        # the built CLI binary (cargo output, copied here)
│   ├── templates/                     # scaffold files for `furnace init`
│   │   ├── shared/
│   │   │   ├── furnace.config.json.tmpl
│   │   │   ├── Cargo.toml.tmpl
│   │   │   └── src-furnace/main.rs.tmpl
│   │   └── macos/
│   │       ├── Info.plist.tmpl
│   │       ├── Assets.xcassets/
│   │       └── entitlements.plist
│   └── crates/                        # Cargo workspace
│       ├── Cargo.toml                 # workspace root
│       ├── furnace-cli/               # the CLI source
│       │   ├── Cargo.toml
│       │   └── src/main.rs
│       └── furnace-runtime/           # the runtime source — vendored into consumer repos
│           ├── Cargo.toml
│           └── src/lib.rs
└── hello-world/                       # demo consumer (unchanged structure)
    └── package.json                   # depends on @furnace/core + @furnace/tools via workspace:*
```

Notes on key choices:
- **`furnace-runtime` is a proper crate in the Cargo workspace**, not just static data files. Enables `cargo check`, in-repo tests, normal Rust development workflow. On `furnace init`, the CLI copies the crate directory verbatim into the consumer's repo.
- **Single-package distribution today** — no `tools-<os>-<arch>` siblings. Biome migration happens at platform #2.
- **The JS shim is plain Node, no deps** — survives Bun/Node version changes. ~3 lines.

### What the consumer's repo looks like after `furnace init my-game --platform=macos`

```
my-game/
├── package.json                       # deps: @furnace/core, @furnace/tools
├── furnace.config.json                # declarative: app id, name, window, plugins
├── src/                               # game code (TS, WGSL, assets) — consumer owned
│   └── index.ts                       # entry using @furnace/core
├── Cargo.toml                         # furnace-runtime = { path = "src-furnace/runtime" }
├── src-furnace/
│   ├── main.rs                        # ~20 lines — boots furnace-runtime, registers plugins
│   └── runtime/                       # vendored — copy of packages/tools/crates/furnace-runtime/
│       ├── Cargo.toml
│       └── src/lib.rs
└── platforms/
    └── macos/                         # scaffolded — committed and edited freely
        ├── Info.plist
        ├── Assets.xcassets/
        └── entitlements.plist
```

Adding `furnace init --platform=android` later creates `platforms/android/` (Gradle project) alongside `platforms/macos/`. The vendored runtime at `src-furnace/runtime/` is platform-agnostic.

### Versioning

- `@furnace/core` — semver on npm, independent cadence.
- `@furnace/tools` — semver on npm.
- `furnace-runtime` (vendored) — implicitly versioned by which `@furnace/tools` version copied it. Upgrades via `furnace upgrade-runtime` re-vendor from the new CLI's bundled source.
- Consumer-edited files (`platforms/`, `src-furnace/main.rs`, `furnace.config.json`) are never touched by upgrades. Conflicts at L4 (modified runtime) surface as a diff/warning, not auto-merge.

## Build pipeline

### Responsibility split

| Domain | Owner |
|---|---|
| Web bundling (consumer's web site), web dev server, web HMR | Consumer's bundler — Vite, Bun, esbuild, whatever |
| Native JS bundling (game code packaged into the native shell) | **Furnace's CLI** — owns the pipeline; operates on copies in tmp; never mutates consumer source |
| Native dev shell + HMR (the live-reload loop when running `furnace dev`) | **Furnace's CLI + runtime** — the shell understands furnace's HMR protocol |
| Rust→wasm plugin compilation | **Furnace's CLI** — same pipeline whether for furnace's own hot-paths or consumer plugins |
| Rust compile, platform packaging, signing | **Furnace's CLI** |

The consumer's relationship with `@furnace/core` is identical to their relationship with any JS library: `npm install`, `import`, their bundler handles it. Furnace has zero opinions about their JS toolchain when targeting the web.

### Command surface

- `furnace init <name> --platform=<platform>` — scaffolds a new project (or adds a platform to an existing one).
- `furnace build --platform=<platform>` — production build. Outputs shippable artifact to `dist/<platform>/`.
- `furnace dev --platform=<platform>` — dev session with watch + HMR + debug symbols. Launches the shell.
- `furnace wasm <crate-path>` — compile a Rust crate to wasm. Standalone command (also used internally by `build`).
- `furnace upgrade-runtime` — re-vendor the runtime source from the installed `@furnace/tools` version.

### Phases of `furnace build` (production)

1. **Pre-flight.** Validate `furnace.config.json`, verify `platforms/<platform>/` exists, verify source path, check Rust toolchain, check platform-specific tools.
2. **wasm compile.** Compile all plugin crates under `plugins/` (or wherever the config declares) to wasm. Output goes into the tmp build dir.
3. **JS stage + bundle (prod mode).** Copy consumer JS source to `/tmp/furnace-build-<hash>/`. Run furnace's bundler: minify, no HMR, sourcemaps as side-artifacts. The wasm files from phase 2 are pulled into the bundle.
4. **Rust compile (release).** `cargo build --release --target=<triple>` against the consumer's Cargo.toml (which depends on `src-furnace/runtime/`).
5. **Platform packaging.** Delegate to a Rust-side packaging tool (`cargo-packager` or `tauri-bundler`, decision deferred). Wraps the Rust binary + bundled JS + platform metadata into the native format.
6. **Sign** (optional). Code-signing using identity from `furnace.config.json` or env vars.
7. **Emit.** Write final artifact to `dist/<platform>/`.

### Phases of `furnace dev` (development)

1. **Pre-flight** (same).
2. **wasm compile** (initial, then watched).
3. **JS stage + bundle (dev mode).** Copy → bundler with HMR injection + sourcemaps + debug instrumentation. Output served from tmp.
4. **Rust compile (debug).** `cargo build` (no `--release`). Faster compile, debug symbols retained.
5. **Native shell launch.** Spawn the binary; it connects to furnace's HMR channel.
6. **Watch loop.** Source changes → re-bundle/re-compile-plugin incrementally → push HMR update through channel → WebView in the shell hot-reloads modules.

### Per-platform organisation in the CLI

```
crates/furnace-cli/src/
├── main.rs                   # clap definitions, top-level command routing
├── build/
│   ├── mod.rs                # PlatformBuilder trait + dispatch
│   ├── context.rs            # generic BuildContext, BuiltArtifacts
│   ├── macos.rs              # impl PlatformBuilder for MacosBuilder
│   ├── windows.rs            # (future)
│   ├── linux.rs              # (future)
│   ├── ios.rs                # (future)
│   └── android.rs            # (future)
├── wasm/                     # Rust→wasm pipeline (used by all platforms + by `furnace wasm`)
├── jsbundle/                 # JS bundler invocation
└── runtime_check/            # contract-version verification
```

The `PlatformBuilder` trait shape:

```rust
pub trait PlatformBuilder {
    fn target_triple(&self) -> &'static str;
    fn pre_flight(&self, ctx: &BuildContext) -> Result<()>;
    fn package(&self, artifacts: &BuiltArtifacts) -> Result<PathBuf>;
    fn sign(&self, bundle: &Path, identity: &SigningIdentity) -> Result<()>;
    fn scaffold(&self, dest: &Path, config: &FurnaceConfig) -> Result<()>;
}
```

Dispatch is a small `match` on the `--platform` string. The research surveyed registry patterns and found none in the surveyed tools — `match` is the right tool at the scale furnace operates.

About 70% of each platform module is configuration; 30% is platform-specific logic. Adding a platform = new file under `src/build/`, new directory under `templates/`, one-line registration in the dispatch, one-line update to clap's allowed `--platform` values. No changes to other platforms, the runtime, or `@furnace/core`.

## Customization layers

Four layers, increasing power, decreasing accessibility. Consumers reach for the next layer down when the current one can't express what they need.

### Layer 1 — `furnace.config.json` (every consumer)

Declarative configuration. The schema is what most consumers see.

```jsonc
{
  "identity": {
    "name": "MyGame",
    "bundleId": "com.example.mygame",
    "version": "1.0.0"
  },
  "source": "src/",
  "window": {
    "title": "My Game",
    "width": 1280,
    "height": 720,
    "fullscreen": false
  },
  "plugins": ["fs", "audio"],
  "signing": {
    "macos": { "identity": "${CODESIGN_IDENTITY}" }
  }
}
```

Covers app identity, window defaults, plugin registration, signing config, source/output paths. Full schema is deferred to implementation.

### Layer 2 — `platforms/<platform>/` (anyone shipping)

Platform-native files that can't be expressed declaratively. Consumer-committed, edited freely.

macOS today: `Info.plist`, `Assets.xcassets/`, `entitlements.plist`, `exportOptions.plist`. iOS later would be a full Xcode project. Android later would be a Gradle project. Each platform's content is whatever the platform's toolchain demands; furnace doesn't try to normalise across them.

Furnace's CLI does template substitution at build time — e.g., injects `identity.bundleId` from config into `Info.plist`. Consumers can override fields manually; manual edit wins.

### Layer 3 — `src-furnace/main.rs` (Rust-comfortable consumers)

The Rust entrypoint, scaffolded by `furnace init` as ~20 lines.

```rust
use furnace_runtime::{App, Plugin};
use furnace_plugin_fs::FsPlugin;
use furnace_plugin_audio::AudioPlugin;

fn main() {
    App::from_config("furnace.config.json")
        .register_plugin(FsPlugin::default())
        .register_plugin(AudioPlugin::default())
        .on_startup(|ctx| { /* consumer's custom startup */ })
        .run();
}
```

Reach for it when you need: custom startup logic, programmatic plugin configuration, native lifecycle hooks, custom IPC/protocol handlers — anything declarative config can't express.

### Layer 4 — `src-furnace/runtime/` (forkers)

The vendored shell runtime. Reach for it when L3 can't reach far enough — replacing the WebView, adding unique platform behaviour, implementing unsupported OS capabilities.

The mental model isn't "modify our source"; it's "**implement the Runtime Contract however you want**." Section 5 makes this explicit. The vendored furnace-runtime is one compliant implementation among potentially many.

Upgrade behaviour: re-vendoring overwrites local modifications. The CLI surfaces a diff and a warning, but doesn't auto-merge. Accepted tradeoff.

### Plugins (orthogonal to L1–L4)

Plugins are not a fifth layer — they're a separate dimension. See the next section.

## Plugin model (wasm)

Plugins are **Rust crates compiled to wasm**, executing inside the JS engine layer (not the native Rust process). Cross-platform portability is automatic — wasm runs anywhere a WebView does.

```rust
// my-game/plugins/image-filter/src/lib.rs
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn apply_blur(pixels: &[u8], radius: u32) -> Vec<u8> {
    // pure computation
}
```

```ts
// my-game/src/effects.ts
import init, { apply_blur } from "@/plugins/image-filter";
await init();
const result = apply_blur(pixels, 5);
```

### What plugins are for

Computation that wants native speed without leaving the JS sandbox: image filters, physics simulation, audio DSP, AI inference, scene graph transforms, procedural generation.

### What plugins are NOT for

OS-level integration. Filesystem access, native dialogs, OS notifications, native window control — these need the native process. They live behind the Runtime Contract, not as plugins.

### Ownership sources

| Source | Where the Rust crate lives | Where JS bindings (if any) live |
|---|---|---|
| First-party (furnace) | `packages/tools/crates/furnace-plugin-<name>/` | `@furnace/plugin-<name>` on npm |
| Third-party | crates.io as `furnace-plugin-<name>` (convention) | npm if the author publishes |
| Consumer-owned | In their repo (e.g., `plugins/my-custom-thing/`) | Inline in their JS code |

**No marketplace, no registry, no plugin search tool.** Cargo + npm handle discovery. A future curated list would be docs, not code.

### Compilation pipeline

`furnace build` automatically compiles all plugin crates declared in `furnace.config.json` (or under a conventional `plugins/` dir) before bundling. The same Rust→wasm pipeline also serves:
- Furnace's own hot-path wasm crates inside `@furnace/core`'s future evolution (transforms, audio per the Shallot architecture doc).
- Consumer-authored crates compiled via `furnace wasm <path>` standalone (useful for web-only consumers who never run `furnace build`).

Implementation candidates (decision deferred): `wasm-pack`, `wasm-bindgen-cli` directly, or a thin wrapper.

### Day-1 plugin set

Probably none. The plugin *mechanism* is the design decision; *which* plugins ship is a separate roadmap question. Filesystem and audio are the likely first candidates.

## Runtime contract

The **Runtime Contract** is a documented interface that the JS engine and wasm plugin layer rely on to talk to the native side. The runtime is *whoever implements it*. `furnace-runtime` (Rust) is one implementation — the default — not the contract itself.

```
JS game code ──────┐
                   │  (calls)
@furnace/core ─────┤
                   │  (calls through the contract)
wasm plugins ──────┤
                   │
        ┌──────────▼──────────┐
        │   Runtime contract   │  ← documented interface
        └──────────▲──────────┘
                   │  (implements)
        ┌──────────┴──────────────┐
        │ furnace-runtime (Rust)  │  ← default impl
        │  - or any other impl    │  ← consumer fork or alternative shell
        └─────────────────────────┘
```

### What's in the contract (categories)

| Category | Examples |
|---|---|
| Filesystem | `read_file`, `write_file`, `list_dir`, `watch`, app-data path resolution |
| Native dialogs | File/folder picker, message box, save-as |
| Window control | Show, hide, resize, fullscreen, focus, decorations |
| Lifecycle hooks | Background/foreground transitions, low-memory warnings, graceful shutdown |
| IPC channel | Message bus carrying invoke calls between JS and Rust; wasm plugin loading |
| Asset access | Reading game files baked into the shipped bundle |
| Optional later | Clipboard, OS notifications, deep links, native sensors |

The contract is *what the JS/wasm layer can ask of any compliant runtime*. Implementation details (wry's invoke channel internals, winit's window thread management) are not part of the contract.

### What's deliberately NOT in the contract

- **Anything platform-specific that doesn't generalise.** macOS-only / Android-only features go in optional contract extensions (e.g., `RuntimeContract.macOS`), not the core.
- **Pluggable computation.** That's wasm plugins.
- **Implementation-specific quirks.** wry version, winit config — internal to `furnace-runtime`, not contract surface.

### Versioning

- The contract is versioned. `@furnace/core` declares which version it requires.
- **Adding** capabilities is non-breaking — older runtimes don't implement them; `@furnace/core` handles "not implemented" via a `featureSupported(name)` check.
- **Changing** existing signatures is breaking — major contract bump.
- The CLI's `runtime_check` module verifies compatibility at build time and fails pre-flight if a contract-version mismatch would prevent the build.

### Alternative implementations

Three legitimate categories enabled by the contract:

1. **Fork `furnace-runtime`.** Modify the L4 vendored source. Satisfies the contract by starting from a compliant implementation. Upgrade cost is real.
2. **New Rust implementation from scratch.** Replace wry, drop winit, use raw platform APIs. As long as the contract is satisfied, everything else works unchanged.
3. **Implementation in another language.** A hypothetical Swift native runtime for iOS could satisfy the contract by registering the same invoke handlers. Furnace doesn't ship these but the option exists at the architecture level.

The contract also makes testing the JS engine in isolation practical: a mock runtime satisfies the contract for tests without booting a real WebView.

### Spec scope

This section establishes the contract exists, what it covers, and its versioning principles. **The exhaustive method list, signatures, IPC protocol, error semantics, and async behaviour are deferred to a separate "Runtime Contract Spec" written when concrete implementation work begins.** The contract is one of the larger design surfaces in the project; treating it as its own session is the right size.

## First implementation milestone

The first implementation that follows from this design is **end-to-end macOS** — `furnace build --platform=macos` producing a double-clickable `.app` that boots and renders a furnace-built game. This milestone is the proof of the architecture.

Concretely, milestone 1 must deliver:
1. A Cargo workspace at `packages/tools/crates/` with `furnace-cli` and `furnace-runtime` crates.
2. A `MacosBuilder` implementing `PlatformBuilder` — including the `.app` directory construction.
3. The wasm-compile pipeline (`furnace wasm` and `build` integration), even if no real plugins ship yet.
4. The JS bundling pipeline for native targets.
5. The JS shim at `packages/tools/shim.js` + corresponding `package.json` updates.
6. Scaffolding templates under `packages/tools/templates/`.
7. The minimum viable Runtime Contract — enough methods to render the hello-world WebGPU triangle inside a `.app` shell.
8. Hello-world rewired: `dev:native` → `furnace dev --platform=macos`, `build:macos` → `furnace build --platform=macos`.
9. The runtime's startup-time bundle extraction (the `payload.bin` pattern from Shallot's `extract_bundle_payload`).

Backlog absorption: items (a) "Native dev: macOS opens Terminal.app to host the launcher binary" and (b) "Native binary bundling" under "Native runtime" in `.docs/BACKLOG.md` are **promoted out of backlog** when milestone 1 starts. The Shallot recipes referenced there (`bundleNativeMac`, `extract_bundle_payload`) are the implementation starting points.

Subsequent milestones (Windows, then mobile when WebGPU-in-WebView lands) each get their own design pass and implementation.

## Open implementation details

These are decided during implementation, not in this design:

| Decision | Candidates |
|---|---|
| JS bundler for native builds | `swc`, `esbuild`, `oxc`, `rollup` |
| Rust-side platform packaging tool | `cargo-packager`, `tauri-bundler` |
| Rust→wasm pipeline | `wasm-pack`, `wasm-bindgen-cli` directly, or thin wrapper |
| HMR protocol between dev session and shell | Probably WebSocket via wry's invoke; exact protocol TBD |
| Default scaffold dependencies for the consumer's web bundling | `bun build`, `vite`, `esbuild`, or "none — pick yourself" |

## Deferred specs

Substantial work items that each warrant their own session:

1. **Runtime Contract Spec** — full method list, signatures, IPC protocol, error/async semantics, versioning policy.
2. **Plugin API Spec** — the `Plugin` trait shape, payload schemas, async patterns, lifecycle.
3. **`furnace.config.json` schema** — full set of fields, validation rules, schema versioning.
4. **Per-platform specs (Windows, iOS, Android)** — each platform's scaffolds, signing flow, and tooling integration is its own scoping exercise.

## Explicitly out of scope (with rationale)

- **Web build pipeline.** Consumer's domain. `@furnace/core` is just a JS module.
- **Plugin marketplace / registry.** Cargo + npm handle discovery; furnace stays out of curation.
- **Automatic three-way merge for L4 forkers.** Forking the runtime accepts upgrade pain; that's the tradeoff being chosen.
- **OS-level extensions as plugins.** Plugins are wasm-only by design. OS-level goes in the Runtime Contract or via L4 forking.
- **wasm size / load-time optimisation strategy.** Real concern, premature to design before measured.
- **`furnace-runtime` as a published crate.** Vendoring is sufficient today; revisit only if multi-consumer fix-sharing becomes a real need.

## Eventual-publishing concerns (when publishing matters)

- **Per-platform binary packages (biome pattern) for `@furnace/tools`** when platform #2 ships. Single-package model works until then; migration is mechanical and well-understood.
- **`workspace:*` → version-range rewrite at publish time** (via `changesets`, `pnpm publish`, or similar). Architecture supports it; tool choice happens at publish time.
- **CI matrix** for multi-platform release builds. Out of scope until publishing matters; affects `.github/workflows/`, not the architecture.

## Risks and open questions

- **WebGPU-in-WebView on mobile is unverified.** wry supports iOS (WKWebView) and Android (Android WebView), but standalone-browser WebGPU support doesn't automatically mean WebView WebGPU support. The architecture extends to mobile cleanly; whether mobile is *viable* today is gated on browser-vendor work that hasn't been verified for this design. Mitigation: design accepts the gating, ship desktop first.
- **wasm size and startup cost.** Rust→wasm produces sizeable artifacts; loading them at game startup adds latency. Mitigation strategies (streaming compile, lazy loading, `wasm-opt`, careful crate selection) exist but are deliberately not designed in until measured. Risk: a consumer ships a heavy plugin and game startup degrades. Mitigation guidance: document it when it bites.
- **The Runtime Contract becomes a public commitment.** Once consumers depend on contract version N, breaking changes are expensive. Mitigation: keep the contract small, add only when needed, expect to live with early decisions.
- **Bun's `workspace:*` + `optionalDependencies` semantics at publish time.** Verified in dev (this session, in `/tmp/bun-optdeps-test/`). Unverified at publish — `bun publish`'s handling of `workspace:*` rewriting is unconfirmed. Mitigation: when publishing matters, use `changesets` or similar; not blocking design.
- **L4 forks at scale.** Today's framing assumes forkers are a small minority. If they become a meaningful fraction of users, upgrade pain becomes a community-scale problem. Mitigation: revisit if/when that happens; not a design-time concern.
- **macOS-only `.app` builder ergonomics.** First implementation will write the `.app` layout, write Info.plist, run codesign, optionally produce a `.dmg`. Choice of `cargo-packager` vs `tauri-bundler` vs hand-rolled determines blast radius. Recommended (per "don't handroll unless no solution exists"): pick `cargo-packager` or `tauri-bundler` over hand-rolling, decided during implementation after a brief comparison.

## See also

- [`.docs/packaging-and-distribution.md`](../../../.docs/packaging-and-distribution.md) — §6 of this doc gets rewritten to reflect the design. Other sections (engine/harness principle, what gets published) remain valid.
- [`.docs/research/2026-05-19-build-distribution/native-shell-distribution.md`](../../../.docs/research/2026-05-19-build-distribution/native-shell-distribution.md) — survey grounding the archetype choice.
- [`.docs/research/2026-05-19-build-distribution/cli-libraries.md`](../../../.docs/research/2026-05-19-build-distribution/cli-libraries.md) — survey of Node CLI libraries; now mostly moot because the CLI is Rust (clap is the obvious choice). Useful if the JS shim ever grows.
- [`.docs/research/2026-05-19-build-distribution/per-platform-builds.md`](../../../.docs/research/2026-05-19-build-distribution/per-platform-builds.md) — survey informing Section 6.
- [`.docs/BACKLOG.md`](../../../.docs/BACKLOG.md) — "Native runtime" entries (a) and (b) get promoted out by the first implementation milestone.
- [`2026-05-18-build-tooling-design.md`](./2026-05-18-build-tooling-design.md) — prior spec that established the three-package structure this design builds on.
- [`.docs/shallot-and-game-engine-architecture.md`](../../../.docs/shallot-and-game-engine-architecture.md) — engine architecture notes referenced for the wasm hot-path strategy.
