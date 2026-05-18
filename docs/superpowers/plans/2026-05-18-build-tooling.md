# Build Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure furnace's build tooling: introduce `@furnace/tools` workspace package (internal helpers + minimal `furnace native` CLI), move the Rust launcher crate from `core` to `tools`, stage publish-ready layouts for `@furnace/core` and `@furnace/tools`, fix native dev UX stdio leakage, and rewire `hello-world` to dogfood tools' CLI.

**Architecture:** Per-package build ownership. Only `@furnace/tools` produces binaries; everything else is TypeScript or wasm. `@furnace/core` becomes pure engine code (TS source + future wasm). `@furnace/tools` owns the Rust window launcher, internal build helpers, and (initially) a single-command CLI (`furnace native`). `hello-world` invokes `bunx furnace native` for native dev, dogfooding the consumer experience.

**Tech Stack:** Bun (runtime, bundler, test runner, `bun:$` shell), TypeScript strict mode, Rust 2021 (`winit` + `wry` for the launcher), Biome (lint).

**Reference:** [`../specs/2026-05-18-build-tooling-design.md`](../specs/2026-05-18-build-tooling-design.md) and [`../../../.docs/packaging-and-distribution.md`](../../../.docs/packaging-and-distribution.md).

---

## Pre-flight

Confirm the working tree is clean and we're on `master` (or branch off it):

```bash
git status
git rev-parse --abbrev-ref HEAD
```

Expected: clean tree on `master`. If not, stash or branch before starting.

**License choice:** This plan defaults to MIT. If a different license is wanted, edit Task 1 step 4 (the `LICENSE` content) before starting, and apply the same change in Task 11 step 1 (tools `LICENSE`) and Task 12 step 1 (core `LICENSE`).

---

## Task 1: Create `packages/tools/` skeleton

**Files:**
- Create: `packages/tools/package.json`
- Create: `packages/tools/tsconfig.json`
- Create: `packages/tools/.gitignore`
- Create: `packages/tools/LICENSE`
- Create: `packages/tools/src/internal/.gitkeep`
- Create: `packages/tools/src/public/.gitkeep`
- Create: `packages/tools/tests/.gitkeep`

- [ ] **Step 1: Create `packages/tools/package.json`**

```json
{
  "name": "@furnace/tools",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./internal": "./src/internal/index.ts"
  },
  "bin": {
    "furnace": "./src/public/cli.ts"
  },
  "scripts": {
    "build": "bun scripts/build.ts",
    "build:native": "bun scripts/build.ts --native-only",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create `packages/tools/tsconfig.json` (extends root, scopes typecheck to this package)**

```json
{
  "extends": "../../tsconfig.json",
  "include": ["src/**/*", "tests/**/*", "scripts/**/*"]
}
```

(Adding `include` scopes `bunx tsc --noEmit` to this package's files only. Without it, tsc walks up to the root config and would typecheck the whole workspace per package.)

- [ ] **Step 3: Create `packages/tools/.gitignore`**

```
node_modules/
```

- [ ] **Step 4: Create `packages/tools/LICENSE` (MIT)**

```
MIT License

Copyright (c) 2026 furnace contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 5: Create empty `.gitkeep` files for source/test dirs**

```bash
mkdir -p packages/tools/src/internal packages/tools/src/public packages/tools/tests
touch packages/tools/src/internal/.gitkeep
touch packages/tools/src/public/.gitkeep
touch packages/tools/tests/.gitkeep
```

- [ ] **Step 6: Run `bun install` to register the workspace package**

Run: `bun install`
Expected: lockfile updates without errors. `bun.lockb` (or `bun.lock`) is regenerated.

Note: Bun creates package symlinks lazily — `@furnace/tools` only appears in another package's `node_modules/` once a consumer declares it as a dependency. That happens in Tasks 11 and 12. For now, only verify the install ran cleanly.

- [ ] **Step 7: Commit**

```bash
git add packages/tools/
git commit -m "feat(tools): scaffold @furnace/tools workspace package"
```

---

## Task 2: Move native crate from `core` to `tools`

**Files:**
- Move: `packages/core/native/` → `packages/tools/native/` (entire directory)
- Modify: `packages/core/package.json` (remove `build:native` script)
- Modify: `package.json` (root: update `build:native` to point at tools)
- Modify: `packages/hello-world/package.json` (`dev:native` repointed to `../tools`)

- [ ] **Step 1: Verify path math holds**

The crate's `EXAMPLE_DIR` constant in `main.rs` is:

```rust
const EXAMPLE_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../hello-world");
```

From `packages/core/native/` that's `packages/hello-world/`. From `packages/tools/native/` it's *also* `packages/hello-world/` (both are at depth 2 from workspace root). **No source change needed in `main.rs` for the move itself.**

- [ ] **Step 2: Move the crate**

```bash
git mv packages/core/native packages/tools/native
```

Verify: `ls packages/tools/native/` shows `Cargo.toml`, `Cargo.lock`, `src/main.rs`. `packages/core/native` is gone.

- [ ] **Step 3: Remove core's `build:native` script**

Edit `packages/core/package.json` — remove the `build:native` line. After:

```json
{
  "name": "@furnace/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  }
}
```

- [ ] **Step 4: Add a temporary `build:native` script to tools**

Edit `packages/tools/package.json` — replace the existing `scripts` block with:

```json
"scripts": {
  "build:native": "cargo build --release --manifest-path native/Cargo.toml && mkdir -p ../../dist/native && cp -f ../../target/release/furnace-window ../../dist/native/furnace-window",
  "test": "bun test",
  "typecheck": "bunx tsc --noEmit"
}
```

(The `build` and `build:native` defined in Task 1 will be re-introduced in Task 10. This temporary inline script keeps `dev:native` working between steps.)

- [ ] **Step 5: Update root `package.json` `build:native`**

Edit root `package.json` — change `build:native` from `packages/core` to `packages/tools`:

```json
"build:native": "bun run --cwd packages/tools build:native"
```

- [ ] **Step 6: Update hello-world's `dev:native` to point at the new location**

Edit `packages/hello-world/package.json` — change the cwd reference:

```json
"dev:native": "bun run --cwd ../tools build:native && ../../dist/native/furnace-window"
```

- [ ] **Step 7: Verify cargo build succeeds**

Run: `bun run build:native`
Expected: cargo builds successfully; binary appears at `dist/native/furnace-window`.

- [ ] **Step 8: Verify `dev:native` end-to-end**

Run: `bun run dev:native`
Expected: launcher window opens with the triangle + FPS overlay. Close it cleanly.

(Stdio noise still present at this point — fixed in Task 3.)

- [ ] **Step 9: Commit**

