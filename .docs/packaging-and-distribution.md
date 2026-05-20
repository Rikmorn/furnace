# Packaging and Distribution

The working model for how furnace is structured, what gets built, and what gets published. Established during the 2026-05-18 build-tooling brainstorm.

Status: working model — refine as concrete decisions land. Open questions are flagged explicitly.

## 1. Workspace layout

**Today:**

| Path | Package name | Visibility |
|---|---|---|
| `packages/core` | `@furnace/core` | private (will become published) |
| `packages/tools` | `@furnace/tools` | private (will become published) |
| `packages/hello-world` | `@furnace/hello-world` | private (stays private) |

**Future:**

- Per-platform CLI binary subpackages owned by `@furnace/tools` (`@furnace/tools-darwin-arm64`, `@furnace/tools-win32-x64`, …) — biome's distribution pattern, triggered when furnace gains its second platform. See §6.
- Possibly more example packages alongside `hello-world` as the engine surface grows.

## 2. The engine/harness principle

This is the foundational rule that governs everything else:

> **Only `@furnace/tools` produces binaries. Everything else is TypeScript or wasm.**

Mapping that to packages:

- **`@furnace/core` — engine.** TS source. Future Rust crates that compile to **wasm** (transforms, audio — Shallot pattern §3) live here, because their output is imported by the engine code itself. No native binaries, no platform-aware code, no `process.platform` reads. Pure consumer-portable runtime.
- **`@furnace/tools` — harness.** Internally a Rust workspace containing the `furnace-cli` binary (the user-facing `furnace` command) and the `furnace-runtime` crate (the shell that consumers vendor into their apps). Externally an npm package distributing the CLI binary via a biome-style JS shim. Owns the `furnace init / build / dev / wasm / upgrade-runtime` command surface, the scaffold templates, and the per-platform build dispatch. Anything that *launches* or *packages* furnace rather than running *inside* it lives here.
- **`@furnace/hello-world` — reference consumer.** Demonstrates the third-party consumer experience. Uses `@furnace/tools`'s CLI for native dev, just as an external consumer would.

The rule is what keeps `@furnace/core` honest: web-only consumers never download a binary, never pay for Rust tooling, never see Bun-coupled code. `packages/core/tests/no-bun-leakage.test.ts` is one static guardrail — a regex-scan against Bun-API imports in core's source. It does not by itself prove the full consumer contract; see `.claude/CLAUDE.md` "What we ship to consumers" for the complete set of constraints.

## 3. What gets published vs not

| Package | Published to npm? | Purpose |
|---|---|---|
| `@furnace/core` | Yes (eventually) | Engine library. Compiled ESM JS + `.d.ts` + future wasm modules. Required for any furnace consumer. |
| `@furnace/tools` | Yes (eventually) | The `furnace` CLI binary. Today: single npm package with host-platform binary inline. Future: biome-style — thin JS shim + per-platform `optionalDependencies`. Required by consumers using the desktop runtime. Contains the vendored `furnace-runtime` source as data files (copied into consumer repos on `furnace init`). |
| `@furnace/tools-<os>-<arch>` (future) | Yes (eventually) | Per-platform CLI binary subpackages — biome's pattern. Pulled in via `optionalDependencies` of `@furnace/tools` once furnace has a second platform target. |
| `@furnace/hello-world` | No | Internal demo. Its build output may be deployed as a showcase site, but it's not a library. |

## 4. What consumers receive

There are two install paths, picked by the consumer based on what they're building:

**Web-only consumer** (browser game, web demo, embedded WebGPU surface):

```bash
npm install @furnace/core
```

They get:

- **Plain ESM JavaScript** compiled from our TypeScript source, plus `.d.ts` declarations.
- *(Future)* Wasm modules + their JS loaders, for hot-path code compiled from Rust.

