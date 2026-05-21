# furnace

A WebGPU exploration project. Currently bootstrapped to render a single triangle to (a) a browser tab and (b) a native desktop window, sharing the same TS/HTML/WGSL code in both contexts. See `docs/reference/engine-architecture.md` for the broader architectural vision.

## Requirements

- [Bun](https://bun.com) 1.3+
- macOS Tahoe 26+ for the native target (Windows is supported in principle but unverified pending bundling — see `docs/backlog/`)
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
- `packages/tools/` — tooling, the `furnace` CLI, and the shell runtime (`@furnace/tools`). Internally a Rust workspace (CLI binary + runtime crate that consumers vendor into their apps) plus scaffold templates and a JS shim. Only package that produces a binary. See `docs/reference/packaging-and-distribution.md`.
- `packages/hello-world/` — reference consumer (`@furnace/hello-world`). Renders the triangle in the browser (`bun run dev:web`) or in a native window (`bun run dev:native` — wraps `furnace dev --platform=macos`).
- `docs/reference/` — canonical "how the project is" docs (packaging & distribution, engine architecture, UI foundation).
- `docs/backlog/` — deferred work register, one file per entry, grouped by topic.
- `docs/learnings/` — post-mortems and "what we tried" notes.
- `docs/research/` — pre-decision research that fed canonical docs.
- `AGENTS.md` — canonical agent guidance (`.claude/CLAUDE.md` is a thin pointer to it).
