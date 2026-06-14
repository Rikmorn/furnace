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

**Reference:** Core Tranche 6 (post-process) design §1 Out.

**Update (Stage 4, 2026-06-08):** The shadow-map work landed the **depth-only caster pipeline** —
the THIRD pipeline-building site this entry anticipated. It is built inline in `frame/shadow-map.ts`
`_ensureShadowCasterPipeline` (depth-only target, no color attachment, `depth32float`, single-sample,
own vertex layout), with its own ad-hoc once-cache rather than the shared refcounted primitive. The
trigger has now technically fired (three sites: material, post, shadow caster), but extraction stays
**deferred** for Stage 4 — the caster pipeline is a singleton built once, so the duplication cost is
small today. Re-evaluate when a fourth site (compute / debug-draw / instanced) makes the shared
factory pay for itself.
