// The D-25 forms vocabulary's DECISION layer, as pure functions.
//
// Two facts about a schema node decide which control the user gets, and neither is a
// `furnace.kind`: is the number BOUNDED, and how many discrete positions does its step
// span. Keeping that decision in `resolveKind` — the registry's single lookup — is the
// whole reason these are testable without a DOM: the alternative (a renderer that
// branches internally) would put two controls behind one registry entry and make the
// registry a liar about what it maps.
//
// The step rule is the load-bearing one and it is worth stating plainly, because the
// schemas in `@furnace/core` under-described themselves until this slice: `intParam`
// REJECTS fractional values, but the property nodes said `type: "number"` with no
// `multipleOf`. A slider that invents its own granularity on such a node emits 8.35 for
// a hall width and the generator throws setup-loud. So the step comes from the schema or
// from the span — never from a guess about what the validator secretly enforces.

import { expect, test } from "bun:test";
import { resolveKind } from "../../src/frontend/inspector/kind.ts";
import {
  numericSchema,
  stepSpan,
} from "../../src/frontend/inspector/lib/numeric-schema.ts";
import { validateNumber } from "../../src/frontend/inspector/lib/validate.ts";

// --- bounds + step -----------------------------------------------------------

test("an unbounded number has NO numeric schema — a slider needs both ends", () => {
  expect(numericSchema({ type: "number" })).toBe(null);
  expect(numericSchema({ type: "number", minimum: 0 })).toBe(null);
  expect(numericSchema({ type: "number", maximum: 1 })).toBe(null);
});

test("`multipleOf` is the step when the schema declares one", () => {
  // hall.width, once core says what `intParam` already enforces.
  const n = numericSchema({
    type: "number",
    minimum: 4,
    maximum: 24,
    multipleOf: 1,
  });
  expect(n).toEqual({ min: 4, max: 24, step: 1, integral: true });
});

test("a schema with no step gets a nice span-derived one, and is NOT integral", () => {
  // cave.chamberRadius: `numParam`, so 5.5 m is a legal value and quantizing to 1 m
  // would take it away. The step is a DISPLAY granularity on a continuous quantity.
  expect(numericSchema({ type: "number", minimum: 3, maximum: 8 })).toEqual({
    min: 3,
    max: 8,
    step: 0.05,
    integral: false,
  });
  // maze.braid over [0,1].
  expect(numericSchema({ type: "number", minimum: 0, maximum: 1 })).toEqual({
    min: 0,
    max: 1,
    step: 0.01,
    integral: false,
  });
});

test("the derived step snaps to 1 / 2 / 5 × 10^k rather than span/100 exactly", () => {
  // scatter.density spans 1.95 → 0.0195 raw, which would print 0.0195-wide ticks.
  expect(
    numericSchema({ type: "number", minimum: 0.05, maximum: 2 })?.step,
  ).toBe(0.02);
  // scatter.minSpacing spans 7.75 → 0.0775 raw → 0.1.
  expect(
    numericSchema({ type: "number", minimum: 0.25, maximum: 8 })?.step,
  ).toBe(0.1);
});

test('`type: "integer"` implies step 1 without a multipleOf', () => {
  expect(numericSchema({ type: "integer", minimum: 0, maximum: 5 })).toEqual({
    min: 0,
    max: 5,
    step: 1,
    integral: true,
  });
});

test("stepSpan counts INTERVALS, so a 6..12 integer param spans 6 not 7", () => {
  const n = numericSchema({
    type: "number",
    minimum: 6,
    maximum: 12,
    multipleOf: 1,
  });
  if (n === null) throw new Error("expected a bounded numeric schema");
  expect(stepSpan(n)).toBe(6);
});

// --- the kind decision -------------------------------------------------------

test("a bounded SMALL-INT param resolves to the stepper, a long one to the slider", () => {
  // hall.pillarSpacing 2..8 — six presses end to end, so ± beats a 40 px slider.
  expect(
    resolveKind({ type: "number", minimum: 2, maximum: 8, multipleOf: 1 }),
  ).toBe("stepper");
  // hall.depth 4..32 — 28 intervals; a stepper here is 28 clicks.
  expect(
    resolveKind({ type: "number", minimum: 4, maximum: 32, multipleOf: 1 }),
  ).toBe("slider");
});

test("a bounded CONTINUOUS param is always a slider, however narrow its span", () => {
  // Without this the [0,1] params (braid, blend, roughness, verticality) would read
  // as 1-step steppers if the rule counted RANGE rather than steps.
  expect(resolveKind({ type: "number", minimum: 0, maximum: 1 })).toBe(
    "slider",
  );
});

test("an UNbounded number keeps the plain NumberField", () => {
  expect(resolveKind({ type: "number" })).toBe("number");
  expect(resolveKind({ type: "integer" })).toBe("number");
});

test("an enum of ≤ 4 members is segmented; a longer one keeps the Select", () => {
  expect(resolveKind({ enum: ["none", "grid", "colonnade"] })).toBe(
    "segmented",
  );
  expect(resolveKind({ enum: ["0", "90", "180", "270"] })).toBe("segmented");
  expect(resolveKind({ enum: ["a", "b", "c", "d", "e"] })).toBe("enum");
});

test("a furnace.kind annotation still wins over every shape rule", () => {
  // A vec3 whose node also carries bounds must not become a slider.
  expect(
    resolveKind({
      type: "number",
      minimum: 0,
      maximum: 1,
      furnace: { kind: "vec3" },
    }),
  ).toBe("vec3");
});

test("a unit-only furnace annotation does not claim a kind", () => {
  // `furnace.unit` rides the same object as `furnace.kind`, so a node carrying only a
  // unit must fall through to the shape rules rather than resolving to "unknown".
  expect(
    resolveKind({
      type: "number",
      minimum: 3,
      maximum: 8,
      furnace: { unit: "m" },
    }),
  ).toBe("slider");
});

// --- field-level validation --------------------------------------------------

test("validateNumber names the bound it broke, in the schema's own numbers", () => {
  const schema = { type: "number", minimum: 3, maximum: 9 };
  expect(validateNumber(schema, 2)).toBe("must be at least 3");
  expect(validateNumber(schema, 10)).toBe("must be at most 9");
  expect(validateNumber(schema, 3)).toBe(null);
  expect(validateNumber(schema, 9)).toBe(null);
});

test("validateNumber refuses a fractional value on a multipleOf-1 schema", () => {
  // The live defect this closes: scrubbing a hall's width label emits 8.35, and
  // `intParam` throws "hall: width must be an integer in [4, 24], got 8.35" — from the
  // WORKER, one round trip later, with the field showing 8.35 as if it took.
  const schema = { type: "number", minimum: 4, maximum: 24, multipleOf: 1 };
  expect(validateNumber(schema, 8.35)).toBe("must be a whole number");
  expect(validateNumber(schema, 8)).toBe(null);
});

test("validateNumber spells a non-unit multipleOf as a multiple", () => {
  expect(validateNumber({ type: "number", multipleOf: 0.5 }, 0.75)).toBe(
    "must be a multiple of 0.5",
  );
  expect(validateNumber({ type: "number", multipleOf: 0.5 }, 1.5)).toBe(null);
});

test("validateNumber passes on values it has no opinion about", () => {
  // Strings, booleans and objects belong to other renderers; a numeric validator that
  // claimed them would refuse every enum commit.
  expect(validateNumber({ type: "string" }, "hall")).toBe(null);
  expect(validateNumber({ type: "number", minimum: 0 }, undefined)).toBe(null);
  expect(validateNumber({ type: "number", minimum: 0 }, Number.NaN)).toBe(null);
});
