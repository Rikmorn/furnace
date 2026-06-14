import type { Box } from "./level.ts";

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

/** Resolve a single horizontal axis as a *swept face crossing*: of all `boxes`,
 *  a box clamps the moving coordinate only if the move would cross one of the
 *  box's near faces on this axis *starting from outside the box's extent*.
 *
 *  - `start` / `target` are the coordinate's value before and after the move on
 *    the resolved axis (`target = start + delta`).
 *  - `delta` is the attempted travel on the resolved axis (sign matters; zero
 *    means no movement and `target` is returned unchanged).
 *  - `axis` / `otherAxis` index the resolved and gating coordinates (0 = X,
 *    2 = Z) into each box's `center`/`size`.
 *  - `otherCoord` is the player's position on the *gating* axis: a box only
 *    blocks this axis when the player overlaps it on the other axis (expanded by
 *    `r`), so you can pass a box edge-on without it walling off the orthogonal
 *    direction.
 *  - `py` selects bodies the player is vertically level with via
 *    {@link overlapsPlayerBand}.
 *
 *  The directional guards (`start <= minV` for +delta, `start >= maxV` for
 *  -delta) are the crux: a box clamps you only if you *started outside* its
 *  extent on this axis and the move would cross the near face. A wall you are
 *  already pressed flat against (inside its extent on this axis) never ejects
 *  you sideways, and a fast move can't tunnel through a face it started outside
 *  of. Returns the clamped coordinate. */
function resolveAxis(
  start: number,
  delta: number,
  axis: 0 | 2,
  otherAxis: 0 | 2,
  otherCoord: number,
  py: number,
  r: number,
  boxes: readonly Box[],
): number {
  let value = start + delta;
  if (delta === 0) return value;

  for (const b of boxes) {
    if (!overlapsPlayerBand(py, b)) continue;
    // Gate: the player must overlap the box on the *other* axis (expanded by the
    // capsule radius) for the box to block movement on this axis.
    const otherHalf = b.size[otherAxis] / 2 + r;
    if (Math.abs(otherCoord - b.center[otherAxis]) > otherHalf) continue;

    const half = b.size[axis] / 2 + r;
    const minV = b.center[axis] - half;
    const maxV = b.center[axis] + half;
    const crossesNearFaceForward = delta > 0 && start <= minV && value > minV;
    const crossesNearFaceBackward = delta < 0 && start >= maxV && value < maxV;
    if (crossesNearFaceForward) value = minV;
    else if (crossesNearFaceBackward) value = maxV;
  }
  return value;
}

/** Resolve a horizontal move of a capsule (radius `r`) from `from` by `delta`
 *  against axis-aligned `boxes`, sliding: X and Z are resolved independently so a
 *  blocked axis doesn't cancel the other.
 *
 *  Resolution is a *swept per-axis face crossing*: on each axis a box clamps the
 *  player only when (1) its vertical extent overlaps the player's body band
 *  (centred on `from[1]`, half-height `PLAYER_HALF_HEIGHT` — so floors/ceilings
 *  the player isn't level with never block), (2) the player overlaps the box on
 *  the *other* horizontal axis expanded by `r`, and (3) the move would cross one
 *  of the box's near faces *starting from outside the box's extent on that axis*.
 *  This last guard is what makes wide walls behave: a player pressed flat against
 *  a wall that is wide on the resolved axis is *inside* its extent there, so the
 *  guard never fires and they slide freely — no sideways teleport. A thin wall
 *  approached head-on still blocks (the player crosses its narrow face from
 *  outside), and a fast move can't tunnel a face it started outside of.
 *
 *  Each axis gates on the *original* `from` coordinate of the other axis, so the
 *  two resolutions are independent. Vertical movement passes through unblocked
 *  (Epic 1 is flat-floored). Returns the resolved **absolute world position**.
 *  Pure; unit-tested. */
export function slideMove(
  from: [number, number, number],
  delta: [number, number, number],
  r: number,
  boxes: readonly Box[],
): [number, number, number] {
  const py = from[1];
  // X gates on the original Z; Z gates on the original X — independent axes.
  const x = resolveAxis(from[0], delta[0], 0, 2, from[2], py, r, boxes);
  const z = resolveAxis(from[2], delta[2], 2, 0, from[0], py, r, boxes);
  return [x, from[1] + delta[1], z];
}
