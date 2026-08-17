---
summary: the `Shader` substrate retains the WGSL `source` on the slot and is hot-reload-ready, but nothing rebuilds pipelines when a `.wgsl` changes; compile-error recovery and layout-changing edits are the open questions
---

# Hot reload of shaders

**Unblocked by Tranche D-1, landed 2026-05-31.** The `Shader` resource substrate is now in place: `shader.load(ctx, url)` is the load path, `Shader` handles are poolable uint48 handles, and the engine retains the WGSL `source` on the `ShaderSlot` (hot-reload-ready). Building HMR itself stays here as a later dev-tooling tranche. Trigger (below) has NOT fired.

In dev mode, when a `.wgsl` file changes on disk, the engine recompiles the shader and swaps pipelines without restarting the app. Wires into Bun's HMR (`bun --hot serve.ts`) — Bun already notifies on file changes; the engine listens and propagates.

Implementation sketch: shaders loaded via `shader.load(ctx, url)` are tracked in a dev-mode registry (url → handle); on HMR file change, the engine re-fetches the source, calls `shader.create` with the new code to get a new handle, and for every material referencing the old handle re-builds the pipeline via `material.create` with the new `Shader`. State held in the running app (camera position, mesh transforms, animation progress) is preserved. The retained `ShaderSlot.source` string supports a revert-to-last-good path if the new WGSL fails to compile.

Open design questions: how to handle shaders with compile errors after edit (revert to last-good? show error overlay?); how to handle pipeline-layout changes (uniform/binding mismatches force a re-create with potential data loss); whether this is dev-only (build flag) or always-on with a small cost; whether bind groups need rebuilding too.

Should be off in production (no `import.meta.hot` access, no dev-server listeners).

**Trigger to revisit:** When shader iteration becomes a friction point — typically when working on a real post-process pipeline or experimenting with shader effects where the round-trip "edit, save, refresh, re-set-up scene" is noticeable.

**Reference:** Core architecture design § "Deferred decisions".