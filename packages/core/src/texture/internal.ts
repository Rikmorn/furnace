// The texture module's engine-private door. Sibling core modules reach the
// sampler cache through this file rather than deep-importing sampler-cache.ts.
// None of it is consumer surface — that is index.ts.

/**
 * Resolve `SamplerParams` to a cached, deduped `GPUSampler` for this ctx.
 * Setup-loud on the WebGPU anisotropy rule. Engine-internal: there is no public
 * Sampler handle, so `material.create` reaches this to build its bind group.
 */
export { _getSampler } from "./sampler-cache.ts";