```bash
git add packages/core/package.json packages/tools/package.json packages/tools/native/ packages/hello-world/package.json package.json
git commit -m "refactor(tools): move furnace-window crate from core to tools"
```

---

## Task 3: Investigate and fix native dev UX (stdio leakage)

**Files:**
- Modify: `packages/tools/native/src/main.rs`

- [ ] **Step 1: Reproduce the symptom**

Run: `bun run dev:native`
Observe: note the exact terminal output between command invocation and the launcher window appearing. Capture the relevant lines for the fix verification later.

Likely culprits (per the spec investigation guidance):
- Bun child's `stderr` is inherited (only `stdout` is `Stdio::piped()` in `spawn_bun_dev`).
- The native binary prints its own informational message: `println!("furnace-window: connected to bun on port {port}")` (line 117 of `main.rs`).
- The Bun child's stdout is piped but the reader thread, after detecting `PORT=…`, keeps buffering lines that go nowhere visible.

- [ ] **Step 2: Apply the fix — pipe stderr and gate the informational println**

Open `packages/tools/native/src/main.rs` and apply two changes.

**Change A: `spawn_bun_dev` — pipe stderr to null.**

Replace:

```rust
fn spawn_bun_dev() -> Child {
    // Note: no `--hot`. Hot reload + `port: 0` could pick a different port on each
    // re-execution, leaving the webview pointing at a dead address. The browser
    // path uses `--hot` directly; the native window simply restarts when needed.
    Command::new("bun")
        .current_dir(EXAMPLE_DIR)
        .args(["serve.ts"])
        .stdout(Stdio::piped())
        .spawn()
        .expect("failed to spawn `bun serve.ts`. Is bun installed and on PATH?")
}
```

With:

```rust
fn spawn_bun_dev() -> Child {
    // Note: no `--hot`. Hot reload + `port: 0` could pick a different port on each
    // re-execution, leaving the webview pointing at a dead address. The browser
    // path uses `--hot` directly; the native window simply restarts when needed.
    //
    // stdout is piped so we can read the PORT=<n> handshake line.
    // stderr is dropped (Stdio::null) so Bun warnings/diagnostics don't leak
    // into the parent terminal. Set FURNACE_VERBOSE=1 to inherit stderr for
    // debugging.
    let stderr = if std::env::var("FURNACE_VERBOSE").is_ok() {
        Stdio::inherit()
    } else {
        Stdio::null()
    };

    Command::new("bun")
        .current_dir(EXAMPLE_DIR)
        .args(["serve.ts"])
        .stdout(Stdio::piped())
        .stderr(stderr)
        .spawn()
        .expect("failed to spawn `bun serve.ts`. Is bun installed and on PATH?")
}
```

**Change B: gate the informational println behind `FURNACE_VERBOSE`.**

Replace line 117:

```rust
println!("furnace-window: connected to bun on port {port}");
```

With:

```rust
if std::env::var("FURNACE_VERBOSE").is_ok() {
    eprintln!("furnace-window: connected to bun on port {port}");
}
```

(Using `eprintln!` since this is diagnostic output, not program output.)

- [ ] **Step 3: Rebuild and verify the terminal stays clean**

```bash
bun run build:native
bun run dev:native
```

Expected:
- Launcher window opens with the triangle.
- The terminal that ran `dev:native` shows only the shell prompt — no `PORT=…`, no `furnace-window: connected…`, no Bun warnings.
- Closing the window returns control to the prompt without leaving zombie processes (`ps aux | grep furnace-window` should show nothing).

If output still appears, investigate further:
- Run `FURNACE_VERBOSE=1 bun run dev:native` — should show diagnostics now. Compare what was leaking before.
- If a *new* Terminal.app window opens (rather than output in the existing terminal), the issue is macOS launching Terminal.app for the binary — that requires `.app` bundling, which is out of scope for this work. Document the discrepancy in `.docs/BACKLOG.md` and move on.

- [ ] **Step 4: Verify FURNACE_VERBOSE produces diagnostics**

Run: `FURNACE_VERBOSE=1 bun run dev:native`
Expected: `furnace-window: connected to bun on port <n>` appears, and any Bun stderr appears.

Close the window and confirm clean shutdown.

- [ ] **Step 5: Commit**

```bash
git add packages/tools/native/src/main.rs
git commit -m "fix(tools/native): suppress Bun child stderr and informational println by default

Gate diagnostic output behind FURNACE_VERBOSE=1 so the normal dev:native flow
shows only the launcher window. Bun's stderr is dropped (Stdio::null) and the
'connected to bun on port' line is suppressed unless verbose mode is on."
```

---

## Task 4: Implement `@furnace/tools/internal/rust.ts` — `compileNativeCrate`

**Files:**
- Create: `packages/tools/src/internal/rust.ts`
- Create: `packages/tools/tests/internal/rust.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/tools/tests/internal/rust.test.ts`:

```ts
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { compileNativeCrate } from "../../src/internal/rust.ts";

test("compileNativeCrate: throws a helpful error when the manifest does not exist", async () => {
  await expect(
    compileNativeCrate({
      manifestPath: resolve(import.meta.dir, "does-not-exist/Cargo.toml"),
      profile: "release",
      outBinaryDir: resolve(import.meta.dir, "tmp"),
      binaryName: "nope",
    }),
  ).rejects.toThrow(/manifest/i);
});
```

- [ ] **Step 2: Run the test — expect FAIL (module not found)**

Run: `bun test packages/tools/tests/internal/rust.test.ts`
Expected: fails with `Cannot find module '../../src/internal/rust.ts'` or similar.

- [ ] **Step 3: Implement `compileNativeCrate`**

Create `packages/tools/src/internal/rust.ts`:

```ts
import { $ } from "bun";
import { existsSync } from "node:fs";
import { mkdir, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface CompileNativeCrateOptions {
  manifestPath: string;
  profile: "release" | "debug";
  outBinaryDir: string;
  binaryName: string;
}

export async function compileNativeCrate(opts: CompileNativeCrateOptions): Promise<string> {
  const manifestPath = resolve(opts.manifestPath);
  if (!existsSync(manifestPath)) {
    throw new Error(`compileNativeCrate: manifest not found at ${manifestPath}`);
  }

  const profileFlag = opts.profile === "release" ? ["--release"] : [];
  await $`cargo build ${profileFlag} --manifest-path ${manifestPath}`;

  const crateDir = dirname(manifestPath);
  const targetDir = resolve(crateDir, "../../target", opts.profile);
  const exeSuffix = process.platform === "win32" ? ".exe" : "";
  const sourceBinary = join(targetDir, `${opts.binaryName}${exeSuffix}`);

  if (!existsSync(sourceBinary)) {
    throw new Error(`compileNativeCrate: expected binary not found at ${sourceBinary}`);
  }

  await mkdir(opts.outBinaryDir, { recursive: true });
  const destBinary = join(opts.outBinaryDir, `${opts.binaryName}${exeSuffix}`);
  await copyFile(sourceBinary, destBinary);
  return destBinary;
}
```

