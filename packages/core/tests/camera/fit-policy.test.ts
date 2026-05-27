import { expect, test } from "bun:test";
import { _deriveBounds, policy } from "../../src/camera/fit-policy.ts";

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

test("_deriveBounds stretch: bounds multiplied by scale, canvas ignored", () => {
  const p = policy.stretch({ left: -2, right: 2, bottom: -1, top: 1 });
  const b1 = _deriveBounds(p, 1, 100, 100);
  expect(b1).toEqual({ left: -2, right: 2, bottom: -1, top: 1 });
  const b2 = _deriveBounds(p, 2, 800, 600);
  expect(b2).toEqual({ left: -4, right: 4, bottom: -2, top: 2 });
});

test("_deriveBounds preserve-height with centered anchor: width = height * aspect", () => {
  const p = policy.preserveHeight(2); // anchor (0.5, 0.5)
  // 16:9 canvas → aspect 16/9; width = 2 * 16/9; half = 16/9
  const b = _deriveBounds(p, 1, 1600, 900);
  expect(b.bottom).toBeCloseTo(-1);
  expect(b.top).toBeCloseTo(1);
  expect(b.left).toBeCloseTo(-16 / 9);
  expect(b.right).toBeCloseTo(16 / 9);
});

test("_deriveBounds preserve-height with bottom-left anchor: positive bounds", () => {
  const p = policy.preserveHeight(2, { x: 0, y: 0 });
  const b = _deriveBounds(p, 1, 200, 100);
  // height = 2, width = 2 * 2 = 4; anchor (0,0) puts origin at bottom-left.
  expect(b.left).toBe(0);
  expect(b.right).toBe(4);
  expect(b.bottom).toBe(0);
  expect(b.top).toBe(2);
});

test("_deriveBounds preserve-height with top-right anchor", () => {
  const p = policy.preserveHeight(2, { x: 1, y: 1 });
  const b = _deriveBounds(p, 1, 200, 100);
  expect(b.left).toBe(-4);
  expect(b.right).toBe(0);
  expect(b.bottom).toBe(-2);
  expect(b.top).toBe(0);
});

test("_deriveBounds preserve-height honors scale", () => {
  const p = policy.preserveHeight(2);
  const b = _deriveBounds(p, 3, 100, 100);
  // scale=3, height=2*3=6, width=6*1=6, anchor centered.
  expect(b.left).toBeCloseTo(-3);
  expect(b.right).toBeCloseTo(3);
  expect(b.bottom).toBeCloseTo(-3);
  expect(b.top).toBeCloseTo(3);
});

test("_deriveBounds preserve-width mirrors preserve-height", () => {
  const p = policy.preserveWidth(4);
  // width=4, aspect=2 → height=2; anchor centered.
  const b = _deriveBounds(p, 1, 200, 100);
  expect(b.left).toBeCloseTo(-2);
  expect(b.right).toBeCloseTo(2);
  expect(b.bottom).toBeCloseTo(-1);
  expect(b.top).toBeCloseTo(1);
});
