import { expect, test } from "bun:test";
import { computeFps } from "../src/stats.ts";

test("computeFps: zero elapsed time returns 0", () => {
  expect(computeFps(60, 0)).toBe(0);
});

test("computeFps: negative elapsed time returns 0 (clock anomaly guard)", () => {
  expect(computeFps(60, -0.5)).toBe(0);
});

test("computeFps: rounds frames-per-second to nearest integer", () => {
  expect(computeFps(60, 1)).toBe(60);
  expect(computeFps(120, 1)).toBe(120);
  expect(computeFps(59, 1.01)).toBe(58);
});

test("computeFps: zero frames over a positive interval returns 0", () => {
  expect(computeFps(0, 1)).toBe(0);
});
