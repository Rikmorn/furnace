# Packaging and Distribution

The working model for how furnace is structured, what gets built, and what gets published. Established during the 2026-05-18 build-tooling brainstorm.

Status: working model — refine as concrete decisions land. Open questions are flagged explicitly.

## 1. Workspace layout

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

## 2. The engine/harness principle

This is the foundational rule that governs everything else:

> **Only `@furnace/tools` produces binaries. Everything else is TypeScript or wasm.**

Mapping that to packages:

- **`@furnace/core` — engine.** TS source. Future Rust crates that compile to **wasm** (transforms, audio — Shallot pattern §3) live here, because their output is imported by the engine code itself. No native binaries, no platform-aware code, no `process.platform` reads. Pure consumer-portable runtime.
- **`@furnace/tools` — harness.** Owns the launcher (`furnace-window` Rust crate that opens a wry window and hosts the engine), the CLI that spawns it, and the per-platform binary distribution mechanics. Anything that *launches* furnace rather than running *inside* it lives here.
- **`@furnace/hello-world` — reference consumer.** Demonstrates the third-party consumer experience. Uses `@furnace/tools`'s CLI for native dev, just as an external consumer would.

The rule is what keeps `@furnace/core` honest: web-only consumers never download a binary, never pay for Rust tooling, never see Bun-coupled code. `packages/core/tests/no-bun-leakage.test.ts` is the runtime enforcement.

## 3. What gets published vs not

| Package | Published to npm? | Purpose |
|---|---|---|
| `@furnace/core` | Yes (eventually) | Engine library. TS source + future wasm modules. Required for any furnace consumer. |
| `@furnace/tools` | Yes (eventually) | Harness library + CLI. Required by consumers using the desktop runtime. |
| `@furnace/tools-<os>-<arch>` (future) | Yes (eventually) | Per-platform native binary subpackages. Pulled in via `optionalDependencies` of `@furnace/tools`. |
| `@furnace/hello-world` | No | Internal demo. Its build output may be deployed as a showcase site, but it's not a library. |

## 4. What consumers receive

There are two install paths, picked by the consumer based on what they're building:

**Web-only consumer** (browser game, web demo, embedded WebGPU surface):

```bash
npm install @furnace/core
```

They get:

- TypeScript source from `packages/core/src/**` (their own bundler compiles it).
- TypeScript declarations (`.d.ts`).
- *(Future)* Wasm modules + their JS loaders, for hot-path code compiled from Rust.

