import { expect, test } from "bun:test";
import { _effectPipelineHashKey } from "../../src/post/pipeline.ts";

const PREMULT: GPUBlendState = {
  color: {
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  },
  alpha: {
    srcFactor: "one",
    dstFactor: "one-minus-src-alpha",
    operation: "add",
  },
};

test("identical inputs hash to the same key", () => {
  const a = _effectPipelineHashKey("shader", "bgra8unorm-srgb", undefined);
  const b = _effectPipelineHashKey("shader", "bgra8unorm-srgb", undefined);
  expect(a).toBe(b);
});

test("differing shader source yields a different key", () => {
  const a = _effectPipelineHashKey("shader1", "bgra8unorm-srgb", undefined);
  const b = _effectPipelineHashKey("shader2", "bgra8unorm-srgb", undefined);
  expect(a).not.toBe(b);
});

test("differing target format yields a different key", () => {
  const a = _effectPipelineHashKey("shader", "bgra8unorm-srgb", undefined);
  const b = _effectPipelineHashKey("shader", "rgba8unorm-srgb", undefined);
  expect(a).not.toBe(b);
});

test("blend vs no-blend yields different keys", () => {
  const a = _effectPipelineHashKey("shader", "bgra8unorm-srgb", undefined);
  const b = _effectPipelineHashKey("shader", "bgra8unorm-srgb", PREMULT);
  expect(a).not.toBe(b);
});
