# Built-in effect internal-resource ownership

`post.tonemap` (Stage 2a) creates two engine-internal resources the consumer never sees: an engine-owned tonemap **Shader** (cached per-ctx in a module `WeakMap`, mirroring `_ensureFullscreenVS`) and a `@group(1)` **Binding** (its `{ exposure, op }` uniform buffer). Per the post-effect contract, `post.destroy(ctx, effect)` releases only the effect's pipeline ref — it does **not** free the shader or the binding. Both are reclaimed by the dispose cascade at `gpu.dispose(ctx)`.

For a long-lived tonemap (the normal case — one per scene, torn down with the ctx) this is correct and leak-free. The wart: a consumer that *churns* built-in effects (creates and `post.destroy`s many over a session) accumulates orphaned bindings (and, for any non-cached built-in, shaders) in the resource pools until ctx dispose. They aren't in the dispose leak-tally (which counts meshes/materials/geometries/effects), so it surfaces only as growing GPU memory.

A cleaner design would let a built-in effect **own** its internal shader/binding and free them on effect destroy — e.g. an optional "owned resources" list on the effect slot that `post.destroy` tears down. That changes `post.create`/`EffectSlot`'s contract, so it was deferred rather than bolted on in 2a.

**Trigger to revisit:** Stage 2b adds `post.bloom` (more internal resources per built-in effect) — decide the ownership model then; OR the first time a consumer pattern churns built-in effects per-frame/per-interaction.

**Reference:** `packages/core/src/post/tonemap.ts` (the cache + binding), `packages/core/src/post/effect.ts` (`EffectSlot`, `destroy` contract). Related: the `post-bind-group-cache.md` deferral.
