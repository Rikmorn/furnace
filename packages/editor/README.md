# @furnace/editor

The furnace editor: a Node-portable daemon serving a React 19 + dockview chrome, project-first — **the editor contains no engine**; it bundles the consumer's `@furnace/core` + extensions.

**Canonical as-built architecture: `docs/reference/editor-architecture.md`.** Chronological slice seals: `docs/learnings/seal-log.md`. This README carries the package's current-state summary; when a slice seals, update HERE (and the reference docs) — never AGENTS.md.

## Dogfood

`bun run edit` in `packages/hello-world` or `packages/dungeon` (or `bun run dungeon:editor` from the repo root).

## Architecture in one breath

- **Daemon** (Node-portable — no `Bun.*` in `src/`, enforced by `tests/no-bun-leakage.test.ts`): serves the chrome same-origin; a zod-validated command registry over `POST /api/<command>`; a mutable document session (open/save, transactional registry-validated mutations, snapshot undo/redo — await-races guarded: stale `onFileChanged` callbacks drop, a superseded `apply` throws `no-session`); an SSE change feed (`GET /api/events`); scene-file watching with conflict semantics; chrome-miss GETs mapped onto the project root (scene-doc asset sidecars resolve same-origin; dotfiles/`node_modules` refused).
- **Project-first bundling**: a browser engine bundle exporting `createViewportHost` + `createPreviewHost` + the consumer's **`extensions` namespace** (the generator seam), and a node registry bundle for daemon-side validation + consumer `bake()` resolution — invalidated by the extensions-dir watch, which also emits `bundle-outdated` SSE so the browser reloads on source change.
- **Viewport**: GPU-id picking, AABB selection highlight, translate gizmo, orbit/pan/zoom, a reflection-driven editable inspector + multi-select + `scene.batch`; camera-less FRAGMENT docs open via `loadScene` fragment mode + bounds-framed orbit.
- **Generation cockpit**: an HDR preview host (`bloom→tonemap` + headlamp + orbit; **fog is a viewport VIEW-FLAG, default off**; both canvases stay laid out — visibility swap, never `display:none`); the Generation panel + ephemeral App-owned session; generation runs in a module Web Worker (runId-disciplined protocol; **cancel = terminate + lazy respawn, instant mid-attempt**; the worker is never respawned alone on `bundle-outdated` — a page reload refreshes worker + main thread together). Since 3.3 W1 the panel drives the WORLD flow (`runWorld`/`bakeWorld`; deterministic, no attempts machinery); `generation.bake` writes browser-uploaded file sets root-contained (optional `cleanDir`), emitting `generation-baked` SSE.
- The consumer-side scene loader instantiates the full built-in set from data incl. physics-from-data (instantiated, NOT stepped).

## Notes

- AI bindings deferred: `docs/backlog/editor-and-tooling/editor-ai-integration-milestone.md`.
- Known UX debt register: `docs/backlog/editor-and-tooling/`.
- React work happens in sessions started INSIDE this package (its `.claude/skills/` — impeccable, shadcn, vercel-react — only load from package-started sessions).
