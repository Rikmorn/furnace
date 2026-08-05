// The post module's engine-private door. Sibling core modules reach the chain
// evaluator, the transient-target pool, the shared sampler, and the slot shape
// through this file rather than deep-importing evaluate.ts / pool.ts /
// post-sampler.ts / effect.ts. None of it is consumer surface — that is
// index.ts. `frame/render.ts` is the integrator that drives all of it per frame.

/**
 * The shape every effect resolves to: a list of passes, the bindings the effect
 * itself owns, and the teardown that releases both. Engine-internal — the chain
 * evaluator consumes a `readonly EffectSlot[]`.
 */
export type { EffectSlot } from "./effect.ts";

/**
 * Evaluate the flattened post chain: every effect's passes concatenated into one
 * linear sequence, mid-chain passes rendering into pool-backed transient targets
 * and the final pass into the swap chain. Engine-internal — `frame.render` is
 * the only caller.
 */
export { _evaluateChain } from "./evaluate.ts";

/**
 * Bytes per texel for the colour render-target formats the engine allocates,
 * for GPU memory-stats accounting.
 *
 * @remarks
 * Not post-specific — a pure `GPUTextureFormat`→number lookup. It is declared
 * here because post owns the file today; relocating it to a shared gpu-side leaf
 * is honest future work, not this seam's business.
 */
export { bytesPerTexel } from "./format-bytes.ts";

/**
 * The per-ctx transient render-target pool: `_poolBeginFrame` trims the free
 * list when the canvas size changes (call once per frame, before acquiring),
 * `_acquirePoolTarget` reuses a matching free target or allocates a new one.
 * Engine-internal — the chain evaluator and the built-in effects are the callers.
 */
export { _acquirePoolTarget, _poolBeginFrame } from "./pool.ts";

/**
 * Get-or-create the shared clamp-to-edge linear sampler the chain evaluator uses
 * to sample each pass's colour input. One per ctx. Engine-internal.
 */
export { _ensurePostSampler } from "./post-sampler.ts";
