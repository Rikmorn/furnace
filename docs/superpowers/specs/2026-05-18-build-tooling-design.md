# Build Tooling — Design Spec

**Date:** 2026-05-18
**Status:** Drafted (pending user review)
**Builds on:** [`2026-05-18-hello-world-package-split-design.md`](./2026-05-18-hello-world-package-split-design.md)
**Reference:** [`.docs/packaging-and-distribution.md`](../../../.docs/packaging-and-distribution.md), [`.docs/BACKLOG.md`](../../../.docs/BACKLOG.md) "Build system revisit"

## Summary

Restructure furnace's build tooling so each package owns its own build, the Rust launcher binary moves out of `@furnace/core`, and a new `@furnace/tools` workspace package becomes the home for both internal build helpers and a future consumer-facing CLI. Fix the native dev UX bug (stray Bun-child terminal output) along the way.

The driving principle, captured in the packaging doc: **only `@furnace/tools` produces binaries; everything else is TypeScript or wasm.** `@furnace/core` becomes purely engine code (TS + future wasm hot-path crates), and the launcher belongs with the tooling that invokes it.

This is the first piece of work that prepares furnace for eventual npm publishing. It stages a publish-ready layout for `@furnace/core` so the publish step is no longer speculative. Per-platform native subpackages and the runtime resolver are explicitly deferred to a follow-up spec.

## Goals

- **Engine/harness separation.** `packages/core/native/` (Rust launcher crate) moves to `packages/tools/native/`. `@furnace/core` becomes free of native code and process-spawning.
- **New `@furnace/tools` package** with two source surfaces:
  - `src/internal/` — helpers used by our own build scripts (cargo orchestration, publish staging, etc.).
  - `src/public/` — a minimal CLI today (`furnace native`), seeded for future growth.
- **Per-package build ownership.** Each package decides how it builds. `packages/core/scripts/build.ts` and `packages/tools/scripts/build.ts` replace the inline `cargo build && cp` strings in today's root scripts. `packages/hello-world` keeps its build inline in `package.json` (one-liner principle).
- **Publish-ready layout for `@furnace/core`.** Core's build stages `dist/core/` with TS source, emitted `.d.ts` declarations, a synthesised publish-ready `package.json`, and a README + LICENSE. Verifiable by visual inspection of `npm pack --dry-run` output.
- **Native dev UX fix.** Eliminate the stray terminal output / window that `bun run dev:native` currently produces. The Bun child spawned by the launcher should not leak stdio into the parent terminal.
- **Hello-world dogfoods the consumer CLI.** `packages/hello-world/`'s `dev:native` invokes `furnace native` (the CLI in `@furnace/tools`) rather than spawning the binary by raw path. Keeps hello-world honest as our reference consumer.
- **Dev/prod distinction for hello-world's web build.** Add an unminified `build:web:dev` variant alongside the existing minified `build:web` for bundle inspection.

## Non-goals

- **Per-platform native subpackages** (`@furnace/tools-darwin-arm64`, etc.). Deferred to a follow-up spec. Today's build produces only the host-platform binary at `dist/native/`.
- **Runtime resolver for per-platform binaries.** Belongs in `@furnace/tools/src/public/` once subpackages exist. Today the CLI uses the host-platform binary via a workspace-local path.
- **CI matrix for cross-platform builds.** No CI configured yet. Tracked in BACKLOG ("GitHub Actions CI").
- **Actual `npm publish` step.** We stage the publish layout but don't publish. Verification is `npm pack --dry-run` output, eyeballed.
- **Versioning policy** beyond "subpackages match the umbrella's version." No release process, no changelog automation, no semver discipline in this spec.
- **`furnace dev` CLI command.** Out of scope. Hello-world's web dev (`bun --hot serve.ts`) is already minimal and direct. A unified `furnace dev` only pays for itself when there are multiple consumers and consistent entry points matter.
- **WGSL hot reload, wasm crate builds, doc generation.** All deferred; tracked in BACKLOG. The build-script architecture should *accommodate* them later (extend `@furnace/tools/internal` with new helpers), not implement them now.
- **Bundling `@furnace/core` to JS at publish time.** Core ships TS source per the packaging doc; consumer bundlers compile it.

## Architecture

### Workspace structure

