# AGENTS.md

Cross-tool AI agent guidance for the `furnace` repo. Single source of truth — Claude Code reads `.claude/CLAUDE.md` which pulls this file in via `@../AGENTS.md`.

## Project state

A Bun workspace (`workspaces: ["packages/*"]`, Bun v1.3.14) experimenting with WebGPU-based engine architecture, split into a headless engine library, a tooling/launcher package, and a consumer demo.

**Foundational rule:** Only `@furnace/tools` produces binaries. Everything else is TypeScript or wasm. See `.docs/packaging-and-distribution.md` for the engine/harness principle.

**Current contents (three workspace packages):**
- `packages/core/` (`@furnace/core`, private) — the engine library. Exports `requestWebGpu`, `runFrameLoop`, `createFpsSystem`, `computeFps`, plus their types. **Browser-only**: no framework deps, no Bun coupling in core's source. The `tests/no-bun-leakage.test.ts` static scan is one guardrail; the full contract lives in "What we ship to consumers" below. Future wasm hot-path crates (transforms, audio) will live here. Contains no native binaries.
- `packages/tools/` (`@furnace/tools`, private) — the harness. Internally a Rust workspace (`crates/furnace-cli/` for the CLI binary, `crates/furnace-runtime/` for the shell consumers vendor) plus scaffold templates and a tiny plain-Node JS shim that wraps the binary for npm distribution (biome's pattern). The only package in the workspace that produces a binary. No TypeScript source — pure orchestration. See `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md` for the architecture.
- `packages/hello-world/` (`@furnace/hello-world`, private) — the reference consumer. Renders the WebGPU triangle with the Svelte 5 FPS overlay. Owns its own `index.html`, `bunfig.toml`, `serve.ts`, and dev-server choice. Imports core via `@furnace/core` (workspace symlink). Uses `furnace dev --platform=macos` for native dev (via `bun run dev:native`) — dogfooding the consumer experience.
- Two runtime targets, shared TS/HTML/WGSL between them: `bun run dev:web` (browser tab) and `bun run dev:native` (desktop window — macOS Tahoe 26+ / Windows; Linux deferred per `.docs/BACKLOG.md`).
- Build outputs: `dist/core/` (core publish layout) and `dist/web/` (bundled hello-world demo, with optional `dist/web/dev/` from `build:web:dev` for unminified inspection). The CLI binary builds in-place to `packages/tools/crates/target/{debug,release}/furnace`; the `dist/tools/` publish layout is deferred — see `.docs/BACKLOG.md`.
- Tooling: Biome for lint, `bun:test` for tests, TypeScript strict mode. Per-package `tsconfig.json` in core; root tsconfig excludes `dist`/`target`.

For deeper context: `.docs/packaging-and-distribution.md` (publish model, engine/harness principle), `.docs/shallot-and-game-engine-architecture.md` (engine architecture notes), `.docs/BACKLOG.md` (deferred work register), `docs/superpowers/specs/` (design specs for major changes).

## Commands

- `bun install` — install dependencies
- `bun test` — run all tests
- `bun test path/to/file.test.ts` — run a single test file
- `bun test -t "name"` — run tests matching a name pattern
- `bun run check` — biome lint + format check
- `bun run typecheck` — type-check core + hello-world
- `bun run dev:web` — hello-world in the browser
- `bun run dev:native` — hello-world in the native window (macOS Tahoe 26+)
- `bun run build` — full chain: core publish staging → tools cargo release → web bundle
- `bun run clean` — remove `dist/` and per-package cargo `target/` + plugin `pkg/` dirs

**Before committing:** run `bun run check` and `bun run typecheck`. Fix anything flagged.

## What we ship to consumers

The published artifacts must work outside the furnace workspace, without our internal toolchain.

- **`@furnace/core`** — plain ESM JavaScript + `.d.ts` declarations. **Browser-only.** No Bun APIs (`Bun.*`, `bun:*`), no Node APIs (`node:*`, `process.*`), no platform-aware code. Any TS-capable bundler (Vite, webpack, esbuild, Bun, Rollup) must be able to consume it. Compiled from TypeScript at publish time.
- **`@furnace/tools`** — a Rust CLI binary (`furnace`) distributed via npm using a biome-style pattern: tiny plain-Node JS shim + the binary as a sibling file (today, single package) or per-platform `optionalDependencies` (future, when furnace ships a second platform). The shim must run on **plain Node ≥20**. The CLI binary has its own per-OS/arch builds. Internal source is mostly Rust (Cargo workspace); the JS shim has no Bun APIs and no runtime dependencies. Consumers invoke via `npx furnace …` or `bunx furnace …`.
- **Native shell binary** — does NOT ship from furnace. The shell is `furnace-runtime` source vendored into the consumer's repo by `furnace init`; it compiles into the consumer's final native artifact (`.app`, `.ipa`, etc.) at *their* build time, not ours. See `.docs/packaging-and-distribution.md` §6.

These rules apply to *shipped artifacts*. They do not apply to in-repo scripts, tests, or internal helpers — those can use any Bun API freely.

`packages/core/tests/no-bun-leakage.test.ts` regex-scans core's `src/` for Bun-API imports as a static guardrail. It is one check among several — it does not by itself prove the full contract above.

## How we build internally

Bun is the runtime for everything that does NOT ship: the dev loop, build scripts, internal helpers, tests, workspace orchestration. In those contexts:

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` / `yarn install` / `pnpm install`
- Use `bun run <script>` instead of `npm run` / `yarn run` / `pnpm run`
- Use `bunx <package> <command>` instead of `npx`
- Bun auto-loads `.env` — don't add `dotenv`.

Consumer/example packages choose their own toolchain. `packages/hello-world` is the reference consumer — it imports `@furnace/core` via the workspace symlink and uses its own build tools.

## Internal-only Bun APIs

For in-repo scripts, tests, and internal tooling that does not ship, prefer Bun's built-ins over equivalent npm packages:

- `Bun.serve()` for HTTP/WebSockets/HTTPS/routes — don't use `express`
- `bun:sqlite` for SQLite — don't use `better-sqlite3`
- `Bun.redis` for Redis — don't use `ioredis`
- `Bun.sql` for Postgres — don't use `pg` or `postgres.js`
- Built-in `WebSocket` — don't use `ws`
- `Bun.file` over `node:fs` `readFile`/`writeFile`
- `` Bun.$`ls` `` over `execa`

These APIs do not exist on plain Node. They cannot appear in any file that ends up inside a package's published `files`/`exports`. The boundary is the publish manifest, not the source directory.

## Testing

Use `bun test`.

```ts
// index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

For more, see the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Deferred work — `.docs/BACKLOG.md`

The repo uses `.docs/BACKLOG.md` to track deferred work and ideas across sessions. This is durable, multi-session storage — distinct from `TaskCreate` (within-session only) and from architecture docs (decisions, not tasks).

**When working in this repo:**
- **Defer something mid-session?** Add an entry to `.docs/BACKLOG.md` before moving on. Use the entry shape documented in that file (title, Context, Trigger to revisit, Reference).
- **Starting new work?** Scan `.docs/BACKLOG.md` first for items that just became actionable. Promote them out by removing the entry and tracking the work in the current session.
- **Don't put bugs there** — fix urgent bugs; use GitHub Issues for non-urgent ones once the repo is on GitHub.
- **Don't put decisions there** — decisions go in `.docs/` notes or ADRs.

When the BACKLOG file grows past ~100 entries or one category exceeds ~20, prune by promoting actionable items out and consolidating context-decayed items.

## Canonical references

- `.docs/packaging-and-distribution.md` — publish model, what gets built, what consumers receive.
- `.docs/shallot-and-game-engine-architecture.md` — architectural vision and inspiration notes.
- `.docs/BACKLOG.md` — deferred work register.
- `docs/superpowers/specs/` — design specs for major changes. **Native shell distribution: `2026-05-19-native-shell-distribution-design.md`** is currently the load-bearing design for tooling/runtime work.
- `docs/superpowers/plans/` — implementation plans for major changes.
