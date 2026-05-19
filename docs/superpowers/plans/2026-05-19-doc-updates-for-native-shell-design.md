# Documentation Updates for Native Shell Distribution Design — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring repo documentation into alignment with the native-shell distribution design committed at `2e0f86c` (`docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md`). This includes promoting deferred items to BACKLOG, comprehensively rewriting `.docs/packaging-and-distribution.md`, and updating the entry-point docs (`CLAUDE.md`, `AGENTS.md`, READMEs) to reflect the new architecture (Tauri 2-style shell, Rust CLI via npm shim, wasm plugins, runtime contract).

**Architecture:** Doc-only changes. Tasks sequenced lowest-blast-radius first. Pre-plan setup commits the unrelated in-flight changes that have accumulated this session (so the working tree is clean and each subsequent commit is atomic). Then BACKLOG additions, then `packaging-and-distribution.md` (the canonical reference doc), then the entry-point docs (which cross-reference the packaging doc). Each task ends with a focused commit.

**Tech Stack:** Markdown editing. Bun + biome for verification (`bunx tsc --noEmit`, `bun test`, `bun run check`).

---

## Pre-task context

The following files are modified-not-committed at plan start:

- `.claude/CLAUDE.md` — earlier session edits (mostly correct, "What we ship" tools description is now partially wrong post-design)
- `.docs/BACKLOG.md` — earlier session edit adding the `@furnace/native` entry (still valid)
- `.docs/packaging-and-distribution.md` — earlier session edits (mostly fine; §6 now needs full rewrite per design)
- `packages/core/tests/no-bun-leakage.test.ts` — glob widening from `["src/index.ts", "src/lib/**/*.ts"]` to `["src/**/*.ts"]` (test passes; standalone improvement, unrelated to design)
- `.cargo/config.toml` — modified at session start, NOT mine, leave alone
- `packages/hello-world/tests/triangle-shader.test.ts` — deleted at session start, NOT mine, leave alone

The following are untracked (new this session):

- `.docs/research/2026-05-19-build-distribution/` — three research artifacts referenced by the design spec; need committing
- `docs/superpowers/plans/2026-05-19-doc-updates-for-native-shell-design.md` — this plan itself

---

## Task 1: Pre-plan setup — commit standalone in-flight work

Goal: clean working tree of unrelated improvements so subsequent commits are atomic. Two independent improvements landed during the brainstorming session that have nothing to do with the new doc updates: the research artifacts (referenced by the now-committed design spec) and the no-bun-leakage test glob fix.

**Files:**
- Commit 1: `.docs/research/2026-05-19-build-distribution/native-shell-distribution.md`, `cli-libraries.md`, `per-platform-builds.md`
- Commit 2: `packages/core/tests/no-bun-leakage.test.ts`

- [ ] **Step 1: Verify expected state**

Run: `git status --short`
Expected output includes (among others):
```
 M packages/core/tests/no-bun-leakage.test.ts
?? .docs/research/
```

If these are missing or different, STOP and investigate before proceeding.

- [ ] **Step 2: Commit research artifacts**

```bash
git add .docs/research/2026-05-19-build-distribution/
git commit -m "$(cat <<'EOF'
docs(research): survey artifacts grounding native-shell distribution design

Three parallel research surveys produced during the 2026-05-19 native-shell
brainstorming: native-shell distribution patterns across RN/Expo/Tauri/
Capacitor/Electron/Flutter, Node CLI library comparison, and per-platform
build script structure across multi-platform native tools. Referenced from
the design spec; commit alongside so cross-doc links resolve.
EOF
)"
```

- [ ] **Step 3: Commit test-glob improvement**

```bash
git add packages/core/tests/no-bun-leakage.test.ts
git commit -m "$(cat <<'EOF'
test(core): widen no-bun-leakage scan to src/**/*.ts

Removes the structural assumption that core's source lives only under
src/lib/. Adding a top-level src/utils.ts no longer silently slips past
the Bun-leakage guardrail. Existing source layout still 100% covered.
EOF
)"
```

- [ ] **Step 4: Verify test still passes**

Run: `bun test packages/core/tests/no-bun-leakage.test.ts`
Expected:
```
 1 pass
 0 fail
```

- [ ] **Step 5: Verify clean state for next task**

Run: `git status --short`
Expected output should still show the three doc files modified (`.claude/CLAUDE.md`, `.docs/BACKLOG.md`, `.docs/packaging-and-distribution.md`) plus pre-existing repo state, but NOT the research/ or test files (now committed).

---

## Task 2: Promote deferred items into BACKLOG.md

Goal: capture substantial deferred work from the design spec as backlog entries so it survives across sessions. Update existing `.app` wrapping entries to cross-reference the new spec.

**Files:**
- Modify: `.docs/BACKLOG.md`

The existing BACKLOG already contains the `@furnace/native` entry added during the brainstorming. This task adds four more entries and updates two existing ones.

- [ ] **Step 1: Add Runtime Contract Spec entry under "Native runtime"**

