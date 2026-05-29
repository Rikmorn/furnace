# AGENTS.md

Cross-tool AI agent guidance for the `furnace` repo. Single source of truth — Claude Code reads `.claude/CLAUDE.md` which pulls this file in via `@../AGENTS.md`.

## Project state

A Bun workspace (`workspaces: ["packages/*"]`, Bun v1.3.14) experimenting with WebGPU-based engine architecture, split into a headless engine library, a tooling/launcher package, and a consumer demo.

**Foundational rule:** Only `@furnace/tools` produces binaries. Everything else is TypeScript or wasm. See `docs/reference/packaging-and-distribution.md` for the engine/harness principle.

**Current contents (four workspace packages):**
- `packages/core/` (`@furnace/core`, private) — the engine library. Exposes its public surface as per-feature sub-path modules — `@furnace/core/{gpu, frame, geometry, mesh, material, camera, transform, post, events, stats, input, log, resources}` — documented signature-by-signature in `docs/reference/core-modules.md` (concept taxonomy + naming rules in `docs/reference/api-posture.md`). Engine-wide conventions are committed at `docs/reference/engine-conventions.md`. **Browser-only**: no framework deps, no Bun coupling in core's source. The `tests/no-bun-leakage.test.ts` static scan is one guardrail; the full contract lives in "What we ship to consumers" below. Future wasm hot-path crates (transforms, audio) will live here. Contains no native binaries.
- `packages/hello-world/` (`@furnace/hello-world`, private) — the reference consumer. Renders the WebGPU triangle with the Svelte 5 FPS overlay. Owns its own `index.html`, `bunfig.toml`, `serve.ts`, and dev-server choice. Imports core via `@furnace/core` (workspace symlink). Uses `furnace dev --platform=macos` for native dev (via `bun run dev:native`) — dogfooding the consumer experience.
- `packages/cookbook/` (`@furnace/cookbook`, private) — the reference cookbook. One page per Tier 1 feature, browseable demo collection. Co-evolves with `docs/reference/core-modules.md`: cookbook shows it, core-modules documents it.
- `packages/tools/` (`@furnace/tools`, private) — the harness. Internally a Rust workspace (`crates/furnace-cli/` for the CLI binary, `crates/furnace-runtime/` for the shell consumers vendor) plus scaffold templates and a tiny plain-Node JS shim that wraps the binary for npm distribution (biome's pattern). The only package in the workspace that produces a binary. No TypeScript source — pure orchestration. See `docs/reference/packaging-and-distribution.md` for the architecture.
- Two runtime targets, shared TS/HTML/WGSL between them: `bun run dev:web` (browser tab) and `bun run dev:native` (desktop window — macOS Tahoe 26+ / Windows; Linux deferred per `docs/backlog/`).
- Build outputs: `dist/core/` (core publish layout) and `dist/web/` (bundled hello-world demo, with optional `dist/web/dev/` from `build:web:dev` for unminified inspection). The CLI binary builds in-place to `packages/tools/crates/target/{debug,release}/furnace`; the `dist/tools/` publish layout is deferred — see `docs/backlog/`.
- Tooling: Biome for lint, `bun:test` for tests, TypeScript strict mode. Per-package `tsconfig.json` in core; root tsconfig excludes `dist`/`target`.

For deeper context: `docs/reference/packaging-and-distribution.md` (publish model, engine/harness principle), `docs/reference/engine-architecture.md` (engine architecture notes), `docs/backlog/` (deferred work register).

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
- **Native shell binary** — does NOT ship from furnace. The shell is `furnace-runtime` source vendored into the consumer's repo by `furnace init`; it compiles into the consumer's final native artifact (`.app`, `.ipa`, etc.) at *their* build time, not ours. See `docs/reference/packaging-and-distribution.md` §6.

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

## Deferred work — `docs/backlog/`

The repo uses `docs/backlog/` to track deferred work and ideas across sessions. This is durable, multi-session storage — distinct from `TaskCreate` (within-session only) and from architecture docs (decisions, not tasks).

**When working in this repo:**
- **Defer something mid-session?** Add an entry to `docs/backlog/` before moving on. Use the entry shape documented in that file (title, Context, Trigger to revisit, Reference).
- **Starting new work?** Scan `docs/backlog/` first for items that just became actionable. Promote them out by removing the entry and tracking the work in the current session.
- **Don't put bugs there** — fix urgent bugs; use GitHub Issues for non-urgent ones once the repo is on GitHub.
- **Don't put decisions there** — decisions go in `docs/reference/` or ADRs.
- **Doing bulk standardisation work (TSDoc pass, type migration, audit sweep)?** Expect ~5–15% of items to surface engine-side findings outside your task's scope. Capture each as a `docs/backlog/` entry mid-tranche rather than silently expanding scope or silently dropping the finding. At end of tranche, summarise surfaced findings to the user and let them decide which warrant a follow-up tranche. Example: Tranche A-1's TSDoc bulk pass surfaced four engine API hygiene items (destroy-policy inconsistency, missing input validation, pre-existing type casts, math-primitive edge cases) which became Tranche A-3 candidates.
- **Inline-fix threshold (added 2026-05-28 from RM tranche learnings).** Before filing a backlog entry, check whether the item qualifies for inline fix instead:
  - **< 10 LOC change** to source or docs
  - **In a file you are already touching** in the current task/tranche
  - **No new design decision required** (no "should we use X or Y" question)
  - **No new public API surface** introduced

  If all four conditions hold, fix inline in the same commit as the surrounding work. Files growing with "trivial-deferred" backlog entries are a smell — the RM tranche surfaced 4 such items (`setmaterial-failure-policy-stance-docs`, `validate-effects-resolved-slot-shape`, one cookbook destroy-order asymmetry, one stale `as number` cast site) each individually defensible but aggregating to cognitive load that outlasted the tranche.

  Backlog entries remain right for: cross-tranche refactors, design decisions, anything needing a separate brainstorm, items whose trigger hasn't fired.

When `docs/backlog/` exceeds ~100 files or one topic subdirectory exceeds ~20, prune by promoting actionable items out and consolidating context-decayed items.

## Keeping docs current

Documentation rots quietly. The lifecycle is `docs/backlog/` → implementation → `docs/reference/`. After a piece of work completes:

- **Resolved a backlog entry?** Delete `docs/backlog/<topic>/<slug>.md`. Don't leave done work parked as "deferred".
- **Changed the `@furnace/core` public API?** Update `docs/reference/core-modules.md` to reflect the new exports / signatures. If the change is consumer-visible, also add or update the relevant `packages/cookbook` demo in the same PR.
- **Changed a public export's behaviour (new throws, new edge cases, changed contract)?** Update its TSDoc. The `bun run check:tsdoc` check catches *missing* TSDoc but not *stale* TSDoc — semantic drift is a review concern. See `docs/reference/tsdoc-conventions.md`.
- **Materialized a new design or changed an existing one?** Update the relevant `docs/reference/*.md` to reflect the new reality. The reference is "how the project IS today" — if it's stale, it's broken.
- **Renamed a file, moved a directory, changed a path that other files mention?** Grep for the old path before committing. Stale path references rot silently because nothing tests them.
- **Tried an approach and walked away?** Capture the lesson in `docs/learnings/<topic>.md` so the next person doesn't retry it.
- **Writing or updating API docs?** Read the implementation source to verify behaviour — don't synthesise from existing reference docs (`core-modules.md`, ADRs, sibling TSDoc), which can be stale or aspirational. Grep the function body for `throw new`, `console.warn`, early-return guards, etc. The code is authoritative; reference docs are summaries that decay. When the reference disagrees with the source, the source wins — and update the reference in the same change. Tranche A-1 caught several `core-modules.md` rows that mis-described actual behaviour (e.g. `stats.measure` no-invoke conditions) only because the TSDoc work read each implementation directly.
- **MIGRATION (until X) comment convention** (added 2026-05-28 from RM Stage 1 learnings #6). For multi-session migrations, mark TSDoc lines and inline comments that will become stale at a specific future point with a `// MIGRATION (until <session/tranche>):` prefix. Example: `// MIGRATION (until Session 3): Material refcount not yet wired; this slot's userCount is always 0`. The grep `grep -rn "MIGRATION (until" packages/` at the named session boundary surfaces all comments to revisit. Prevents the predictable rot pattern where mid-migration scaffolding comments survive past their relevance window.

Before claiming a piece of work is complete: search `AGENTS.md`, `README.md`, and `docs/reference/` for mentions of files, paths, scripts, or decisions you touched. Update where stale. The cost of a 60-second grep is much smaller than the cost of a future reader trusting a stale claim.

## Canonical references

- `docs/reference/` — canonical "how the project is" docs:
  - `engine-conventions.md` — behavioural contracts (coords, color, DPR, lifecycle, failure policy, instrumentation)
  - `core-modules.md` — public API surface of `@furnace/core`, module by module
  - `api-posture.md` — concept taxonomy (data/function kinds) + R1–R9 rules for how new API surface is shaped & named
  - `tsdoc-conventions.md` — TSDoc authoring policy for the `@furnace/core` public API surface
  - `engine-architecture.md` — broader architectural rationale
  - `packaging-and-distribution.md` — what we ship to consumers
  - `ui-foundation.md` — Svelte 5 + screen-space projection patterns for consumer UI
  - `fixed-step-interpolation.md` — engine posture + consumer recipe for interpolating between fixed-step ticks
- `docs/backlog/` — deferred work register (one file per entry, grouped by topic).
- `docs/learnings/` — post-mortems and "what we tried" notes.
- `docs/research/` — pre-decision research that fed canonical docs.
