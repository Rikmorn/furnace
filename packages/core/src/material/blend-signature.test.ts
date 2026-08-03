import { expect, test } from "bun:test";
import { _blendSignature } from "./material.ts";

test("blendSignature returns 'none' for undefined", () => {
  expect(_blendSignature(undefined)).toBe("none");
});

test("blendSignature normalises missing factors to spec defaults", () => {
  const allDefaults: GPUBlendState = { color: {}, alpha: {} };
  const fullySpec: GPUBlendState = {
    color: { srcFactor: "one", dstFactor: "zero", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "zero", operation: "add" },
  };
  expect(_blendSignature(allDefaults)).toBe(_blendSignature(fullySpec));
});

test("blendSignature distinguishes meaningfully different blend states", () => {
  const premult: GPUBlendState = {
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
  const additive: GPUBlendState = {
    color: { srcFactor: "one", dstFactor: "one", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
  };
  expect(_blendSignature(premult)).not.toBe(_blendSignature(additive));
});
