import { expect, test } from "bun:test";
import { blend } from "./blend.ts";

test("blend.premultiplied structure", () => {
  expect(blend.premultiplied.color.srcFactor).toBe("one");
  expect(blend.premultiplied.color.dstFactor).toBe("one-minus-src-alpha");
  expect(blend.premultiplied.color.operation).toBe("add");
  expect(blend.premultiplied.alpha.srcFactor).toBe("one");
  expect(blend.premultiplied.alpha.dstFactor).toBe("one-minus-src-alpha");
  expect(blend.premultiplied.alpha.operation).toBe("add");
});

test("blend.additive structure", () => {
  expect(blend.additive.color.srcFactor).toBe("one");
  expect(blend.additive.color.dstFactor).toBe("one");
  expect(blend.additive.color.operation).toBe("add");
  expect(blend.additive.alpha.srcFactor).toBe("one");
  expect(blend.additive.alpha.dstFactor).toBe("one");
  expect(blend.additive.alpha.operation).toBe("add");
});

test("blend.straightAlpha structure", () => {
  expect(blend.straightAlpha.color.srcFactor).toBe("src-alpha");
  expect(blend.straightAlpha.color.dstFactor).toBe("one-minus-src-alpha");
  expect(blend.straightAlpha.color.operation).toBe("add");
  expect(blend.straightAlpha.alpha.srcFactor).toBe("one");
  expect(blend.straightAlpha.alpha.dstFactor).toBe("one-minus-src-alpha");
  expect(blend.straightAlpha.alpha.operation).toBe("add");
});

test("preset constants are deep-frozen", () => {
  expect(Object.isFrozen(blend)).toBe(true);
  expect(Object.isFrozen(blend.premultiplied)).toBe(true);
  expect(Object.isFrozen(blend.premultiplied.color)).toBe(true);
  expect(Object.isFrozen(blend.premultiplied.alpha)).toBe(true);
  expect(Object.isFrozen(blend.additive)).toBe(true);
  expect(Object.isFrozen(blend.additive.color)).toBe(true);
  expect(Object.isFrozen(blend.additive.alpha)).toBe(true);
  expect(Object.isFrozen(blend.straightAlpha)).toBe(true);
  expect(Object.isFrozen(blend.straightAlpha.color)).toBe(true);
  expect(Object.isFrozen(blend.straightAlpha.alpha)).toBe(true);
});