Target runtime: browser. No Bun APIs, no Node APIs (`node:*`, `process.*`), no platform-aware code in the shipped output. No native binary, no Rust toolchain. Consumers compose with whatever bundler they prefer (Vite, webpack, Bun, esbuild, Rollup, etc.).

**Desktop consumer** (also wants the native runtime):

```bash
npm install --save-dev @furnace/tools
npm install @furnace/core
```

They additionally get:

- The `furnace` CLI — a Rust binary distributed via npm using a biome-style JS shim. Invoked via `npx furnace …` or `bunx furnace …`.
- The vendored `furnace-runtime` Rust source, copied into their repo at `.furnace/shell/runtime/` on `furnace init`. Consumer's `Cargo.toml` depends on it via a `path` reference.
- Platform scaffolds at `.furnace/platforms/<platform>/` (Info.plist, icons, entitlements for macOS; Xcode project for iOS later; Gradle project for Android later). Consumer-committed and editable.
- A scaffolded `.furnace/shell/main.rs` (~20 lines) — the Rust entrypoint the consumer can extend.

The CLI orchestrates the build: bundle the consumer's JS source for native targets, cross-compile Rust to the chosen target triple, run platform packaging (`cargo-packager` / `tauri-bundler` / xcodebuild / Gradle), emit a shippable artifact in `dist/<platform>/`. No prebuilt native shell binary ships from furnace; the consumer's final `.app` / `.ipa` / `.apk` is compiled from their own machine (or CI) with the vendored runtime as a build input.

In both paths, consumers **do not** receive: our internal build scripts, our dev server (`serve.ts`), our bundler config. They are free to use any web toolchain they like for their game's JS code; `@furnace/tools` is only relevant for the native shell build pipeline.

## 5. Bun's role

Bun does three internal jobs, none of which are consumer-facing:

1. **Dev server + HMR + on-the-fly bundling** — `bun --hot serve.ts`. The daily dev loop. Bun resolves and bundles the import graph from the HTML entry on every request, with hot reload.
2. **Static bundler for hello-world** — `bun build index.html …`. Walks the same import graph but emits static files to disk. Produces a deployable demo artefact, not a library.
3. **Script runtime** — runs build orchestration, tests, internal scripts.

Bun does not appear in the dependency tree consumers see — neither in shipped JS nor in install footprint. The build step transpiles `@furnace/core`'s TypeScript source to plain ESM JavaScript before publishing, so its shipped artifact contains no Bun-API imports and no `.ts` extension imports. `@furnace/tools` ships as a Rust binary wrapped by a tiny plain-Node JS shim (biome's pattern); neither side touches Bun runtime APIs. Consumers point their bundler at `@furnace/core`'s compiled ESM output and invoke `@furnace/tools`'s CLI via `npx`/`bunx`/direct path.

## 6. Native shell distribution

Furnace follows **Tauri 2's architecture, scoped to a WebGPU game engine.** This displaces an earlier plan-of-record (per-platform native runtime binaries published via `optionalDependencies`, esbuild/swc/sharp pattern). The earlier plan cited the wrong precedent: the `optionalDependencies` per-platform pattern is dominant for *compilation tooling* (esbuild, swc, sharp) but rare for *shell runtimes* per the 2026-05-19 research survey. Shell-runtime ecosystems (Electron, Tauri, RN, Capacitor, Flutter, Expo) source-ship the shell or use hybrid models. The runtime *must* compile into the consumer's final binary because it's the shell of their app; distributing a prebuilt runtime binary separately doesn't fit shell-runtime use cases.

### What furnace ships

| Artifact | Channel | Form |
|---|---|---|
| `@furnace/core` | npm | Compiled ESM JS + `.d.ts`. Browser-only. |
| `@furnace/tools` | npm | Rust CLI binary + JS shim + vendored `furnace-runtime` source + scaffold templates. Single npm package today; biome-style per-platform packages when furnace gains its second platform target. |

