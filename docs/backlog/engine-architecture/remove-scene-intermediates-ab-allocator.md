# Remove the dead A/B scene-intermediate allocator

Stage 2b-3 replaced `frame.render`'s A/B ping-pong post path with the pool-backed
linear chain evaluator (`evaluateChain`). The scene target is now acquired from
`_acquirePoolTarget` and every mid-chain target is pool-backed. As a result,
`_ensureSceneIntermediates` (and its `IntermediateEntry` type, the paired
`a`/`b` textures, `_disposeIntermediates`, and the per-ctx `intermediateByCtx`
WeakMap in `packages/core/src/post/intermediate.ts`) is **production-dead** —
referenced only by its own tests:

- `packages/core/tests/post/intermediate.gpu.test.ts` (4 tests)
- `packages/core/tests/post/intermediate-hdr.gpu.test.ts` (2 tests)

The shared clamp-to-edge linear sampler that lived inside it was extracted to
`_ensurePostSampler(ctx)` (kept in the same file), which is what `evaluateChain`
now uses. Only the A/B texture machinery is dead.

It was left in place during 2b-3 to keep the full suite green and because
deleting a documented internal helper plus its 6 tests is a reductive
deletion-pass decision, not part of the feature task's scope. The HDR
format assertion those tests make (`im.a.format === "rgba16float"`) is now
covered structurally by the pool path; before deleting, confirm an equivalent
assertion exists (e.g. a `_poolStats`/format check that the scene target is
acquired at `workingColorFormat`) or add one so deleting these tests doesn't
drop HDR-intermediate-format coverage.

**Trigger to revisit:** next post/visual-fidelity tranche that touches
`post/intermediate.ts`, OR any hygiene/deletion-pass sweep of the post module.

**Reference:** `packages/core/src/post/intermediate.ts` (the dead allocator +
the live `_ensurePostSampler`), `packages/core/src/frame/render.ts`
(`evaluateChain`, the new pool-backed scene-target acquire), `packages/core/src/post/pool.ts`.
