# @furnace/tools

Internal build helpers and the public `furnace` CLI for the furnace engine.

## Surfaces

- `@furnace/tools/internal` — workspace-only helpers used by furnace's own build scripts (cargo orchestration, publish staging). Not exposed in the published package.
- `furnace` (bin) — public CLI. Currently supports `furnace native [--rebuild]` to launch the desktop runtime.

This package owns the Rust launcher binary (`native/`) and is the only package in the workspace that produces a native binary.
