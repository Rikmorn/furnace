# @furnace/tools

The `furnace` CLI and the runtime shell for the furnace engine.

## What this package is

A Rust workspace shipped via npm:

- `crates/furnace-cli/` — the `furnace` command-line tool (init, build, dev, wasm, upgrade-runtime).
- `crates/furnace-runtime/` — the Rust shell that consumers vendor into their apps on `furnace init`. Wraps `wry` + `winit`, implements the Runtime Contract that the JS engine layer talks to.
- `templates/` — scaffold files for `furnace init`.
- `shim.js` — tiny plain-Node JS that finds and execs the furnace binary. Single fat-package model today; per-platform biome-style packages deferred to a future milestone (see `docs/backlog/infrastructure/per-platform-binary-packages.md`).

## Consumer surface

- `furnace` (bin) — public CLI (Rust binary via `shim.js`). Commands: `init`, `build`, `dev`, `wasm`. `upgrade-runtime` is stubbed pending a use-case. See `docs/reference/packaging-and-distribution.md` (especially §6) for the architecture and distribution model.

This is the only package in the workspace that produces a binary.

## Design

See `docs/reference/packaging-and-distribution.md` for the architecture (Tauri 2-style shell, wasm plugins, runtime contract) and §6 for the distribution model summary.

## Packaging architecture

The engine/harness principle, the npm distribution model (biome-style shim + binary), and what ships vs what stays internal: `docs/reference/packaging-and-distribution.md`. Only this package produces binaries — everything else in the workspace is TypeScript or wasm.