`furnace-runtime` (the Rust shell crate) is **not published as a separate Rust crate today**. It ships as files inside `@furnace/tools`'s npm package; `furnace init` copies it into the consumer's repo. Consumers depend on it via a Cargo `path` reference. Revisit if multi-consumer fix-sharing becomes a real need.

### Per-platform CLI binary distribution (deferred, biome's pattern)

Today: single `@furnace/tools` package contains the host-platform binary inline. Sufficient for one platform.

Future (triggered by platform #2): migrate to biome's distribution pattern:

| Platform | Subpackage | Status |
|---|---|---|
| macOS Apple Silicon | `@furnace/tools-darwin-arm64` | Primary target — milestone 1 |
| macOS Intel | `@furnace/tools-darwin-x64` | If/when Intel Macs are needed |
| Windows x64 | `@furnace/tools-win32-x64` | Planned, next after macOS |
| Linux x64 | `@furnace/tools-linux-x64` | Deferred — see BACKLOG.md "Linux / cef support" |

In the biome pattern, `@furnace/tools` (the umbrella) lists per-platform subpackages as `optionalDependencies`; npm resolves only the matching one. A ~3-line JS shim in `@furnace/tools/index.js` resolves the right binary via `require.resolve` and execs it. Verified to work in Bun workspaces during the 2026-05-19 brainstorming.

### Consumer build flow

```
$ furnace build --platform=macos
[1/6] Pre-flight: ✓ cargo, ✓ codesign, ✓ source at src/
[2/6] wasm compile: plugins/ → tmp (Rust → wasm via wasm-pack)
[3/6] JS bundle (prod): src/ → tmp/furnace-build-<hash>/ (minified, no HMR)
[4/6] Rust compile (release): cargo build --release --target=aarch64-apple-darwin
      → target/release/my-game
[5/6] Packaging: cargo-packager → MyGame.app (Info.plist, Resources/web/, icon)
[6/6] Sign + emit: dist/macos/MyGame.app
```

The CLI orchestrates the full pipeline. No prebuilt binary from furnace ships to the consumer's `.app`; the consumer's machine (or CI) compiles the runtime as part of building their app. This trades install simplicity for consumer flexibility: the consumer owns the platform metadata (`.furnace/platforms/macos/`), the Rust entrypoint (`.furnace/shell/main.rs`), and optionally the runtime source itself (`.furnace/shell/runtime/`) — see §4 of `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md` for the four customisation layers.

### What's deliberately rejected

- **Pre-built native runtime binary per platform.** The runtime compiles INTO the consumer's app; shipping a prebuilt binary doesn't fit.
- **Compile-at-install via `postinstall` hook.** Requires the consumer to have Rust/Xcode/etc. at `npm install` time; slow; fragile on Windows. Compilation happens explicitly at `furnace build` time, not implicitly at install.
- **Plugin marketplace / registry.** Plugins are wasm crates; Cargo + npm handle discovery. Furnace stays out of curation.

### Full design

This section is a reference summary. The architectural decisions, alternatives considered, and rationale live in `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md`.

## 7. Cross-compilation reality

`wry` + `winit` apps can't be cross-compiled cleanly from a single host — each target needs its platform-native WebView (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux). iOS additionally requires macOS (Xcode dependency). In practice:

- **Consumer's local build:** a consumer building their game with `furnace build --platform=<X>` typically builds only for their own platform's match. Cross-compiling to a *different* platform requires that platform's toolchain on their host.
- **Consumer's publish:** a consumer shipping their game to multiple platforms typically runs `furnace build --platform=<X>` on a CI matrix — one job per target on a host that supports it.
- **Furnace's own CI** (for publishing the `@furnace/tools` CLI binaries via biome's pattern, when that lands) likewise needs a matrix to produce per-platform CLI binaries.

The `--platform` flag on `furnace build` means "build *this* target on a host that supports it," not "build all targets in one shot." Today there is no CI matrix and we only build for the host platform during milestone 1.

