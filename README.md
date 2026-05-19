# furnace

A WebGPU exploration project. Currently bootstrapped to render a single triangle to (a) a browser tab and (b) a native desktop window, sharing the same TS/HTML/WGSL code in both contexts. Inspired by [Shallot](https://github.com/dylanebert/shallot); see `.docs/shallot-and-game-engine-architecture.md` for the broader architectural vision.

## Requirements

- [Bun](https://bun.com) 1.3+
- macOS Tahoe 26+ for the native target (Windows is supported in principle but unverified pending bundling — see `.docs/BACKLOG.md`)
- Rust toolchain (cargo) for the native target

## Run

```bash
bun install                  # install workspace deps
bun run dev:web              # browser path; open the URL it prints
bun run dev:native           # native window path (mac/windows only)
bun run check                # biome lint + format
bun run typecheck            # tsc --noEmit
bun test                     # smoke tests
```

## Layout

- `packages/core/` — engine library (`@furnace/core`). Pure TypeScript; consumer-portable.
- `packages/tools/` — tooling, the `furnace` CLI, and the shell runtime (`@furnace/tools`). Internally a Rust workspace (CLI binary + runtime crate that consumers vendor into their apps) plus scaffold templates and a JS shim. Only package that produces a binary. See `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md`.
- `packages/hello-world/` — reference consumer (`@furnace/hello-world`). Renders the triangle in the browser or in the native window via `bunx furnace native`.
- `.docs/` — architecture notes (`packaging-and-distribution.md`, `shallot-and-game-engine-architecture.md`), BACKLOG, and other planning context.
- `docs/superpowers/specs/`, `docs/superpowers/plans/` — design specs and implementation plans.
- `.claude/CLAUDE.md`, `AGENTS.md` — agent guidance.
