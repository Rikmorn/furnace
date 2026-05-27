# Pipeline cache leaks pipelines across disposed contexts

*Filed during Tranche A-4 (2026-05-28) — adjacent finding from Task 10 (renderToTexture validation) review.*

`packages/core/src/material/pipeline.ts:9` declares the pipeline cache
as a module-level `Map<string, CacheEntry>`. The cache key (constructed
in `packages/core/src/material/material.ts:156-165`) includes
`ctx.format` (a string like `"bgra8unorm"`) but NOT context identity.

When a consumer disposes a context (`gpu.dispose(ctx)`) WITHOUT first
calling `material.destroy()` on every material allocated against it,
cache entries with refcount ≥ 1 survive — holding `GPURenderPipeline`
objects whose underlying `GPUDevice` is now destroyed. A subsequent
context with the same surface format computes the same cache key →
cache HIT → returns the dead pipeline → first draw fails with
`"BindGroupLayout is associated with [Device], and cannot be used
with [Device]"`.

This is a structural issue, not a test-pollution artifact — the
`_pipelineCache.resetForTests()` helper at `pipeline.ts:34` exists
precisely because the leak between tests was already known to be
possible. Surfaced visibly during Tranche A-4 Task 10 (renderToTexture
test additions) because tests churn contexts faster than typical
consumers do.

## Fix shape

Two coherent options:

1. **Key the cache by `(Context, hashString)`.** Use a `WeakMap<Context,
   Map<string, CacheEntry>>` so cache entries are GC'd when the
   Context is unreachable. Pure structural change; no consumer-visible
   API change.

2. **Cascade pipeline destruction in `gpu.dispose`.** Use the existing
   `_onDispose` cascade primitive (added in Tranche B) to walk the
   cache on dispose and release any entry whose pipeline is associated
   with the disposed ctx. Requires the cache to track which ctx each
   entry was built against — adds bookkeeping but keeps the cache
   shape simple.

Option 1 is simpler and likely correct. Option 2 keeps the cache more
useful across multiple ctxs that happen to need identical pipelines
(rare in practice — ctx churn is usually app teardown, not concurrent
multi-ctx).

## Trigger to revisit

- When a consumer reports `"BindGroupLayout is associated with
  [Device]"` errors after `gpu.dispose` + new ctx creation, OR
- When a future tranche cleans up the dispose-cascade contracts and
  this naturally folds in.

## What to verify when fixing

- A new ctx after `gpu.dispose` of a previous ctx (without explicit
  `material.destroy` calls) does NOT hit cross-device pipelines.
- The existing `_pipelineCache.resetForTests()` workaround can be
  removed (or its callers can stop using it).
- `bun run check`, `bun run typecheck`, `bun test` clean.
- Cookbook demos still boot.

**Reference:** Surfaced during Tranche A-4 Task 10 (2026-05-28).
Cache definition: `packages/core/src/material/pipeline.ts:9`. Key
construction: `packages/core/src/material/material.ts:156-165`.
