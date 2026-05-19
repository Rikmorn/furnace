# Native Shell Milestone 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Phases (1–5) are verification gates: complete and verify a phase before starting the next.

**Goal:** Deliver milestone 1 of the native-shell distribution design — end-to-end `furnace build --platform=macos` producing a clickable `.app` that boots and renders the WebGPU hello-world. Add `furnace dev`, wasm plugin pipeline, and `furnace init` scaffolding around that core.

**Architecture:** Stand up a Cargo workspace at `packages/tools/crates/` (`furnace-cli` + `furnace-runtime`). Drive native builds from the new Rust CLI; bundle JS via `bun build`; package `.app` via `cargo-packager`. The legacy `packages/tools/native/furnace-window` crate stays in place during Phases 1–2 so `dev:native` keeps working, then is retired in Phase 3 when `furnace dev` replaces it. Each phase ends in a working, verifiable state.

**Tech Stack:**
- Rust (clap 4.x for CLI, wry 0.48 + winit 0.30 for runtime — matching the legacy crate's known-working versions)
- `cargo-packager` for `.app` construction
- `wasm-pack` for Rust→wasm
- `bun build` for JS bundling (already a workspace tool)
- WebSocket-over-wry-invoke for HMR (Phase 3)
- Existing: Bun 1.3.14 workspace, biome lint, `bun test`

**Source of truth:** `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md`. When this plan and the spec disagree, the spec wins — flag the conflict and pause.

---

## Plan series — phase overview

Each phase is a self-contained, shippable milestone. Run all verification before starting the next.

| Phase | Deliverable | End-state demo |
|---|---|---|
| 1 — Foundation | Cargo workspace + minimal `furnace-runtime` + clap-skeleton `furnace-cli` + shim.js | `bunx furnace --help` works; `cargo run -p furnace-runtime -- file:///tmp/hello.html` opens a wry window |
| 2 — Build skeleton | `furnace build --platform=macos` produces a clickable `.app` | `bun run --cwd packages/hello-world build:macos` emits `dist/macos/hello-world.app` that renders the WebGPU triangle |
| 3 — Dev mode | `furnace dev --platform=macos` with HMR; legacy `furnace-window` retired | `bun run dev:native` watches sources and live-reloads the WebView |
| 4 — Wasm pipeline | `furnace wasm` standalone + automatic plugin compilation in build/dev | Hello-world has a sample `plugins/demo-wasm` Rust crate that `furnace build` embeds and `furnace dev` hot-reloads |
| 5 — Scaffolding + shim polish | `furnace init` + templates + biome-style shim ready for publish | `bunx furnace init /tmp/test-game --platform=macos` scaffolds a fresh project that builds and runs |

**Deferred (per spec):** Windows / iOS / Android implementations; the formal Runtime Contract Spec; the Plugin API Spec; the `furnace.config.json` schema spec; per-platform CLI binary packages (biome's migration). Each has its own BACKLOG entry; each gets its own future plan.

**Open implementation details (resolved here):**
- JS bundler: `bun build` (already a workspace tool; mature; trivial swap later)
- Rust→wasm: `wasm-pack` (most mature; widest ecosystem support)
- Rust-side packaging: `cargo-packager` (actively maintained by the Tauri team; designed for cross-platform native packaging)
- HMR protocol: WebSocket bridge with wry's invoke channel proxying messages to JS

---

## Pre-flight (one-time before Phase 1)

- [ ] **Confirm working tree is clean.**

```bash
git status --short
```

Expected: only pre-existing modifications (`.cargo/config.toml` M, `packages/hello-world/tests/triangle-shader.test.ts` D) — both NOT to be touched by this plan.

- [ ] **Install Rust toolchain prerequisites.**

```bash
rustup target add aarch64-apple-darwin
cargo install cargo-packager --locked
cargo install wasm-pack --locked
```

Expected: each command exits 0. `cargo packager --version` and `wasm-pack --version` should print.

- [ ] **Confirm the design spec and BACKLOG entries this plan implements are committed.**

```bash
git log --oneline 2e0f86c~1..HEAD -- docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md .docs/BACKLOG.md
```

Expected: spec commit `2e0f86c` and BACKLOG-update commit `3efa946` are both present.

---

## Phase 1 — Foundation

**Goal:** Stand up the Cargo workspace and the bare minimum runtime + CLI so that subsequent phases have a place to add code. No new consumer-facing functionality yet; legacy `dev:native` still uses the old `furnace-window` crate.

**End-state:**
- `packages/tools/crates/Cargo.toml` is a Cargo workspace with `furnace-cli` and `furnace-runtime` members.
- `cargo run -p furnace-runtime -- file:///tmp/hello.html` opens a 1280×720 wry window loading the URL.
- `cargo run -p furnace-cli -- --help` prints clap-generated help listing `build`, `dev`, `wasm`, `init`, `upgrade-runtime` (commands not yet functional except `--help`).
- `packages/tools/shim.js` is a 3-line Node script that execs the binary.
- `packages/tools/package.json` `bin.furnace` points at `./shim.js` (the new path); the old TS CLI is still importable but no longer the bin entry.
- Repo-wide tests pass (`bun test`, `bunx tsc --noEmit`, `cargo build` from the new workspace).

### Task 1.1: Cargo workspace skeleton

**Files:**
- Create: `packages/tools/crates/Cargo.toml` (workspace root)
- Create: `packages/tools/crates/furnace-cli/Cargo.toml`
- Create: `packages/tools/crates/furnace-cli/src/main.rs`
- Create: `packages/tools/crates/furnace-runtime/Cargo.toml`
- Create: `packages/tools/crates/furnace-runtime/src/lib.rs`

- [ ] **Step 1: Create workspace root manifest.**

Write `packages/tools/crates/Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["furnace-cli", "furnace-runtime"]

[workspace.package]
version = "0.0.0"
edition = "2021"
publish = false
license = "MIT"

[workspace.dependencies]
anyhow = "1"
clap = { version = "4", features = ["derive"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
winit = "0.30"
wry = "0.48"
```

- [ ] **Step 2: Create `furnace-runtime` crate manifest and lib.**

Write `packages/tools/crates/furnace-runtime/Cargo.toml`:

```toml
[package]
name = "furnace-runtime"
version.workspace = true
edition.workspace = true
publish.workspace = true
license.workspace = true

[lib]
crate-type = ["lib"]

[dependencies]
anyhow.workspace = true
winit.workspace = true
wry.workspace = true
```

Write `packages/tools/crates/furnace-runtime/src/lib.rs`:

```rust
//! furnace-runtime — the native shell that consumers vendor into their apps.
//!
//! Phase 1 surface: open a wry window pointing at a URL. Subsequent phases
//! add the Runtime Contract methods (filesystem, IPC, HMR channel).

use anyhow::{Context, Result};
use winit::{
    application::ApplicationHandler,
    dpi::LogicalSize,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, EventLoop},
    window::{Window, WindowId},
};
use wry::{WebView, WebViewBuilder};

pub struct AppConfig {
    pub title: String,
    pub width: f64,
    pub height: f64,
    pub url: String,
}

impl AppConfig {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            title: "furnace".into(),
            width: 1280.0,
            height: 720.0,
            url: url.into(),
        }
    }
}

struct AppState {
    config: AppConfig,
    window: Option<Window>,
    _webview: Option<WebView>,
}

impl ApplicationHandler for AppState {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title(&self.config.title)
            .with_inner_size(LogicalSize::new(self.config.width, self.config.height));
        let window = event_loop
            .create_window(attrs)
            .expect("failed to create window");
        let webview = WebViewBuilder::new()
            .with_url(&self.config.url)
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

pub fn run(config: AppConfig) -> Result<()> {
    let event_loop = EventLoop::new().context("failed to create event loop")?;
    let mut state = AppState {
        config,
        window: None,
        _webview: None,
    };
    event_loop
        .run_app(&mut state)
        .context("event loop failure")?;
    Ok(())
}
```

- [ ] **Step 3: Create `furnace-cli` crate manifest and main.**

Write `packages/tools/crates/furnace-cli/Cargo.toml`:

```toml
[package]
name = "furnace-cli"
version.workspace = true
edition.workspace = true
publish.workspace = true
license.workspace = true

[[bin]]
name = "furnace"
path = "src/main.rs"

[dependencies]
anyhow.workspace = true
clap.workspace = true
furnace-runtime = { path = "../furnace-runtime" }
serde.workspace = true
serde_json.workspace = true
```

Write `packages/tools/crates/furnace-cli/src/main.rs`:

```rust
//! furnace — workspace CLI.
//!
//! Phase 1 surface: clap definitions for the milestone-1 command set. Commands
//! return `Err(unimplemented)` for now; later phases fill them in.

use anyhow::{bail, Result};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "furnace", about = "Furnace engine CLI", version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Production build for a platform target.
    Build {
        #[arg(long, value_parser = ["macos"])]
        platform: String,
    },
    /// Dev session with HMR.
    Dev {
        #[arg(long, value_parser = ["macos"])]
        platform: String,
    },
    /// Compile a Rust crate to wasm.
    Wasm {
        crate_path: std::path::PathBuf,
    },
    /// Scaffold a new project (or add a platform to an existing one).
    Init {
        name: String,
        #[arg(long, value_parser = ["macos"])]
        platform: String,
    },
    /// Re-vendor the runtime source from the installed @furnace/tools.
    UpgradeRuntime,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Build { .. } => bail!("furnace build is not yet implemented (Phase 2)"),
        Command::Dev { .. } => bail!("furnace dev is not yet implemented (Phase 3)"),
        Command::Wasm { .. } => bail!("furnace wasm is not yet implemented (Phase 4)"),
        Command::Init { .. } => bail!("furnace init is not yet implemented (Phase 5)"),
        Command::UpgradeRuntime => bail!("furnace upgrade-runtime is not yet implemented (Phase 5)"),
    }
}
```

- [ ] **Step 4: Verify the workspace builds.**

```bash
cargo build --manifest-path packages/tools/crates/Cargo.toml
```

Expected: builds cleanly. Both crates compile. Output goes to `dist/rust/` (per the existing `.cargo/config.toml`).

- [ ] **Step 5: Smoke-test the runtime binary.**

Write a temporary HTML to verify the runtime opens a window:

```bash
echo '<html><body style="background:#0d0d12;color:#fff"><h1>furnace-runtime phase 1</h1></body></html>' > /tmp/furnace-phase1.html
```

Then create a tiny example to drive the runtime — write `packages/tools/crates/furnace-runtime/examples/open_url.rs`:

```rust
use furnace_runtime::{run, AppConfig};

fn main() -> anyhow::Result<()> {
    let url = std::env::args().nth(1).unwrap_or_else(|| "file:///tmp/furnace-phase1.html".into());
    run(AppConfig::new(url))
}
```

Run it:

```bash
cargo run --manifest-path packages/tools/crates/Cargo.toml --example open_url -p furnace-runtime
```

Expected: a 1280×720 window opens showing the test HTML. Close it; command exits 0.

- [ ] **Step 6: Smoke-test the CLI binary.**

```bash
cargo run --manifest-path packages/tools/crates/Cargo.toml -p furnace-cli -- --help
cargo run --manifest-path packages/tools/crates/Cargo.toml -p furnace-cli -- build --platform=macos
```

Expected: `--help` prints clap-generated help with all five subcommands. `build --platform=macos` exits with the "not yet implemented (Phase 2)" error message.

- [ ] **Step 7: Commit.**

```bash
git add packages/tools/crates/
git commit -m "$(cat <<'EOF'
feat(tools): scaffold Cargo workspace with furnace-cli and furnace-runtime

Empty CLI command surface (build, dev, wasm, init, upgrade-runtime) defined via
clap; all subcommands return "not yet implemented" with the phase they land in.
furnace-runtime exposes a single `run(AppConfig)` that opens a wry window at a
given URL — enough to verify the wry/winit stack works before piling on the
build pipeline. Legacy packages/tools/native/furnace-window crate left in place
so dev:native keeps working until Phase 3.
EOF
)"
```

### Task 1.2: Replace JS CLI shim with a Rust-binary shim

**Files:**
- Create: `packages/tools/shim.js`
- Modify: `packages/tools/package.json` (change `bin.furnace` target, drop `exports`, drop scripts that build the TS CLI)

- [ ] **Step 1: Write the shim.**

Write `packages/tools/shim.js`:

```js
#!/usr/bin/env node
// Tiny zero-dependency shim that finds and execs the furnace Rust binary.
// Phase 1: resolves to the in-repo cargo build output.
// Phase 5: extends to biome-style per-platform optionalDependencies.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const exe = process.platform === "win32" ? "furnace.exe" : "furnace";
const candidates = [
  resolve(here, exe),                                              // shipped: sibling of shim
  resolve(here, "../../dist/rust/debug", exe),                      // in-repo dev
  resolve(here, "../../dist/rust/release", exe),                    // in-repo release
];
const binary = candidates.find(existsSync);
if (!binary) {
  console.error(`furnace: binary not found. Looked in:\n  ${candidates.join("\n  ")}`);
  console.error(`Run \`cargo build --manifest-path packages/tools/crates/Cargo.toml\` first.`);
  process.exit(1);
}
const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
```

Make it executable: `chmod +x packages/tools/shim.js`.

- [ ] **Step 2: Update `packages/tools/package.json` to point `bin.furnace` at the shim.**

Edit `packages/tools/package.json` — replace `"furnace": "./src/public/cli.ts"` with `"furnace": "./shim.js"`. Keep `exports` as-is for now (internal helpers still used by tests and the legacy build script). Result:

```jsonc
{
  "name": "@furnace/tools",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./internal": "./src/internal/index.ts"
  },
  "bin": {
    "furnace": "./shim.js"
  },
  "scripts": {
    "build": "bun scripts/build.ts",
    "build:native": "bun scripts/build.ts --native-only",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  }
}
```

- [ ] **Step 3: Verify `bunx furnace` resolves to the new shim.**

```bash
cargo build --manifest-path packages/tools/crates/Cargo.toml
bunx furnace --help
```

Expected: clap-generated help printed (same as Task 1.1 Step 6, but via the shim path).

- [ ] **Step 4: Run repo-wide checks to confirm no regression.**

```bash
bun test
bunx tsc --noEmit
bun run check
```

Expected: all pass. The TS test file `packages/tools/tests/public/cli.test.ts` (if it exists) may still pass because the TS module remains importable, just not the bin entry. If it fails because the test resolves the bin path, mark the failing test as `.skip` with a comment "retired in Phase 1; new CLI tested via cargo test in furnace-cli."

- [ ] **Step 5: Verify `dev:native` (legacy path) still works.**

```bash
bun run --cwd packages/hello-world dev:native
```

Expected: legacy `furnace-window` crate launches, opens the dev window. Close it. This is the regression check that Phase 1's restructure didn't break the existing workflow.

If `dev:native` is broken because the bin entry changed, that means hello-world's `dev:native` script `bunx furnace native --rebuild` is now hitting the new Rust CLI (which doesn't have a `native` subcommand). The legacy `native` command lived in TS. Options to recover:

- **Preferred:** Temporarily teach the new Rust CLI a hidden `native` subcommand that execs the legacy `furnace-window` binary (a 10-line shim within furnace-cli). Drop it in Phase 3.
- **Alternative:** Point hello-world's `dev:native` directly at `bun packages/tools/src/public/cli.ts native --rebuild` (skip the bin entry). Restore in Phase 3.

Do the preferred option — write a `native` subcommand into furnace-cli's `main.rs` Command enum that builds `packages/tools/native/` and execs the resulting binary. The legacy crate's path is stable for two more phases; this bridge is contained.

Add to the `Command` enum in `furnace-cli/src/main.rs`:

```rust
    /// (Legacy bridge — retired in Phase 3.) Launch the old furnace-window crate.
    #[command(hide = true)]
    Native {
        #[arg(long)]
        rebuild: bool,
    },
