# AGENTS.md

Cross-tool AI agent guidance for the `furnace` repo. Single source of truth — Claude Code reads `.claude/CLAUDE.md` which pulls this file in via `@../AGENTS.md`.

## Project state

A Bun workspace (`workspaces: ["packages/*"]`, Bun v1.3.14) experimenting with WebGPU-based engine architecture, split into a headless engine library, a tooling/launcher package, and consumer demos.

**Foundational rule:** Only `@furnace/tools` produces binaries. Everything else is TypeScript or wasm. See `docs/reference/packaging-and-distribution.md` for the engine/harness principle.

**Current contents (six workspace packages):**
- `packages/core/` (`@furnace/core`, private) — the engine library. Public surface = per-feature sub-path modules — `@furnace/core/{gpu, frame, geometry, mesh, material, camera, transform, post, events, stats, input, log, resources, physics, rigid-mesh, rng, scene, shader, binding}` — documented signature-by-signature in `docs/reference/core-modules.md` (concept taxonomy + naming rules: `docs/reference/api-posture.md`; behavioural contracts: `docs/reference/engine-conventions.md`). **Browser-only**: no framework deps, no Bun/Node coupling in core source (`tests/no-bun-leakage.test.ts` is one guardrail; the full contract is "What we ship to consumers" below). Capability highlights the dungeon leans on: physics query primitives (`castRay`/`castShape`, `RayHit.body`) + the `voxels` collider (ghost-free static voxel grids; heightfield deliberately absent — broken in the vendored rapier wasm) + `trimesh`/scene-baked collision (`retainForCollision`/`getCollisionData`); seeded `rng` (sfc32; **`derive(label)` is STATE-INDEPENDENT** — child streams reproduce from seed+label alone, which bake/load re-expansion relies on); first-class GPU instancing (`mesh.createInstanced`, `litInstanced`/`unlitInstanced`, the separate `instanced` render list — uniform per-instance scale only; instanced shadow casting deferred to backlog); the `scene` module (`loadScene` full/`fragment` modes, `world` injection, the `.fmesh` codec `encodeMeshBlob`/`decodeMeshBlob`, physics-from-data); HDR post (`bloom`/`tonemap`), exponential fog, multi-light Blinn-Phong + opt-in PCF shadows. Future wasm hot-path crates live here; no native binaries. Seal history: `docs/learnings/seal-log.md`.
- `packages/hello-world/` (`@furnace/hello-world`, private) — the reference consumer. Renders the WebGPU triangle with the Svelte 5 FPS overlay. Owns its own `index.html`, `bunfig.toml`, `serve.ts`, and dev-server choice. Imports core via `@furnace/core` (workspace symlink). Uses `furnace dev --platform=macos` for native dev (via `bun run dev:native`) — dogfooding the consumer experience.
- `packages/dungeon/` (`@furnace/dungeon`, private) — the first-person dungeon-crawler demo, the engine's go-forward consumer app (vision — an atmospheric, eventually LLM-streamed crawler: `~/.claude/.../memory/project_dungeon_crawler_vision.md`). Browser-first; imports core via the workspace symlink; owns `index.html` + `serve.ts`; `bun run dev:dungeon`; editor-openable (`bun run edit` in the package). **As-built architecture (canonical current-state): `docs/reference/dungeon-architecture.md`** — game loop, traversal/collision, the generator library, the bake/load pipeline, invariants, testing posture. Chronological slice seals: `docs/learnings/seal-log.md`. Current state in one breath (Epics 1–2 CLOSED; Epic 3 Slices 3.0–3.1 landed 2026-07-06): the GAME ships the hand-authored level + baked cavern + a wing at the chamber door — the BAKED wing when `regions/generated-wing/manifest.json` exists (`wing-loader.ts`), else live `layoutWorld(buildWorldGraph(WORLD_SEED))`; the player is a Rapier capsule driven by the custom `CharacterMover` (collide-and-slide on core casts; generated/organic geometry collides against field-derived VOXEL PROXIES — the confirmed ghost-free bridge, Jolt endgame in backlog); HDR `bloom→tonemap` + fog + torch + instanced scatter dressing. The GENERATOR is a pure library the cockpit consumes: `topology.ts` (graph generation; **`WorldNode.themeParams` records each node's exact extra generator params — the bake/load provenance contract**) → the `layout.ts` placer (deterministic collision-aware incremental embedding, `LayoutBudget`-bounded, fail-fast) → `themes/` + `connect.ts` + `built.ts` + `scatter.ts` → the `region.ts` `RegionData` contract → `realize.ts`; `world.ts` **`worldAttempts()`** iterator owns ALL retry policy and `seed:k` derivation (`buildWorld` drains it; the cockpit steps it between paints; `COCKPIT_CONFIG`/`COCKPIT_BUDGET`). The BAKE pipeline (3.1): `bake.ts bakeWing` → ONE merged render-only `wing.scene.json` + `.fmesh` sidecars + a provenance manifest written LAST (crash-safety); nameable `regions/<name>/`; **the BROWSER bakes and uploads** (JSC vs V8 diverge on placement transcendentals — NEVER regenerate placement cross-engine: `docs/learnings/2026-07-06-cross-engine-placement-determinism.md`), the daemon validates + writes; `wing-loader.ts` re-expands voxel proxies + dressing deterministically at load, guarded placement-level by `tests/bake-dressing-parity.test.ts`. **Epic 3 doctrine:** editor-time generation may use search-class algorithms — a human with reroll, caps, and curation tools absorbs failure; runtime generation is restricted to construction-guaranteed or degrade-never-fail vocabularies via generator entities, and the guarantee class is an explicit setup-loud field on the socket contract. Ladder: 3.0 foundations ✅ → 3.1 the Loop ✅ (user-gated live) → 3.2 seeing & curating + the editor full pass (inputs: `docs/backlog/editor-and-tooling/generation-cockpit-ux-gate-findings.md`, `docs/backlog/dungeon/generated-wing-traversal-quality.md`; DECIDED there: consolidate the bake to a single `wing.scene.json` BEFORE curation verbs bind to the artifact) → 3.3 generator entities (socket contract + guarantee class; maze vocabulary first) → 3.4 organic arc ("built places, organic carves" — carve-union probe first). The old deep-gen/streaming/LLM epic renumbered to **Epic 4**, unchanged.
- `packages/cookbook/` (`@furnace/cookbook`, private) — the reference cookbook. One page per Tier 1 feature, browseable demo collection. Co-evolves with `docs/reference/core-modules.md`: cookbook shows it, core-modules documents it.
- `packages/editor/` (`@furnace/editor`, private) — the editor: a Node-portable daemon (no `Bun.*` in `src/`, enforced by `tests/no-bun-leakage.test.ts`) serving the React 19 + dockview chrome same-origin, with a zod-validated command registry over `POST /api/<command>` (document session: open/save, transactional registry-validated mutations, snapshot undo/redo — await-races guarded: stale `onFileChanged` callbacks drop, a superseded `apply` throws `no-session`), an SSE change feed (`GET /api/events`), scene-file watching with conflict semantics, and chrome-miss GETs mapped onto the project root (scene-doc asset sidecars resolve same-origin; dotfiles/`node_modules` refused). **Project-first bundling — the editor contains no engine:** a browser engine bundle exporting `createViewportHost` + `createPreviewHost` + the consumer's **`extensions` namespace** (the generator seam), and a node registry bundle for daemon-side validation + consumer `bake()` resolution — invalidated by the extensions-dir watch, which also emits `bundle-outdated` SSE so the browser reloads on source change. Viewport: GPU-id picking, AABB selection highlight, translate gizmo, orbit/pan/zoom, a reflection-driven editable inspector + multi-select + `scene.batch` (M4/M5A/M5B); camera-less FRAGMENT docs open via `loadScene` fragment mode + bounds-framed orbit; the 3.1 cockpit surface: an HDR preview host (`bloom→tonemap` + headlamp + orbit; **fog is a viewport VIEW-FLAG, default off**; both canvases stay laid out — visibility swap, never `display:none`), the Generation panel + ephemeral session (frontend-only state; wing-name field; freeze bakes the `done`-status config SNAPSHOT), and `generation.bake` (browser-uploaded file set, root-contained writes validated before any write, optional `cleanDir` clears the prior bake first, `generation-baked` SSE). The consumer-side scene loader instantiates the full built-in set from data incl. physics-from-data (instantiated, NOT stepped). AI bindings deferred (`docs/backlog/editor-and-tooling/editor-ai-integration-milestone.md`). Dogfood: `bun run edit` in `packages/hello-world` or `packages/dungeon`. **As-built: `docs/reference/editor-architecture.md`**; seals: `docs/learnings/seal-log.md`; the known UX debt is 3.2's full editor pass (`docs/backlog/editor-and-tooling/`).
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
- `bun run edit` (in `packages/hello-world`) — open the editor on hello-world
- `bun run build` — full chain: core publish staging → tools cargo release → web bundle
- `bun run clean` — remove `dist/` and per-package cargo `target/` + plugin `pkg/` dirs

