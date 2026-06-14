import type { Box } from "./level.ts";

type Span = { min: number; max: number };

/** The player capsule's vertical half-extent (metres) used for collision. A box
 *  only acts as a horizontal obstacle when its Y-span overlaps the player's body
 *  band `[py - PLAYER_HALF_HEIGHT, py + PLAYER_HALF_HEIGHT]`; this excludes
 *  floors/ceilings/stalactites the player isn't level with (which span the whole
 *  XZ footprint and would otherwise wall the player in). */
const PLAYER_HALF_HEIGHT = 0.9;

/** Whether box `b`'s vertical extent overlaps the player's body band, centred on
 *  `py` (strict overlap, so a box flush against the band's edge doesn't block). */
function overlapsPlayerBand(py: number, b: Box): boolean {
  const hy = b.size[1] / 2;
  const boxMinY = b.center[1] - hy;
  const boxMaxY = b.center[1] + hy;
  const bandMinY = py - PLAYER_HALF_HEIGHT;
  const bandMaxY = py + PLAYER_HALF_HEIGHT;
  return boxMaxY > bandMinY && boxMinY < bandMaxY;
}

/** The X interval (expanded by capsule radius) that box `b` blocks, or `null`
 *  if the capsule's current Z is outside the box's Z band, or the box's Y-span
 *  doesn't overlap the player's body band centred on `py` (so X is unobstructed). */
function blocksX(pz: number, py: number, r: number, b: Box): Span | null {
  if (!overlapsPlayerBand(py, b)) return null;
  const hz = b.size[2] / 2;
  const hx = b.size[0] / 2;
  // Overlap on Z (with radius) is required for the box to block X movement.
  if (pz < b.center[2] - hz - r || pz > b.center[2] + hz + r) return null;
  return { min: b.center[0] - hx - r, max: b.center[0] + hx + r };
}

/** The Z interval (expanded by capsule radius) that box `b` blocks, or `null`
 *  if the capsule's X is outside the box's X band, or the box's Y-span doesn't
 *  overlap the player's body band centred on `py` (so Z is unobstructed). */
function blocksZ(px: number, py: number, r: number, b: Box): Span | null {
  if (!overlapsPlayerBand(py, b)) return null;
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
 *  a blocked axis doesn't cancel the other. A box only obstructs when its
 *  vertical extent overlaps the player's body band (centred on `from[1]`,
 *  half-height `PLAYER_HALF_HEIGHT`), so floors/ceilings the player isn't level
 *  with don't block horizontal movement. Vertical movement itself passes through
 *  unblocked (Epic 1 is flat-floored). Returns the resolved **absolute world
 *  position**. Pure; unit-tested. */
export function slideMove(
  from: [number, number, number],
  delta: [number, number, number],
  r: number,
  boxes: readonly Box[],
): [number, number, number] {
  const py = from[1];

  // Resolve X against boxes overlapping the *current* Z band.
  let x = from[0] + delta[0];
  for (const b of boxes) {
    const span = blocksX(from[2], py, r, b);
    if (!span) continue;
    x = clampAgainstSpan(x, span, delta[0]);
  }

  // Resolve Z against boxes overlapping the *original* X band.
  let z = from[2] + delta[2];
  for (const b of boxes) {
    const span = blocksZ(from[0], py, r, b);
    if (!span) continue;
    z = clampAgainstSpan(z, span, delta[2]);
  }

  return [x, from[1] + delta[1], z];
}
