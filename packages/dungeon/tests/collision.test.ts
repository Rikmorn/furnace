import { expect, test } from "bun:test";
import { slideMove } from "../src/collision.ts";
import type { Box } from "../src/level.ts";

const RADIUS = 0.3;
// A wall: thin box at x=1.5 spanning z.
const WALL: Box[] = [{ center: [1.5, 1.5, -8], size: [0.2, 3, 16] }];

test("moving into a wall on +X is blocked", () => {
  const from: [number, number, number] = [1.0, 1.6, -8];
  const out = slideMove(from, [0.5, 0, 0], RADIUS, WALL);
  // wall inner face at x = 1.5 - 0.1 = 1.4; minus radius 0.3 → stop at 1.1
  expect(out[0]).toBeLessThanOrEqual(1.1 + 1e-4);
  expect(out[0]).toBeGreaterThan(1.0 - 1e-4);
});

test("moving parallel to the wall on Z slides freely", () => {
  const from: [number, number, number] = [1.0, 1.6, -8];
  const out = slideMove(from, [0, 0, -1], RADIUS, WALL);
  expect(out[2]).toBeCloseTo(-9, 5);
  expect(out[0]).toBeCloseTo(1.0, 5);
});

test("a blocked X still allows the Z component (slide along wall)", () => {
  const from: [number, number, number] = [1.0, 1.6, -8];
  const out = slideMove(from, [0.5, 0, -1], RADIUS, WALL);
  expect(out[0]).toBeLessThanOrEqual(1.1 + 1e-4); // X clamped
  expect(out[2]).toBeCloseTo(-9, 5); // Z free
});
