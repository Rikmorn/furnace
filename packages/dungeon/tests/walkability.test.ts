// packages/dungeon/tests/walkability.test.ts
import { expect, test } from "bun:test";
import { GROUND_SNAP } from "../src/char-move.ts";
import {
  RAMP_MOUNT_LIMIT_RAD,
  SLOPE_LIMIT_COS,
  SLOPE_LIMIT_RAD,
  STEP_HEIGHT,
} from "../src/walkability.ts";

test("GROUND_SNAP >= STEP_HEIGHT (else step-up floats then jitters)", () => {
  expect(GROUND_SNAP).toBeGreaterThanOrEqual(STEP_HEIGHT);
});

test("slope limit cos matches 55 degrees", () => {
  expect(SLOPE_LIMIT_COS).toBeCloseTo(Math.cos((55 * Math.PI) / 180), 10);
});

test("ramp mount limit sits at 45°, safely below the empirical 47.2° mount success", () => {
  expect(RAMP_MOUNT_LIMIT_RAD).toBeCloseTo((45 * Math.PI) / 180, 12);
  expect(RAMP_MOUNT_LIMIT_RAD).toBeLessThan(SLOPE_LIMIT_RAD);
});