- [ ] **Step 4: Create `packages/tools/src/internal/index.ts` re-exporting**

```ts
export { compileNativeCrate } from "./rust.ts";
export type { CompileNativeCrateOptions } from "./rust.ts";
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `bun test packages/tools/tests/internal/rust.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck the new files**

Run: `bun run --cwd packages/tools typecheck`
Expected: no errors.

- [ ] **Step 7: Run biome on the new files**

Run: `bunx biome check --write packages/tools/src/internal/ packages/tools/tests/internal/`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/tools/src/internal/rust.ts packages/tools/src/internal/index.ts packages/tools/tests/internal/rust.test.ts
git rm packages/tools/src/internal/.gitkeep packages/tools/tests/.gitkeep
git commit -m "feat(tools/internal): add compileNativeCrate helper"
```

---

## Task 5: Implement `@furnace/tools/internal/publish.ts` — `stageTypeScript`

**Files:**
- Create: `packages/tools/src/internal/publish.ts`
- Create: `packages/tools/tests/internal/publish.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/tools/tests/internal/publish.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageTypeScript } from "../../src/internal/publish.ts";

test("stageTypeScript: copies .ts files preserving directory structure", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "furnace-stage-ts-"));
  try {
    const from = join(tmp, "src");
    const to = join(tmp, "out");
    await mkdir(join(from, "lib"), { recursive: true });
    await writeFile(join(from, "index.ts"), "export const a = 1;\n");
    await writeFile(join(from, "lib", "util.ts"), "export const b = 2;\n");
    await writeFile(join(from, "lib", "util.test.ts"), "/* should be excluded */\n");

    await stageTypeScript({ from, to });

    expect(await Bun.file(join(to, "index.ts")).text()).toBe("export const a = 1;\n");
    expect(await Bun.file(join(to, "lib/util.ts")).text()).toBe("export const b = 2;\n");
    expect(await Bun.file(join(to, "lib/util.test.ts")).exists()).toBe(false);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `bun test packages/tools/tests/internal/publish.test.ts`
Expected: fails (module or function not found).

- [ ] **Step 3: Implement `stageTypeScript`**

Create `packages/tools/src/internal/publish.ts`:

```ts
import { Glob } from "bun";
import { mkdir, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface StageTypeScriptOptions {
  from: string;
  to: string;
}

export async function stageTypeScript(opts: StageTypeScriptOptions): Promise<void> {
  const from = resolve(opts.from);
  const to = resolve(opts.to);
  const glob = new Glob("**/*.ts");

  for await (const relative of glob.scan({ cwd: from })) {
    if (relative.endsWith(".test.ts")) continue;
    const src = join(from, relative);
    const dst = join(to, relative);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
  }
}
```

- [ ] **Step 4: Re-export from `index.ts`**

Edit `packages/tools/src/internal/index.ts` — add:

```ts
export { stageTypeScript } from "./publish.ts";
export type { StageTypeScriptOptions } from "./publish.ts";
```

The full file at this point:

```ts
export { compileNativeCrate } from "./rust.ts";
export type { CompileNativeCrateOptions } from "./rust.ts";
export { stageTypeScript } from "./publish.ts";
export type { StageTypeScriptOptions } from "./publish.ts";
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `bun test packages/tools/tests/internal/publish.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `bun run --cwd packages/tools typecheck && bunx biome check --write packages/tools/src/internal/ packages/tools/tests/internal/`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/tools/src/internal/publish.ts packages/tools/src/internal/index.ts packages/tools/tests/internal/publish.test.ts
git commit -m "feat(tools/internal): add stageTypeScript publish helper"
```

---

## Task 6: Implement `emitDeclarations` in `publish.ts`

**Files:**
- Modify: `packages/tools/src/internal/publish.ts`
- Modify: `packages/tools/src/internal/index.ts`
- Modify: `packages/tools/tests/internal/publish.test.ts`

- [ ] **Step 1: Append the failing test**

Append to `packages/tools/tests/internal/publish.test.ts`:

```ts
import { emitDeclarations } from "../../src/internal/publish.ts";

test("emitDeclarations: emits .d.ts files for a small TS project", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "furnace-emit-dts-"));
  try {
    const srcDir = join(tmp, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      join(srcDir, "index.ts"),
      "export const greet = (n: string): string => `hi ${n}`;\n",
    );

    const baseConfig = join(tmp, "base-tsconfig.json");
    await writeFile(
      baseConfig,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: "ESNext",
          module: "Preserve",
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          verbatimModuleSyntax: true,
          skipLibCheck: true,
        },
      }),
    );

    const outDir = join(tmp, "types");
    await emitDeclarations({ srcDir, outDir, baseConfig });

    const dts = await Bun.file(join(outDir, "index.d.ts")).text();
    expect(dts).toContain("greet");
    expect(dts).toContain("string");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `bun test packages/tools/tests/internal/publish.test.ts -t "emitDeclarations"`
Expected: fails (function not exported).

- [ ] **Step 3: Implement `emitDeclarations`**

Append to `packages/tools/src/internal/publish.ts`:

```ts
import { $ } from "bun";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

export interface EmitDeclarationsOptions {
  srcDir: string;
  outDir: string;
  baseConfig: string;
}

export async function emitDeclarations(opts: EmitDeclarationsOptions): Promise<void> {
  const srcDir = resolve(opts.srcDir);
  const outDir = resolve(opts.outDir);
  const baseConfig = resolve(opts.baseConfig);

  await mkdir(outDir, { recursive: true });

  // Use an ephemeral tsconfig so emit-time include is narrower than typecheck-time include.
  // Extending baseConfig keeps strict mode, moduleResolution, and other settings consistent.
  const tmp = await mkdtemp(join(tmpdir(), "furnace-emit-dts-"));
  try {
    const tempTsconfig = join(tmp, "tsconfig.json");
    await writeFile(
      tempTsconfig,
      JSON.stringify({
        extends: baseConfig,
        compilerOptions: {
          declaration: true,
          emitDeclarationOnly: true,
          noEmit: false,
          outDir,
          rootDir: srcDir,
        },
        include: [join(srcDir, "**/*.ts")],
      }),
    );
    await $`bunx tsc --project ${tempTsconfig}`;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
```

Why the ephemeral tsconfig: TypeScript's `noEmit: true` (set in the root tsconfig) and `allowImportingTsExtensions: true` together require `emitDeclarationOnly: true` to override. Building an inline tsconfig that extends the base and sets the right combination is cleaner than juggling 5+ CLI flags. The narrow `include` prevents emitting types for test files.