```
packages/
  core/                                    ← engine library, no native code
    src/                                   (unchanged — TS engine)
    tests/                                 (unchanged)
    scripts/
      build.ts                             ← NEW — stages publish layout for @furnace/core
    README.md                              ← NEW — consumer-facing description
    LICENSE                                ← NEW — TBD which license
    package.json                           (additions: scripts.build, scripts.typecheck unchanged)
    tsconfig.json                          (no change, declaration emit happens via build script)
    (no native/ dir — moved to tools)

  tools/                                   ← NEW workspace package
    src/
      internal/                            ← helpers used by our own build scripts
        index.ts
        rust.ts                            (cargo invocation helpers)
        publish.ts                         (layout staging helpers)
      public/                              ← future consumer surface
        cli.ts                             ← initial CLI: `furnace native`
    native/                                ← moved from packages/core/native/
      Cargo.toml
      src/main.rs                          (stdio-detach fix lands here)
      … (rest of crate unchanged in structure)
    scripts/
      build.ts                             ← NEW — builds native + stages publish layout
    package.json                           (private: true; "bin": { "furnace": "./src/public/cli.ts" })
    tsconfig.json
    tests/                                 (unit tests for internal helpers and CLI)

  hello-world/                             ← unchanged structure
    … (existing files)
    package.json                           (dev:native rewired to use furnace CLI;
                                            build:web:dev added)

dist/                                      (gitignored)
  core/                                    ← from packages/core/scripts/build.ts
    src/**                                 (staged TS source)
    types/**                               (emitted .d.ts)
    package.json                           (synthesised, publish-ready)
    README.md
    LICENSE
  tools/                                   ← from packages/tools/scripts/build.ts
    src/public/**                          (staged consumer surface)
    types/**                               (emitted .d.ts)
    package.json                           (synthesised, publish-ready)
    README.md
    LICENSE
  native/
    furnace-window[.exe]                   ← host-platform binary (built by tools)
  web/                                     ← from packages/hello-world/build:web
    dev/                                   ← unminified dev variant
    *                                      ← minified prod
```

### The engine/harness boundary

The split between `@furnace/core` and `@furnace/tools` follows a single rule, stated in `.docs/packaging-and-distribution.md` §2:

> **Only `@furnace/tools` produces binaries. Everything else is TypeScript or wasm.**

Concretely:

- `@furnace/core` — engine that runs *inside* the runtime. TS source. Future Rust crates that compile to **wasm** (transforms, audio per Shallot §3) live here, because the engine imports their output. No native binaries, no `process.platform` reads, no spawn calls. The `no-bun-leakage` test continues to enforce consumer portability.
- `@furnace/tools` — harness that *launches* the runtime. Owns the Rust launcher crate (the binary that opens a wry window and spawns Bun to serve the engine code). Owns the CLI that invokes the binary. Owns (eventually) the per-platform subpackage mechanics.
- `@furnace/hello-world` — reference consumer. Imports `@furnace/core` like any third party. Uses `@furnace/tools`'s CLI for native dev — proving the consumer experience.

### Internal helpers in `@furnace/tools/src/internal/`

Conceptual surface; final signatures are an implementation concern.

- **`rust.ts`** — Cargo invocation helpers.
  - `compileNativeCrate({ manifestPath, profile, outBinaryDir, binaryName })` — runs `cargo build --release`, locates the produced binary in `target/release/`, copies it to the output dir. Encapsulates today's `cp -f ../../target/release/X ../../dist/native/X` workaround for stable Rust lacking `cargo build --out-dir`.
- **`publish.ts`** — Publish-layout staging helpers.
  - `stageTypeScript({ from, to })` — copies TS source files (filtered, e.g. excluding test files).
  - `emitDeclarations({ tsconfig, outDir })` — invokes `tsc` with `--emitDeclarationOnly` to produce `.d.ts` files for the public surface.
  - `synthesisePackageJson({ workspaceManifest, outPath, transforms })` — reads the workspace's `package.json`, applies transforms (remove `private`, set `files`, set `exports` paths relative to publish root, etc.), writes the result.
  - `stageAssets({ from, to, files })` — copies files like README and LICENSE into the publish dir.

These are primitives. Higher-level orchestration (e.g., "stage everything for `@furnace/core`") lives in core's `scripts/build.ts`, not in tools — tools provides the building blocks, callers compose them.

