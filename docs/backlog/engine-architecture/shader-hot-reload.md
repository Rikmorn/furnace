# Hot reload of shaders

**Unblocked by Tranche D-1 (`shader-resource.md`), 2026-05-30 — but not part of it.** The implementation sketch below hangs off `material.loadShader(url)` + a dev registry; D-1's `Shader` resource (`shader.load` + a poolable handle) is exactly that substrate. D-1 should make the `Shader` handle hot-reload-*ready*; building HMR itself stays here as a later dev-tooling tranche. Trigger (below) has NOT fired.

In dev mode, when a `.wgsl` file changes on disk, the engine recompiles the shader and swaps pipelines without restarting the app. Wires into Bun's HMR (`bun --hot serve.ts`) — Bun already notifies on file changes; the engine listens and propagates.

Implementation sketch: shaders loaded via `material.loadShader(url)` are tracked in a dev-mode registry; on HMR file change, the engine re-fetches the source, calls `device.createShaderModule` with the new code, and atomically swaps the pipeline. State held in the running app (camera position, mesh transforms, animation progress) is preserved.

Open design questions: how to handle shaders with compile errors after edit (revert to last-good? show error overlay?); how to handle pipeline-layout changes (uniform/binding mismatches force a re-create with potential data loss); whether this is dev-only (build flag) or always-on with a small cost; whether bind groups need rebuilding too.

Should be off in production (no `import.meta.hot` access, no dev-server listeners).

**Trigger to revisit:** When shader iteration becomes a friction point — typically when working on a real post-process pipeline or experimenting with shader effects where the round-trip "edit, save, refresh, re-set-up scene" is noticeable.

**Reference:** `docs/superpowers/specs/2026-05-21-core-architecture-design.md` § "Deferred decisions".
