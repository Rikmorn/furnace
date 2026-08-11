# Plugin API Spec

The native-shell distribution design (Plugin Model section) establishes that plugins are Rust crates compiled to wasm running inside the JS layer (chosen over the Tauri-style Rust-in-runtime model to preserve cross-platform reach). The plugin *mechanism* is decided; the full `Plugin` trait shape, payload schemas, async patterns, lifecycle hooks, and JS-side IPC contract are deliberately deferred. Tauri's `command!` macro is a strong precedent to crib from.

**Trigger to revisit:** First plugin authored in earnest (likely after filesystem or audio is needed as a furnace-first-party plugin), OR when a third-party wants to publish a `furnace-plugin-*` crate.

**Reference:** Plugin Model section of `docs/reference/packaging-and-distribution.md`.
