# Post: bind-group caching (revised after T2 pool)

## Original concern (superseded)

The original entry described caching `@group(0)` bind groups for the old A/B ping-pong pattern — only two flavors (`sceneA-as-input`, `sceneB-as-input`) ever needed per effect. That pattern was replaced by Stage 2b-3's pool-backed linear chain evaluator (`post/evaluate.ts: _evaluateChain`), which acquires a fresh transient target per mid-chain pass. The two-flavor shape no longer applies.

## Revised concern (live)

The chain evaluator (`recordPassDraw` in `post/evaluate.ts`) creates a **new `GPUBindGroup` for `@group(0)` on every frame per pass**. Each call constructs a fresh bind group over the pipeline's auto-derived layout from N input texture views + one sampler.

WebGPU bind-group creation is cheap (CPU-only struct; no GPU work), so at low-effect-count / low-pass-count depths this is negligible. As pass counts grow (e.g. a 12-pass bloom + multi-effect chain), the per-frame allocation count grows linearly.

The `@group(1)` bind group is built lazily (once per pipeline variant, per resolved target format) and cached in `PassSlot.byFormat` — that path is already cached.

## What would a fix look like?

Cache `@group(0)` keyed by the tuple of input texture view objects. Because pool targets are reused across frames (same `GPUTexture` → same `GPUTextureView` object for any given `(w, h, format)` key), a `WeakMap<GPUTextureView, GPUBindGroup>` (or a composite key over N views) per pass-slot could give ~100% hit rate once the pool's free list stabilises.

A simpler but partial approach: cache on first frame per input-set; invalidate on resize (which invalidates the pool anyway). This is less correct than a WeakMap key but simpler.

## Current live concern

The per-frame `@group(0)` bind-group rebuild in `evaluate.ts:recordPassDraw` is the cacheable hot-path item. At typical effect depths (1–3 effects, 1–15 passes for bloom) the cost is buried in `queue.submit` overhead. Revisit when profiling surfaces it.

**Trigger to revisit:** Profiling shows post bind-group allocation as a measurable hot spot, OR effect / pass counts routinely exceed ~10–20 passes per frame in a real consumer scene.

**Reference:** `packages/core/src/post/evaluate.ts` (`recordPassDraw`), `packages/core/src/post/pool.ts` (pool reuse), `packages/core/src/post/effect.ts` (`_resolvePassPipeline`, which already caches `@group(1)` per format).
