import { expect, test } from "bun:test";
import { policy } from "../../src/camera/fit-policy.ts";

test("policy.stretch returns a stretch variant with the given bounds", () => {
  const p = policy.stretch({ left: -2, right: 2, bottom: -1, top: 1 });
  expect(p.kind).toBe("stretch");
  if (p.kind !== "stretch") throw new Error("unreachable");
  expect(p.bounds).toEqual({ left: -2, right: 2, bottom: -1, top: 1 });
});

test("policy.stretch throws on non-finite bounds", () => {
  expect(() =>
    policy.stretch({ left: Number.NaN, right: 1, bottom: -1, top: 1 }),
  ).toThrow(/finite/);
  expect(() =>
    policy.stretch({
      left: -1,
      right: Number.POSITIVE_INFINITY,
      bottom: -1,
      top: 1,
    }),
  ).toThrow(/finite/);
});

test("policy.stretch throws on inverted bounds", () => {
  expect(() =>
    policy.stretch({ left: 1, right: -1, bottom: -1, top: 1 }),
  ).toThrow(/left.*right/i);
  expect(() =>
    policy.stretch({ left: -1, right: 1, bottom: 1, top: -1 }),
  ).toThrow(/bottom.*top/i);
});

test("policy.preserveHeight returns the variant with default anchor", () => {
  const p = policy.preserveHeight(2);
  expect(p.kind).toBe("preserve-height");
  if (p.kind !== "preserve-height") throw new Error("unreachable");
  expect(p.height).toBe(2);
  expect(p.anchor).toEqual({ x: 0.5, y: 0.5 });
});

test("policy.preserveHeight honors a custom anchor", () => {
  const p = policy.preserveHeight(2, { x: 0, y: 1 });
  if (p.kind !== "preserve-height") throw new Error("unreachable");
  expect(p.anchor).toEqual({ x: 0, y: 1 });
});

test("policy.preserveHeight throws on non-positive or non-finite height", () => {
  expect(() => policy.preserveHeight(0)).toThrow(/positive/);
  expect(() => policy.preserveHeight(-1)).toThrow(/positive/);
  expect(() => policy.preserveHeight(Number.NaN)).toThrow(/finite/);
});

test("policy.preserveHeight throws on out-of-range anchor", () => {
  expect(() => policy.preserveHeight(2, { x: -0.1, y: 0.5 })).toThrow(
    /\[0, ?1\]/,
  );
  expect(() => policy.preserveHeight(2, { x: 0.5, y: 1.1 })).toThrow(
    /\[0, ?1\]/,
  );
  expect(() => policy.preserveHeight(2, { x: Number.NaN, y: 0.5 })).toThrow(
    /finite/,
  );
});

test("policy.preserveWidth mirrors preserveHeight", () => {
  const p = policy.preserveWidth(3, { x: 1, y: 0 });
  expect(p.kind).toBe("preserve-width");
  if (p.kind !== "preserve-width") throw new Error("unreachable");
  expect(p.width).toBe(3);
  expect(p.anchor).toEqual({ x: 1, y: 0 });
});

test("policy.preserveWidth throws on non-positive width", () => {
  expect(() => policy.preserveWidth(0)).toThrow(/positive/);
});
