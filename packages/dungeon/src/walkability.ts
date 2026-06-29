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
