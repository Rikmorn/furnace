import type { Box } from "./level.ts";

type Span = { min: number; max: number };

/** The X interval (expanded by capsule radius) that box `b` blocks, or `null`
 *  if the capsule's current Z is outside the box's Z band (so X is unobstructed). */
function blocksX(pz: number, r: number, b: Box): Span | null {
  const hz = b.size[2] / 2;
  const hx = b.size[0] / 2;
  // Overlap on Z (with radius) is required for the box to block X movement.
  if (pz < b.center[2] - hz - r || pz > b.center[2] + hz + r) return null;
  return { min: b.center[0] - hx - r, max: b.center[0] + hx + r };
}

/** The Z interval (expanded by capsule radius) that box `b` blocks, or `null`
 *  if the capsule's X is outside the box's X band (so Z is unobstructed). */
function blocksZ(px: number, r: number, b: Box): Span | null {
  const hx = b.size[0] / 2;
  const hz = b.size[2] / 2;
  if (px < b.center[0] - hx - r || px > b.center[0] + hx + r) return null;
  return { min: b.center[2] - hz - r, max: b.center[2] + hz + r };
}

/** Push `value` out of `span` along the side it entered from, given travel
 *  direction `dir` (sign of the attempted delta). A `value` already outside the
 *  span, or a zero `dir`, is returned unchanged. */
function clampAgainstSpan(value: number, span: Span, dir: number): number {
  if (value <= span.min || value >= span.max) return value;
  if (dir > 0) return Math.min(value, span.min);
  if (dir < 0) return Math.max(value, span.max);
  return value;
}

/** Resolve a horizontal move of a capsule (radius `r`) from `from` by `delta`
 *  against axis-aligned `boxes`, sliding: X and Z are resolved independently so
 *  a blocked axis doesn't cancel the other. Vertical movement passes through
 *  unblocked (Epic 1 is flat-floored). Returns the resolved **absolute world
 *  position**. Pure; unit-tested. */
export function slideMove(
  from: [number, number, number],
  delta: [number, number, number],
  r: number,
  boxes: readonly Box[],
): [number, number, number] {
  // Resolve X against boxes overlapping the *current* Z band.
  let x = from[0] + delta[0];
  for (const b of boxes) {
    const span = blocksX(from[2], r, b);
    if (!span) continue;
    x = clampAgainstSpan(x, span, delta[0]);
  }

  // Resolve Z against boxes overlapping the *original* X band.
  let z = from[2] + delta[2];
  for (const b of boxes) {
    const span = blocksZ(from[0], r, b);
    if (!span) continue;
    z = clampAgainstSpan(z, span, delta[2]);
  }

  return [x, from[1] + delta[1], z];
}
