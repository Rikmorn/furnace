// packages/dungeon/src/walkability.ts
/** Single source for the locomotion constants that define what the CharacterMover can
 *  traverse. `char-move.ts` reads both: SLOPE_LIMIT_COS gates which surface normals count
 *  as ground, STEP_HEIGHT sizes the step-up sweep and the ground-snap reach. The voxel
 *  proxy (`proxy.ts`, and the grids in `connector.ts` / `themes/cave.ts`) sizes its
 *  anisotropic Y cell BELOW STEP_HEIGHT so a one-cell lip is always climbable. */

/** Max walkable slope angle (degrees). */
const MAX_SLOPE_DEG = 55;
/** Max walkable slope angle in radians. */
const SLOPE_LIMIT_RAD = (MAX_SLOPE_DEG * Math.PI) / 180;
/** Cosine of the max walkable slope: a surface is walkable when its unit normal's Y >= this. */
export const SLOPE_LIMIT_COS = Math.cos(SLOPE_LIMIT_RAD);
/** Max auto-step height (m): a rise below this is climbable in one tick. */
export const STEP_HEIGHT = 0.4;
