# Shared pipeline factory + unified cache

Tranche 6 ships post with its own pipeline cache (`post/pipeline-cache.ts`)
structurally identical to material's (`material/pipeline.ts`). Two
singletons. The duplication is deliberate — master spec §3 forbids
cross-module imports of internals (stats is the documented exception),
so post can't reach into material's cache directly.

When a third pipeline-building module lands, that duplication becomes
costly and the abstraction's joints become visible. Likely candidates:
- **Compute pipelines** — entirely different (`GPUComputePipelineDescriptor`,
  no vertex/fragment/depth).
- **Shadow map pipelines** — depth-only target, no color attachment.
- **Debug drawing** — lines/points, different vertex layouts.
- **ECS instanced batches** — instance buffer in addition to vertex.

Likely shape:
- `gpu/pipeline-cache.ts` (or new internal module) holds the refcounted
  cache primitive, exported as `_pipelineCache`.
- Material, post, and the third module all import it; keys are namespaced
  (`"material:..."`, `"post:..."`, `"compute:..."`).
- Optionally extract a shared `_buildPipeline(ctx, opts)` that wraps
  shader-module creation + cache lookup + error-scope handling, with
  per-module descriptor builders feeding it.

**Trigger to revisit:** Third pipeline-building module lands.

**Reference:** `docs/superpowers/specs/2026-05-24-core-tranche-6-post-process-design.md` §1 Out.