Open `.docs/BACKLOG.md`. Find the existing entry "Native packaging — `.app` wrapping + asset bundling (PAIRED)" under `## Native runtime`. Insert a new entry IMMEDIATELY BEFORE that paired-entry section:

```markdown
### Runtime Contract Spec
**Context:** The native-shell distribution design (Section 5) introduces the Runtime Contract as the abstraction boundary between the JS engine / wasm plugin layer and any compliant native shell implementation. The spec establishes the contract exists, what it covers (filesystem, dialogs, window control, lifecycle, IPC, asset access), and its versioning principles — but the *exhaustive method list, signatures, IPC protocol, error semantics, and async behaviour* are deliberately deferred to a separate spec. This is one of the larger design surfaces in the project; it warrants its own session.
**Trigger to revisit:** When implementation of milestone 1 (end-to-end macOS) needs more contract methods than the bare minimum, OR when a second alternative runtime implementation is considered.
**Reference:** Section 5 of `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md`.

```

- [ ] **Step 2: Add Plugin API Spec entry under "Engine architecture"**

Find the section `## Engine architecture`. Insert the new entry AFTER the existing `### Rust transforms wasm crate` entry and BEFORE the `### @furnace/native JS package` entry (which was added earlier this session):

```markdown
### Plugin API Spec
**Context:** The native-shell distribution design (Plugin Model section) establishes that plugins are Rust crates compiled to wasm running inside the JS layer (chosen over the Tauri-style Rust-in-runtime model to preserve cross-platform reach). The plugin *mechanism* is decided; the full `Plugin` trait shape, payload schemas, async patterns, lifecycle hooks, and JS-side IPC contract are deliberately deferred. Tauri's `command!` macro is a strong precedent to crib from.
**Trigger to revisit:** First plugin authored in earnest (likely after filesystem or audio is needed as a furnace-first-party plugin), OR when a third-party wants to publish a `furnace-plugin-*` crate.
**Reference:** Plugin Model section of `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md`.

```

- [ ] **Step 3: Add `furnace.config.json` schema entry under "Editor & tooling"**

Find the section `## Editor & tooling`. Insert the new entry as the FIRST entry under that heading (BEFORE `### Svelte editor / inspector surfaces`):

```markdown
### `furnace.config.json` schema
**Context:** The native-shell distribution design uses `furnace.config.json` as the L1 declarative customisation surface — covering app identity, window defaults, plugin registration, signing config, and source/output paths. Sample structure is sketched in the spec but the full schema (field-by-field definitions, validation rules, schema versioning, platform-specific override semantics) is deferred until the first implementation milestone forces the choices.
**Trigger to revisit:** Start of milestone 1 implementation (end-to-end macOS). The schema design happens BEFORE writing the Rust struct that deserialises it, so the choices are explicit rather than implicit.
**Reference:** Customization Layers Section 4 of `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md`.

```

- [ ] **Step 4: Add per-platform binary packages migration entry under "Native runtime"**

Find the section `## Native runtime`. Insert the new entry AT THE END of that section (after the existing "Native packaging — `.app` wrapping + asset bundling (PAIRED)" block, including its (a) and (b) sub-entries):

```markdown
### Per-platform binary packages — biome-style migration
**Context:** Today's plan ships `@furnace/tools` as a single npm package containing the host-platform CLI binary inline. When furnace gains a second platform target (likely Windows after macOS is proven), the right move is to migrate to the biome distribution pattern: thin `@furnace/tools` shim package + `@furnace/tools-<os>-<arch>` per-platform packages as `optionalDependencies`. Verified to work in Bun workspaces during the 2026-05-19 brainstorming (test in `/tmp/bun-optdeps-test/`). Migration is mechanical — the JS shim changes ~5 lines.
**Trigger to revisit:** Second platform binary (Windows almost certainly first) needs to ship.
**Reference:** Section 2 "Artifact model" of `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md`; biome's `@biomejs/biome` npm package layout as the precedent.

```

- [ ] **Step 5: Update existing `.app` wrapping entry (a) cross-reference**

Find the entry titled `#### a) Native dev: macOS opens Terminal.app to host the launcher binary` within the "Native packaging — `.app` wrapping + asset bundling (PAIRED)" section. Locate its final `**Reference:**` line. Replace it with:

```markdown
**Reference:** `docs/superpowers/specs/2026-05-18-build-tooling-design.md` "Native dev UX fix" anticipated this branch. The Shallot recipe lives at `https://github.com/dylanebert/shallot/blob/main/packages/shallot/bin/native.ts` (`bundleNativeMac`). Now also the implementation starting point for Milestone 1 of `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md` — when that milestone begins, this entry gets promoted out of backlog. Investigation might still want to confirm: whether `dev:native` via VS Code's integrated terminal exhibits the same behaviour vs a standalone terminal, and whether `bun run dev:native` vs double-clicking the binary in Finder produce the same Terminal pop-up.
```

- [ ] **Step 6: Update existing `.app` wrapping entry (b) cross-reference**

Find the entry titled `#### b) Native binary bundling`. Locate its final `**Reference:**` line. Replace it with:

```markdown
**Reference:** Same Shallot files as (a). Also see `packages/shallot/rust/window/src/main.rs` (`unpack_to_cache`, `cache_dir`, `extract_bundle_payload`). Now also the implementation starting point for Milestone 1 of `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md` — when that milestone begins, this entry gets promoted out of backlog.
```

- [ ] **Step 7: Verify BACKLOG.md is well-formed**

Read the file. Sanity-check:
- Each new entry follows the standard shape (Context / Trigger to revisit / Reference).
- New entries are grouped under the right `##` category headings.
- The existing `@furnace/native JS package` entry (added earlier this session) is still present and untouched.
- No accidental duplication of the existing (a)+(b) entries' bodies — only their Reference lines should have changed.

- [ ] **Step 8: Commit**

```bash
git add .docs/BACKLOG.md
git commit -m "$(cat <<'EOF'
docs(backlog): promote deferred items from native-shell design spec

Adds entries for Runtime Contract Spec, Plugin API Spec, furnace.config.json
schema, and the eventual per-platform binary packages migration. Updates
the existing .app-wrapping entries (a)+(b) to cross-reference the design
spec, marking them as the implementation starting point for milestone 1.
Also captures the @furnace/native entry added during the brainstorming.
EOF
)"
```

- [ ] **Step 9: Verify clean commit**

Run: `git log --oneline -3`
Expected: most recent commit is "docs(backlog): promote deferred items..."

Run: `git status --short`
Expected: `.docs/BACKLOG.md` no longer modified; other in-flight files (`.claude/CLAUDE.md`, `.docs/packaging-and-distribution.md`) still pending.

---

## Task 3: Rewrite `.docs/packaging-and-distribution.md`

Goal: align the canonical packaging reference with the design. Multiple sections need rewriting. The current file already has earlier session edits applied (TS→JS reversal in §4, etc.); this task replaces sections wholesale where the design supersedes them.

**Files:**
- Modify: `.docs/packaging-and-distribution.md`

Implementation strategy: read the current file, then apply section-by-section Edit replacements. The file's overall structure is preserved; section bodies are updated.

- [ ] **Step 1: Update §1 (Workspace layout) "Today" table to reflect three-package current state**

Find the `## 1. Workspace layout` section. Replace the "Today" and "Imminent" tables with a single unified "Today" table reflecting all three packages currently existing:

Find:
```markdown
**Today:**

| Path | Package name | Visibility |
|---|---|---|
| `packages/core` | `@furnace/core` | private (will become published) |
| `packages/hello-world` | `@furnace/hello-world` | private (stays private) |

**Imminent, as part of the in-progress build-tooling spec:**

| Path | Package name | Visibility |
|---|---|---|
| `packages/tools` | `@furnace/tools` | private now (may be published later) |

**Future:**

- Per-platform native subpackages owned by tools (`@furnace/tools-darwin-arm64`, `@furnace/tools-win32-x64`, …) — see §6.
- Possibly more example packages alongside `hello-world` as the engine surface grows.
```

Replace with:
```markdown
**Today:**

| Path | Package name | Visibility |
|---|---|---|
| `packages/core` | `@furnace/core` | private (will become published) |
| `packages/tools` | `@furnace/tools` | private (will become published) |
| `packages/hello-world` | `@furnace/hello-world` | private (stays private) |

**Future:**

- Per-platform CLI binary subpackages owned by `@furnace/tools` (`@furnace/tools-darwin-arm64`, `@furnace/tools-win32-x64`, …) — biome's distribution pattern, triggered when furnace gains its second platform. See §6.
- Possibly more example packages alongside `hello-world` as the engine surface grows.
```

- [ ] **Step 2: Update §2 (engine/harness principle) to reflect Rust tools**

Find the `## 2. The engine/harness principle` section. The foundational rule "Only `@furnace/tools` produces binaries" stays, but the surrounding wording needs refining to reflect that tools is internally Rust now, distributed via an npm shim.

Find:
```markdown
- **`@furnace/tools` — harness.** Owns the launcher (`furnace-window` Rust crate that opens a wry window and hosts the engine), the CLI that spawns it, and the per-platform binary distribution mechanics. Anything that *launches* furnace rather than running *inside* it lives here.
```

Replace with:
```markdown
- **`@furnace/tools` — harness.** Internally a Rust workspace containing the `furnace-cli` binary (the user-facing `furnace` command) and the `furnace-runtime` crate (the shell that consumers vendor into their apps). Externally an npm package distributing the CLI binary via a biome-style JS shim. Owns the `furnace init / build / dev / wasm / upgrade-runtime` command surface, the scaffold templates, and the per-platform build dispatch. Anything that *launches* or *packages* furnace rather than running *inside* it lives here.
```

- [ ] **Step 3: Update §3 (What gets published vs not) table**

Find the `## 3. What gets published vs not` section. Replace its table:

Find:
```markdown
| Package | Published to npm? | Purpose |
|---|---|---|
| `@furnace/core` | Yes (eventually) | Engine library. TS source + future wasm modules. Required for any furnace consumer. |
| `@furnace/tools` | Yes (eventually) | Harness library + CLI. Required by consumers using the desktop runtime. |
| `@furnace/tools-<os>-<arch>` (future) | Yes (eventually) | Per-platform native binary subpackages. Pulled in via `optionalDependencies` of `@furnace/tools`. |
| `@furnace/hello-world` | No | Internal demo. Its build output may be deployed as a showcase site, but it's not a library. |
```

Replace with:
```markdown
| Package | Published to npm? | Purpose |
|---|---|---|
| `@furnace/core` | Yes (eventually) | Engine library. Compiled ESM JS + `.d.ts` + future wasm modules. Required for any furnace consumer. |
| `@furnace/tools` | Yes (eventually) | The `furnace` CLI binary. Today: single npm package with host-platform binary inline. Future: biome-style — thin JS shim + per-platform `optionalDependencies`. Required by consumers using the desktop runtime. Contains the vendored `furnace-runtime` source as data files (copied into consumer repos on `furnace init`). |
| `@furnace/tools-<os>-<arch>` (future) | Yes (eventually) | Per-platform CLI binary subpackages — biome's pattern. Pulled in via `optionalDependencies` of `@furnace/tools` once furnace has a second platform target. |
| `@furnace/hello-world` | No | Internal demo. Its build output may be deployed as a showcase site, but it's not a library. |
```

- [ ] **Step 4: Update §4 (Desktop consumer block) to reflect CLI build flow**

Find the "Desktop consumer" subsection within `## 4. What consumers receive`. Replace its body:

Find:
```markdown
**Desktop consumer** (also wants the native runtime):

```bash
npm install @furnace/core @furnace/tools
```

They additionally get:

- The platform-matching native binary, installed automatically via `optionalDependencies` of `@furnace/tools`.
- The `furnace` CLI — plain ESM JavaScript that runs on **plain Node ≥20**, provided by `@furnace/tools`'s `bin` entry, used to launch the desktop runtime.

In both paths, consumers **do not** receive: our internal build scripts, our dev server (`serve.ts`), our bundler config. They are free to use any toolchain they like; `@furnace/tools`'s consumer surface is library-style helpers + a CLI, not a workspace orchestrator.
```

Replace with:
```markdown
**Desktop consumer** (also wants the native runtime):

```bash
npm install --save-dev @furnace/tools
npm install @furnace/core
```

They additionally get:

- The `furnace` CLI — a Rust binary distributed via npm using a biome-style JS shim. Invoked via `npx furnace …` or `bunx furnace …`.
- The vendored `furnace-runtime` Rust source, copied into their repo at `src-furnace/runtime/` on `furnace init`. Consumer's `Cargo.toml` depends on it via a `path` reference.
- Platform scaffolds at `platforms/<platform>/` (Info.plist, icons, entitlements for macOS; Xcode project for iOS later; Gradle project for Android later). Consumer-committed and editable.
- A scaffolded `src-furnace/main.rs` (~20 lines) — the Rust entrypoint the consumer can extend.

The CLI orchestrates the build: bundle the consumer's JS source for native targets, cross-compile Rust to the chosen target triple, run platform packaging (`cargo-packager` / `tauri-bundler` / xcodebuild / Gradle), emit a shippable artifact in `dist/<platform>/`. No prebuilt native shell binary ships from furnace; the consumer's final `.app` / `.ipa` / `.apk` is compiled from their own machine (or CI) with the vendored runtime as a build input.

In both paths, consumers **do not** receive: our internal build scripts, our dev server (`serve.ts`), our bundler config. They are free to use any web toolchain they like for their game's JS code; `@furnace/tools` is only relevant for the native shell build pipeline.
```