- [ ] **Step 4: Re-export from `index.ts`**

Append to `packages/tools/src/internal/index.ts`:

```ts
export { emitDeclarations } from "./publish.ts";
export type { EmitDeclarationsOptions } from "./publish.ts";
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `bun test packages/tools/tests/internal/publish.test.ts -t "emitDeclarations"`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `bun run --cwd packages/tools typecheck && bunx biome check --write packages/tools/src/internal/ packages/tools/tests/internal/`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/tools/src/internal/publish.ts packages/tools/src/internal/index.ts packages/tools/tests/internal/publish.test.ts
git commit -m "feat(tools/internal): add emitDeclarations publish helper"
```

---

## Task 7: Implement `synthesisePackageJson` in `publish.ts`

**Files:**
- Modify: `packages/tools/src/internal/publish.ts`
- Modify: `packages/tools/src/internal/index.ts`
- Modify: `packages/tools/tests/internal/publish.test.ts`

- [ ] **Step 1: Append the failing test**

Append to `packages/tools/tests/internal/publish.test.ts`:

```ts
import { synthesisePackageJson } from "../../src/internal/publish.ts";

test("synthesisePackageJson: drops private, scripts, devDependencies; applies overrides", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "furnace-pkgjson-"));
  try {
    const inputPath = join(tmp, "package.json");
    const outputPath = join(tmp, "out", "package.json");
    await writeFile(
      inputPath,
      JSON.stringify({
        name: "@furnace/core",
        version: "0.0.0",
        private: true,
        type: "module",
        exports: { ".": "./src/index.ts" },
        scripts: { build: "bun scripts/build.ts" },
        devDependencies: { "@furnace/tools": "workspace:*" },
      }),
    );

    await synthesisePackageJson({
      workspaceManifest: inputPath,
      outPath: outputPath,
      overrides: {
        exports: {
          ".": { types: "./types/index.d.ts", default: "./src/index.ts" },
        },
        files: ["src/**", "types/**"],
      },
    });

    const result = JSON.parse(await Bun.file(outputPath).text());
    expect(result.name).toBe("@furnace/core");
    expect(result.version).toBe("0.0.0");
    expect(result.type).toBe("module");
    expect(result.private).toBeUndefined();
    expect(result.scripts).toBeUndefined();
    expect(result.devDependencies).toBeUndefined();
    expect(result.exports["."].types).toBe("./types/index.d.ts");
    expect(result.files).toEqual(["src/**", "types/**"]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `bun test packages/tools/tests/internal/publish.test.ts -t "synthesisePackageJson"`
Expected: fails.

- [ ] **Step 3: Implement `synthesisePackageJson`**

Append to `packages/tools/src/internal/publish.ts`:

```ts
import { writeFile, readFile } from "node:fs/promises";

export interface SynthesisePackageJsonOptions {
  workspaceManifest: string;
  outPath: string;
  overrides?: Record<string, unknown>;
}

const DROPPED_KEYS = ["private", "scripts", "devDependencies"] as const;