```

And handle it in `main`:

```rust
        Command::Native { rebuild } => legacy_native(rebuild),
```

Add the implementation at the bottom of `main.rs`:

```rust
fn legacy_native(rebuild: bool) -> Result<()> {
    use std::process::Command as Proc;
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into());
    // furnace-cli/src → packages/tools/crates/furnace-cli → packages/tools → packages/tools/native
    let legacy_manifest = std::path::Path::new(&manifest_dir)
        .join("../../native/Cargo.toml")
        .canonicalize()
        .context("failed to resolve legacy native crate path")?;
    let binary = std::path::Path::new(&manifest_dir)
        .join("../../../../dist/rust/release/furnace-window")
        .canonicalize()
        .ok();
    if rebuild || binary.as_ref().map(|p| !p.exists()).unwrap_or(true) {
        let status = Proc::new("cargo")
            .args(["build", "--release", "--manifest-path"])
            .arg(&legacy_manifest)
            .status()
            .context("failed to invoke cargo for legacy native crate")?;
        if !status.success() {
            bail!("legacy native crate failed to build");
        }
    }
    let binary = std::path::Path::new(&manifest_dir)
        .join("../../../../dist/rust/release/furnace-window")
        .canonicalize()
        .context("legacy binary not found after build")?;
    let status = Proc::new(binary).status().context("legacy binary failed to launch")?;
    std::process::exit(status.code().unwrap_or(1));
}
```

Rebuild and retry:

```bash
cargo build --manifest-path packages/tools/crates/Cargo.toml
bun run --cwd packages/hello-world dev:native
```

Expected: window opens, hello-world triangle renders. Phase 1 is complete and the legacy workflow is preserved.

- [ ] **Step 6: Commit.**

```bash
git add packages/tools/shim.js packages/tools/package.json packages/tools/crates/furnace-cli/src/main.rs
git commit -m "$(cat <<'EOF'
feat(tools): switch furnace bin entry to Rust binary via shim.js

The npm bin now resolves to a 25-line zero-dep Node shim that finds and execs
the cargo-built furnace binary. The legacy TS CLI at src/public/cli.ts remains
importable for transitional internal use but is no longer the bin entry.

Bridges the dev:native flow with a hidden \`furnace native [--rebuild]\` subcommand
in furnace-cli that proxies to the legacy furnace-window crate. The bridge is
retired in Phase 3 when \`furnace dev --platform=macos\` replaces it.
EOF
)"
```

### Task 1.3: Document the Phase 1 state

**Files:**
- Modify: `packages/tools/README.md` (a doc-only update — earlier plan rewrote it for the *designed* state; this updates with the *actual* current state)

- [ ] **Step 1: Update `packages/tools/README.md` Consumer surface block.**

Find:
```markdown
- `furnace` (bin) — public CLI. Today supports the legacy `furnace native [--rebuild]` (used by hello-world's `dev:native`); the design spec lays out the eventual full command surface (`init`, `build`, `dev`, `wasm`, `upgrade-runtime`).
```

Replace with:
```markdown
- `furnace` (bin) — public CLI (Rust binary via `shim.js`). Commands defined: `build`, `dev`, `wasm`, `init`, `upgrade-runtime`. Only the hidden `native` bridge is implemented today; the others return "not yet implemented" with the phase they land in. See `docs/superpowers/plans/2026-05-19-native-shell-milestone-1.md` for the active implementation plan.
```

- [ ] **Step 2: Commit.**

```bash
git add packages/tools/README.md
git commit -m "docs(tools): note Phase 1 CLI state in README"
```

### Phase 1 verification gate

- [ ] **Run all of these and confirm pass before starting Phase 2.**

```bash
git status --short
cargo build --manifest-path packages/tools/crates/Cargo.toml
bunx furnace --help
bun test
bunx tsc --noEmit
bun run check
bun run --cwd packages/hello-world dev:native     # close window to exit
```

Expected: clean working tree (except pre-existing modifications), cargo build succeeds, `furnace --help` prints, all tests pass, lint passes, legacy dev:native still launches.

---

## Phase 2 — Build skeleton (macOS .app)

**Goal:** `furnace build --platform=macos` produces a clickable `.app` that boots and renders hello-world's WebGPU triangle, with assets bundled inside the app and extracted at first launch.

