// packages/dungeon/src/walkability.ts
/** Single source for the locomotion constants that define what the CharacterMover can
 *  traverse. The connection router (`connect.ts route`) reads the SAME constants so every
 *  connector it emits is walkable by construction; box-room staircases read them too. */

/** Max walkable slope angle (degrees). */
const MAX_SLOPE_DEG = 55;
/** Max walkable slope angle in radians (for sizing ramps). */
export const SLOPE_LIMIT_RAD = (MAX_SLOPE_DEG * Math.PI) / 180;
/** Cosine of the max walkable slope: a surface is walkable when its unit normal's Y >= this. */
export const SLOPE_LIMIT_COS = Math.cos(SLOPE_LIMIT_RAD);
/** Max auto-step height (m): a rise below this is climbable in one tick. */
export const STEP_HEIGHT = 0.4;
/** Keep generated step rises strictly below STEP_HEIGHT by this margin. */
export const STEP_MARGIN = 0.05;

/** Number of equal risers a stair run of total height `rise` (m, non-negative) needs to
 *  keep every riser strictly below STEP_HEIGHT (by STEP_MARGIN). THE single source for the
 *  stair step-count — connect.ts (minWalkableRun + floorBoxes) and box-room.ts (stepBoxes)
 *  all derive from this, so a STEP_HEIGHT/STEP_MARGIN tune can never desync them. */
export function stepCount(rise: number): number {
  return Math.ceil(rise / (STEP_HEIGHT - STEP_MARGIN));
}

/** Practical ramp-MOUNT ceiling (radians): the steepest ramp the CharacterMover can climb
 *  onto from a FLAT approach. Empirical (Slice 2.2.5b-B1 GPU traces): mounts 47.2°, stalls
 *  at 49.64°; 45° keeps a safe margin below the known-good mount. `connect.ts` reads this
 *  for BOTH chooseKind's ramp band and route's forced-ramp guard — a ramp steeper than the
 *  mount limit is a one-way slope in a walk-verb world (descending arrivals put a flat
 *  landing at every ramp foot, so every ramp gets mounted from flat when walked back up).
 *  SLOPE_LIMIT_RAD (55°) remains the physical stand-on/slide limit only. */
export const RAMP_MOUNT_LIMIT_RAD = (45 * Math.PI) / 180;
