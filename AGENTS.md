# AGENTS.md

Cross-tool AI agent guidance for the `furnace` repo. Canonical agent context lives in `.claude/CLAUDE.md` — this file points there to keep one source of truth.

## TL;DR

- **Runtime is Bun.** Use `bun <file>`, `bun test`, `bun build`, `bun install`. Do **not** use Node, npm, jest, vitest, webpack, esbuild, or ts-node.
- **APIs:** prefer `Bun.serve`, `bun:sqlite`, `Bun.redis`, `Bun.sql`, `Bun.file`, `` Bun.$`...` `` over their Node equivalents.
- **Workspace:** monorepo via Bun workspaces — three packages live in `packages/*`: `@furnace/core` (browser-only engine library, TS source), `@furnace/tools` (Rust workspace with the `furnace` CLI + the vendored runtime crate consumers embed; JS shim wraps the binary for npm), `@furnace/hello-world` (reference consumer). Only `@furnace/tools` produces binaries. Run package scripts via `bun run --cwd packages/<name> <script>`.
- **Before commit:** run `bun run check` (biome) and `bun run typecheck`. Fix anything flagged.
- **Deferred work:** new items go in `.docs/BACKLOG.md` (see the convention in `.claude/CLAUDE.md`).

## Canonical references

- `.claude/CLAUDE.md` — full agent guidance (Bun runtime rules, API preferences, testing).
- `.docs/packaging-and-distribution.md` — publish model, what gets built, what consumers receive.
- `.docs/shallot-and-game-engine-architecture.md` — architectural vision and inspiration notes.
- `.docs/BACKLOG.md` — deferred work register.
- `docs/superpowers/specs/` — design specs for major changes. **Native shell distribution: `2026-05-19-native-shell-distribution-design.md`** is currently the load-bearing design for tooling/runtime work.
- `docs/superpowers/plans/` — implementation plans for major changes.