export async function synthesisePackageJson(opts: SynthesisePackageJsonOptions): Promise<void> {
  const workspaceManifest = resolve(opts.workspaceManifest);
  const outPath = resolve(opts.outPath);
  const raw = await readFile(workspaceManifest, "utf8");
  const manifest = JSON.parse(raw) as Record<string, unknown>;

  for (const key of DROPPED_KEYS) {
    delete manifest[key];
  }

  if (opts.overrides) {
    for (const [key, value] of Object.entries(opts.overrides)) {
      manifest[key] = value;
    }
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
```

- [ ] **Step 4: Re-export from `index.ts`**

Append to `packages/tools/src/internal/index.ts`:

```ts
export { synthesisePackageJson } from "./publish.ts";
export type { SynthesisePackageJsonOptions } from "./publish.ts";
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `bun test packages/tools/tests/internal/publish.test.ts -t "synthesisePackageJson"`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `bun run --cwd packages/tools typecheck && bunx biome check --write packages/tools/`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/tools/src/internal/publish.ts packages/tools/src/internal/index.ts packages/tools/tests/internal/publish.test.ts
git commit -m "feat(tools/internal): add synthesisePackageJson publish helper"
```

---

## Task 8: Implement `stageAssets` in `publish.ts`

**Files:**
- Modify: `packages/tools/src/internal/publish.ts`
- Modify: `packages/tools/src/internal/index.ts`
- Modify: `packages/tools/tests/internal/publish.test.ts`

- [ ] **Step 1: Append the failing test**

Append to `packages/tools/tests/internal/publish.test.ts`:

```ts
import { stageAssets } from "../../src/internal/publish.ts";

test("stageAssets: copies listed files; skips missing ones with a warning return", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "furnace-assets-"));
  try {
    const from = join(tmp, "src");
    const to = join(tmp, "out");
    await mkdir(from, { recursive: true });
    await writeFile(join(from, "README.md"), "# Hello\n");
    await writeFile(join(from, "LICENSE"), "MIT\n");

    const result = await stageAssets({
      from,
      to,
      files: ["README.md", "LICENSE", "CHANGELOG.md"],
    });

    expect(await Bun.file(join(to, "README.md")).text()).toBe("# Hello\n");
    expect(await Bun.file(join(to, "LICENSE")).text()).toBe("MIT\n");
    expect(await Bun.file(join(to, "CHANGELOG.md")).exists()).toBe(false);
    expect(result.copied).toEqual(["README.md", "LICENSE"]);
    expect(result.missing).toEqual(["CHANGELOG.md"]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `bun test packages/tools/tests/internal/publish.test.ts -t "stageAssets"`
Expected: fails.

- [ ] **Step 3: Implement `stageAssets`**

Append to `packages/tools/src/internal/publish.ts`:

```ts
export interface StageAssetsOptions {
  from: string;
  to: string;
  files: string[];
}

export interface StageAssetsResult {
  copied: string[];
  missing: string[];
}

export async function stageAssets(opts: StageAssetsOptions): Promise<StageAssetsResult> {
  const from = resolve(opts.from);
  const to = resolve(opts.to);
  await mkdir(to, { recursive: true });

  const copied: string[] = [];
  const missing: string[] = [];

  for (const file of opts.files) {
    const src = join(from, file);
    if (!(await Bun.file(src).exists())) {
      missing.push(file);
      continue;
    }
    const dst = join(to, file);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
    copied.push(file);
  }

  return { copied, missing };
}
```

- [ ] **Step 4: Re-export from `index.ts`**

Append to `packages/tools/src/internal/index.ts`:

```ts
export { stageAssets } from "./publish.ts";
export type { StageAssetsOptions, StageAssetsResult } from "./publish.ts";
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `bun test packages/tools/tests/internal/publish.test.ts -t "stageAssets"`
Expected: PASS.

- [ ] **Step 6: Verify all tools tests pass**

Run: `bun test packages/tools/`
Expected: all green.

- [ ] **Step 7: Typecheck and lint**

Run: `bun run --cwd packages/tools typecheck && bunx biome check --write packages/tools/`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/tools/src/internal/publish.ts packages/tools/src/internal/index.ts packages/tools/tests/internal/publish.test.ts
git commit -m "feat(tools/internal): add stageAssets publish helper"
```

---

## Task 9: Implement the public CLI — `furnace native`

**Files:**
- Create: `packages/tools/src/public/cli.ts`
- Create: `packages/tools/tests/public/cli.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/tools/tests/public/cli.test.ts`:

```ts
import { expect, test } from "bun:test";
import { resolveCliCommand, BINARY_RELATIVE_PATH } from "../../src/public/cli.ts";

test("resolveCliCommand: 'native' with no flags returns a native command", () => {
  const cmd = resolveCliCommand(["native"]);
  expect(cmd.kind).toBe("native");
  expect(cmd.kind === "native" && cmd.rebuild).toBe(false);
});

test("resolveCliCommand: 'native --rebuild' sets rebuild=true", () => {
  const cmd = resolveCliCommand(["native", "--rebuild"]);
  expect(cmd.kind === "native" && cmd.rebuild).toBe(true);
});

test("resolveCliCommand: missing subcommand returns help", () => {
  const cmd = resolveCliCommand([]);
  expect(cmd.kind).toBe("help");
});

test("resolveCliCommand: unknown subcommand returns error", () => {
  const cmd = resolveCliCommand(["wat"]);
  expect(cmd.kind).toBe("error");
  expect(cmd.kind === "error" && cmd.message).toMatch(/unknown subcommand/i);
});

test("BINARY_RELATIVE_PATH points at workspace dist/native location", () => {
  expect(BINARY_RELATIVE_PATH).toContain("dist/native");
  expect(BINARY_RELATIVE_PATH).toContain("furnace-window");
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `bun test packages/tools/tests/public/cli.test.ts`
Expected: fails (module not found).

- [ ] **Step 3: Implement the CLI**

Create `packages/tools/src/public/cli.ts`:

```ts
#!/usr/bin/env bun
import { $ } from "bun";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type CliCommand =
  | { kind: "native"; rebuild: boolean }
  | { kind: "help" }
  | { kind: "error"; message: string };

export function resolveCliCommand(argv: string[]): CliCommand {
  const [sub, ...rest] = argv;
  if (sub === undefined) return { kind: "help" };

  if (sub === "native") {
    return { kind: "native", rebuild: rest.includes("--rebuild") };
  }

  return { kind: "error", message: `unknown subcommand '${sub}'. Try: furnace native [--rebuild]` };
}

// Resolved relative to this file: packages/tools/src/public/cli.ts → dist/native/
export const BINARY_RELATIVE_PATH = resolve(
  import.meta.dir,
  "../../../../dist/native",
  process.platform === "win32" ? "furnace-window.exe" : "furnace-window",
);

const HELP = `furnace — workspace CLI

Usage:
  furnace native [--rebuild]   Launch the desktop runtime. --rebuild forces a fresh build first.

Environment:
  FURNACE_VERBOSE=1            Show diagnostic output from the launcher and its Bun child.
`;

async function runNative(rebuild: boolean): Promise<number> {
  if (rebuild || !existsSync(BINARY_RELATIVE_PATH)) {
    if (!rebuild) {
      console.error(`furnace: binary not found at ${BINARY_RELATIVE_PATH}, building first...`);
    }
    const toolsRoot = resolve(import.meta.dir, "../..");
    await $`bun run build:native`.cwd(toolsRoot);
  }
  const result = await $`${BINARY_RELATIVE_PATH}`.nothrow();
  return result.exitCode;
}

async function main(): Promise<void> {
  const cmd = resolveCliCommand(process.argv.slice(2));
  switch (cmd.kind) {
    case "help":
      console.log(HELP);
      process.exit(0);
      break;
    case "native":
      process.exit(await runNative(cmd.rebuild));
      break;
    case "error":
      console.error(`furnace: ${cmd.message}`);
      console.error(HELP);
      process.exit(1);
      break;
  }
}

// Only run main() when invoked as a script (not when imported by tests).
if (import.meta.main) {
  await main();
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `bun test packages/tools/tests/public/cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Manual verify: `bunx furnace --help` style invocations**

```bash
bun packages/tools/src/public/cli.ts
```
Expected: prints help, exits 0.

```bash
bun packages/tools/src/public/cli.ts wat
```
Expected: prints `furnace: unknown subcommand 'wat'...`, exits 1.

```bash
bun packages/tools/src/public/cli.ts native
```
Expected: rebuilds if needed, launches the window. Close it cleanly.

- [ ] **Step 6: Verify direct invocation works from the tools dir**

```bash
cd packages/tools && bunx furnace native && cd ../..
```

Expected: from `packages/tools/`, `bunx` should find the local `bin/furnace` entry and launch the window.

The full "`bunx furnace native` from any package dir" check is deferred to Task 12, after `@furnace/tools` is added as a devDep of `@furnace/hello-world` (which is what creates the bin symlink that other dirs in the workspace can resolve).

- [ ] **Step 7: Typecheck and lint**

Run: `bun run --cwd packages/tools typecheck && bunx biome check --write packages/tools/`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/tools/src/public/cli.ts packages/tools/tests/public/cli.test.ts
git rm packages/tools/src/public/.gitkeep
git commit -m "feat(tools/public): add minimal furnace CLI with 'native' subcommand"
```

---

## Task 10: Add `packages/tools/scripts/build.ts`

**Files:**
- Create: `packages/tools/scripts/build.ts`
- Create: `packages/tools/README.md`
- Modify: `packages/tools/package.json` (restore full scripts block)

- [ ] **Step 1: Create `packages/tools/README.md`**

```markdown
# @furnace/tools

Internal build helpers and the public `furnace` CLI for the furnace engine.

## Surfaces

- `@furnace/tools/internal` — workspace-only helpers used by furnace's own build scripts (cargo orchestration, publish staging). Not exposed in the published package.
- `furnace` (bin) — public CLI. Currently supports `furnace native [--rebuild]` to launch the desktop runtime.

This package owns the Rust launcher binary (`native/`) and is the only package in the workspace that produces a native binary.
```

- [ ] **Step 2: Restore the full scripts block in `packages/tools/package.json`**

Replace the temporary `scripts` block with the full one from Task 1:

```json
"scripts": {
  "build": "bun scripts/build.ts",
  "build:native": "bun scripts/build.ts --native-only",
  "test": "bun test",
  "typecheck": "bunx tsc --noEmit"
}
```

- [ ] **Step 3: Create `packages/tools/scripts/build.ts`**

```ts
import { resolve } from "node:path";
import {
  compileNativeCrate,
  stageAssets,
  stageTypeScript,
  synthesisePackageJson,
  emitDeclarations,
} from "../src/internal/index.ts";

const PKG_ROOT = resolve(import.meta.dir, "..");
const WORKSPACE_ROOT = resolve(PKG_ROOT, "../..");
const DIST_TOOLS = resolve(WORKSPACE_ROOT, "dist/tools");
const DIST_NATIVE = resolve(WORKSPACE_ROOT, "dist/native");

const nativeOnly = process.argv.includes("--native-only");

await compileNativeCrate({
  manifestPath: resolve(PKG_ROOT, "native/Cargo.toml"),
  profile: "release",
  outBinaryDir: DIST_NATIVE,
  binaryName: "furnace-window",
});

if (nativeOnly) {
  process.exit(0);
}

await stageTypeScript({
  from: resolve(PKG_ROOT, "src/public"),
  to: resolve(DIST_TOOLS, "src/public"),
});

await emitDeclarations({
  srcDir: resolve(PKG_ROOT, "src/public"),
  outDir: resolve(DIST_TOOLS, "types"),
  baseConfig: resolve(WORKSPACE_ROOT, "tsconfig.json"),
});

await synthesisePackageJson({
  workspaceManifest: resolve(PKG_ROOT, "package.json"),
  outPath: resolve(DIST_TOOLS, "package.json"),
  overrides: {
    exports: {
      "./public/cli": "./src/public/cli.ts",
    },
    files: ["src/public/**", "types/**"],
  },
});

await stageAssets({
  from: PKG_ROOT,
  to: DIST_TOOLS,
  files: ["README.md", "LICENSE"],
});

console.log(`Staged @furnace/tools publish layout at ${DIST_TOOLS}`);
```

- [ ] **Step 4: Run the full build**

Run: `bun run --cwd packages/tools build`
Expected: cargo builds, then publish staging completes. Outputs at `dist/native/furnace-window` and `dist/tools/`.

- [ ] **Step 5: Eyeball the output**

Run: `ls -la dist/tools/ && cat dist/tools/package.json`
Expected:
- `dist/tools/src/public/cli.ts` exists.
- `dist/tools/types/public/cli.d.ts` exists.
- `dist/tools/package.json` is the synthesised manifest (no `private`, no `scripts`, has `bin`).
- `dist/tools/README.md` and `dist/tools/LICENSE` exist.

- [ ] **Step 6: Verify native-only mode**

Run: `rm -rf dist/tools && bun run --cwd packages/tools build:native`
Expected: binary built; `dist/tools/` is **not** created (because `--native-only` skips publish staging).

- [ ] **Step 7: Verify `dev:native` still works**

Run: `bun run dev:native`
Expected: launches cleanly (no regression from Task 3's fix).

- [ ] **Step 8: Typecheck and lint**

Run: `bun run --cwd packages/tools typecheck && bunx biome check --write packages/tools/`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add packages/tools/scripts/build.ts packages/tools/README.md packages/tools/package.json
git commit -m "feat(tools): add scripts/build.ts orchestrator and README"
```

---

## Task 11: Add `packages/core/scripts/build.ts` + core README/LICENSE

**Files:**
- Create: `packages/core/scripts/build.ts`
- Create: `packages/core/README.md`
- Create: `packages/core/LICENSE`
- Modify: `packages/core/package.json` (add `build` script, add `@furnace/tools` devDep)

- [ ] **Step 1: Create `packages/core/README.md`**

```markdown
# @furnace/core

The furnace engine library. Headless. Web-platform APIs only. No framework dependencies.

## Install

```bash
npm install @furnace/core
```

## What you get

- `requestWebGpu` — WebGPU device acquisition with a uniform error shape.
- `runFrameLoop` — `requestAnimationFrame` loop with start/stop semantics.
- `createFpsSystem` / `computeFps` — frame-rate measurement with a subscribe API.

For a working end-to-end example, see the `@furnace/hello-world` package in this repository.

## Consumer portability

`@furnace/core` ships TypeScript source and `.d.ts` declarations. Use any bundler that consumes ESM + TS (Vite, webpack, esbuild, Bun's own bundler, etc.). The public surface uses only web-platform APIs; the `no-bun-leakage` test enforces this.

The desktop runtime is provided by a separate package, [`@furnace/tools`](../tools/README.md). Install it if you need the native launcher.
```

- [ ] **Step 2: Create `packages/core/LICENSE`**

Copy the MIT text from `packages/tools/LICENSE` verbatim (same copyright line).

```bash
cp packages/tools/LICENSE packages/core/LICENSE
```

- [ ] **Step 3: Add `@furnace/tools` as a devDependency of core, and add a `build` script**

Edit `packages/core/package.json` to:

```json
{
  "name": "@furnace/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "bun scripts/build.ts",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  },
  "devDependencies": {
    "@furnace/tools": "workspace:*"
  }
}
```

- [ ] **Step 4: Run `bun install`**

Run: `bun install`
Expected: lockfile updates; `@furnace/tools` linked into `packages/core/node_modules/`.

- [ ] **Step 5: Create `packages/core/scripts/build.ts`**

```ts
import { resolve } from "node:path";
import {
  emitDeclarations,
  stageAssets,
  stageTypeScript,
  synthesisePackageJson,
} from "@furnace/tools/internal";

const PKG_ROOT = resolve(import.meta.dir, "..");
const WORKSPACE_ROOT = resolve(PKG_ROOT, "../..");
const DIST_CORE = resolve(WORKSPACE_ROOT, "dist/core");

await stageTypeScript({
  from: resolve(PKG_ROOT, "src"),
  to: resolve(DIST_CORE, "src"),
});

await emitDeclarations({
  srcDir: resolve(PKG_ROOT, "src"),
  outDir: resolve(DIST_CORE, "types"),
  baseConfig: resolve(WORKSPACE_ROOT, "tsconfig.json"),
});

await synthesisePackageJson({
  workspaceManifest: resolve(PKG_ROOT, "package.json"),
  outPath: resolve(DIST_CORE, "package.json"),
  overrides: {
    exports: {
      ".": {
        types: "./types/index.d.ts",
        default: "./src/index.ts",
      },
    },
    files: ["src/**", "types/**"],
  },
});

await stageAssets({
  from: PKG_ROOT,
  to: DIST_CORE,
  files: ["README.md", "LICENSE"],
});

console.log(`Staged @furnace/core publish layout at ${DIST_CORE}`);
```

- [ ] **Step 6: Create `packages/core/tsconfig.json` (per-package, scopes typecheck to this package)**

```json
{
  "extends": "../../tsconfig.json",
  "include": ["src/**/*", "tests/**/*", "scripts/**/*"]
}
```

(Mirrors the per-package tsconfig added for `@furnace/tools` in Task 1. Scopes `bunx tsc --noEmit` to this package's files. The `emitDeclarations` helper does *not* use this tsconfig — it builds its own ephemeral one — so this is purely for typecheck scoping.)

- [ ] **Step 7: Run core's build**

Run: `bun run --cwd packages/core build`
Expected: `dist/core/` populated. No errors. `dist/core/types/index.d.ts` exists. `dist/core/package.json` has no `private`, no `scripts`, no `devDependencies`.

- [ ] **Step 8: Verify `no-bun-leakage` test still passes**

Run: `bun test packages/core/tests/no-bun-leakage.test.ts`
Expected: PASS. (Adding `@furnace/tools` as a devDep doesn't put it in the `src/lib/` scan, so the test should be unaffected.)

- [ ] **Step 9: Typecheck**

Run: `bun run --cwd packages/core typecheck`
Expected: no errors. (`scripts/build.ts` imports `@furnace/tools/internal` — needs to resolve via the new devDep.)

If typecheck fails on `Cannot find module '@furnace/tools/internal'`, double-check that `packages/tools/package.json` has `"exports": { "./internal": "./src/internal/index.ts" }` and that `bun install` was run after step 3.

- [ ] **Step 10: Lint**

Run: `bunx biome check --write packages/core/`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add packages/core/scripts/build.ts packages/core/README.md packages/core/LICENSE packages/core/package.json packages/core/tsconfig.json
git commit -m "feat(core): add scripts/build.ts for publish-layout staging + README/LICENSE"
```

---

## Task 12: Rewire `hello-world` to use the CLI; add `build:web:dev`

**Files:**
- Modify: `packages/hello-world/package.json`

- [ ] **Step 1: Add `@furnace/tools` as a devDependency of hello-world**

(Ensures `bunx furnace` resolution from inside hello-world's dir works reliably and the CLI shows up in `node_modules/.bin/`.)

Edit `packages/hello-world/package.json`:

```json
"devDependencies": {
  "bun-plugin-svelte": "^0.0.6",
  "svelte": "^5.55.7",
  "@furnace/tools": "workspace:*"
}
```

- [ ] **Step 2: Update `dev:native` and add `build:web:dev`**

Edit `packages/hello-world/package.json` scripts to:

```json
"scripts": {
  "dev": "bun --hot serve.ts",
  "dev:native": "bun run --cwd ../tools build:native && bunx furnace native",
  "build:web": "bun build index.html --outdir ../../dist/web --minify --sourcemap=external",
  "build:web:dev": "bun build index.html --outdir ../../dist/web/dev --sourcemap=inline",
  "test": "bun test",
  "typecheck": "bunx tsc --noEmit"
}
```

- [ ] **Step 3: Run `bun install`**

Run: `bun install`
Expected: lockfile updates.

- [ ] **Step 4: Verify web dev still works**

Run: `bun run dev:web`
Expected: dev server starts; opening the browser shows the triangle.

Stop the server.

- [ ] **Step 5: Verify native dev still works (now via the CLI)**

Run: `bun run dev:native`
Expected: tools' `build:native` runs, then the CLI launches the window. Clean terminal (no stray output). Close cleanly.

- [ ] **Step 6: Verify the new `build:web:dev` flag produces unminified output**

```bash
bun run --cwd packages/hello-world build:web:dev
ls -la dist/web/dev/
```

Expected: `dist/web/dev/index.html` and JS chunk(s) exist. Open one of the JS chunks; it should NOT be minified (readable variable names, comments stripped but layout preserved).

- [ ] **Step 7: Verify prod build still produces minified output**

```bash
rm -rf dist/web && bun run --cwd packages/hello-world build:web
ls -la dist/web/
```

Expected: minified JS chunk(s) at `dist/web/`.

- [ ] **Step 8: Commit**

```bash
git add packages/hello-world/package.json
git commit -m "refactor(hello-world): use furnace CLI for native dev; add build:web:dev"
```

---

## Task 13: Finalise root `package.json` scripts

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Update root scripts to final state**

Replace the existing `scripts` block in root `package.json` with:

```json
"scripts": {
  "dev:web": "bun run --cwd packages/hello-world dev",
  "dev:native": "bun run --cwd packages/hello-world dev:native",
  "build": "bun run build:core && bun run build:tools && bun run build:web",
  "build:core": "bun run --cwd packages/core build",
  "build:tools": "bun run --cwd packages/tools build",
  "build:web": "bun run --cwd packages/hello-world build:web",
  "build:web:dev": "bun run --cwd packages/hello-world build:web:dev",
  "typecheck": "bun run --cwd packages/core typecheck && bun run --cwd packages/tools typecheck && bun run --cwd packages/hello-world typecheck",
  "test": "bun test",
  "check": "biome check",
  "clean": "rm -rf dist target"
}
```

(`build:native` is gone from the root — natives are built by `build:tools`. Use `bun run --cwd packages/tools build:native` if only the binary is needed.)

- [ ] **Step 2: Verify each top-level script**

```bash
bun run clean
bun run check
bun run typecheck
bun run test
bun run build:core
bun run build:tools
bun run build:web
bun run build:web:dev
bun run build      # runs all three sequentially
```

All should pass without errors. After `bun run build`, expected outputs:
- `dist/core/` populated
- `dist/tools/` populated
- `dist/native/furnace-window`
- `dist/web/*.html` + chunks

- [ ] **Step 3: Verify dev scripts still work**

```bash
bun run dev:web    # then Ctrl+C
bun run dev:native # then close window
```

Both work cleanly.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "refactor: simplify root scripts to delegate to per-package builds"
```

---

## Task 14: Verify publish layouts with `npm pack --dry-run`

**Files:** (no files modified unless adjustments are needed)

- [ ] **Step 1: Run `npm pack --dry-run` for core**

```bash
bun run --cwd packages/core build
cd dist/core && npm pack --dry-run 2>&1 | tee /tmp/furnace-core-pack.txt && cd ../..
```

Eyeball the output. Expected file list (verify each):
- `package.json`
- `LICENSE`
- `README.md`
- `src/index.ts`
- `src/lib/**/*.ts` (excluding test files)
- `types/index.d.ts`
- `types/lib/**/*.d.ts`

**Should NOT appear:**
- `tests/**`
- `*.test.ts`
- `scripts/**`
- `node_modules/**`
- `tsconfig.json` (unless we deliberately include it)

If anything is wrong, adjust `files` array in core's `synthesisePackageJson` overrides (in `packages/core/scripts/build.ts`) and rebuild.

- [ ] **Step 2: Run `npm pack --dry-run` for tools**

```bash
bun run --cwd packages/tools build
cd dist/tools && npm pack --dry-run 2>&1 | tee /tmp/furnace-tools-pack.txt && cd ../..
```

Expected file list:
- `package.json`
- `LICENSE`
- `README.md`
- `src/public/cli.ts`
- `types/public/cli.d.ts`

**Should NOT appear:**
- `src/internal/**` (workspace-only — critical to verify)
- `tests/**`
- `scripts/**`
- `native/**` (binary lives in per-platform subpackages, deferred)

If `src/internal/**` appears, the build script's `files` override is wrong — fix it in `packages/tools/scripts/build.ts` and rebuild.

- [ ] **Step 3: Commit any adjustments (if needed)**

If steps 1 or 2 required edits:

```bash
git add packages/core/scripts/build.ts packages/tools/scripts/build.ts
git commit -m "fix(build): adjust publish-layout file lists after pack inspection"
```

If no edits were needed, skip the commit.

---

## Task 15: Update documentation to reflect the new reality

**Files:**
- Modify: `.claude/CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `.docs/BACKLOG.md`

- [ ] **Step 1: Update `.claude/CLAUDE.md`**

Replace the "Project state" section's package list with the three-package layout. The new "Project state" should read approximately:

```markdown
## Project state

A Bun workspace (`workspaces: ["packages/*"]`, Bun v1.3.14) experimenting with WebGPU-based engine architecture, split into a headless engine library, a tooling/launcher package, and a consumer demo.

**Current contents (three workspace packages):**
- `packages/core/` (`@furnace/core`, private) — the engine library. TypeScript source + future wasm hot-path crates. Consumer-portable: no framework deps, no Bun coupling in the public surface (enforced by `tests/no-bun-leakage.test.ts`). Per the engine/harness principle: contains no native binaries.
- `packages/tools/` (`@furnace/tools`, private) — the harness. Owns the Rust `winit + wry` native launcher (`native/`), internal build helpers (`src/internal/`), and the public `furnace` CLI (`src/public/cli.ts`). Per the engine/harness principle: **the only package that produces a binary**.
- `packages/hello-world/` (`@furnace/hello-world`, private) — the reference consumer. Renders the WebGPU triangle with the Svelte 5 FPS overlay. Owns its own `index.html`, `bunfig.toml`, `serve.ts`, and dev-server choice. Imports core via `@furnace/core` (workspace symlink). Uses `bunx furnace native` for native dev — dogfooding the consumer experience.
- Two runtime targets, shared TS/HTML/WGSL between them: `bun run dev:web` (browser tab) and `bun run dev:native` (desktop window — macOS Tahoe 26+ / Windows; Linux deferred per `.docs/BACKLOG.md`).
- Build outputs: `dist/core/` (core publish layout), `dist/tools/` (tools publish layout), `dist/native/` (host-platform binary), `dist/web/` (bundled demo).
- Tooling: Biome for lint, `bun:test` for tests, TypeScript strict mode (noEmit — typechecking only).

For deeper context: `.docs/packaging-and-distribution.md` (publish model, engine/harness principle), `.docs/shallot-and-game-engine-architecture.md` (engine architecture notes), `.docs/BACKLOG.md` (deferred work register), `docs/superpowers/specs/` (design specs for major changes).
```

- [ ] **Step 2: Update `AGENTS.md`**

Update the "Workspace" bullet under TL;DR:

Replace:
```markdown
- **Workspace:** monorepo via Bun workspaces — packages live in `packages/*`. Run package scripts via `bun run --cwd packages/<name> <script>`.
```

With:
```markdown
- **Workspace:** monorepo via Bun workspaces — three packages live in `packages/*`: `@furnace/core` (engine library), `@furnace/tools` (harness + CLI + native launcher), `@furnace/hello-world` (reference consumer). Only `@furnace/tools` produces binaries. Run package scripts via `bun run --cwd packages/<name> <script>`.
```

Under "Canonical references", add this bullet (alphabetical-ish):
```markdown
- `.docs/packaging-and-distribution.md` — publish model, what gets built, what consumers receive.
```

- [ ] **Step 3: Update `README.md` if needed**

```bash
cat README.md
```

Read the file. If it describes the package structure or refers to specific packages, update it to reflect the three-package layout. If it's generic project intro material, leave it alone.

- [ ] **Step 4: Remove the "Build system revisit" entry from `.docs/BACKLOG.md`**

Open `.docs/BACKLOG.md`. Delete the `### Build system revisit` block (under `## Infrastructure`) entirely — this work resolves it.

Verify the adjacent native-related backlog entries are untouched:
- `### Robust child-process cleanup on Rust panic` — still applies (we fixed stdio leakage, not the deeper child-cleanup story).
- `### Native window: focus/activation triggers server respawn` — still applies (separate bug, untouched by this work).

- [ ] **Step 5: Verify no other stale references**

```bash
grep -r "packages/core/native" --include="*.md" .
grep -r "build:native.*core" --include="*.md" .
```

Both should return only this plan and the spec (which describe the historical state). If anywhere else still references the old layout, update it.

- [ ] **Step 6: Commit**

```bash
git add .claude/CLAUDE.md AGENTS.md README.md .docs/BACKLOG.md
git commit -m "docs: update CLAUDE/AGENTS/BACKLOG to reflect three-package layout

Reflects the engine/harness principle and the new @furnace/tools package.
Removes the 'Build system revisit' backlog entry (resolved by this work).
Adds the packaging doc to AGENTS.md canonical references."
```

---

## Final verification

After all tasks land, run the full verification list from the spec:

- [ ] `bun install` succeeds
- [ ] `bun run dev:web` works (no regression)
- [ ] `bun run dev:native` works AND terminal stays clean (only the launcher window)
- [ ] `bun run typecheck` passes for all three packages
- [ ] `bun test` passes (existing tests + new helper tests)
- [ ] `bun run check` (biome) passes
- [ ] `bun run build:core` produces `dist/core/` with TS source, `.d.ts`, synthesised `package.json`, README, LICENSE
- [ ] `bun run build:tools` produces `dist/tools/` (publish layout) and `dist/native/furnace-window`
- [ ] `bun run build:web` and `bun run build:web:dev` both produce expected outputs
- [ ] `npm pack --dry-run` in `dist/core/` and `dist/tools/` lists only intended files
- [ ] `packages/core/tests/no-bun-leakage.test.ts` still passes
- [ ] `bunx furnace native` from any package directory launches the binary
- [ ] `.claude/CLAUDE.md`, `AGENTS.md`, `README.md`, `.docs/BACKLOG.md` all reflect the new three-package layout

If any item fails, fix it before declaring complete.
