import { expect, test } from "bun:test";
import {
  ADDITIVE_BLEND,
  PREMULTIPLIED_ALPHA_BLEND,
  STRAIGHT_ALPHA_BLEND,
} from "../../src/material/blend.ts";

test("PREMULTIPLIED_ALPHA_BLEND structure", () => {
  expect(PREMULTIPLIED_ALPHA_BLEND.color.srcFactor).toBe("one");
  expect(PREMULTIPLIED_ALPHA_BLEND.color.dstFactor).toBe("one-minus-src-alpha");
  expect(PREMULTIPLIED_ALPHA_BLEND.color.operation).toBe("add");
  expect(PREMULTIPLIED_ALPHA_BLEND.alpha.srcFactor).toBe("one");
  expect(PREMULTIPLIED_ALPHA_BLEND.alpha.dstFactor).toBe("one-minus-src-alpha");
  expect(PREMULTIPLIED_ALPHA_BLEND.alpha.operation).toBe("add");
});

test("ADDITIVE_BLEND structure", () => {
  expect(ADDITIVE_BLEND.color.srcFactor).toBe("one");
  expect(ADDITIVE_BLEND.color.dstFactor).toBe("one");
  expect(ADDITIVE_BLEND.color.operation).toBe("add");
  expect(ADDITIVE_BLEND.alpha.srcFactor).toBe("one");
  expect(ADDITIVE_BLEND.alpha.dstFactor).toBe("one");
  expect(ADDITIVE_BLEND.alpha.operation).toBe("add");
});

test("STRAIGHT_ALPHA_BLEND structure", () => {
  expect(STRAIGHT_ALPHA_BLEND.color.srcFactor).toBe("src-alpha");
  expect(STRAIGHT_ALPHA_BLEND.color.dstFactor).toBe("one-minus-src-alpha");
  expect(STRAIGHT_ALPHA_BLEND.color.operation).toBe("add");
  expect(STRAIGHT_ALPHA_BLEND.alpha.srcFactor).toBe("one");
  expect(STRAIGHT_ALPHA_BLEND.alpha.dstFactor).toBe("one-minus-src-alpha");
  expect(STRAIGHT_ALPHA_BLEND.alpha.operation).toBe("add");
});

test("preset constants are deep-frozen", () => {
  expect(Object.isFrozen(PREMULTIPLIED_ALPHA_BLEND)).toBe(true);
  expect(Object.isFrozen(PREMULTIPLIED_ALPHA_BLEND.color)).toBe(true);
  expect(Object.isFrozen(PREMULTIPLIED_ALPHA_BLEND.alpha)).toBe(true);
  expect(Object.isFrozen(ADDITIVE_BLEND)).toBe(true);
  expect(Object.isFrozen(ADDITIVE_BLEND.color)).toBe(true);
  expect(Object.isFrozen(ADDITIVE_BLEND.alpha)).toBe(true);
  expect(Object.isFrozen(STRAIGHT_ALPHA_BLEND)).toBe(true);
  expect(Object.isFrozen(STRAIGHT_ALPHA_BLEND.color)).toBe(true);
  expect(Object.isFrozen(STRAIGHT_ALPHA_BLEND.alpha)).toBe(true);
});
