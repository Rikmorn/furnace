# Rust transforms wasm crate

Compile a Rust matrix-math crate to wasm via `wasm-pack` to host the hot scene-graph transform loop (positions/quaternions/scale → matrices) off the JS engine. Not relevant until we have a scene graph at all — see `docs/research/shallot.md` § "Engine library + wasm hot loops" for the reference pattern.

**Trigger to revisit:** When transforms become a hot path.