No native binary, no Rust toolchain pulled in, no Bun. They use whatever bundler they prefer (Vite, webpack, Bun's own, esbuild, etc.).

**Desktop consumer** (also wants the native runtime):

```bash
npm install @furnace/core @furnace/tools
```

They additionally get:

- The platform-matching native binary, installed automatically via `optionalDependencies` of `@furnace/tools`.
- The `furnace` CLI (provided by `@furnace/tools`'s `bin` entry), used to launch the desktop runtime.

In both paths, consumers **do not** receive: our internal build scripts, our dev server (`serve.ts`), our bundler config. They are free to use any toolchain they like; `@furnace/tools`'s consumer surface is library-style helpers + a CLI, not a workspace orchestrator.

## 5. Bun's role

Bun does three internal jobs, none of which are consumer-facing:

1. **Dev server + HMR + on-the-fly bundling** — `bun --hot serve.ts`. The daily dev loop. Bun resolves and bundles the import graph from the HTML entry on every request, with hot reload.
2. **Static bundler for hello-world** — `bun build index.html …`. Walks the same import graph but emits static files to disk. Produces a deployable demo artefact, not a library.
3. **Script runtime** — runs build orchestration, tests, internal scripts.

Bun does not appear in the dependency tree consumers see. They pick whichever bundler they prefer and point it at `@furnace/core`'s TS source.

## 6. Native binary distribution

Standard industry pattern (`esbuild`, `swc`, `sharp`, `lefthook`, `rollup`): pre-compile binaries on our side, publish them as per-platform subpackages, use `optionalDependencies` on the umbrella so each consumer only downloads the one matching their platform.

For furnace, the umbrella is **`@furnace/tools`**, not `@furnace/core`:

| Platform | Subpackage | Status |
|---|---|---|
| macOS Apple Silicon | `@furnace/tools-darwin-arm64` | Primary target |
| Windows x64 | `@furnace/tools-win32-x64` | Planned |
| macOS Intel | `@furnace/tools-darwin-x64` | If/when we target Intel Macs |
| Linux x64 | `@furnace/tools-linux-x64` | Deferred — see BACKLOG.md "Linux / cef support" |

`@furnace/tools` (the umbrella) lists the platform subpackages as `optionalDependencies`. A small **runtime resolver** inside `@furnace/tools` picks the right subpackage at load time, based on `process.platform` + `process.arch`, and the CLI uses it to locate the binary to spawn.

The resolver and the per-platform subpackage mechanics are deferred to a follow-up spec — see §9. For now, the main `@furnace/tools` package will exist with the launcher binary built locally for the host platform; per-platform distribution is on the roadmap, not in this iteration.

**Rejected: compile-at-install** (running cargo via a `postinstall` hook on the consumer's machine). Requires consumers to have a Rust toolchain, is slow, and is fragile on Windows. The whole point of pre-compiled binaries is to spare consumers the toolchain requirement.

## 7. Cross-compilation reality

`wry` + `winit` desktop binaries can't be cross-compiled cleanly from a single host — each target needs its platform-native WebView (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux). In practice:

- **Local dev:** a developer builds only their own platform's binary. No cross-compilation expected day-to-day.
- **Publish-time:** a CI matrix runs one build job per target on a host that supports it, then a single publish job pulls artefacts together and publishes the umbrella + subpackages.

The build tool's `--target` flag (if/when we add one) therefore means "build *this* target on a host that supports it," not "build all targets in one shot." Today there is no CI matrix and we only build for the host platform.

## 8. Build artefacts

| Artefact location | Owner package | What it is | Shipped to consumers? |
|---|---|---|---|
| `dist/core/` | `@furnace/core` | Publish-ready layout: TS source + `.d.ts` + manifest | Yes |
| `dist/tools/` | `@furnace/tools` | Publish-ready layout: TS source + `.d.ts` + manifest + CLI entry | Yes |
| `dist/native/furnace-window[.exe]` | `@furnace/tools` | Native runtime binary (host platform only, today) | Eventually — via per-platform subpackages |
| `dist/web/*` | `@furnace/hello-world` | Bundled demo site | No — deployable showcase only |
| `dist/wasm/*` (future) | `@furnace/core` | Compiled wasm modules + their JS loaders | Yes — in `@furnace/core` itself |
| API docs (future) | TBD | Generated reference docs | Yes — via GitHub Pages or similar |

Each artefact has a single owning package. That ownership determines which package's `files` array lists it and which subpackage publishes it.

## 9. Internal tooling placement — resolved

The build-tooling brainstorm settled this: tooling lives in a new private workspace package, **`packages/tools` (`@furnace/tools`)**. The package has two source areas:

- `src/internal/` — helpers used by our own build scripts (Rust compile orchestration, publish-layout staging, etc.). Not exposed in the package's published `exports` map.
- `src/public/` — future consumer-facing surface: the `furnace` CLI, dev-server helpers, build plugins. Empty in the initial cut; populated incrementally as consumer use cases land.

The placement constraint — "a published package must not pull internal tooling at install or runtime time" — is satisfied because:

- `@furnace/core` does not depend on `@furnace/tools`. A web-only consumer never installs tools.
- When `@furnace/tools` is published, only its `src/public/**` is exposed; the `src/internal/**` paths are excluded from the package via the `exports` map and the published `files` array.

**Follow-up spec needed (not in this iteration):** the per-platform native subpackages (`@furnace/tools-<os>-<arch>`), the runtime resolver inside `@furnace/tools/public`, and the `furnace native` / `furnace dev` CLI commands. The current iteration produces only the host-platform binary at `dist/native/`, used by hello-world for native dev.

---

**See also:**

- `.docs/shallot-and-game-engine-architecture.md` — engine architecture notes (Shallot reference, ECS, WebGPU, wasm strategy)
- `.docs/BACKLOG.md` — deferred work register, including the "Build system revisit" entry that triggered this conversation
- `packages/core/tests/no-bun-leakage.test.ts` — runtime enforcement that the public surface stays consumer-portable
