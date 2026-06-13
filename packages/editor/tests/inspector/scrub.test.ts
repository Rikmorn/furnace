import { expect, test } from "bun:test";
import { scrubValue } from "../../src/frontend/inspector/lib/scrub.ts";

test("scrubValue: dx scaled by sensitivity; shift = fine", () => {
  expect(scrubValue(10, 4, 0.1, false)).toBeCloseTo(10.4, 6); // start + dx*0.1
  expect(scrubValue(10, 4, 0.1, true)).toBeCloseTo(10.04, 6); // fine = ÷10
});

test("scrubValue: negative dx decreases value", () => {
  expect(scrubValue(5, -10, 0.1, false)).toBeCloseTo(4, 6); // 5 + (-10)*0.1
  expect(scrubValue(5, -10, 0.1, true)).toBeCloseTo(4.9, 6); // fine: 5 + (-10)*0.1*0.1
});

test("scrubValue: zero dx leaves value unchanged", () => {
  expect(scrubValue(42, 0, 0.1, false)).toBeCloseTo(42, 6);
  expect(scrubValue(42, 0, 0.1, true)).toBeCloseTo(42, 6);
});
