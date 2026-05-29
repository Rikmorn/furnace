/**
 * Frozen `GPUBlendState` for premultiplied-alpha compositing — the production
 * default. Pass to `MaterialDescriptor.blend`.
 *
 * Math: `src=one, dst=one-minus-src-alpha, op=add` for both color and alpha.
 * The shader is expected to output color already multiplied by alpha
 * (`vec4(rgb * a, a)`); the blend equation then composes correctly when
 * translucent overlays are chained, which is why every production engine
 * pre-multiplies. Compare `material.blend.straightAlpha` for the naive,
 * non-PMA path and the seam artefacts it produces under chained overlays.
 */
// Boundary cast: Object.freeze widens to Readonly; structural match with GPUBlendState is preserved
const PREMULTIPLIED_ALPHA_BLEND: GPUBlendState = Object.freeze({
  color: Object.freeze({
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  }),
  alpha: Object.freeze({
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  }),
}) as GPUBlendState;

/**
 * Frozen `GPUBlendState` for additive blending. Pass to
 * `MaterialDescriptor.blend`.
 *
 * Math: `src=one, dst=one, op=add` for both color and alpha. Useful for
 * particles, light accumulation, glow passes — anywhere contributions sum
 * rather than occlude.
 */
// Boundary cast: Object.freeze widens to Readonly; structural match with GPUBlendState is preserved
const ADDITIVE_BLEND: GPUBlendState = Object.freeze({
  color: Object.freeze({
    srcFactor: "one",
    dstFactor: "one",
    operation: "add",
  }),
  alpha: Object.freeze({
    srcFactor: "one",
    dstFactor: "one",
    operation: "add",
  }),
}) as GPUBlendState;

/**
 * Frozen `GPUBlendState` for non-premultiplied ("straight") alpha blending —
 * the naive alpha-blend most beginners reach for. Pass to
 * `MaterialDescriptor.blend`.
 *
 * Math: color `src=src-alpha, dst=one-minus-src-alpha, op=add`; alpha
 * `src=one, dst=one-minus-src-alpha, op=add`. Compare with
 * `material.blend.premultiplied`: PMA composes correctly under chained
 * translucent overlays; straight alpha accumulates α-multiplication error
 * visible at the seams. Prefer PMA unless you have a specific reason to
 * stay non-premultiplied.
 */
// Boundary cast: Object.freeze widens to Readonly; structural match with GPUBlendState is preserved
const STRAIGHT_ALPHA_BLEND: GPUBlendState = Object.freeze({
  color: Object.freeze({
    srcFactor: "src-alpha",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  }),
  alpha: Object.freeze({
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  }),
}) as GPUBlendState;

/**
 * Blend-state presets (well-formed `GPUBlendState` constants). Sugar-helper namespace (api-posture.md R6).
 *
 * - `blend.straightAlpha` — non-premultiplied alpha blending. The "naive"
 *   alpha-blend most beginners reach for; accumulates α-multiplication error
 *   at the seams when translucent overlays are chained.
 * - `blend.premultiplied` — premultiplied-alpha compositing; the production
 *   default. Shader must output `vec4(rgb * a, a)`. Composes correctly under
 *   chained translucent overlays.
 * - `blend.additive` — additive blending; contributions sum rather than
 *   occlude. Useful for particles, glow passes, light accumulation.
 *
 * All three values are frozen `GPUBlendState` objects; pass directly to
 * `MaterialDescriptor.blend`.
 */
export const blend = Object.freeze({
  straightAlpha: STRAIGHT_ALPHA_BLEND,
  premultiplied: PREMULTIPLIED_ALPHA_BLEND,
  additive: ADDITIVE_BLEND,
});
