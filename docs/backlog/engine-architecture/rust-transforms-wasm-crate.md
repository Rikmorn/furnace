# Rust transforms wasm crate

Compile a Rust matrix-math crate to wasm via `wasm-pack` to host the hot scene-graph transform loop (positions/quaternions/scale → matrices) off the JS engine. Specific instance of the broader "module wasm-backing" pattern — any core module whose hot path becomes a measurable problem can be replaced with a Rust→wasm implementation behind the same function-level API (design language rule 4, per the core architecture spec).

The Tier 1 `transform` module is pure JS/TS to start; this entry is its eventual perf upgrade. Not relevant until we have a scene graph at all (or large numbers of entities that need their world matrices recomputed each frame).

**Trigger to revisit:** When transforms become a hot path.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Design language" rule 4; `docs/research/shallot.md` § "Engine library + wasm hot loops" for the reference pattern.
