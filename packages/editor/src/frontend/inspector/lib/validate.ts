// Field-level validation (D-25): the refusal a form can make WITHOUT asking anyone.
//
// The scope is deliberately narrow — bounds and the notch, read off the schema node the
// field is already rendering. Everything else a generator enforces (a door offset that
// fits its wall, a scale range whose min is below its max) is cross-field, lives in
// `@furnace/core`'s setup-loud validators, and reaches the user through the session's
// error line. Duplicating those here would be a second spelling of a rule that already
// has one, and the two would drift the first time a generator changed.
//
// What this DOES close is the single-field case, which is the one worth catching early:
// the value never reaches `onPreview`, so the worker never evaluates a ghost it is going
// to throw on, and the reason renders beside the control that produced it rather than in
// a toast a second later.

import type { JsonSchemaNode } from "../types.ts";

/** Float tolerance for the multiple test — a snapped 0.05-step value can land at
 *  5.250000000000001, and refusing that would be the field arguing with its own slider. */
const MULTIPLE_EPSILON = 1e-9;

/** Read `v` as a finite number, or `null` when it is anything else. */
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** True when `value` sits on the `multiple` grid, within float tolerance. */
function isMultipleOf(value: number, multiple: number): boolean {
  const notches = value / multiple;
  return Math.abs(notches - Math.round(notches)) < MULTIPLE_EPSILON;
}

/**
 * Why `value` is not admissible under `schema`, or `null` when it is — a sentence
 * fragment that reads after the field's own label ("Width **must be at least 3**").
 *
 * Values this validator has no opinion about (strings, booleans, objects, `undefined`,
 * NaN) return `null` rather than a complaint: a numeric rule that claimed them would
 * refuse every enum commit, and a half-typed number is the text field's business, not
 * the schema's.
 */
export function validateNumber(
  schema: JsonSchemaNode,
  value: unknown,
): string | null {
  const n = finite(value);
  if (n === null) return null;

  const min = finite(schema["minimum"]);
  if (min !== null && n < min) return `must be at least ${min}`;
  const max = finite(schema["maximum"]);
  if (max !== null && n > max) return `must be at most ${max}`;

  const multiple = finite(schema["multipleOf"]);
  if (multiple !== null && multiple > 0 && !isMultipleOf(n, multiple))
    return multiple === 1
      ? "must be a whole number"
      : `must be a multiple of ${multiple}`;
  return null;
}