### `@furnace/tools/src/public/cli.ts`

Minimal Bun-executable CLI. Registered via `"bin": { "furnace": "./src/public/cli.ts" }` in the package manifest. Dispatches on `process.argv[2]`:

- `furnace native [--rebuild]` — locates the host-platform binary (today: a workspace-local path; eventually: via per-platform subpackage resolver), spawns it. With `--rebuild`, runs the tools native build first. No-arg defaults to "use existing binary; error helpfully if missing."

That's the entire initial surface. Future additions (`furnace dev`, `furnace build`, project scaffolding) belong to a later spec when the use cases concretely land.

The CLI must work both as a Bun script (`bun packages/tools/src/public/cli.ts`) and via the workspace symlink (`bunx furnace` from any package, or `bun run --cwd packages/hello-world dev:native`).

### `packages/core/scripts/build.ts`

Imports from `@furnace/tools/internal` and composes the publish staging:

```ts
// Sketch — not the final implementation
import { stageTypeScript, emitDeclarations, synthesisePackageJson, stageAssets }
  from "@furnace/tools/internal";

const SRC = "src";
const OUT = "../../dist/core";

await stageTypeScript({ from: SRC, to: `${OUT}/src` });
await emitDeclarations({ tsconfig: "tsconfig.json", outDir: `${OUT}/types` });
await synthesisePackageJson({
  workspaceManifest: "package.json",
  outPath: `${OUT}/package.json`,
  transforms: {
    removePrivate: true,
    setFiles: ["src/**", "types/**"],   // README and LICENSE included implicitly by npm
    setExports: {
      ".": {
        "types": "./types/index.d.ts",
        "default": "./src/index.ts",
      },
    },
  },
});
await stageAssets({ from: ".", to: OUT, files: ["README.md", "LICENSE"] });
```

No cargo invocation. No native binary. Core is engine-only.

### `packages/tools/scripts/build.ts`

Does two things: builds the native crate, stages tools' publish layout. Supports a partial mode for `dev:native` workflows.

```ts
// Sketch
import { compileNativeCrate, stageTypeScript, emitDeclarations,
         synthesisePackageJson, stageAssets } from "@furnace/tools/internal";

const args = parseArgs(process.argv);  // very small, no library

if (args.nativeOnly) {
  await compileNativeCrate({
    manifestPath: "native/Cargo.toml",
    profile: "release",
    outBinaryDir: "../../dist/native",
    binaryName: "furnace-window",
  });
  process.exit(0);
}

// Full build: native + tools publish layout
await compileNativeCrate({ /* same as above */ });
await stageTypeScript({ from: "src/public", to: "../../dist/tools/src" });
await emitDeclarations({ /* ... */ });
await synthesisePackageJson({ /* drop private, set exports for public only, set bin */ });
await stageAssets({ /* README, LICENSE */ });
```

Note: tools' synthesised publish `package.json` exposes **only `src/public/**`** in `files` and `exports`. `src/internal/**` is workspace-only — it never reaches consumers.

### Hello-world rewiring

Only two scripts in `packages/hello-world/package.json` change:

```diff
-  "dev:native": "bun run --cwd ../core build:native && ../../dist/native/furnace-window",
+  "dev:native": "bun run --cwd ../tools build:native && bunx furnace native",
   "build:web": "bun build index.html --outdir ../../dist/web --minify --sourcemap=external",
+  "build:web:dev": "bun build index.html --outdir ../../dist/web/dev --sourcemap=inline",
```

`dev:native` now dogfoods the tools CLI. The web dev server (`bun --hot serve.ts`) is unchanged.

### Native dev UX fix

**The symptom:** when running `bun run dev:native`, the user sees the launcher window AND stray "PORT=8765\nServing at …" output bleeding through, suggesting either stdio leakage or a second window appearing.

**Investigation step (first task of the native fix):** read `packages/core/native/src/main.rs` (after move, `packages/tools/native/src/main.rs`) to identify where the Bun child is spawned. The current `dev:native` chain is:

1. User runs `bun run dev:native` from terminal.
2. Cargo builds + binary is invoked.
3. The Rust binary calls something like `Command::new("bun").arg("serve.ts").spawn()`.
4. That child's stdio is inherited from the Rust process, which is inherited from the parent terminal.
5. `serve.ts`'s `console.log("PORT=…")` lands in the user's terminal.

