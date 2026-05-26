/**
 * Frozen `GPUBlendState` for premultiplied-alpha compositing — the production
 * default. Pass to `MaterialDescriptor.blend`.
 *
 * Math: `src=one, dst=one-minus-src-alpha, op=add` for both color and alpha.
 * The shader is expected to output color already multiplied by alpha
 * (`vec4(rgb * a, a)`); the blend equation then composes correctly when
 * translucent overlays are chained, which is why every production engine
 * pre-multiplies. Compare {@link STRAIGHT_ALPHA_BLEND} for the naive,
 * non-PMA path and the seam artefacts it produces under chained overlays.
 */
// Boundary cast: Object.freeze widens to Readonly; structural match with GPUBlendState is preserved
export const PREMULTIPLIED_ALPHA_BLEND: GPUBlendState = Object.freeze({
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
export const ADDITIVE_BLEND: GPUBlendState = Object.freeze({
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
 * {@link PREMULTIPLIED_ALPHA_BLEND}: PMA composes correctly under chained
 * translucent overlays; straight alpha accumulates α-multiplication error
 * visible at the seams. Prefer PMA unless you have a specific reason to
 * stay non-premultiplied.
 */
// Boundary cast: Object.freeze widens to Readonly; structural match with GPUBlendState is preserved
export const STRAIGHT_ALPHA_BLEND: GPUBlendState = Object.freeze({
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
