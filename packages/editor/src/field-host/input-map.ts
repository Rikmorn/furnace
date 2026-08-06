/** A stamp-region nudge in whole LATTICE STEPS (not metres) on world axes —
 *  what {@link arrowNudgeSteps} returns and `FieldHost.nudgeStamp` takes. */
export type NudgeSteps = [number, number, number];

// The arrow bindings as data: plain vs Shift-held, per lowercased
// `KeyboardEvent.key`. A Map, NOT an object literal: the lookup key is
// caller-supplied, and a plain literal answers `Object.prototype` names
// ("constructor", "valueof", "__proto__") with a truthy non-entry — the
// undefined check would pass it through and the caller would nudge by
// garbage. A Map has no prototype chain to inherit through.
const ARROW_NUDGE = new Map<string, { plain: NudgeSteps; shift: NudgeSteps }>([
  ["arrowleft", { plain: [-1, 0, 0], shift: [-1, 0, 0] }],
  ["arrowright", { plain: [1, 0, 0], shift: [1, 0, 0] }],
  ["arrowup", { plain: [0, 0, -1], shift: [0, 1, 0] }],
  ["arrowdown", { plain: [0, 0, 1], shift: [0, -1, 0] }],
]);

/**
 * Map an arrow keydown to a stamp-region nudge, in whole lattice steps on
 * WORLD axes: ←/→ = ∓X, ↑/↓ = ∓Z, and with Shift held ↑/↓ become ±Y (a
 * four-key pad has no third pair, so the vertical axis rides the modifier).
 * Shift on ←/→ deliberately MIRRORS the plain mapping — there is no second
 * horizontal axis to promote them to, so the modifier is a no-op there rather
 * than a dead key.
 *
 * Camera-relative mapping is deliberately not v0: world axes stay predictable
 * whatever the fly camera is doing.
 *
 * Pure and case-insensitive, so the sign table is unit-testable without a
 * canvas, a GPU, or a real KeyboardEvent. The caller owns the chord guards and
 * the session check.
 *
 * Total: every non-arrow key answers `null` — including `Object.prototype`
 * member names, which a plain-object lookup would have leaked through.
 *
 * @param e - The keydown's `key` (any case) and shift state.
 * @returns The nudge in lattice steps, or `null` when the key is not an arrow.
 */
export function arrowNudgeSteps(e: {
  key: string;
  shiftKey: boolean;
}): NudgeSteps | null {
  const entry = ARROW_NUDGE.get(e.key.toLowerCase());
  if (entry === undefined) return null;
  return e.shiftKey ? entry.shift : entry.plain;
}
