import type { Context } from "../gpu/context-types.ts";

const postSamplerByCtx = new WeakMap<Context, GPUSampler>();

function createSharedSampler(ctx: Context): GPUSampler {
  return ctx.device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  });
}

/**
 * Get-or-create the shared clamp-to-edge linear sampler used by the post-chain
 * evaluator to sample each pass's colour input(s). One sampler per ctx; freed by
 * GC when the ctx is dropped (`GPUSampler` has no explicit destroy). Engine-
 * internal — `frame.render`'s chain evaluator is the only caller.
 */
export function _ensurePostSampler(ctx: Context): GPUSampler {
  const cached = postSamplerByCtx.get(ctx);
  if (cached !== undefined) return cached;
  const sampler = createSharedSampler(ctx);
  postSamplerByCtx.set(ctx, sampler);
  return sampler;
}
