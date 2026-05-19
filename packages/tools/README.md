# @furnace/tools

The `furnace` CLI and the runtime shell for the furnace engine.

## What this package is

A Rust workspace shipped via npm:

- `crates/furnace-cli/` — the `furnace` command-line tool (init, build, dev, wasm, upgrade-runtime).
- `crates/furnace-runtime/` — the Rust shell that consumers vendor into their apps on `furnace init`. Wraps `wry` + `winit`, implements the Runtime Contract that the JS engine layer talks to.
- `templates/` — scaffold files for `furnace init`.
- `shim.js` — tiny plain-Node JS that resolves and execs the right per-platform binary (biome's distribution pattern). Lets consumers invoke via `npx furnace` / `bunx furnace`.

## Consumer surface

- `furnace` (bin) — public CLI. Today supports the legacy `furnace native [--rebuild]` (used by hello-world's `dev:native`); the design spec lays out the eventual full command surface (`init`, `build`, `dev`, `wasm`, `upgrade-runtime`).

This is the only package in the workspace that produces a binary.

## Design

See `docs/superpowers/specs/2026-05-19-native-shell-distribution-design.md` for the architecture (Tauri 2-style shell, wasm plugins, runtime contract). See `.docs/packaging-and-distribution.md` §6 for the distribution model summary.
