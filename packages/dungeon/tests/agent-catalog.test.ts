// packages/dungeon/tests/agent-catalog.test.ts
// D-F4-4: capsule facts are catalog DATA, one authored source. This guards the
// catalog against internal drift (clearance derivable from capsule dims, climb
// ceiling above step height per the F0 measured split) and guards walkability.ts
// against silently diverging from the file it's supposed to derive from.
import { expect, test } from "bun:test";
import agent from "../catalog/agent.json";
import { AGENT, SLOPE_LIMIT_COS, STEP_HEIGHT } from "../src/walkability.ts";

test("clearance is derived (2*(halfHeight+radius)), not an independent number", () => {
  const expected = 2 * (agent.capsule.halfHeight + agent.capsule.radius);
  expect(agent.clearance).toBeCloseTo(expected, 10);
});

test("capsule/step/climb/clearance/slope fields are all positive finite", () => {
  expect(Number.isFinite(agent.capsule.radius)).toBe(true);
  expect(agent.capsule.radius).toBeGreaterThan(0);
  expect(Number.isFinite(agent.capsule.halfHeight)).toBe(true);
  expect(agent.capsule.halfHeight).toBeGreaterThan(0);
  expect(Number.isFinite(agent.stepHeight)).toBe(true);
  expect(agent.stepHeight).toBeGreaterThan(0);
  expect(Number.isFinite(agent.climbCeiling)).toBe(true);
  expect(agent.climbCeiling).toBeGreaterThan(0);
  expect(Number.isFinite(agent.clearance)).toBe(true);
  expect(agent.clearance).toBeGreaterThan(0);
  expect(Number.isFinite(agent.slopeLimitDeg)).toBe(true);
  expect(agent.slopeLimitDeg).toBeGreaterThan(0);
});

test("climb ceiling exceeds step height (F0's two conflated numbers, now distinct)", () => {
  expect(agent.climbCeiling).toBeGreaterThan(agent.stepHeight);
});

test("walkability.STEP_HEIGHT is derived from the catalog's stepHeight", () => {
  expect(STEP_HEIGHT).toBe(agent.stepHeight);
});

test("walkability.SLOPE_LIMIT_COS is derived from the catalog's slopeLimitDeg", () => {
  expect(SLOPE_LIMIT_COS).toBeCloseTo(
    Math.cos((agent.slopeLimitDeg * Math.PI) / 180),
    10,
  );
});

test("walkability.AGENT re-exports the parsed catalog profile", () => {
  expect(AGENT).toEqual(agent);
});
