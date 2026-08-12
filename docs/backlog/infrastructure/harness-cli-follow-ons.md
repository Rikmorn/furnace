---
summary: two `@furnace/tools` deferrals: the `furnace.config.json` schema, and the Bun ↔ wasm-bindgen wrapper generator's maintenance surface
---

# Harness (`@furnace/tools`) follow-ons — config schema + the wasm-bindgen generator

The two deferred items that belong to the CLI/harness rather than the editor: the
`furnace.config.json` schema (deferred until a milestone forces the field-by-field
choices) and the Bun ↔ wasm-bindgen wrapper generator's maintenance surface. Merged
because they are the only two harness entries in this topic dir and both are keyed to
`packages/tools/`. Sections keep their original content.

## `furnace.config.json` schema

The native-shell distribution design uses `furnace.config.json` as the L1 declarative customisation surface — covering app identity, window defaults, plugin registration, signing config, and source/output paths. Sample structure is sketched in the spec but the full schema (field-by-field definitions, validation rules, schema versioning, platform-specific override semantics) is deferred until the first implementation milestone forces the choices.

**Trigger to revisit:** Start of milestone 1 implementation (end-to-end macOS). The schema design happens BEFORE writing the Rust struct that deserialises it, so the choices are explicit rather than implicit.

**Reference:** Customization Layers Section 4 of `docs/reference/packaging-and-distribution.md`.

**Namespacing convention (settled 2026-06-11, M3 Plan B):** `furnace.config.json` is ONE file
with per-tool sections. Top-level fields belong to the `furnace` CLI (Rust, tolerates unknown
keys — verified no `deny_unknown_fields`); the editor owns the `"editor"` block and parses it
strictly while ignoring the rest (`packages/editor/src/daemon/config.ts`). Any future shared
JSON Schema must encode both sections.

## Bun ↔ wasm-bindgen generator — maintenance surface

Bun's bundler treats `import * as wasm from "./*.wasm"` as an asset import — the namespace resolves to `{default: "url-string"}` at runtime, not an instantiated WebAssembly.Instance. wasm-bindgen's `--target bundler` (and `--target web` in current versions) split-files glue assumes the bundler performs webpack-style instantiation that Bun doesn't. The CLI sidesteps this by rewriting `pkg/<crate>.js` and `pkg/<crate>.d.ts` after `wasm-pack` runs — see `rewrite_wrapper` in `packages/tools/crates/furnace-cli/src/wasm.rs`. Consumers import the typed exports + a `ready` promise; the manual `WebAssembly.instantiateStreaming` dance lives in the generated wrapper.

**Trigger to revisit:** wasm-pack/wasm-bindgen output shape changes break the generator template, OR a second bundler is integrated (vite/webpack handle wasm-bindgen natively, so the generator should branch and emit nothing for them), OR the typed-export shape proves insufficient and consumers want richer control. Alternatives if the generator approach falls down: a standalone Bun build plugin handling wasm-bindgen output (reusable beyond furnace), upstream Bun support for the split-files convention (out of our hands), or switching bundler for wasm-plugin projects (loses Bun's speed).

**Reference:** Generator landed in commit `f133341`. The hand-written workaround that preceded it (and explains the diagnosis) lives in commit `92061f7`.