**End-state:**
- `bun run --cwd packages/hello-world build:macos` (new script that invokes `furnace build --platform=macos`) emits `dist/macos/hello-world.app`.
- Double-clicking the `.app` (or `open dist/macos/hello-world.app`) opens a window with the rendered triangle, no external file dependencies.
- Hello-world has `furnace.config.json`, `platforms/macos/`, `src-furnace/main.rs`, and a vendored `src-furnace/runtime/` directory (Phase 2's seed copy of `packages/tools/crates/furnace-runtime`).

### Task 2.1: Consumer-side scaffolding for hello-world (manual seed)

In Phase 5, `furnace init` produces this layout automatically. In Phase 2, write it by hand so the build pipeline has something to consume.

**Files:**
- Create: `packages/hello-world/furnace.config.json`
- Create: `packages/hello-world/platforms/macos/Info.plist`
- Create: `packages/hello-world/platforms/macos/entitlements.plist`
- Create: `packages/hello-world/src-furnace/main.rs`
- Create: `packages/hello-world/src-furnace/Cargo.toml` (consumer's Cargo manifest)
- Create: `packages/hello-world/src-furnace/runtime/` (vendored — copy of `packages/tools/crates/furnace-runtime/`)
- Create: `packages/hello-world/.gitignore` updates for `dist/macos/` and `src-furnace/target/`

- [ ] **Step 1: Write `furnace.config.json`.**

```json
{
  "identity": {
    "name": "hello-world",
    "bundleId": "com.furnace.hello-world",
    "version": "0.0.0"
  },
  "source": "src/",
  "entry": "index.html",
  "window": {
    "title": "furnace",
    "width": 1280,
    "height": 720,
    "fullscreen": false
  },
  "plugins": []
}
```

- [ ] **Step 2: Write `platforms/macos/Info.plist`.**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>${IDENTITY_NAME}</string>
  <key>CFBundleIdentifier</key><string>${IDENTITY_BUNDLE_ID}</string>
  <key>CFBundleVersion</key><string>${IDENTITY_VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${IDENTITY_VERSION}</string>
  <key>CFBundleExecutable</key><string>hello-world</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
```

The `${IDENTITY_*}` placeholders are substituted at build time by the CLI from `furnace.config.json`.

- [ ] **Step 3: Write `platforms/macos/entitlements.plist`** (minimal — empty entitlements; signing comes later).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
</dict>
</plist>
```

- [ ] **Step 4: Vendor the runtime crate into `packages/hello-world/src-furnace/runtime/`.**

```bash
mkdir -p packages/hello-world/src-furnace
cp -r packages/tools/crates/furnace-runtime packages/hello-world/src-furnace/runtime
```

Then edit `packages/hello-world/src-furnace/runtime/Cargo.toml` to use literal `version = "0.0.0"` lines instead of `version.workspace = true` (the vendored copy is standalone, not inside a Cargo workspace anymore). Same for `edition`, `publish`, `license`. Replace `winit.workspace = true` etc. with explicit versions:

```toml
[package]
name = "furnace-runtime"
version = "0.0.0"
edition = "2021"
publish = false
license = "MIT"

[lib]
crate-type = ["lib"]

[dependencies]
anyhow = "1"
winit = "0.30"
wry = "0.48"
```

- [ ] **Step 5: Write `packages/hello-world/src-furnace/Cargo.toml`.**

```toml
[package]
name = "hello-world"
version = "0.0.0"
edition = "2021"
publish = false

[[bin]]
name = "hello-world"
path = "main.rs"

[dependencies]
anyhow = "1"
furnace-runtime = { path = "runtime" }
```

- [ ] **Step 6: Write `packages/hello-world/src-furnace/main.rs`.**

```rust
//! Consumer entrypoint scaffolded by `furnace init` (manual in Phase 2).
//!
//! Boots furnace-runtime and points it at the bundled web assets extracted to
//! the user's cache dir at startup.

use anyhow::{Context, Result};
use furnace_runtime::{run, AppConfig};
use std::path::PathBuf;

const PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.bin"));

fn main() -> Result<()> {
    let entry = extract_payload().context("failed to extract bundled payload")?;
    let url = format!("file://{}", entry.to_string_lossy());
    let mut config = AppConfig::new(url);
    config.title = "furnace".into();
    run(config)
}

fn extract_payload() -> Result<PathBuf> {
    // Cache dir: ~/Library/Caches/com.furnace.hello-world/payload/
    let cache_dir = dirs::cache_dir()
        .context("no cache dir")?
        .join(env!("CARGO_PKG_NAME"))
        .join("payload");
    std::fs::create_dir_all(&cache_dir)?;
    // Unpack: PAYLOAD is a tar archive (built by build.rs).
    let cursor = std::io::Cursor::new(PAYLOAD);
    let mut archive = tar::Archive::new(cursor);
    archive.unpack(&cache_dir)?;
    Ok(cache_dir.join("index.html"))
}
```

Add `dirs = "5"` and `tar = "0.4"` to the consumer `Cargo.toml`:

```toml
[dependencies]
anyhow = "1"
dirs = "5"
furnace-runtime = { path = "runtime" }
tar = "0.4"

[build-dependencies]
tar = "0.4"
```

- [ ] **Step 7: Write `packages/hello-world/src-furnace/build.rs`.**

The build script needs to construct `payload.bin` (a tar of the bundled web assets) at compile time. The CLI orchestrates this by writing the assets into `OUT_DIR/web/` before cargo builds; build.rs picks them up.

```rust
//! Bundles staged web assets into payload.bin at build time.
//!
//! The CLI populates `<OUT_DIR>/web/` with the bundled web app before invoking
//! `cargo build`. This script tars that directory into `<OUT_DIR>/payload.bin`,
//! which main.rs includes via `include_bytes!`.

use std::env;
use std::fs::File;
use std::path::PathBuf;

fn main() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
    let web_dir = out_dir.join("web");
    let payload_path = out_dir.join("payload.bin");

    if !web_dir.exists() {
        // Empty stub during plain `cargo check` outside the CLI pipeline.
        File::create(&payload_path).expect("create empty payload");
        println!("cargo:warning=furnace: OUT_DIR/web/ missing — emitting empty payload (run via `furnace build`)");
        return;
    }

    let file = File::create(&payload_path).expect("create payload.bin");
    let mut builder = tar::Builder::new(file);
    builder
        .append_dir_all(".", &web_dir)
        .expect("tar append_dir_all");
    builder.finish().expect("tar finish");

    println!("cargo:rerun-if-changed={}", web_dir.display());
}
```

- [ ] **Step 8: Update `packages/hello-world/.gitignore`.**

Append:
```
dist/macos/
src-furnace/target/
```

- [ ] **Step 9: Commit.**

```bash
git add packages/hello-world/furnace.config.json packages/hello-world/platforms/ packages/hello-world/src-furnace/ packages/hello-world/.gitignore
git commit -m "$(cat <<'EOF'
feat(hello-world): seed manual furnace.config.json + platforms/macos + src-furnace

Phase 2 of the native-shell milestone-1 plan. This is the layout that
\`furnace init\` will produce automatically in Phase 5; hand-writing it here lets
the build pipeline take shape against a real consumer-style structure.

Layout matches §4 of the design spec:
- furnace.config.json — declarative app config
- platforms/macos/ — Info.plist + entitlements templates (substituted at build)
- src-furnace/main.rs + Cargo.toml — Rust entrypoint
- src-furnace/runtime/ — vendored copy of furnace-runtime
- src-furnace/build.rs — packs OUT_DIR/web/ into payload.bin for inclusion
EOF
)"
```

### Task 2.2: Implement `furnace build --platform=macos`

**Files:**
- Create: `packages/tools/crates/furnace-cli/src/build/mod.rs`
- Create: `packages/tools/crates/furnace-cli/src/build/context.rs`
- Create: `packages/tools/crates/furnace-cli/src/build/macos.rs`
- Create: `packages/tools/crates/furnace-cli/src/jsbundle.rs`
- Create: `packages/tools/crates/furnace-cli/src/config.rs`
- Modify: `packages/tools/crates/furnace-cli/src/main.rs`
- Modify: `packages/tools/crates/furnace-cli/Cargo.toml` (add `cargo-packager-utils` or hand-roll, `walkdir`, `tempfile`)

**Implementation overview:** the build pipeline runs:
1. Read `furnace.config.json` from cwd.
2. Resolve platform builder.
3. Stage JS bundle to `tmp/furnace-build-<hash>/web/` (Phase 2: invoke `bun build` via `Command::new("bun")`).
4. Stage assets into the consumer's `src-furnace/target/.../OUT_DIR/web/` location via a known env var (use `FURNACE_WEB_DIR`), then run `cargo build --release --manifest-path src-furnace/Cargo.toml`.
5. Run `cargo-packager` (or hand-roll the .app construction in Phase 2 to avoid a hard dep choice — see Phase 2.3 below) to produce `dist/macos/hello-world.app`.

> **Decision check during implementation:** if `cargo-packager` proves slow or has rough edges for our exact shape, switch to hand-rolling the .app directory (it's roughly: create `Foo.app/Contents/MacOS/`, copy the binary, write Info.plist, optional codesign). Defer the choice to the executor with this guidance: try `cargo-packager` first; if it adds more friction than value, hand-roll. The .app layout is well-documented.

- [ ] **Step 1: Write `config.rs` — load and validate `furnace.config.json`.**

```rust
//! Parses furnace.config.json. Schema is minimal in Phase 2; expands later.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Deserialize, Debug)]
pub struct FurnaceConfig {
    pub identity: Identity,
    pub source: String,
    #[serde(default = "default_entry")]
    pub entry: String,
    pub window: Window,
    #[serde(default)]
    pub plugins: Vec<String>,
}

#[derive(Deserialize, Debug)]
pub struct Identity {
    pub name: String,
    #[serde(rename = "bundleId")]
    pub bundle_id: String,
    pub version: String,
}

#[derive(Deserialize, Debug)]
pub struct Window {
    pub title: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub fullscreen: bool,
}

fn default_entry() -> String { "index.html".into() }

impl FurnaceConfig {
    pub fn load_from(project_root: &Path) -> Result<Self> {
        let path = project_root.join("furnace.config.json");
        let text = std::fs::read_to_string(&path)
            .with_context(|| format!("reading {}", path.display()))?;
        serde_json::from_str(&text)
            .with_context(|| format!("parsing {}", path.display()))
    }
}

pub struct ProjectPaths {
    pub root: PathBuf,
    pub source_dir: PathBuf,
    pub src_furnace: PathBuf,
    pub platforms: PathBuf,
    pub dist: PathBuf,
}

impl ProjectPaths {
    pub fn resolve(root: &Path, config: &FurnaceConfig) -> Self {
        let root = root.to_path_buf();
        Self {
            source_dir: root.join(&config.source),
            src_furnace: root.join("src-furnace"),
            platforms: root.join("platforms"),
            dist: root.join("dist"),
            root,
        }
    }
}
```

- [ ] **Step 2: Write `jsbundle.rs` — run bun build.**

```rust
//! Invokes `bun build` to produce the native-target JS bundle.

use anyhow::{bail, Context, Result};
use std::path::Path;
use std::process::Command;

pub struct BundleRequest<'a> {
    pub project_root: &'a Path,
    pub entry_html: &'a Path,
    pub out_dir: &'a Path,
    pub mode: BundleMode,
}

pub enum BundleMode { Prod, Dev }

pub fn bundle(req: BundleRequest<'_>) -> Result<()> {
    std::fs::create_dir_all(req.out_dir)?;
    let mut cmd = Command::new("bun");
    cmd.current_dir(req.project_root)
       .arg("build")
       .arg(req.entry_html)
       .arg("--outdir")
       .arg(req.out_dir);
    match req.mode {
        BundleMode::Prod => { cmd.args(["--minify", "--sourcemap=external"]); }
        BundleMode::Dev => { cmd.arg("--sourcemap=inline"); }
    }
    let status = cmd.status().context("failed to invoke `bun build`")?;
    if !status.success() {
        bail!("bun build failed");
    }
    Ok(())
}
```

- [ ] **Step 3: Write `build/context.rs` — shared build context.**

```rust
use crate::config::{FurnaceConfig, ProjectPaths};
use std::path::PathBuf;

pub struct BuildContext {
    pub config: FurnaceConfig,
    pub paths: ProjectPaths,
    pub web_staging_dir: PathBuf,  // tmp dir where the JS bundle lands
}

pub struct BuiltArtifacts {
    pub binary: PathBuf,
    pub app_metadata_dir: PathBuf,
}
```

- [ ] **Step 4: Write `build/mod.rs` — PlatformBuilder trait + dispatch.**

```rust
use crate::build::context::{BuildContext, BuiltArtifacts};
use anyhow::Result;
use std::path::PathBuf;

pub mod context;
pub mod macos;

pub trait PlatformBuilder {
    fn target_triple(&self) -> &'static str;
    fn pre_flight(&self, ctx: &BuildContext) -> Result<()>;
    fn package(&self, ctx: &BuildContext, artifacts: &BuiltArtifacts) -> Result<PathBuf>;
}

pub fn dispatch(platform: &str) -> Result<Box<dyn PlatformBuilder>> {
    match platform {
        "macos" => Ok(Box::new(macos::MacosBuilder)),
        other => anyhow::bail!("unknown platform: {other}"),
    }
}
```

- [ ] **Step 5: Write `build/macos.rs` — the MacosBuilder.**

```rust
use super::context::{BuildContext, BuiltArtifacts};
use super::PlatformBuilder;
use anyhow::{bail, Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct MacosBuilder;

impl PlatformBuilder for MacosBuilder {
    fn target_triple(&self) -> &'static str {
        if cfg!(target_arch = "aarch64") { "aarch64-apple-darwin" } else { "x86_64-apple-darwin" }
    }

    fn pre_flight(&self, ctx: &BuildContext) -> Result<()> {
        if !ctx.paths.platforms.join("macos").join("Info.plist").exists() {
            bail!("platforms/macos/Info.plist missing — run `furnace init --platform=macos`");
        }
        if !ctx.paths.src_furnace.join("Cargo.toml").exists() {
            bail!("src-furnace/Cargo.toml missing");
        }
        Ok(())
    }

    fn package(&self, ctx: &BuildContext, artifacts: &BuiltArtifacts) -> Result<PathBuf> {
        // Construct the .app layout by hand: Foo.app/Contents/{MacOS,Resources}
        let app_name = format!("{}.app", ctx.config.identity.name);
        let app_dir = ctx.paths.dist.join("macos").join(&app_name);
        if app_dir.exists() {
            fs::remove_dir_all(&app_dir)?;
        }
        let contents = app_dir.join("Contents");
        let macos = contents.join("MacOS");
        let resources = contents.join("Resources");
        fs::create_dir_all(&macos)?;
        fs::create_dir_all(&resources)?;

        // Copy binary.
        let exe_name = &ctx.config.identity.name;
        fs::copy(&artifacts.binary, macos.join(exe_name))?;

        // Substitute and write Info.plist.
        let plist_template = fs::read_to_string(ctx.paths.platforms.join("macos/Info.plist"))?;
        let plist = plist_template
            .replace("${IDENTITY_NAME}", &ctx.config.identity.name)
            .replace("${IDENTITY_BUNDLE_ID}", &ctx.config.identity.bundle_id)
            .replace("${IDENTITY_VERSION}", &ctx.config.identity.version);
        fs::write(contents.join("Info.plist"), plist)?;

        // Mark binary executable (cargo already does this, but cross-FS copies can drop it).
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let bin = macos.join(exe_name);
            let mut perms = fs::metadata(&bin)?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&bin, perms)?;
        }

        Ok(app_dir)
    }
}

pub fn cargo_build_release(ctx: &BuildContext) -> Result<PathBuf> {
    let target = MacosBuilder.target_triple();
    let manifest = ctx.paths.src_furnace.join("Cargo.toml");
    // Pin the target dir explicitly: cargo walks up looking for .cargo/config.toml,
    // and the repo root's config redirects target-dir to dist/rust/. For consumers
    // that DON'T have that ambient config, cargo would default to src-furnace/target/.
    // Force a single predictable location regardless of ambient config.
    let target_dir = ctx.paths.src_furnace.join("target");
    let status = Command::new("cargo")
        .args(["build", "--release", "--target", target, "--manifest-path"])
        .arg(&manifest)
        .env("CARGO_TARGET_DIR", &target_dir)
        .env("FURNACE_WEB_DIR", &ctx.web_staging_dir)
        .status()
        .context("cargo build failed to start")?;
    if !status.success() {
        bail!("cargo build (release) failed");
    }
    let binary = target_dir
        .join(target).join("release").join(&ctx.config.identity.name);
    if !binary.exists() {
        bail!("expected binary at {} after build", binary.display());
    }
    Ok(binary)
}
```

> **Important env-var wiring:** the consumer's `build.rs` (from Task 2.1 Step 7) reads `OUT_DIR/web/`, not `FURNACE_WEB_DIR`. So in Phase 2, we need to either (a) update `build.rs` to honour `FURNACE_WEB_DIR` and copy from there to `OUT_DIR/web/`, or (b) write the bundle directly into the per-target `OUT_DIR/web/` path before invoking cargo. Path (a) is cleaner. Update the consumer's `build.rs`:

Add this snippet inside `build.rs` near the top of `main()`:

```rust
    // If FURNACE_WEB_DIR is set (CLI-driven build), copy its contents into OUT_DIR/web/ first.
    if let Ok(furnace_web) = env::var("FURNACE_WEB_DIR") {
        let src = PathBuf::from(furnace_web);
        copy_dir_recursive(&src, &web_dir).expect("copy FURNACE_WEB_DIR into OUT_DIR/web/");
        println!("cargo:rerun-if-env-changed=FURNACE_WEB_DIR");
    }
```

And add the helper at the bottom of `build.rs`:

```rust
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let dst_entry = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_entry)?;
        } else {
            std::fs::copy(entry.path(), dst_entry)?;
        }
    }
    Ok(())
}
```

- [ ] **Step 6: Wire it all together in `main.rs`.**

Replace the `Command::Build` branch in `furnace-cli/src/main.rs`:

```rust
        Command::Build { platform } => run_build(&platform),
```

And add the `run_build` function:

```rust
fn run_build(platform: &str) -> Result<()> {
    use crate::build::context::{BuildContext, BuiltArtifacts};
    use crate::config::{FurnaceConfig, ProjectPaths};
    use crate::jsbundle::{bundle, BundleMode, BundleRequest};

    let project_root = std::env::current_dir()?;
    let config = FurnaceConfig::load_from(&project_root)?;
    let paths = ProjectPaths::resolve(&project_root, &config);

    let builder = build::dispatch(platform)?;

    let staging = tempfile::tempdir().context("create tmp dir")?;
    let web_staging = staging.path().join("web");
    bundle(BundleRequest {
        project_root: &paths.root,
        entry_html: &paths.source_dir.join(&config.entry),
        out_dir: &web_staging,
        mode: BundleMode::Prod,
    })?;

    let ctx = BuildContext { config, paths, web_staging_dir: web_staging };
    builder.pre_flight(&ctx)?;

    let binary = build::macos::cargo_build_release(&ctx)?;
    let artifacts = BuiltArtifacts { binary, app_metadata_dir: ctx.paths.platforms.join(platform) };

    let app = builder.package(&ctx, &artifacts)?;
    println!("✓ {}", app.display());
    Ok(())
}
```

Declare the new modules at the top of `main.rs`:

```rust
mod build;
mod config;
mod jsbundle;
```

Add deps to `furnace-cli/Cargo.toml`:

```toml
tempfile = "3"
```

- [ ] **Step 7: Add a `build:macos` script to hello-world.**

Edit `packages/hello-world/package.json` — add to `scripts`:

```jsonc
    "build:macos": "bunx furnace build --platform=macos",
```

- [ ] **Step 8: Smoke-test the full build.**

```bash
cargo build --manifest-path packages/tools/crates/Cargo.toml --release
bun run --cwd packages/hello-world build:macos
```

Expected: produces `packages/hello-world/dist/macos/hello-world.app`. `bun run` exits 0. Final stdout line: `✓ /path/to/dist/macos/hello-world.app`.

If cargo emits warnings about unused deps or `cargo:warning=furnace: OUT_DIR/web/ missing`, those are OK in the standalone-cargo-check case but should NOT appear when the CLI drives the build (because `FURNACE_WEB_DIR` is set).

- [ ] **Step 9: Open the .app and verify it renders.**

```bash
open packages/hello-world/dist/macos/hello-world.app
```

Expected: window opens, WebGPU triangle renders with the Svelte FPS overlay (or whatever hello-world's index.html resolves to).

If the window opens but renders a blank/error page, debug:
- Check the bundle made it inside the .app: `find packages/hello-world/dist/macos/hello-world.app -type f` — should include the binary in Contents/MacOS/ and Info.plist in Contents/.
- Check the extracted payload: `ls ~/Library/Caches/hello-world/payload/` after the app launches.
- Tail Console.app for crash logs filtered by hello-world.

- [ ] **Step 10: Commit.**

```bash
git add packages/tools/crates/furnace-cli/ packages/hello-world/package.json packages/hello-world/src-furnace/build.rs
git commit -m "$(cat <<'EOF'
feat(tools): furnace build --platform=macos produces a clickable .app

Phase 2 of native-shell milestone-1. The CLI now:
- Loads furnace.config.json
- Stages the consumer's web bundle via \`bun build\` into a tmp dir
- Invokes cargo build --release on the consumer's src-furnace Cargo project,
  passing FURNACE_WEB_DIR so build.rs pulls the staged bundle into payload.bin
- Hand-rolls the Foo.app/Contents/{MacOS,Resources} layout, copies the binary,
  substitutes Info.plist placeholders from config

Hand-rolled .app construction in Phase 2 instead of cargo-packager — keeps the
dep surface small and the layout transparent. Revisit packaging-tool choice
when adding code signing or .dmg production.

Hello-world has \`bun run build:macos\` that drives the new pipeline end-to-end.
EOF
)"
```

### Task 2.3: Test the build pipeline

**Files:**
- Create: `packages/tools/crates/furnace-cli/tests/build_macos.rs`

- [ ] **Step 1: Write an integration test that runs the full build against hello-world.**

```rust
//! Integration test for `furnace build --platform=macos`.
//!
//! Runs the CLI against the hello-world workspace member and asserts the .app
//! is produced with the expected structure. Requires the test runner to be on
//! macOS; skipped otherwise.

#![cfg(target_os = "macos")]

use std::process::Command;

#[test]
fn build_macos_produces_app() {
    // Resolve repo root from CARGO_MANIFEST_DIR (packages/tools/crates/furnace-cli).
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(4)
        .expect("repo root")
        .to_path_buf();
    let hello_world = repo_root.join("packages/hello-world");

    let status = Command::new("bun")
        .args(["run", "build:macos"])
        .current_dir(&hello_world)
        .status()
        .expect("failed to spawn bun");
    assert!(status.success(), "build:macos exited non-zero");

    let app = hello_world.join("dist/macos/hello-world.app");
    assert!(app.exists(), "{} missing", app.display());
    assert!(app.join("Contents/Info.plist").exists());
    assert!(app.join("Contents/MacOS/hello-world").exists());
}
```

- [ ] **Step 2: Run the test.**

```bash
cargo test --manifest-path packages/tools/crates/Cargo.toml -p furnace-cli --test build_macos
```

Expected: PASS. Test produces a real .app as a side effect; that's fine.

- [ ] **Step 3: Commit.**

```bash
git add packages/tools/crates/furnace-cli/tests/build_macos.rs
git commit -m "test(furnace-cli): integration test for furnace build --platform=macos"
```

### Phase 2 verification gate

- [ ] **Before starting Phase 3, all of these must pass.**

```bash
git status --short
bun run --cwd packages/hello-world build:macos
open packages/hello-world/dist/macos/hello-world.app    # manual: triangle renders
cargo test --manifest-path packages/tools/crates/Cargo.toml
bun test
bunx tsc --noEmit
bun run check
```

Expected: build emits a clickable .app that renders the WebGPU triangle from a cold double-click (no dev server running). Tests, typecheck, lint all pass.

---

## Phase 2 deviations (errata)

Phase 2 shipped with several substantive deviations from the plan body. Phases 3+ must respect them. Phase 1 and Phase 2 task bodies are left as written for historical context; the shipped state lives in the git history.

1. **macOS-native asset layout, not `payload.bin` tar.** The plan's Task 2.1 used `include_bytes!(payload.bin)` + a `build.rs` that tarred the staged bundle, with extraction to `~/Library/Caches/<name>/payload/` at first launch. Shipped state: web assets live at `Contents/Resources/web/` inside the `.app`. The consumer's `main.rs` resolves them via `current_exe().parent().parent().join("Resources/web")`. `build.rs` is deleted; `dirs` and `tar` deps are removed; `FURNACE_WEB_DIR` is no longer passed to cargo. The `MacosBuilder` copies the staged web bundle into the `.app` after the cargo build step.

2. **`furnace://` custom protocol is how assets reach the WebView.** `file://` is blocked by WKWebView from fetching sibling files; wry 0.48 doesn't expose `allowFileAccessFromFileURLs`. The runtime's `AppConfig.assets_dir: Option<PathBuf>` triggers registration of a `furnace://` custom protocol via `with_custom_protocol`; the URL loaded becomes `furnace://localhost/index.html`. The `open_url` example still works (it doesn't set `assets_dir`).

3. **JS bundling is via `Bun.build()` programmatic script, not the `bun build` CLI.** `bunfig.toml`'s `[serve.static].plugins` config only applies to `bun serve`; without programmatic invocation, `bun-plugin-svelte` doesn't run and `.svelte.ts` files leak `$state` runes into runtime JS. See `packages/tools/crates/furnace-cli/src/jsbundle.rs` for the generated `bundle.mjs` pattern and `Bun.resolveSync("bun-plugin-svelte", projectRoot)` discovery. `BundleMode::Dev` passes `development: true` to `SveltePlugin`; `BundleMode::Prod` passes `false`.

4. **`FURNACE_VERBOSE` env gates protocol-request logging** in the runtime's custom protocol handler (legacy convention).

5. **Error-capture JS is permanently injected** via `with_initialization_script` in the runtime. It replaces `document.body.innerText` on uncaught errors / unhandled rejections with a red overlay so silent JS failures become visible. Keep this in all future runtime changes.

6. **`tsconfig.json` excludes are `["**/dist", "**/target"]`.** The consumer's cargo target lives nested under `packages/hello-world/src-furnace/target/` and the `.app` builds to `packages/hello-world/dist/`; un-nested patterns don't match.

7. **Vendored runtime sync:** every change to `packages/tools/crates/furnace-runtime/src/lib.rs` must be mirrored to `packages/hello-world/src-furnace/runtime/src/lib.rs` (byte-identical `lib.rs`; their Cargo.toml diverges — canonical uses `*.workspace = true`, vendored uses literal versions). Sync via `cp` and verify with `diff`. Phase 5 will replace the vendored copy under hello-world with a fresh copy under `packages/tools/templates/shared/src-furnace/runtime/`.

**Phase 3 consumer-side dev integration:** the plan's `FURNACE_DEV_CACHE_DIR` env is still the right approach, but with the new asset layout it integrates differently — see Task 3.2's "Edit `src-furnace/main.rs` to honour that env" section below (rewritten).

---

## Phase 3 — Dev mode (`furnace dev`) + retire legacy

**Goal:** `furnace dev --platform=macos` runs a watch loop with HMR over WebSocket; the legacy `packages/tools/native/furnace-window` crate and the `Command::Native` bridge are removed.

**End-state:**
- `bun run --cwd packages/hello-world dev:native` invokes `bunx furnace dev --platform=macos`.
- Editing a `.ts` or `.wgsl` file in hello-world's `src/` triggers a re-bundle and the WebView reloads (full reload in Phase 3 — granular module HMR is deferred).
- `packages/tools/native/` is removed. The `Command::Native` bridge is removed from `furnace-cli`.

### Task 3.1: HMR channel in furnace-runtime

**Files:**
- Modify: `packages/tools/crates/furnace-runtime/src/lib.rs` (extend AppConfig with optional HMR URL; spawn a thread that connects to a WebSocket and calls `webview.evaluate_script("location.reload()")` on reload messages)
- Modify: `packages/tools/crates/furnace-runtime/Cargo.toml` (add `tungstenite = "0.21"` for WebSocket; gate behind a `hmr` feature)

- [ ] **Step 1: Add the WebSocket reload listener.**

In `lib.rs`, extend `AppConfig`:

```rust
pub struct AppConfig {
    pub title: String,
    pub width: f64,
    pub height: f64,
    pub url: String,
    pub hmr_ws_url: Option<String>,
}
```

Update `new` accordingly. In `resumed`, after building the webview, spawn a thread if `hmr_ws_url` is Some:

```rust
        if let Some(ws_url) = self.config.hmr_ws_url.clone() {
            let proxy = event_loop.create_proxy();  // need a custom UserEvent for cross-thread reload
            std::thread::spawn(move || {
                use tungstenite::connect;
                let Ok((mut socket, _)) = connect(&ws_url) else { return };
                while let Ok(msg) = socket.read() {
                    if msg.is_text() {
                        let _ = proxy.send_event(());  // reload signal
                    }
                }
            });
        }
```

The event-loop type signature has to be updated to use `EventLoop::<()>::with_user_event()`. Adjust `run` accordingly and handle the user event in `ApplicationHandler::user_event` by calling `webview.evaluate_script("location.reload()")`.

> **If wry's webview-from-different-thread story bites, an alternative:** the WebSocket listener thread writes a sentinel file path; the runtime polls it on a timer in a winit timer event. Slower but simpler.

- [ ] **Step 2: Add the `tungstenite` dependency.**

```toml
[dependencies]
# ... existing ...
tungstenite = "0.24"
```

- [ ] **Step 3: Confirm runtime still builds with the new feature.**

```bash
cargo build --manifest-path packages/tools/crates/Cargo.toml
```

### Task 3.2: HMR server in furnace-cli

**Files:**
- Create: `packages/tools/crates/furnace-cli/src/dev/mod.rs`
- Create: `packages/tools/crates/furnace-cli/src/dev/server.rs` (WebSocket server bound to localhost:0)
- Create: `packages/tools/crates/furnace-cli/src/dev/watch.rs` (notify-based file watcher → rebundle → broadcast)
- Modify: `packages/tools/crates/furnace-cli/src/main.rs` (wire `Command::Dev`)
- Modify: `packages/tools/crates/furnace-cli/Cargo.toml` (add `notify = "6"`, `tungstenite = "0.24"`, `tokio = { version = "1", features = ["full"] }` OR keep it sync with std threads — preferred for milestone 1)

**Implementation overview:**
1. `furnace dev --platform=macos` bundles into a persistent dev cache dir (e.g., `<consumer>/target/furnace-dev/`) via `BundleMode::Dev`.
2. Spawn a WebSocket server on `localhost:0`, capture the chosen port.
3. Run `cargo build` (debug, not release) on `src-furnace/`. **Do not pass `FURNACE_WEB_DIR`** (no `build.rs` reads it anymore — see Phase 2 deviation #1).
4. Spawn the resulting bare debug binary (NOT a `.app`) with two envs: `FURNACE_DEV_CACHE_DIR=<dev cache dir>` and `FURNACE_HMR_WS=ws://127.0.0.1:<port>`.
5. Watch `paths.source_dir` with `notify`. On change: re-bundle into the dev cache dir; broadcast `"reload"` on the WebSocket; runtime calls `location.reload()` which re-reads via the `furnace://` custom protocol from the dev cache dir.
6. On Ctrl+C, terminate the child.

> **Why the bare binary, not a `.app`:** dev mode iterates faster without re-packaging the `.app` on every change. The consumer's `resolve_assets_dir()` falls through to the dev path when `FURNACE_DEV_CACHE_DIR` is set, so the runtime points the custom protocol at the watched dir rather than the `.app`'s `Contents/Resources/web/`.

Edit `src-furnace/main.rs` `resolve_assets_dir()` to honour the dev env (current shape: it resolves from `current_exe()`):

```rust
fn resolve_assets_dir() -> Result<PathBuf> {
    if let Ok(dev_dir) = std::env::var("FURNACE_DEV_CACHE_DIR") {
        return Ok(PathBuf::from(dev_dir));
    }
    // Prod (macOS .app) path:
    let exe = std::env::current_exe()?;
    let assets = exe
        .parent()
        .context("exe has no parent")?
        .parent()
        .context("MacOS dir has no parent")?
        .join("Resources/web");
    if !assets.is_dir() {
        anyhow::bail!(
            "assets dir not found at {} — was the .app constructed correctly?",
            assets.display()
        );
    }
    Ok(assets)
}
```

And the consumer's `main()` reads `FURNACE_HMR_WS` into the AppConfig:

```rust
let mut config = AppConfig::new("furnace://localhost/index.html");
config.title = "furnace".into();
config.assets_dir = Some(assets_dir);
config.hmr_ws_url = std::env::var("FURNACE_HMR_WS").ok();
run(config)
```

- [ ] **Step 1: Write `dev/server.rs` — a synchronous WebSocket server.**

```rust
use anyhow::{Context, Result};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;
use tungstenite::accept;
use tungstenite::protocol::WebSocket;
use tungstenite::Message;

pub struct HmrServer {
    pub port: u16,
    clients: Arc<Mutex<Vec<WebSocket<std::net::TcpStream>>>>,
}

impl HmrServer {
    pub fn start() -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").context("bind")?;
        let port = listener.local_addr()?.port();
        let clients: Arc<Mutex<Vec<WebSocket<std::net::TcpStream>>>> = Arc::default();
        let clients_for_thread = clients.clone();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                if let Ok(ws) = accept(stream) {
                    if let Ok(mut guard) = clients_for_thread.lock() {
                        guard.push(ws);
                    }
                }
            }
        });
        Ok(Self { port, clients })
    }

    pub fn broadcast(&self, text: &str) {
        let Ok(mut guard) = self.clients.lock() else { return };
        guard.retain_mut(|ws| ws.send(Message::text(text)).is_ok());
    }
}
```

- [ ] **Step 2: Write `dev/watch.rs` — debounced file watcher.**

```rust
use anyhow::Result;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;

pub fn watch(paths: &[&Path]) -> Result<(RecommendedWatcher, Receiver<Event>)> {
    let (tx, rx) = channel();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(ev) = res {
            let _ = tx.send(ev);
        }
    })?;
    for p in paths {
        watcher.watch(p, RecursiveMode::Recursive)?;
    }
    Ok((watcher, rx))
}

pub fn debounce<T>(rx: &Receiver<T>, window: Duration) -> Option<T> {
    let first = rx.recv().ok()?;
    // Drain any events arriving within the debounce window; return the first.
    let deadline = std::time::Instant::now() + window;
    while let Some(remaining) = deadline.checked_duration_since(std::time::Instant::now()) {
        match rx.recv_timeout(remaining) {
            Ok(_) => continue,
            Err(_) => break,
        }
    }
    Some(first)
}
```

- [ ] **Step 3: Write `dev/mod.rs` — orchestrates the dev loop.**

```rust
pub mod server;
pub mod watch;

use crate::build::macos::MacosBuilder;
use crate::build::PlatformBuilder;
use crate::config::{FurnaceConfig, ProjectPaths};
use crate::jsbundle::{bundle, BundleMode, BundleRequest};
use anyhow::{bail, Context, Result};
use std::process::{Child, Command};
use std::time::Duration;

pub fn run_dev(platform: &str) -> Result<()> {
    if platform != "macos" {
        bail!("dev mode only supports --platform=macos in milestone 1");
    }
    let project_root = std::env::current_dir()?;
    let config = FurnaceConfig::load_from(&project_root)?;
    let paths = ProjectPaths::resolve(&project_root, &config);

    // Persistent dev cache dir (the runtime reads index.html from here).
    let dev_cache = paths.root.join("target").join("furnace-dev");
    std::fs::create_dir_all(&dev_cache)?;

    // Initial bundle.
    bundle(BundleRequest {
        project_root: &paths.root,
        entry_html: &paths.source_dir.join(&config.entry),
        out_dir: &dev_cache,
        mode: BundleMode::Dev,
    })?;

    // HMR server.
    let server = server::HmrServer::start()?;
    let ws_url = format!("ws://127.0.0.1:{}", server.port);

    // cargo build (debug). No FURNACE_WEB_DIR — build.rs was removed in Phase 2's
    // macOS-native refactor; assets are wired in via the runtime's custom protocol
    // reading FURNACE_DEV_CACHE_DIR at startup.
    let target = MacosBuilder.target_triple();
    let target_dir = paths.src_furnace.join("target");
    let status = Command::new("cargo")
        .args(["build", "--target", target, "--manifest-path"])
        .arg(paths.src_furnace.join("Cargo.toml"))
        .env("CARGO_TARGET_DIR", &target_dir)
        .status()
        .context("cargo build (debug) failed")?;
    if !status.success() {
        bail!("cargo build (debug) failed");
    }
    let binary = target_dir.join(target).join("debug").join(&config.identity.name);

    // Spawn the binary with HMR + dev-cache env.
    let mut child: Child = Command::new(&binary)
        .env("FURNACE_HMR_WS", &ws_url)
        .env("FURNACE_DEV_CACHE_DIR", &dev_cache)
        .spawn()
        .context("failed to spawn runtime binary")?;
    println!("furnace dev: pid {} listening on {ws_url}", child.id());

    // Watch the source tree for changes.
    let source_dir = paths.source_dir.clone();
    let (_watcher, rx) = watch::watch(&[&source_dir])?;
    loop {
        // Exit if the runtime died.
        if let Ok(Some(_)) = child.try_wait() {
            break;
        }
        if watch::debounce(&rx, Duration::from_millis(150)).is_none() {
            continue;
        }
        // Re-bundle into the dev cache.
        if let Err(e) = bundle(BundleRequest {
            project_root: &paths.root,
            entry_html: &paths.source_dir.join(&config.entry),
            out_dir: &dev_cache,
            mode: BundleMode::Dev,
        }) {
            eprintln!("furnace dev: bundle failed — {e}");
            continue;
        }
        server.broadcast("reload");
    }

    let _ = child.kill();
    Ok(())
}
```

The `try_wait` polling above will tight-loop when waiting; the actual implementation should also support an Ctrl+C handler via `ctrlc = "3"` or `tokio::signal` (if going async). For Phase 3 the simple synchronous version above is acceptable — the `debounce` blocks on `recv`, so it only spins when events arrive.

- [ ] **Step 2: Update consumer `main.rs` and `build.rs` for dev mode awareness** (per the snippets above).

- [ ] **Step 3: Update hello-world's `dev:native` script.**

Edit `packages/hello-world/package.json`:

```jsonc
    "dev:native": "bunx furnace dev --platform=macos",
```

- [ ] **Step 4: Smoke-test dev mode.**

```bash
cargo build --manifest-path packages/tools/crates/Cargo.toml
bun run --cwd packages/hello-world dev:native
```

Expected: a window opens, hello-world renders. Edit `packages/hello-world/src/entry.ts` (e.g., change a string), save → the window reloads automatically within ~1s.

- [ ] **Step 5: Commit.**

```bash
git add packages/tools/crates/furnace-cli/src/dev/ packages/tools/crates/furnace-cli/src/main.rs packages/tools/crates/furnace-cli/Cargo.toml packages/tools/crates/furnace-runtime/ packages/hello-world/src-furnace/main.rs packages/hello-world/src-furnace/build.rs packages/hello-world/package.json
git commit -m "$(cat <<'EOF'
feat(tools): furnace dev --platform=macos with WebSocket-driven full-reload HMR

Phase 3 of native-shell milestone-1. The CLI:
- Bundles the consumer's source in dev mode (sourcemap=inline, no minify)
- Stands up a WebSocket server on localhost:0 and watches the source tree
- Spawns the runtime with FURNACE_HMR_WS and FURNACE_DEV_CACHE_DIR env
- On source change: re-bundles + broadcasts reload; runtime calls
  location.reload() in the WebView

Phase 3 is full-reload HMR; granular module HMR is intentionally deferred.

The hello-world dev:native script now routes through \`bunx furnace dev\`,
matching the design's intended consumer experience.
EOF
)"
```

### Task 3.3: Retire the legacy launcher

**Files:**
- Delete: `packages/tools/native/` (whole directory)
- Modify: `packages/tools/crates/furnace-cli/src/main.rs` (remove `Command::Native` + `legacy_native()`)
- Modify: `packages/tools/scripts/build.ts` (remove the `compileNativeCrate` call and `--native-only` flag, or delete the script entirely if no longer needed)
- Modify: `packages/tools/src/internal/index.ts` (remove `compileNativeCrate` export if unused)
- Modify: `packages/tools/src/internal/rust.ts` (delete if unused)
- Modify: root `package.json` (audit any scripts that reference `furnace-window`)

- [ ] **Step 1: Confirm `dev:native` works via the new path** (run Phase 3 dev once more, close window).

- [ ] **Step 2: Remove `packages/tools/native/` and the `Command::Native` bridge.**

```bash
git rm -r packages/tools/native/
```

Remove the `Native` variant + `legacy_native` from `furnace-cli/src/main.rs`.

- [ ] **Step 3: Update `packages/tools/scripts/build.ts`.**

If the script's only remaining purpose was building `furnace-window`, delete it and remove the `build` / `build:native` scripts from `packages/tools/package.json`. The new build path is `cargo build --manifest-path packages/tools/crates/Cargo.toml [--release]`.

If the TS staging logic in `build.ts` is still useful for publishing `@furnace/core` or `@furnace/tools` later, leave it alone for now — `@furnace/core`'s `bun run build` still uses `stageTypeScript` etc.

Actual cleanup target: just the `compileNativeCrate` lines in `build.ts` and the `--native-only` branch.

- [ ] **Step 4: Audit and update root `package.json` scripts.**

```bash
grep -n 'tools/build' package.json
```

If `bun run build:tools` is now meaningless or just runs cargo, simplify it to `cargo build --manifest-path packages/tools/crates/Cargo.toml --release`. Adjust the root `build` script accordingly.

- [ ] **Step 5: Verify everything still works post-cleanup.**

```bash
git status --short                      # confirm only retirements + intended new files
cargo build --manifest-path packages/tools/crates/Cargo.toml
bun run --cwd packages/hello-world build:macos
bun run --cwd packages/hello-world dev:native    # close to exit
bun test
bunx tsc --noEmit
bun run check
```

- [ ] **Step 6: Commit.**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(tools): retire furnace-window legacy crate and TS CLI bridge

Phase 3 completion. The old packages/tools/native/furnace-window crate is gone;
the Command::Native bridge in furnace-cli is gone; build.ts no longer compiles
a native crate. dev:native and build:macos both route through the new
Rust-CLI-driven pipeline.

packages/tools/src/internal/ retains stageTypeScript / synthesisePackageJson /
emitDeclarations because @furnace/core's publish flow still uses them. The
rust.ts helper is removed (unused).
EOF
)"
```

### Phase 3 verification gate

- [ ] **Before starting Phase 4, all of these must pass.**

```bash
test ! -d packages/tools/native    # legacy gone
bun run --cwd packages/hello-world build:macos
bun run --cwd packages/hello-world dev:native    # edit a .ts file, confirm reload, close
cargo test --manifest-path packages/tools/crates/Cargo.toml
bun test
bunx tsc --noEmit
bun run check
```

---

## Phase 4 — Wasm pipeline

**Goal:** `furnace wasm <crate-path>` compiles a Rust crate to wasm via `wasm-pack`. `furnace build` and `furnace dev` automatically pre-compile crates listed in `furnace.config.json` `plugins` or under a `plugins/` dir.

**End-state:**
- Hello-world has `plugins/demo-wasm/` — a tiny Rust crate exposing one function.
- Hello-world's JS imports the wasm module and calls the function during boot.
- Both `furnace build` and `furnace dev` compile the plugin automatically; the WebGPU canvas displays a small marker proving the wasm function ran.

### Task 4.1: Standalone `furnace wasm` command

**Files:**
- Create: `packages/tools/crates/furnace-cli/src/wasm.rs`
- Modify: `packages/tools/crates/furnace-cli/src/main.rs` (wire `Command::Wasm`)

- [ ] **Step 1: Implement `wasm.rs` — invokes `wasm-pack`.**

```rust
use anyhow::{bail, Context, Result};
use std::path::Path;
use std::process::Command;

pub struct WasmRequest<'a> {
    pub crate_path: &'a Path,
    pub out_dir: &'a Path,
    pub release: bool,
}

pub fn compile(req: WasmRequest<'_>) -> Result<()> {
    std::fs::create_dir_all(req.out_dir)?;
    let mut cmd = Command::new("wasm-pack");
    cmd.args(["build", "--target", "web", "--out-dir"])
       .arg(req.out_dir)
       .arg(req.crate_path);
    if !req.release {
        cmd.arg("--dev");
    }
    let status = cmd.status().context("failed to invoke wasm-pack — is it installed?")?;
    if !status.success() {
        bail!("wasm-pack failed for {}", req.crate_path.display());
    }
    Ok(())
}
```

- [ ] **Step 2: Wire `Command::Wasm` in `main.rs`.**

```rust
        Command::Wasm { crate_path } => {
            wasm::compile(wasm::WasmRequest {
                crate_path: &crate_path,
                out_dir: &crate_path.join("pkg"),
                release: false,
            })
        }
```

Declare `mod wasm;` at the top.

The `out_dir = crate_path.join("pkg")` convention is load-bearing: the consumer's `entry.ts` imports the wasm module via a relative path that resolves to `<plugin-dir>/pkg/` at bundle time (see Task 4.3 Step 2). Don't stage wasm output to a tmp dir — `bun build` needs the import path to resolve to a real on-disk location during bundling. The `pkg/` directory is gitignored (it's generated).

- [ ] **Step 3: Add the wasm-pack prerequisite check to pre-flight** (call this from any builder before bundling, if the config has plugins).

In `build/mod.rs`, add a `check_prereqs()` that runs once at the top of `run_build`/`run_dev` and verifies `wasm-pack --version` works if `config.plugins` is non-empty.

### Task 4.2: Automatic plugin compilation in build/dev

**Files:**
- Modify: `packages/tools/crates/furnace-cli/src/build/mod.rs`
- Modify: `packages/tools/crates/furnace-cli/src/jsbundle.rs` (the bundle's tmp dir needs the pkg/ output copied next to the JS so imports resolve)
- Modify: `packages/tools/crates/furnace-cli/src/dev/mod.rs` (re-compile wasm on change too)

**Convention for Phase 4:** `furnace.config.json`'s `plugins` field is a list of paths relative to the project root, e.g. `"plugins": ["plugins/demo-wasm"]`. Each path points at a directory containing a `Cargo.toml`.

- [ ] **Step 1: Iterate `config.plugins` before bundling.**

In `run_build` (after pre-flight, before `bundle()`), iterate:

```rust
for plugin_rel in &ctx.config.plugins {
    let crate_path = ctx.paths.root.join(plugin_rel);
    // Output goes IN the plugin dir at <crate>/pkg/. The consumer's JS imports
    // it via relative path — staging to tmp would break import resolution.
    let out_dir = crate_path.join("pkg");
    wasm::compile(wasm::WasmRequest { crate_path: &crate_path, out_dir: &out_dir, release: true })?;
}
```

Add `.gitignore` documentation that `plugins/*/pkg/` is generated (Task 4.3 covers this for hello-world).

- [ ] **Step 2: Same plumbing in `run_dev` — pre-compile plugins on startup and watch their sources.**

In `run_dev` (Phase 3 source), before the initial `bundle()` call, add a pre-compile loop matching `run_build`'s:

```rust
for plugin_rel in &config.plugins {
    let crate_path = paths.root.join(plugin_rel);
    wasm::compile(wasm::WasmRequest { crate_path: &crate_path, out_dir: &crate_path.join("pkg"), release: false })?;
}
```

(Note: `config` and `paths` are the locals in `run_dev`, not `ctx.config` / `ctx.paths`.)

Then extend the watcher to cover plugin sources:

```rust
let plugin_src_paths: Vec<PathBuf> = config.plugins.iter()
    .map(|p| paths.root.join(p).join("src"))
    .collect();
let mut watch_paths: Vec<&Path> = vec![&source_dir];
watch_paths.extend(plugin_src_paths.iter().map(|p| p.as_path()));
let (_watcher, rx) = watch::watch(&watch_paths)?;
```

On change events, distinguish plugin-source events from JS-source events by path prefix. If the event path is under any plugin's directory, re-run `wasm::compile` for that plugin before re-bundling JS. Otherwise just re-bundle JS. Either way, end with `server.broadcast("reload")`.

### Task 4.3: Demo wasm plugin in hello-world

**Files:**
- Create: `packages/hello-world/plugins/demo-wasm/Cargo.toml`
- Create: `packages/hello-world/plugins/demo-wasm/src/lib.rs`
- Modify: `packages/hello-world/furnace.config.json` (`"plugins": ["plugins/demo-wasm"]`)
- Modify: `packages/hello-world/src/entry.ts` (import the wasm module and call its function during boot)

- [ ] **Step 1: Write the crate.**

`Cargo.toml`:
```toml
[package]
name = "demo-wasm"
version = "0.0.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"
```

`src/lib.rs`:
```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn add(a: i32, b: i32) -> i32 { a + b }
```

- [ ] **Step 2: Use it in hello-world's entry.**

Add to `packages/hello-world/src/entry.ts` near the top of bootstrap:

```ts
import init, { add } from "../plugins/demo-wasm/pkg/demo_wasm";
await init();
console.log("demo-wasm: 2 + 3 =", add(2, 3));
```

The relative import resolves at bundle time because the CLI ran `wasm::compile` with `out_dir = plugins/demo-wasm/pkg` (Task 4.2 Step 1), populating that directory before `bun build` is invoked.

Also add `plugins/*/pkg/` to `packages/hello-world/.gitignore`.

- [ ] **Step 3: Smoke-test.**

```bash
bun run --cwd packages/hello-world build:macos
open packages/hello-world/dist/macos/hello-world.app
# Open Console.app, filter by hello-world; confirm "demo-wasm: 2 + 3 = 5" log line
```

- [ ] **Step 4: Commit (in two atomic commits — pipeline first, then plugin).**

```bash
git add packages/tools/crates/furnace-cli/src/wasm.rs packages/tools/crates/furnace-cli/src/build/mod.rs packages/tools/crates/furnace-cli/src/dev/mod.rs packages/tools/crates/furnace-cli/src/jsbundle.rs packages/tools/crates/furnace-cli/src/main.rs
git commit -m "feat(tools): furnace wasm command + automatic plugin compilation in build/dev"

git add packages/hello-world/plugins/ packages/hello-world/furnace.config.json packages/hello-world/src/entry.ts
git commit -m "feat(hello-world): demo wasm plugin exercising the new pipeline"
```

### Phase 4 verification gate

- [ ] **Before starting Phase 5:**

```bash
bun run --cwd packages/hello-world build:macos
open packages/hello-world/dist/macos/hello-world.app    # check Console.app for the wasm log
bun run --cwd packages/hello-world dev:native           # edit lib.rs, confirm reload picks up the change, close
bun test
cargo test --manifest-path packages/tools/crates/Cargo.toml
bunx tsc --noEmit
bun run check
```

---

## Phase 5 — `furnace init` + scaffolding + shim polish

**Goal:** `furnace init <name> --platform=macos` scaffolds a fresh project that builds and runs without any manual file creation. The shim and package layout are ready for npm publish (the actual publish is out of scope — that's the eventual-publishing concern in the spec).

**End-state:**
- `bunx furnace init /tmp/test-game --platform=macos` produces a buildable project (the same shape as hello-world's manually-seeded layout).
- `cd /tmp/test-game && bun install && bunx furnace build --platform=macos` works (uses the in-repo workspace via `bun link` or the @furnace/tools tarball).
- `packages/tools/templates/` exists with all the template files.
- `packages/tools/shim.js` includes a `prepare` step or first-run check that resolves the binary correctly when installed via npm (today's path-based lookup still works in-workspace; this is the path-when-published refinement).

### Task 5.1: Scaffold templates

**Files:**
- Create: `packages/tools/templates/shared/furnace.config.json.tmpl`
- Create: `packages/tools/templates/shared/package.json.tmpl`
- Create: `packages/tools/templates/shared/src-furnace/main.rs.tmpl`
- Create: `packages/tools/templates/shared/src-furnace/Cargo.toml.tmpl`
- Create: `packages/tools/templates/shared/src/index.html.tmpl`
- Create: `packages/tools/templates/shared/src/main.ts.tmpl`
- Create: `packages/tools/templates/shared/.gitignore.tmpl`
- Create: `packages/tools/templates/macos/Info.plist.tmpl`
- Create: `packages/tools/templates/macos/entitlements.plist.tmpl`

Each `.tmpl` file uses `${VAR}` substitution placeholders (same syntax as Phase 2's Info.plist substitution). Variables: `${NAME}`, `${BUNDLE_ID}`, `${VERSION}`.

> **Source of truth:** derive every template from hello-world's **current committed state**, not from this plan's example snippets — Phase 2 refactored hello-world's `src-furnace/` (no `build.rs`, no `dirs`/`tar` deps, `main.rs` uses `resolve_assets_dir()` with the `FURNACE_DEV_CACHE_DIR` branch from Phase 3, etc.). The plan body predates those changes; the templates must match the shipped layout. See the Phase 2 deviations errata for context.

- [ ] **Step 1: Copy hello-world's manually-seeded files into templates with placeholders substituted back.**

For example, `furnace.config.json.tmpl`:

```jsonc
{
  "identity": {
    "name": "${NAME}",
    "bundleId": "${BUNDLE_ID}",
    "version": "${VERSION}"
  },
  "source": "src/",
  "entry": "index.html",
  "window": {
    "title": "${NAME}",
    "width": 1280,
    "height": 720,
    "fullscreen": false
  },
  "plugins": []
}
```

Repeat for each template file based on the hello-world reference.

- [ ] **Step 2: Also vendor a copy of `furnace-runtime/` into the templates** at `packages/tools/templates/shared/src-furnace/runtime/`.

```bash
cp -r packages/tools/crates/furnace-runtime packages/tools/templates/shared/src-furnace/runtime
```

Then convert the Cargo.toml to standalone (same as Phase 2 Task 2.1 Step 4).

This is what `furnace init` will copy verbatim into the consumer's repo.

### Task 5.2: Implement `furnace init`

**Files:**
- Create: `packages/tools/crates/furnace-cli/src/init.rs`
- Modify: `packages/tools/crates/furnace-cli/src/main.rs` (wire `Command::Init`)
- Modify: `packages/tools/crates/furnace-cli/Cargo.toml` (add `walkdir = "2"`)

- [ ] **Step 1: Locate templates at runtime.**

```rust
use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

fn templates_root() -> Result<PathBuf> {
    // Walk up from the CLI binary's location to find packages/tools/templates/.
    // In-repo: <repo>/dist/rust/release/furnace → ../../../packages/tools/templates
    // When shipped via npm: <pkg>/furnace → ../templates (sibling of shim.js)
    let exe = std::env::current_exe()?;
    let parent = exe.parent().context("no exe parent")?;
    let candidates = [
        parent.join("../templates"),                   // shipped layout
        parent.join("../../../packages/tools/templates"),  // in-repo dev layout
    ];
    for c in &candidates {
        if c.exists() {
            return Ok(c.canonicalize()?);
        }
    }
    bail!("could not locate furnace templates directory");
}
```

- [ ] **Step 2: Implement `init` — copies the templates with substitution.**

```rust
pub fn run_init(name: &str, platform: &str, dest: &Path) -> Result<()> {
    if dest.exists() && dest.read_dir()?.next().is_some() {
        bail!("destination {} exists and is non-empty", dest.display());
    }
    std::fs::create_dir_all(dest)?;
    let templates = templates_root()?;
    let bundle_id = format!("com.example.{}", name.replace('-', ""));
    let vars = [
        ("${NAME}", name),
        ("${BUNDLE_ID}", bundle_id.as_str()),
        ("${VERSION}", "0.0.0"),
    ];
    copy_with_substitution(&templates.join("shared"), dest, &vars)?;
    copy_with_substitution(&templates.join(platform), &dest.join("platforms").join(platform), &vars)?;
    println!("✓ scaffolded {} at {}", name, dest.display());
    Ok(())
}

fn copy_with_substitution(src: &Path, dst: &Path, vars: &[(&str, &str)]) -> Result<()> {
    for entry in walkdir::WalkDir::new(src) {
        let entry = entry?;
        let rel = entry.path().strip_prefix(src)?;
        let dst_path = dst.join(rel.to_string_lossy().trim_end_matches(".tmpl"));
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&dst_path)?;
        } else if entry.path().extension().and_then(|e| e.to_str()) == Some("tmpl") {
            let mut text = std::fs::read_to_string(entry.path())?;
            for (k, v) in vars { text = text.replace(k, v); }
            std::fs::write(&dst_path, text)?;
        } else {
            std::fs::create_dir_all(dst_path.parent().context("no parent")?)?;
            std::fs::copy(entry.path(), &dst_path)?;
        }
    }
    Ok(())
}
```

- [ ] **Step 3: Wire `Command::Init` in `main.rs`.**

```rust
        Command::Init { name, platform } => {
            let dest = std::env::current_dir()?.join(&name);
            init::run_init(&name, &platform, &dest)
        }
```

If a caller wants a custom destination (e.g., `furnace init /tmp/foo --platform=macos`), accept an optional `--dir` arg. For Phase 5 keep it simple: `<name>` is also the directory name relative to cwd.

- [ ] **Step 4: Smoke-test init from scratch.**

```bash
cargo build --manifest-path packages/tools/crates/Cargo.toml --release
cd /tmp
rm -rf test-game
bunx --cwd /Users/roberto.sousa/Documents/Projects/furnace furnace init test-game --platform=macos
ls -la /tmp/test-game/
```

Expected: directory contains `furnace.config.json`, `package.json`, `platforms/macos/`, `src-furnace/`, `src/`, `.gitignore`.

```bash
cd /tmp/test-game
bun install
bunx --cwd /Users/roberto.sousa/Documents/Projects/furnace furnace build --platform=macos
open dist/macos/test-game.app
```

Expected: a `.app` is produced. (Skip the open step if running headless.)

> **Note on `bunx --cwd <repo>` invocation:** until `@furnace/tools` is npm-published, an external project needs to invoke the in-repo binary. Two options: (a) `bun link` from the workspace and `bun link @furnace/tools` in the new project; (b) call the binary by absolute path. For Phase 5 we test via option (a) — document it. Real npm publish is deferred.

### Task 5.3: Shim polish for publish-ready resolution

**Files:**
- Modify: `packages/tools/shim.js` (add OPTIONAL_DEPS fallback path — looks up `@furnace/tools-<os>-<arch>/furnace` via `import.meta.resolve` even though those packages don't exist yet; harmless when missing)
- Modify: `packages/tools/package.json` (add `files` array constraining what gets published)

- [ ] **Step 1: Extend shim with biome-style optional-dep lookup.**

```js
#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const exe = process.platform === "win32" ? "furnace.exe" : "furnace";
const triple = `${process.platform}-${process.arch}`;
const subpackage = `@furnace/tools-${triple}`;

const candidates = [];
// 1. Per-platform subpackage (biome pattern, future).
try {
  const req = createRequire(import.meta.url);
  const subpath = req.resolve(`${subpackage}/package.json`);
  candidates.push(resolve(dirname(subpath), exe));
} catch { /* not installed; fine */ }
// 2. Sibling of the shim (single-package model — Phase 1–5 today).
candidates.push(resolve(here, exe));
// 3. In-repo dev paths.
candidates.push(resolve(here, "../../dist/rust/debug", exe));
candidates.push(resolve(here, "../../dist/rust/release", exe));

const binary = candidates.find(existsSync);
if (!binary) {
  console.error(`furnace: binary not found. Looked in:\n  ${candidates.join("\n  ")}`);
  console.error(`Run \`cargo build --manifest-path packages/tools/crates/Cargo.toml\` first.`);
  process.exit(1);
}
const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
```

- [ ] **Step 2: Add a `files` allowlist to `package.json`** so a future `npm publish` only ships shipped artifacts.

```jsonc
{
  ...
  "files": [
    "shim.js",
    "furnace",
    "templates/",
    "crates/furnace-runtime/"
  ],
  ...
}
```

(`furnace` — the binary copy — doesn't exist as a sibling of shim.js yet; that's the future biome-pattern subpackage's job. The placeholder is harmless until then.)

- [ ] **Step 3: Commit.**

```bash
git add packages/tools/crates/furnace-cli/src/init.rs packages/tools/crates/furnace-cli/src/main.rs packages/tools/templates/ packages/tools/shim.js packages/tools/package.json
git commit -m "$(cat <<'EOF'
feat(tools): furnace init + scaffolding templates + publish-ready shim

Phase 5 of native-shell milestone-1.

\`furnace init <name> --platform=macos\` scaffolds a buildable project from
templates under packages/tools/templates/. Variables (\${NAME}, \${BUNDLE_ID},
\${VERSION}) are substituted; runtime source is vendored verbatim.

shim.js now resolves per-platform subpackages (biome pattern) first, falling
back to a sibling binary (single-package model) and in-repo dev paths. The
biome-pattern subpackages aren't published yet — added now so the migration in
the future is data, not code.

package.json gains a \`files\` allowlist constraining what an eventual
\`npm publish\` ships.
EOF
)"
```

### Task 5.4: BACKLOG hygiene + final docs sweep

**Files:**
- Modify: `.docs/BACKLOG.md`
- Modify: `packages/tools/README.md`

- [ ] **Step 1: Remove the `.app` wrapping + asset bundling entries** (now implemented by milestone 1). The plan committed them as the implementation starting point; with milestone 1 done they're absorbed.

In `.docs/BACKLOG.md`, find the "Native packaging — `.app` wrapping + asset bundling (PAIRED)" section with entries (a) and (b). Delete the entire section (the heading and both sub-entries).

- [ ] **Step 2: Add a new BACKLOG entry for granular HMR** (Phase 3 used full-reload; granular HMR was deferred).

Under `## Native runtime`, add:

```markdown
### Granular module HMR
**Context:** Phase 3 of milestone 1 shipped full-reload HMR — any source change triggers `location.reload()` in the WebView. Granular HMR (Vite-style — only the changed module re-evaluates, app state persists) is meaningfully better DX but a substantially larger implementation. Requires a JS-side runtime that subscribes to module-update messages, an ESM module graph the dev bundler tracks, and a protocol over the existing WebSocket channel. Vite's HMR API or Bun's `--hot` graph are precedents to crib from.
**Trigger to revisit:** Full-reload HMR becomes painful enough that consumers ask for it, OR furnace's own first-party plugins need hot-swappable state. Estimated trigger: 3-6 months of dogfooding milestone 1.
**Reference:** Vite's HMR API documentation; Bun's `--hot` reload graph; `furnace dev` source at `packages/tools/crates/furnace-cli/src/dev/`.

```

- [ ] **Step 3: Update `packages/tools/README.md`** to reflect Phase 5 end-state.

Replace the Consumer surface bullet:

Find:
```markdown
- `furnace` (bin) — public CLI (Rust binary via `shim.js`). Commands defined: `build`, `dev`, `wasm`, `init`, `upgrade-runtime`. Only the hidden `native` bridge is implemented today; the others return "not yet implemented" with the phase they land in. See `docs/superpowers/plans/2026-05-19-native-shell-milestone-1.md` for the active implementation plan.
```

Replace with:
```markdown
- `furnace` (bin) — public CLI (Rust binary via `shim.js`). Commands: `init`, `build`, `dev`, `wasm`. `upgrade-runtime` is stubbed pending a use-case. See `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md` for the architecture and `.docs/packaging-and-distribution.md` §6 for the distribution model.
```

- [ ] **Step 4: Commit.**

```bash
git add .docs/BACKLOG.md packages/tools/README.md
git commit -m "$(cat <<'EOF'
docs: BACKLOG and tools README updates for milestone-1 completion

- Removes the .app wrapping (a)+(b) backlog entries — absorbed by milestone 1.
- Adds a granular-module-HMR backlog entry for the deferred richer dev DX.
- Updates packages/tools/README.md Consumer surface to reflect the now-shipping
  CLI surface (init, build, dev, wasm).
EOF
)"
```

### Phase 5 verification gate (milestone 1 complete)

- [ ] **Full milestone-1 acceptance suite.**

```bash
# Clean working tree (except pre-existing modifications).
git status --short

# Fresh scaffold builds and boots.
rm -rf /tmp/test-game
bunx --cwd $(pwd) furnace init test-game --platform=macos
# Manually inspect /tmp/test-game layout.
cd /tmp/test-game && bun install
# (Skipping the `bun link` plumbing comment from Task 5.2 Step 4 is OK if templates already use workspace paths during in-repo testing.)
bunx --cwd /Users/roberto.sousa/Documents/Projects/furnace furnace build --platform=macos
open dist/macos/test-game.app
cd -

# Hello-world still works.
bun run --cwd packages/hello-world build:macos
bun run --cwd packages/hello-world dev:native      # edit something, confirm reload, close

# Full repo suite.
cargo test --manifest-path packages/tools/crates/Cargo.toml
bun test
bunx tsc --noEmit
bun run check
```

Expected: every step succeeds. Milestone 1 of the native-shell design is complete.

---

## Done state

When this plan completes:

- The Cargo workspace at `packages/tools/crates/` is the home for `furnace-cli` and `furnace-runtime`.
- `furnace init / build / dev / wasm` all work end-to-end on macOS Apple Silicon.
- Hello-world is rewired through the new CLI; the legacy `furnace-window` crate is retired.
- `bunx furnace` works in-repo via the JS shim resolving to the cargo build output.
- Templates exist for scaffolding fresh projects.
- A demo wasm plugin in hello-world proves the plugin pipeline works end-to-end.
- BACKLOG cleanup: `.app` wrapping (a)+(b) entries removed (absorbed); granular HMR added (newly deferred).

**Subsequent work (separate plans / sessions):**
- The Runtime Contract Spec (per BACKLOG, deferred from the design spec).
- The Plugin API Spec (same).
- `furnace.config.json` schema spec (same).
- Per-platform milestones: Windows, then iOS/Android once WebGPU-in-WebView matures.
- Per-platform CLI binary packages (biome pattern migration) at platform #2.
- Granular module HMR (per the new BACKLOG entry).
- npm publish flow + CI matrix (eventual-publishing concerns from the design spec).
