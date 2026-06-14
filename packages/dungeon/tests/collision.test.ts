import { expect, test } from "bun:test";
import { slideMove } from "../src/collision.ts";
import type { Box } from "../src/level.ts";
import { LEVEL_BOXES } from "../src/level.ts";

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

test("a floor box below the player does not block horizontal movement", () => {
  const FLOOR: Box[] = [{ center: [0, 0, -8], size: [3, 0.2, 16] }];
  const out = slideMove([0, 1.6, -8], [0.5, 0, 0], RADIUS, FLOOR);
  expect(out[0]).toBeCloseTo(0.5, 5); // free — floor is below the player's body band
});

test("player can walk forward from spawn (floors/ceilings don't trap them)", () => {
  const out = slideMove([0, 1.6, -2], [0, 0, -0.5], RADIUS, LEVEL_BOXES);
  expect(out[2]).toBeLessThan(-2); // moved forward, NOT ejected backward
  expect(out[2]).toBeCloseTo(-2.5, 5);
});
