# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

A Bun workspace (`workspaces: ["packages/*"]`, Bun v1.3.14) experimenting with WebGPU-based engine architecture, split into a headless engine library, a tooling/launcher package, and a consumer demo.

**Foundational rule:** Only `@furnace/tools` produces binaries. Everything else is TypeScript or wasm. See `.docs/packaging-and-distribution.md` for the engine/harness principle.

**Current contents (three workspace packages):**
- `packages/core/` (`@furnace/core`, private) — the engine library. Exports `requestWebGpu`, `runFrameLoop`, `createFpsSystem`, `computeFps`, plus their types. Consumer-portable: no framework deps, no Bun coupling in the public surface (enforced by `tests/no-bun-leakage.test.ts`). Future wasm hot-path crates (transforms, audio) will live here. Contains no native binaries.
- `packages/tools/` (`@furnace/tools`, private) — the harness. Owns the Rust `winit + wry` native launcher (`native/`), internal build helpers (`src/internal/`), and the public `furnace` CLI (`src/public/cli.ts`). The only package in the workspace that produces a binary.
- `packages/hello-world/` (`@furnace/hello-world`, private) — the reference consumer. Renders the WebGPU triangle with the Svelte 5 FPS overlay. Owns its own `index.html`, `bunfig.toml`, `serve.ts`, and dev-server choice. Imports core via `@furnace/core` (workspace symlink). Uses `bunx furnace native` for native dev — dogfooding the consumer experience.
- Two runtime targets, shared TS/HTML/WGSL between them: `bun run dev:web` (browser tab) and `bun run dev:native` (desktop window — macOS Tahoe 26+ / Windows; Linux deferred per `.docs/BACKLOG.md`).
- Build outputs: `dist/core/` (core publish layout), `dist/tools/` (tools publish layout), `dist/native/` (host-platform binary), `dist/web/` (bundled hello-world demo, with optional `dist/web/dev/` from `build:web:dev` for unminified inspection).
- Tooling: Biome for lint, `bun:test` for tests, TypeScript strict mode. Per-package `tsconfig.json` in core and tools scopes typecheck; root tsconfig excludes `dist`/`target`.

For deeper context: `.docs/packaging-and-distribution.md` (publish model, engine/harness principle), `.docs/shallot-and-game-engine-architecture.md` (engine architecture notes), `.docs/BACKLOG.md` (deferred work register), `docs/superpowers/specs/` (design specs for major changes).

## Commands

- `bun install` — install dependencies
- `bun run index.ts` — run the entry point once
- `bun --hot index.ts` — run with hot reload during development
- `bun test` — run all tests
- `bun test path/to/file.test.ts` — run a single test file
- `bun test -t "name"` — run tests matching a name pattern
- `bunx tsc --noEmit` — typecheck (tsconfig has `noEmit: true`, strict, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`)

## Toolchain: Bun is the workspace default

Bun is the workspace runtime for the dev loop, the `@furnace/core` package's build, tests, and internal scripts. In those contexts:

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` / `yarn install` / `pnpm install`
- Use `bun run <script>` instead of `npm run` / `yarn run` / `pnpm run`
- Use `bunx <package> <command>` instead of `npx`
- Bun auto-loads `.env` — don't add `dotenv`.

**Consumer/example packages choose their own toolchain.** `@furnace/core` is designed to be runtime-agnostic — its public surface uses only web-platform APIs (no `Bun.*` globals, no `bun:*` imports). The `no-bun-leakage` test in `packages/core/tests/` enforces this. A consumer (including in-repo examples like `packages/hello-world`) is free to use Vite, Webpack, Bun's own bundler, or any other tool that ships ESM + TS. The bullets above apply to workspace internals, not to consumers.

## APIs to prefer

- `Bun.serve()` for HTTP/WebSockets/HTTPS/routes — don't use `express`
- `bun:sqlite` for SQLite — don't use `better-sqlite3`
- `Bun.redis` for Redis — don't use `ioredis`
- `Bun.sql` for Postgres — don't use `pg` or `postgres.js`
- Built-in `WebSocket` — don't use `ws`
- `Bun.file` over `node:fs` `readFile`/`writeFile`
- `` Bun.$`ls` `` over `execa`

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
