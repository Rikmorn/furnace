// What a schema node says about a number, reduced to the three facts a bounded control
// needs: where it starts, where it ends, and how far one notch is.
//
// THE STEP IS NEVER GUESSED, and that is the whole design. A slider quantizes by
// construction, so whatever it snaps to becomes the only value a drag can produce — and
// `@furnace/core`'s generators validate their params setup-loud, from inside the preview
// worker, one round trip after the gesture. So the step comes from `multipleOf` when the
// schema declares one, from `type: "integer"` when it declares that, and otherwise from
// the SPAN — which is the honest reading of a node that says "any number in [3, 8]": the
// granularity is a display choice on a continuous quantity, not a claim about the
// validator. Inferring "these bounds look like integers, so step 1" would take 5.5 m away
// from `cave.chamberRadius`, whose validator admits it.

import type { JsonSchemaNode } from "../types.ts";

/** How many notches a span-derived step aims for across the whole range. 100 is the
 *  pointer-precision floor: a palette slider is ~120 px wide, so finer than this is
 *  unreachable by drag and belongs to the exact input beside it. */
const TARGET_STEPS = 100;

/** The mantissas a derived step is allowed to land on — the 1-2-5 ladder every axis-tick
 *  algorithm uses, so a step reads as a round number rather than as 0.0195. */
const NICE_MANTISSAS = [1, 2, 5, 10] as const;

/** A schema node's numeric shape: bounds, the notch, and whether every reachable value is
 *  a whole number. */
export type NumericSchema = {
  min: number;
  max: number;
  step: number;
  /** True when the step and the floor are both integers, so no reachable value is
   *  fractional. Drives the stepper-vs-slider split and the "must be a whole number"
   *  refusal — never inferred from how the bounds happen to look. */
  integral: boolean;
};

/** Read `n` as a finite number, or `null` when it is anything else. */
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** A round step near `span / TARGET_STEPS`, snapped UP the 1-2-5 ladder. */
function niceStep(span: number): number {
  const target = span / TARGET_STEPS;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const mantissa = NICE_MANTISSAS.find((m) => normalized <= m) ?? 10;
  // One significant digit kills the binary-float residue (5 × 0.01 lands at
  // 0.05000000000000001 on some magnitudes) so the step prints as the number it is.
  return Number((mantissa * magnitude).toPrecision(1));
}

/** The notch, in declaration order: an explicit `multipleOf`, then the integer type, then
 *  the span. Each source is more specific than the next, and only the last is a choice. */
function resolveStep(
  declared: number | null,
  type: string | undefined,
  span: number,
): number {
  if (declared !== null && declared > 0) return declared;
  if (type === "integer") return 1;
  return niceStep(span);
}

/**
 * The numeric shape of `schema`, or `null` when it is not a BOUNDED number — a slider
 * with one open end has no track to draw, so an unbounded numeric param keeps the plain
 * text field.
 */
export function numericSchema(schema: JsonSchemaNode): NumericSchema | null {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type !== "number" && type !== "integer") return null;
  const min = finite(schema["minimum"]);
  const max = finite(schema["maximum"]);
  if (min === null || max === null || max <= min) return null;

  const step = resolveStep(finite(schema["multipleOf"]), type, max - min);
  return {
    min,
    max,
    step,
    integral: Number.isInteger(step) && Number.isInteger(min),
  };
}

/** How many INTERVALS the step spans between the bounds — 6..12 by 1 is six, not seven.
 *  Intervals rather than positions because that is what "how many presses end to end"
 *  counts, which is the question the stepper-vs-slider split is asking. */
export const stepSpan = (n: NumericSchema): number =>
  Math.round((n.max - n.min) / n.step);

/** Snap `value` onto the schema's notch grid and clamp it between the bounds. Every
 *  gesture that produces a number (the range, the label scrub, the ± buttons) routes
 *  through this one function, so no two of them can disagree about what is reachable. */
export function snapToStep(n: NumericSchema, value: number): number {
  const notches = Math.round((value - n.min) / n.step);
  const snapped = n.min + notches * n.step;
  const clamped = Math.min(n.max, Math.max(n.min, snapped));
  // Float residue again: 3 + 45 × 0.05 is 5.250000000000001 at some magnitudes, and the
  // generator receives whatever we send.
  return Number(clamped.toPrecision(12));
}
