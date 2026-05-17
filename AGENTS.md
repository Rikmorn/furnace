# AGENTS.md

Cross-tool AI agent guidance for the `furnace` repo. Canonical agent context lives in `.claude/CLAUDE.md` — this file points there to keep one source of truth.

## TL;DR

- **Runtime is Bun.** Use `bun <file>`, `bun test`, `bun build`, `bun install`. Do **not** use Node, npm, jest, vitest, webpack, esbuild, or ts-node.
- **APIs:** prefer `Bun.serve`, `bun:sqlite`, `Bun.redis`, `Bun.sql`, `Bun.file`, `` Bun.$`...` `` over their Node equivalents.
- **Workspace:** monorepo via Bun workspaces — packages live in `packages/*`. Run package scripts via `bun run --cwd packages/<name> <script>`.
- **Before commit:** run `bun run check` (biome) and `bun run typecheck`. Fix anything flagged.
- **Deferred work:** new items go in `.docs/BACKLOG.md` (see the convention in `.claude/CLAUDE.md`).

## Canonical references

- `.claude/CLAUDE.md` — full agent guidance (Bun runtime rules, API preferences, testing).
- `.docs/shallot-and-game-engine-architecture.md` — architectural vision and inspiration notes.
- `.docs/BACKLOG.md` — deferred work register.
- `docs/superpowers/specs/` — design specs for major changes.
- `docs/superpowers/plans/` — implementation plans for major changes.