**Before committing:** run `bun run check` and `bun run typecheck`. Fix anything flagged.

## Agent skills & `.claude` structure

- **Root `.claude/` holds only truly shared config and skills** (currently `playwright-cli`, `teach`). Package-specific skills live in that package's own `.claude/skills/` — today: `packages/editor/.claude/skills/{impeccable, shadcn, vercel-react-best-practices, vercel-react-view-transitions}` (the editor is the repo's only React surface).
- **Start the session inside the package you're working on** (e.g. `packages/editor` for editor work). Skills load from the session-start directory plus its parents: a package session sees both package and root skills; a root-started session sees only root skills (verified CC 2.1.204, 2026-07-08). Root sessions are for planning / cross-package work — by design they don't load package skills.
- Third-party skills (impeccable, shadcn, vercel-react-*) are **never edited in place** — updates overwrite them. Scoping/behaviour notes belong here or in package guidance, not in skill files.

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
- **Sealing a slice/epic?** APPEND the dated seal paragraph to `docs/learnings/seal-log.md` — NOT to this file's package bullets. Then update the affected current-state summaries (the package bullets here, capped at roughly a paragraph each) and the relevant `docs/reference/*-architecture.md`. The bullets went through a 50 KB→summary compaction on 2026-07-06 precisely because seals accreted here; don't regrow them.
- **Changed the `@furnace/core` public API?** Update `docs/reference/core-modules.md` to reflect the new exports / signatures. If the change is consumer-visible, also add or update the relevant `packages/cookbook` demo in the same PR.
- **Changed a public export's behaviour (new throws, new edge cases, changed contract)?** Update its TSDoc. The `bun run check:tsdoc` check catches *missing* TSDoc but not *stale* TSDoc — semantic drift is a review concern. See `docs/reference/tsdoc-conventions.md`.
- **Materialized a new design or changed an existing one?** Update the relevant `docs/reference/*.md` to reflect the new reality. The reference is "how the project IS today" — if it's stale, it's broken.
- **Renamed a file, moved a directory, changed a path that other files mention?** Grep for the old path before committing. Stale path references rot silently because nothing tests them.
- **Never point a tracked doc at `docs/superpowers/`.** Everything under `docs/superpowers/` (specs, plans, archive) is **gitignored** — local design/plan scaffolding that goes stale the moment it's referenced and that other clones don't even have. Tracked docs (`docs/reference/`, `docs/backlog/`, `AGENTS.md`, `README.md`) must cite **facts in `docs/reference/`** (or the source files themselves), never a `docs/superpowers/...` path. `docs/reference/` is where we document how things are; if a decision or design from a superpowers spec needs to be citable, promote the fact into `docs/reference/` and cite that. A `grep -rn "docs/superpowers/" docs/reference docs/backlog docs/learnings` should return nothing (this rule, in `AGENTS.md`, is the only place the path is named on purpose).
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
  - `dungeon-architecture.md` — as-built dungeon: game loop, traversal/collision (voxel-proxy bridge), the generator library, the bake/load pipeline, invariants, testing posture
  - `packaging-and-distribution.md` — what we ship to consumers
  - `editor-architecture.md` — as-built M3+M4+M5A+M5B editor: daemon, project-first bundling, command registry, document session, SSE change feed + file watching, error contract, chrome, config namespacing; M5A inspector module (SchemaForm, kind→renderer registry, live-preview seam, multi-select, echo suppression); M5B viewport interaction (orbit camera, GPU picking, AABB highlight, translate gizmo, drag-scrub, echo-guard, revertSettings)
  - `ui-foundation.md` — Svelte 5 + screen-space projection patterns for consumer UI
  - `fixed-step-interpolation.md` — engine posture + consumer recipe for interpolating between fixed-step ticks
- `docs/backlog/` — deferred work register (one file per entry, grouped by topic).
- `docs/learnings/` — post-mortems and "what we tried" notes; `seal-log.md` is the chronological slice/epic seal record (append-only).
- `docs/research/` — pre-decision research that fed canonical docs.