**The fix:** configure the Bun child's stdio explicitly. Default behaviour for `dev:native` should be `Stdio::null()` for stdout/stderr — drop the output entirely. If diagnostics are needed, gate verbose mode behind an env var (e.g., `FURNACE_VERBOSE=1` → `Stdio::piped()` with capture to a log file at `~/.furnace/last-run.log` or similar).

**Verification:** `bun run dev:native` shows only the launcher window; the terminal that ran the command produces no Bun-child output and stays clean for subsequent input.

If the symptom turns out to be a separate Terminal.app window appearing (not just stdio leakage), the fix involves making the binary a proper macOS `.app` bundle. Plan for the simpler case first; escalate if investigation reveals otherwise.

### Root `package.json` final state

```jsonc
{
  "scripts": {
    "dev:web":        "bun run --cwd packages/hello-world dev",
    "dev:native":     "bun run --cwd packages/hello-world dev:native",
    "build":          "bun run build:core && bun run build:tools && bun run build:web",
    "build:core":     "bun run --cwd packages/core build",
    "build:tools":    "bun run --cwd packages/tools build",
    "build:web":      "bun run --cwd packages/hello-world build:web",
    "build:web:dev":  "bun run --cwd packages/hello-world build:web:dev",
    "typecheck":      "bun run --cwd packages/core typecheck && bun run --cwd packages/tools typecheck && bun run --cwd packages/hello-world typecheck",
    "test":           "bun test",
    "check":          "biome check",
    "clean":          "rm -rf dist target"
  }
}
```

Notable: `build:native` is gone from the root — natives are built by tools' build script. Use `bun run --cwd packages/tools build:native` if you need only the binary (without staging publish layout).

## Migration steps (suggested order)

The implementation plan will refine this, but the design supports this order:

1. **Create `packages/tools/` skeleton.** Empty `src/internal/`, empty `src/public/`, `package.json`, `tsconfig.json`. Add to workspace; verify `bun install` links it. No behaviour change yet.
2. **Move the Rust crate.** `packages/core/native/` → `packages/tools/native/`. There is no workspace-level `Cargo.toml` today; the only Cargo manifest is the crate's own, so the move is mostly `mv` + updating any `CARGO_MANIFEST_DIR`-relative paths inside the crate's source. Update root scripts temporarily (still inline) to point at the new location. Verify `dev:native` still works end-to-end before further changes.
3. **Native dev UX fix.** Patch the Bun-child stdio in the moved crate. Verify clean terminal on `dev:native`.
4. **Populate `@furnace/tools/src/internal/`.** Implement `rust.ts` and `publish.ts` helpers. Add unit tests for the publish helpers (the rust one is integration-flavoured; light test or none).
5. **Implement the minimal CLI.** `packages/tools/src/public/cli.ts` with the `native` subcommand. Add `bin` entry to tools' package.json. Verify `bunx furnace native` works from hello-world's dir.
6. **Add `packages/tools/scripts/build.ts`.** Native build + tools publish staging. Update root scripts to use it.
7. **Add `packages/core/scripts/build.ts`.** Core publish staging. Add README + LICENSE to core. Update root scripts to use it.
8. **Rewire `packages/hello-world/`.** Change `dev:native` to use `bunx furnace native`. Add `build:web:dev`. Verify both web and native dev paths still work.
9. **Update root `package.json` scripts** to the final state above.
10. **Verify with `npm pack --dry-run`** for both `dist/core/` and `dist/tools/`. Eyeball the included file lists; adjust `files` / `exports` if anything looks wrong.
11. **Update documentation to reflect the new reality.** Specifically:
    - `.claude/CLAUDE.md` — update the "Project state" section: add `@furnace/tools`, state the engine/harness principle, point at the new packaging doc.
    - `AGENTS.md` — refresh the "Workspace" bullet so the three-package layout is visible at a glance; add a link to `.docs/packaging-and-distribution.md` under "Canonical references."
    - `README.md` — quick pass to ensure any structure description matches reality.
    - `.docs/BACKLOG.md` — remove the "Build system revisit" entry (this spec resolves it) and verify the "Robust child-process cleanup on Rust panic" and "Native window: focus/activation triggers server respawn" entries still apply (likely yes; this spec only fixes the stdio-leakage symptom, not those deeper issues).

