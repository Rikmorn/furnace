import { FurnaceError } from "../errors.ts";
import type { Context } from "../gpu/index.ts";
import type { SamplerParams } from "./types.ts";

/** Engine-wide default sampler: trilinear, repeat-wrap, no anisotropy. */
export const DEFAULT_SAMPLER: Required<SamplerParams> = {
  magFilter: "linear",
  minFilter: "linear",
  mipmapFilter: "linear",
  addressU: "repeat",
  addressV: "repeat",
  maxAnisotropy: 1,
};

function keyOf(p: Required<SamplerParams>): string {
  return [
    p.magFilter,
    p.minFilter,
    p.mipmapFilter,
    p.addressU,
    p.addressV,
    p.maxAnisotropy,
  ].join("|");
}

/**
 * Resolve sampler params to a cached, deduped {@link GPUSampler} for this ctx.
 * Setup-loud on the WebGPU anisotropic-filtering rule: `maxAnisotropy > 1`
 * requires `magFilter`, `minFilter`, and `mipmapFilter` all `"linear"`.
 *
 * @remarks
 * Internal — there is no public Sampler handle (deferred escape hatch).
 * Cache lives on `ctx._internal.resources.samplerCache`; GC'd with the ctx device.
 *
 * @throws FurnaceError - when maxAnisotropy > 1 and any of magFilter/minFilter/mipmapFilter is not "linear".
 */
export function _getSampler(
  ctx: Context,
  params: SamplerParams = {},
): GPUSampler {
  const p: Required<SamplerParams> = { ...DEFAULT_SAMPLER, ...params };

  const violatesAnisotropyRule =
    p.maxAnisotropy > 1 &&
    (p.magFilter !== "linear" ||
      p.minFilter !== "linear" ||
      p.mipmapFilter !== "linear");

  if (violatesAnisotropyRule) {
    throw new FurnaceError(
      "sampler: maxAnisotropy > 1 requires magFilter, minFilter, and mipmapFilter all 'linear'",
    );
  }

  const cache = ctx._internal.resources.samplerCache;
  const key = keyOf(p);
  const existing = cache.get(key);
  if (existing) return existing;

  const sampler = ctx.device.createSampler({
    magFilter: p.magFilter,
    minFilter: p.minFilter,
    mipmapFilter: p.mipmapFilter,
    addressModeU: p.addressU,
    addressModeV: p.addressV,
    maxAnisotropy: p.maxAnisotropy,
  });
  cache.set(key, sampler);
  return sampler;
}