- [ ] **Step 5: Update §5 (Bun's role) closing paragraph**

Find the closing paragraph of `## 5. Bun's role`. The earlier session edit already made this mostly correct. One refinement: clarify that `@furnace/tools` is a Rust binary in shipped form, not a Bun script.

Find:
```markdown
Bun does not appear in the dependency tree consumers see — neither in shipped JS nor in install footprint. The build step transpiles each package's TypeScript source to plain ESM JavaScript before publishing, so shipped artifacts contain no Bun-API imports and no `.ts` extension imports. Consumers point their bundler at `@furnace/core`'s compiled ESM output and run `@furnace/tools` on plain Node.
```

Replace with:
```markdown
Bun does not appear in the dependency tree consumers see — neither in shipped JS nor in install footprint. The build step transpiles `@furnace/core`'s TypeScript source to plain ESM JavaScript before publishing, so its shipped artifact contains no Bun-API imports and no `.ts` extension imports. `@furnace/tools` ships as a Rust binary wrapped by a tiny plain-Node JS shim (biome's pattern); neither side touches Bun runtime APIs. Consumers point their bundler at `@furnace/core`'s compiled ESM output and invoke `@furnace/tools`'s CLI via `npx`/`bunx`/direct path.
```

- [ ] **Step 6: REPLACE §6 (Native binary distribution) — full rewrite**

Find the entire `## 6. Native binary distribution` section, from the heading through the "Rejected: compile-at-install" paragraph. Replace with:

```markdown
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

The CLI orchestrates the full pipeline. No prebuilt binary from furnace ships to the consumer's `.app`; the consumer's machine (or CI) compiles the runtime as part of building their app. This trades install simplicity for consumer flexibility: the consumer owns the platform metadata (`platforms/macos/`), the Rust entrypoint (`src-furnace/main.rs`), and optionally the runtime source itself (`src-furnace/runtime/`) — see §4 of `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md` for the four customisation layers.

### What's deliberately rejected

- **Pre-built native runtime binary per platform.** The runtime compiles INTO the consumer's app; shipping a prebuilt binary doesn't fit.
- **Compile-at-install via `postinstall` hook.** Requires the consumer to have Rust/Xcode/etc. at `npm install` time; slow; fragile on Windows. Compilation happens explicitly at `furnace build` time, not implicitly at install.
- **Plugin marketplace / registry.** Plugins are wasm crates; Cargo + npm handle discovery. Furnace stays out of curation.

### Full design

This section is a reference summary. The architectural decisions, alternatives considered, and rationale live in `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md`.
```

- [ ] **Step 7: Update §7 (Cross-compilation reality) to reframe target**

Find the `## 7. Cross-compilation reality` section. The content is mostly still valid (host requirements for each platform haven't changed). One framing update: we're no longer talking about cross-compiling per-platform *publish* binaries; we're talking about consumers cross-compiling at build time.

Find:
```markdown
## 7. Cross-compilation reality

`wry` + `winit` desktop binaries can't be cross-compiled cleanly from a single host — each target needs its platform-native WebView (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux). In practice:

- **Local dev:** a developer builds only their own platform's binary. No cross-compilation expected day-to-day.
- **Publish-time:** a CI matrix runs one build job per target on a host that supports it, then a single publish job pulls artefacts together and publishes the umbrella + subpackages.

The build tool's `--target` flag (if/when we add one) therefore means "build *this* target on a host that supports it," not "build all targets in one shot." Today there is no CI matrix and we only build for the host platform.
```

Replace with:
```markdown
## 7. Cross-compilation reality

`wry` + `winit` apps can't be cross-compiled cleanly from a single host — each target needs its platform-native WebView (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux). iOS additionally requires macOS (Xcode dependency). In practice:

- **Consumer's local build:** a consumer building their game with `furnace build --platform=<X>` typically builds only for their own platform's match. Cross-compiling to a *different* platform requires that platform's toolchain on their host.
- **Consumer's publish:** a consumer shipping their game to multiple platforms typically runs `furnace build --platform=<X>` on a CI matrix — one job per target on a host that supports it.
- **Furnace's own CI** (for publishing the `@furnace/tools` CLI binaries via biome's pattern, when that lands) likewise needs a matrix to produce per-platform CLI binaries.

The `--platform` flag on `furnace build` means "build *this* target on a host that supports it," not "build all targets in one shot." Today there is no CI matrix and we only build for the host platform during milestone 1.
```

- [ ] **Step 8: Update §8 (Build artefacts) table**

Find the `## 8. Build artefacts` section. Replace its table:

Find:
```markdown
| Artefact location | Owner package | What it is | Shipped to consumers? |
|---|---|---|---|
| `dist/core/` | `@furnace/core` | Publish-ready layout: compiled ESM JS + `.d.ts` + manifest | Yes |
| `dist/tools/` | `@furnace/tools` | Publish-ready layout: compiled ESM JS + `.d.ts` + manifest + CLI entry | Yes |
| `dist/native/furnace-window[.exe]` | `@furnace/tools` | Native runtime binary (host platform only, today) | Eventually — via per-platform subpackages |
| `dist/web/*` | `@furnace/hello-world` | Bundled demo site | No — deployable showcase only |
| `dist/wasm/*` (future) | `@furnace/core` | Compiled wasm modules + their JS loaders | Yes — in `@furnace/core` itself |
| API docs (future) | TBD | Generated reference docs | Yes — via GitHub Pages or similar |
```

Replace with:
```markdown
| Artefact location | Owner package | What it is | Shipped to consumers? |
|---|---|---|---|
| `dist/core/` | `@furnace/core` | Publish-ready layout: compiled ESM JS + `.d.ts` + manifest | Yes |
| `dist/tools/` | `@furnace/tools` | Publish-ready layout: JS shim + Rust CLI binary + vendored runtime source + templates + manifest | Yes |
| `packages/tools/furnace[.exe]` | `@furnace/tools` | Built CLI binary (cargo output copied here for in-repo use; ships inside `dist/tools/`) | Indirectly — embedded in `dist/tools/` |
| `dist/web/*` | `@furnace/hello-world` | Bundled demo site | No — deployable showcase only |
| `dist/wasm/*` (future) | `@furnace/core` | Compiled wasm modules + their JS loaders | Yes — in `@furnace/core` itself |
| Consumer's `dist/<platform>/` | Consumer | Shippable native artifact (`.app`, `.ipa`, `.apk`, `.msi`, …) produced by `furnace build`. Not a furnace artifact. | No — that's the consumer's final product |
| API docs (future) | TBD | Generated reference docs | Yes — via GitHub Pages or similar |
```

- [ ] **Step 9: REPLACE §9 (Internal tooling placement) — full rewrite for Rust workspace**

Find the entire `## 9. Internal tooling placement — resolved` section. Replace with:

```markdown
## 9. Internal tooling placement — resolved

`@furnace/tools` is internally a **Rust workspace** with auxiliary JS and scaffold-template assets, not a TS package with a vendored Rust crate. Layout:

```
packages/tools/
├── package.json                 # bin: { furnace: ./shim.js }, eventually with optionalDependencies
├── shim.js                      # ~3-line plain Node JS shim that resolves + execs the binary
├── furnace                      # the built CLI binary (cargo output)
├── templates/                   # scaffold files for `furnace init`
│   ├── shared/                  # furnace.config.json.tmpl, Cargo.toml.tmpl, src-furnace/main.rs.tmpl
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
- The vendored runtime source is copied by `furnace init` into the consumer's `src-furnace/runtime/`. The consumer's `Cargo.toml` references it by `path`; the original source in `node_modules/@furnace/tools/runtime/` is read-only data files.

**Follow-up specs needed** (tracked in `.docs/BACKLOG.md`): the Runtime Contract Spec, the Plugin API Spec, the `furnace.config.json` schema, and the per-platform binary packages migration (biome's pattern at platform #2). All are deferred from the design spec; each warrants its own session.
```

- [ ] **Step 10: Verify the full file is well-formed**

Run: `cat .docs/packaging-and-distribution.md | head -3` — confirm header is intact.

Read the full file. Sanity-check:
- All nine sections are present in order (§1 through §9, plus See also footer).
- No leftover prose from the old §6 (the rejected `esbuild`/`swc`/`sharp` framing).
- The "See also" footer at the bottom is unchanged (still references no-bun-leakage test correctly).
- No markdown syntax errors (unclosed code fences, broken tables).

- [ ] **Step 11: Commit**

```bash
git add .docs/packaging-and-distribution.md
git commit -m "$(cat <<'EOF'
docs(packaging): rewrite for Tauri-style native shell architecture

Aligns packaging-and-distribution.md with the native-shell distribution
design (2e0f86c). Substantive changes:

- §1: collapses Today/Imminent split; tools is now a real workspace package
- §2: tools is internally a Rust workspace; foundational rule unchanged
- §3: clarifies furnace-runtime is vendored not separately published
- §4: desktop consumer flow rewritten — CLI orchestrates build, not just spawn
- §6: full rewrite — Tauri 2 archetype, biome-style CLI distribution; explicitly
  rejects the previous optionalDeps-for-runtime plan with cited precedent
- §7: cross-compilation reframed for consumer-side builds, not publish matrix
- §8: artefact table reflects vendored-runtime model
- §9: internal layout rewritten for Rust workspace

The design spec at docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md
remains the source of truth for rationale and alternatives considered.
EOF
)"
```

- [ ] **Step 12: Verify clean commit**

Run: `git log --oneline -3`
Expected: most recent commit is "docs(packaging): rewrite for Tauri-style..."

Run: `git status --short`
Expected: `.docs/packaging-and-distribution.md` no longer modified; only `.claude/CLAUDE.md` (and pre-existing unmodified-by-me files) still pending.

---

## Task 4: Update entry-point docs (CLAUDE.md, AGENTS.md, READMEs)

Goal: bring the agent-facing and user-facing entry-point docs into alignment with the new design. These docs reference the packaging doc (just rewritten in Task 3); cross-references should point to the right concepts.

**Files:**
- Modify: `.claude/CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `README.md` (root)
- Modify: `packages/tools/README.md`
- Modify: `packages/core/README.md` (minor — already mostly correct)

### Sub-task 4a: CLAUDE.md

- [ ] **Step 1: Update Project state — packages/tools/ description**

Find this line in `.claude/CLAUDE.md`:
```markdown
- `packages/tools/` (`@furnace/tools`, private) — the harness. Owns the Rust `winit + wry` native launcher (`native/`), internal build helpers (`src/internal/`), and the public `furnace` CLI (`src/public/cli.ts`). The only package in the workspace that produces a binary.
```

Replace with:
```markdown
- `packages/tools/` (`@furnace/tools`, private) — the harness. Internally a Rust workspace (`crates/furnace-cli/` for the CLI binary, `crates/furnace-runtime/` for the shell consumers vendor) plus scaffold templates and a tiny plain-Node JS shim that wraps the binary for npm distribution (biome's pattern). The only package in the workspace that produces a binary. See `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md` for the architecture.
```

- [ ] **Step 2: Update "What we ship to consumers" — @furnace/tools entry**

Find this line in `.claude/CLAUDE.md`:
```markdown
- **`@furnace/tools`** — plain ESM JavaScript + `.d.ts` declarations + a `bin` entry. Must run on **plain Node ≥20**. No Bun APIs in shipped code. Internal source can use Bun freely; the build step is responsible for transpiling to Node-compatible output before publishing. Compiled from TypeScript at publish time.
```

Replace with:
```markdown
- **`@furnace/tools`** — a Rust CLI binary (`furnace`) distributed via npm using a biome-style pattern: tiny plain-Node JS shim + the binary as a sibling file (today, single package) or per-platform `optionalDependencies` (future, when furnace ships a second platform). The shim must run on **plain Node ≥20**. The CLI binary has its own per-OS/arch builds. Internal source is mostly Rust (Cargo workspace); the JS shim has no Bun APIs and no runtime dependencies. Consumers invoke via `npx furnace …` or `bunx furnace …`.
```

- [ ] **Step 3: Update "Native shell binary" line under "What we ship to consumers"**

Find:
```markdown
- **Native shell binary** — distribution model is open; see `.docs/packaging-and-distribution.md`.
```

Replace with:
```markdown
- **Native shell binary** — does NOT ship from furnace. The shell is `furnace-runtime` source vendored into the consumer's repo by `furnace init`; it compiles into the consumer's final native artifact (`.app`, `.ipa`, etc.) at *their* build time, not ours. See `.docs/packaging-and-distribution.md` §6.
```

- [ ] **Step 4: Verify CLAUDE.md is consistent**

Read the file. Sanity-check:
- "What we ship to consumers" section now correctly describes tools as a Rust binary via shim.
- "How we build internally" section is unchanged (still about Bun for the JS workspace orchestration).
- "Internal-only Bun APIs" section is unchanged.
- "Project state" section reflects the three-package layout including the new tools description.

### Sub-task 4b: AGENTS.md

- [ ] **Step 5: Update workspace TL;DR line**

Find this line in `AGENTS.md`:
```markdown
- **Workspace:** monorepo via Bun workspaces — three packages live in `packages/*`: `@furnace/core` (engine library), `@furnace/tools` (harness + CLI + native launcher), `@furnace/hello-world` (reference consumer). Only `@furnace/tools` produces binaries. Run package scripts via `bun run --cwd packages/<name> <script>`.
```

Replace with:
```markdown
- **Workspace:** monorepo via Bun workspaces — three packages live in `packages/*`: `@furnace/core` (browser-only engine library, TS source), `@furnace/tools` (Rust workspace with the `furnace` CLI + the vendored runtime crate consumers embed; JS shim wraps the binary for npm), `@furnace/hello-world` (reference consumer). Only `@furnace/tools` produces binaries. Run package scripts via `bun run --cwd packages/<name> <script>`.
```

- [ ] **Step 6: Add native-shell design spec to canonical references**

Find the `## Canonical references` section in `AGENTS.md`. Add a new bullet AFTER the `docs/superpowers/specs/` line and BEFORE the `docs/superpowers/plans/` line:

Find:
```markdown
- `docs/superpowers/specs/` — design specs for major changes.
- `docs/superpowers/plans/` — implementation plans for major changes.
```

Replace with:
```markdown
- `docs/superpowers/specs/` — design specs for major changes. **Native shell distribution: `2026-05-19-native-shell-distribution-design.md`** is currently the load-bearing design for tooling/runtime work.
- `docs/superpowers/plans/` — implementation plans for major changes.
```

### Sub-task 4c: Root README.md

- [ ] **Step 7: Update packages/tools/ Layout description**

Find this line in `README.md`:
```markdown
- `packages/tools/` — tooling and the native launcher (`@furnace/tools`). Owns the Rust crate (`winit` + `wry`) and the `furnace` CLI. Only package that produces a binary.
```

Replace with:
```markdown
- `packages/tools/` — tooling, the `furnace` CLI, and the shell runtime (`@furnace/tools`). Internally a Rust workspace (CLI binary + runtime crate that consumers vendor into their apps) plus scaffold templates and a JS shim. Only package that produces a binary. See `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md`.
```

### Sub-task 4d: packages/tools/README.md

- [ ] **Step 8: Rewrite packages/tools/README.md**

The current content describes an internal/public TS surface that no longer matches the new design. Replace the entire file content with:

```markdown
# @furnace/tools

The `furnace` CLI and the runtime shell for the furnace engine.

## What this package is

A Rust workspace shipped via npm:

- `crates/furnace-cli/` — the `furnace` command-line tool (init, build, dev, wasm, upgrade-runtime).
- `crates/furnace-runtime/` — the Rust shell that consumers vendor into their apps on `furnace init`. Wraps `wry` + `winit`, implements the Runtime Contract that the JS engine layer talks to.
- `templates/` — scaffold files for `furnace init`.
- `shim.js` — tiny plain-Node JS that resolves and execs the right per-platform binary (biome's distribution pattern). Lets consumers invoke via `npx furnace` / `bunx furnace`.

## Consumer surface

- `furnace` (bin) — public CLI. Today supports the legacy `furnace native [--rebuild]` (used by hello-world's `dev:native`); the design spec lays out the eventual full command surface (`init`, `build`, `dev`, `wasm`, `upgrade-runtime`).

This is the only package in the workspace that produces a binary.

## Design

See `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md` for the architecture (Tauri 2-style shell, wasm plugins, runtime contract). See `.docs/packaging-and-distribution.md` §6 for the distribution model summary.
```

### Sub-task 4e: packages/core/README.md

- [ ] **Step 9: Update Consumer portability section to reflect compiled-JS shipping**

Find this paragraph in `packages/core/README.md`:
```markdown
`@furnace/core` ships TypeScript source and `.d.ts` declarations. Use any bundler that consumes ESM + TS (Vite, webpack, esbuild, Bun's own bundler, etc.). The public surface uses only web-platform APIs; the `no-bun-leakage` test enforces this.
```

Replace with:
```markdown
`@furnace/core` ships compiled ESM JavaScript and `.d.ts` declarations. Use any modern bundler (Vite, webpack, esbuild, Bun, Rollup) — its public surface uses only web-platform APIs (no Bun APIs, no Node APIs, no `process.*` reads), targeting the browser. The `no-bun-leakage` test is one static guardrail; the full consumer contract lives in `.claude/CLAUDE.md` "What we ship to consumers."
```

### Verification + commit

- [ ] **Step 10: Verify all entry-point docs are consistent**

Spot-check:
- `.claude/CLAUDE.md`: tools described as Rust binary + shim; "What we ship" section internally consistent.
- `AGENTS.md`: workspace bullet mentions Rust workspace; design spec is in canonical references.
- `README.md` (root): packages/tools/ description matches new design.
- `packages/tools/README.md`: describes Rust workspace + CLI + runtime + shim.
- `packages/core/README.md`: ships compiled JS, browser-only.

- [ ] **Step 11: Run repo checks to confirm no regressions**

Run: `bun run check`
Expected: PASS (biome lint). No errors from doc edits.

Run: `bunx tsc --noEmit`
Expected: PASS. No TS errors (doc edits don't affect TS).

Run: `bun test packages/core/tests/no-bun-leakage.test.ts`
Expected:
```
 1 pass
 0 fail
```

- [ ] **Step 12: Commit all entry-point doc updates as one commit**

```bash
git add .claude/CLAUDE.md AGENTS.md README.md packages/tools/README.md packages/core/README.md
git commit -m "$(cat <<'EOF'
docs: update CLAUDE.md, AGENTS.md, READMEs for native shell design

Aligns the entry-point docs with the native shell distribution design.
- CLAUDE.md: revises tools description (Rust binary via npm shim, not plain
  Node ESM); clarifies native shell binary doesn't ship from furnace
- AGENTS.md: refreshes workspace TL;DR; adds design spec to canonical refs
- README.md (root): updates packages/tools/ layout description
- packages/tools/README.md: full rewrite — Rust workspace + CLI + runtime + shim
- packages/core/README.md: corrects "ships TS source" to "compiled ESM JS"
  to match the actual shipping contract
EOF
)"
```

- [ ] **Step 13: Final verification — clean working tree**

Run: `git status --short`
Expected: only pre-existing repo state remains modified (e.g., `.cargo/config.toml` and `packages/hello-world/tests/triangle-shader.test.ts` from session start — both NOT mine, both leave alone).

Run: `git log --oneline -6`
Expected (most recent first):
```
<hash> docs: update CLAUDE.md, AGENTS.md, READMEs for native shell design
<hash> docs(packaging): rewrite for Tauri-style native shell architecture
<hash> docs(backlog): promote deferred items from native-shell design spec
<hash> test(core): widen no-bun-leakage scan to src/**/*.ts
<hash> docs(research): survey artifacts grounding native-shell distribution design
2e0f86c docs(spec): native shell distribution design
```

If the log differs (extra commits, missing commits, wrong order), STOP and investigate.

---

## Done state

After this plan completes:

- The design spec from this session is committed (already done at start: `2e0f86c`).
- Research artifacts are committed.
- The no-bun-leakage test glob improvement is committed.
- `.docs/BACKLOG.md` has the deferred items captured with triggers.
- `.docs/packaging-and-distribution.md` reflects the new architecture across all nine sections.
- `.claude/CLAUDE.md`, `AGENTS.md`, root `README.md`, `packages/tools/README.md`, and `packages/core/README.md` all reflect the new architecture and cross-reference the design spec.
- Working tree is clean of furnace-design-derived changes; only pre-existing modifications (`.cargo/config.toml`, deleted test) remain.

Subsequent work (not in this plan):
- The first implementation milestone (end-to-end macOS) — a separate session and a separate implementation plan.
- The deferred specs in BACKLOG (Runtime Contract Spec, Plugin API Spec, etc.) — each its own session when triggered.