## 8. Build artefacts

| Artefact location | Owner package | What it is | Shipped to consumers? |
|---|---|---|---|
| `dist/core/` | `@furnace/core` | Publish-ready layout: compiled ESM JS + `.d.ts` + manifest | Yes |
| `dist/tools/` | `@furnace/tools` | Publish-ready layout: JS shim + Rust CLI binary + vendored runtime source + templates + manifest | Yes |
| `packages/tools/furnace[.exe]` | `@furnace/tools` | Built CLI binary (cargo output copied here for in-repo use; ships inside `dist/tools/`) | Indirectly — embedded in `dist/tools/` |
| `dist/web/*` | `@furnace/hello-world` | Bundled demo site | No — deployable showcase only |
| `dist/wasm/*` (future) | `@furnace/core` | Compiled wasm modules + their JS loaders | Yes — in `@furnace/core` itself |
| Consumer's `dist/<platform>/` | Consumer | Shippable native artifact (`.app`, `.ipa`, `.apk`, `.msi`, …) produced by `furnace build`. Not a furnace artifact. | No — that's the consumer's final product |
| API docs (future) | TBD | Generated reference docs | Yes — via GitHub Pages or similar |

Each artefact has a single owning package. That ownership determines which package's `files` array lists it and which subpackage publishes it.

## 9. Internal tooling placement — resolved

`@furnace/tools` is internally a **Rust workspace** with auxiliary JS and scaffold-template assets, not a TS package with a vendored Rust crate. Layout:

```
packages/tools/
├── package.json                 # bin: { furnace: ./shim.js }, eventually with optionalDependencies
├── shim.js                      # ~3-line plain Node JS shim that resolves + execs the binary
├── furnace                      # the built CLI binary (cargo output)
├── templates/                   # scaffold files for `furnace init`
│   ├── shared/                  # furnace.config.json.tmpl, .furnace/shell/Cargo.toml.tmpl, .furnace/shell/main.rs.tmpl
│   └── macos/                   # Info.plist.tmpl, Assets.xcassets/, entitlements.plist
└── crates/                      # Cargo workspace
    ├── Cargo.toml               # workspace root
    ├── furnace-cli/             # the CLI source
    │   ├── Cargo.toml
    │   └── src/main.rs
    └── furnace-runtime/         # the shell runtime — copied into consumer repos verbatim
        ├── Cargo.toml
        └── src/lib.rs
```

The placement constraint — "a published package must not pull internal tooling at install or runtime time" — is satisfied because:

- `@furnace/core` does not depend on `@furnace/tools`. A web-only consumer never installs tools.
- `@furnace/tools`'s shipped npm package contains only what consumers need: the CLI binary, the JS shim, the vendored runtime source (as data files), the scaffold templates, plus `package.json`. Internal build helpers, tests, and Cargo intermediate output are excluded from the published `files` array.
- The vendored runtime source is copied by `furnace init` into the consumer's `.furnace/shell/runtime/`. The consumer's `Cargo.toml` references it by `path`; the original source in `node_modules/@furnace/tools/runtime/` is read-only data files.

**Follow-up specs needed** (tracked in `.docs/BACKLOG.md`): the Runtime Contract Spec, the Plugin API Spec, the `furnace.config.json` schema, and the per-platform binary packages migration (biome's pattern at platform #2). All are deferred from the design spec; each warrants its own session.

---

**See also:**

- `.docs/shallot-and-game-engine-architecture.md` — engine architecture notes (Shallot reference, ECS, WebGPU, wasm strategy)
- `.docs/BACKLOG.md` — deferred work register, including the "Build system revisit" entry that triggered this conversation
- `packages/core/tests/no-bun-leakage.test.ts` — static guardrail against Bun-API imports in core's source (one check among the full consumer contract; see `.claude/CLAUDE.md`)
