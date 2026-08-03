import { expect, test } from "bun:test";
import { clipVelocity, isWalkable } from "./char-move.ts";

test("clipVelocity removes the component into a wall, keeps the tangent", () => {
  // moving +x into a wall whose normal is -x → x cancelled, z preserved
  const out = clipVelocity([1, 0, 0.5], [-1, 0, 0]);
  expect(out[0]).toBeCloseTo(0, 6);
  expect(out[2]).toBeCloseTo(0.5, 6);
});

test("clipVelocity on a flat-up normal leaves horizontal motion intact", () => {
  const out = clipVelocity([1, -0.16, 0], [0, 1, 0]);
  expect(out[0]).toBeCloseTo(1, 6);
  expect(out[1]).toBeCloseTo(0, 6); // downward component clipped against the floor
});

test("isWalkable: gentle slope walkable, steep slope not", () => {
  const limitCos = Math.cos((50 * Math.PI) / 180);
  expect(isWalkable([0, 1, 0], limitCos)).toBe(true); // flat
  expect(isWalkable([0, 0.2, 0.98], limitCos)).toBe(false); // ~78° wall-ish
});
