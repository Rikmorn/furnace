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
