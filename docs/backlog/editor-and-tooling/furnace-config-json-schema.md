# `furnace.config.json` schema

The native-shell distribution design uses `furnace.config.json` as the L1 declarative customisation surface — covering app identity, window defaults, plugin registration, signing config, and source/output paths. Sample structure is sketched in the spec but the full schema (field-by-field definitions, validation rules, schema versioning, platform-specific override semantics) is deferred until the first implementation milestone forces the choices.

**Trigger to revisit:** Start of milestone 1 implementation (end-to-end macOS). The schema design happens BEFORE writing the Rust struct that deserialises it, so the choices are explicit rather than implicit.

**Reference:** Customization Layers Section 4 of `docs/reference/packaging-and-distribution.md`.

**Namespacing convention (settled 2026-06-11, M3 Plan B):** `furnace.config.json` is ONE file
with per-tool sections. Top-level fields belong to the `furnace` CLI (Rust, tolerates unknown
keys — verified no `deny_unknown_fields`); the editor owns the `"editor"` block and parses it
strictly while ignoring the rest (`packages/editor/src/daemon/config.ts`). Any future shared
JSON Schema must encode both sections.
