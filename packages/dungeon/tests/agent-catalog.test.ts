// packages/dungeon/tests/agent-catalog.test.ts
// D-F4-4: capsule facts are catalog DATA, one authored source. This guards the
// catalog against internal drift (clearance derivable from capsule dims, climb
// ceiling above step height per the F0 measured split) and guards walkability.ts
// against silently diverging from the file it's supposed to derive from.
import { expect, test } from "bun:test";
import agent from "../catalog/agent.json";
import { SKIN } from "../src/char-move.ts";
import { AGENT, SLOPE_LIMIT_COS, STEP_HEIGHT } from "../src/walkability.ts";

test("clearance is derived (2*(halfHeight+radius)), not an independent number", () => {
  // Tolerance, not `toBe`: 2*(0.6+0.3) computes to 1.7999999999999998 in IEEE 754 double
  // arithmetic, one ULP below the authored 1.8 literal — a genuine float representation
  // gap, not a derivation this test is being lenient about. `toBeCloseTo(_, 10)` treats
  // that gap as equal while still catching a real mismatch (e.g. an uncorrected typo).
  const expected = 2 * (agent.capsule.halfHeight + agent.capsule.radius);
  expect(agent.clearance).toBeCloseTo(expected, 10);
});

test("skin is the mover's own SKIN constant, and below the capsule radius", () => {
  // The clearance-equality pattern, for the second fact the catalog and the mover
  // both hold: char-move.ts reads its contact margin from a module constant, so
  // nothing but this pin stops the catalog's copy from drifting. Strict equality —
  // both are the same authored literal, not two float derivations.
  expect(agent.skin).toBe(SKIN);
  // A margin at or above the radius would make the pinch threshold (2r + skin)
  // exceed three radii, i.e. flag lanes the capsule walks through comfortably.
  expect(agent.skin).toBeLessThan(agent.capsule.radius);
});

test("version/capsule/step/climb/clearance/slope/skin fields are all positive finite", () => {
  // version is schema metadata, not a physical quantity, but a non-integer or non-positive
  // version is still a malformed catalog, so it gets the same floor plus an integer check
  // (the honest shape for a schema version number).
  expect(Number.isFinite(agent.version)).toBe(true);
  expect(Number.isInteger(agent.version)).toBe(true);
  expect(agent.version).toBeGreaterThan(0);
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
  expect(Number.isFinite(agent.skin)).toBe(true);
  expect(agent.skin).toBeGreaterThan(0);
});

test("catalog version is pinned to 1", () => {
  // The static import path (unlike the editor's future parseAgentCatalog, tranche B) has no
  // schema-mismatch guard of its own — this pin forces a conscious review the moment the
  // schema bumps, rather than a version change passing silently through the positive-finite
  // check above.
  expect(agent.version).toBe(1);
});

test("climb ceiling exceeds step height (F0's two conflated numbers, now distinct)", () => {
  expect(agent.climbCeiling).toBeGreaterThan(agent.stepHeight);
});

test("walkability.STEP_HEIGHT is derived from the catalog's stepHeight", () => {
  expect(STEP_HEIGHT).toBe(agent.stepHeight);
});

test("walkability.SLOPE_LIMIT_COS is derived from the catalog's slopeLimitDeg", () => {
  // Strict equality (unlike clearance above): walkability.ts computes this with the exact
  // same expression, `Math.cos((agent.slopeLimitDeg * Math.PI) / 180)`, so there is no
  // independent floating-point path to reconcile — this is genuine byte-identity, not a
  // value that merely happens to be close.
  expect(SLOPE_LIMIT_COS).toBe(Math.cos((agent.slopeLimitDeg * Math.PI) / 180));
});

test("walkability.AGENT re-exports the parsed catalog profile", () => {
  expect(AGENT).toEqual(agent);
});