Steps 1–3 are the riskiest because they touch the Rust side. Doing them first and verifying `dev:native` before any TS-side restructuring keeps blast radius small if something breaks.

## Verification

The spec is delivered when all of the following hold:

- `bun install` succeeds; `packages/tools/` is linked into the workspace.
- `bun run dev:web` works as before (no regression).
- `bun run dev:native` works AND the terminal stays free of stray Bun-child output. Only the launcher window appears.
- `bun run typecheck` passes for all three packages.
- `bun test` passes (existing tests + any new ones for the internal helpers).
- `bun run check` (biome) passes.
- `bun run build:core` produces `dist/core/` with TS source, `.d.ts`, synthesised `package.json`, README, LICENSE.
- `bun run build:tools` produces `dist/tools/` (publish layout) and `dist/native/furnace-window` (host-platform binary).
- `bun run build:web` and `bun run build:web:dev` both produce expected outputs to `dist/web/` and `dist/web/dev/`.
- `npm pack --dry-run` in `dist/core/` and `dist/tools/` lists only the intended files (no `src/internal/**` in tools, no test files in either, no source maps if not wanted).
- `packages/core/tests/no-bun-leakage.test.ts` still passes (core stays consumer-portable).
- `bunx furnace native` from anywhere in the workspace launches the binary.
- `.claude/CLAUDE.md`, `AGENTS.md`, `README.md`, and `.docs/BACKLOG.md` all reflect the new three-package layout and the engine/harness principle; the "Build system revisit" backlog entry is removed.

## Risks and open questions

- **The terminal-flash symptom may not be pure stdio leakage.** If `bun run dev:native` is opening a second OS window (Terminal.app, etc.), the fix is a macOS `.app` bundle, which is a larger change. **Mitigation:** investigation in step 3 of migration; escalate if the simpler fix doesn't address the observed behaviour.
- **`bunx furnace` resolution across packages.** Workspace symlinks should make `furnace` available in `node_modules/.bin/` for every package. Untested specifically for this layout. **Mitigation:** verify in step 5 of migration; fall back to `bun run --cwd packages/tools furnace -- native` if needed.
- **`.d.ts` emission via `tsc --emitDeclarationOnly`.** Today both `tsconfig.json` files use `noEmit: true`. The build script needs a separate tsconfig (or runtime override) for declaration emission. **Mitigation:** spec leaves this to the implementer — likely a `tsconfig.build.json` per package extending the base.
- **License choice.** Adding LICENSE files requires picking a license. Not a design decision in this spec; user picks at implementation time. MIT is the default unless specified otherwise.
- **READMEs are placeholder-quality at this iteration.** This spec produces the files (so the publish layout is correct), not their content. Real consumer-facing prose is a separate task.
- **Tools' `internal/` accidentally exported.** A bug in the publish manifest's `exports` map could expose internal helpers. **Mitigation:** the verification step inspects `npm pack --dry-run` output specifically for this.

## Out of scope / follow-up specs

These were considered and explicitly deferred:

- **Per-platform native subpackages** (`@furnace/tools-darwin-arm64`, etc.) and the runtime resolver. Needs CI matrix story and a real `npm publish` motivator before designing.
- **`furnace dev` CLI command.** Hello-world's `bun --hot serve.ts` is sufficient today. Revisit when there's a second example package or a clear DX win.
- **Wasm crate builds** (transforms, audio). When the first Rust hot-path crate lands in `packages/core/rust/`, extend `@furnace/tools/internal` with a `compileWasmCrate` helper.
- **Documentation generation.** TBD owner and pipeline; possibly a new helper in `@furnace/tools/internal`.
- **WGSL hot reload.** Tracked in BACKLOG ("Hot-reload for WGSL shaders").
- **CI / GitHub Actions.** Tracked in BACKLOG ("GitHub Actions CI").
- **Actual publishing.** Versioning, changelog, npm credentials, release process all unconcerned today.

When any of these arrive, the engine/harness principle and the package layout in this spec should accommodate them without restructuring: wasm helpers extend `@furnace/tools/internal`, new CLI commands extend `@furnace/tools/src/public/`, new artefacts get their own `dist/<x>/` directory with a clear owner.
