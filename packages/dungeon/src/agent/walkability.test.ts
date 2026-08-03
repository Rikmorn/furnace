// packages/dungeon/src/agent/walkability.test.ts
import { expect, test } from "bun:test";
import { GROUND_SNAP } from "./char-move.ts";
import { SLOPE_LIMIT_COS, STEP_HEIGHT } from "./walkability.ts";

test("GROUND_SNAP >= STEP_HEIGHT (else step-up floats then jitters)", () => {
  expect(GROUND_SNAP).toBeGreaterThanOrEqual(STEP_HEIGHT);
});

test("slope limit cos matches 55 degrees", () => {
  expect(SLOPE_LIMIT_COS).toBeCloseTo(Math.cos((55 * Math.PI) / 180), 10);
});
