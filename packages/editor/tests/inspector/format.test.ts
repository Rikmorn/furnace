import { expect, test } from "bun:test";
import { roundForDisplay } from "../../src/frontend/inspector/lib/format.ts";

test("roundForDisplay strips IEEE-754 noise and excess precision", () => {
  expect(roundForDisplay(1.2000000000000002)).toBe(1.2);
  expect(roundForDisplay(10.090214558538591)).toBe(10.0902);
  expect(roundForDisplay(2)).toBe(2);
  expect(roundForDisplay(0.35)).toBe(0.35);
  expect(roundForDisplay(-0.0001)).toBe(-0.0001);
});

test("roundForDisplay passes non-finite values through unchanged", () => {
  expect(roundForDisplay(Number.NaN)).toBeNaN();
  expect(roundForDisplay(Number.POSITIVE_INFINITY)).toBe(
    Number.POSITIVE_INFINITY,
  );
});

test("roundForDisplay honours a custom precision", () => {
  expect(roundForDisplay(10.090214558538591, 2)).toBe(10.09);
});
