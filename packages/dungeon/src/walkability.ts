// packages/dungeon/src/walkability.ts
/** Single source for the locomotion constants that define what the CharacterMover can
 *  traverse. `char-move.ts` reads both: SLOPE_LIMIT_COS gates which surface normals count
 *  as ground, STEP_HEIGHT sizes the step-up sweep and the ground-snap reach. The voxel
 *  proxy (`proxy.ts`, and the grids in `connector.ts` / `themes/cave.ts`) sizes its
 *  anisotropic Y cell BELOW STEP_HEIGHT so a one-cell lip is always climbable.
 *
 *  The underlying capsule facts (radius, half-height, step/climb/clearance, slope limit)
 *  are authored once in `catalog/agent.json` (D-F4-4) — not restated here — so the game's
 *  locomotion constants and the (future) walkability analyzer's thresholds can't drift
 *  apart the way STEP_HEIGHT and the mover's real ~0.7 m climb ceiling once did (see
 *  `docs/learnings/2026-07-15-analyzer-corpus-probe.md` §climb ceiling). STEP_HEIGHT and
 *  SLOPE_LIMIT_COS below are derived from that file; their values are unchanged. */
import agent from "../catalog/agent.json";

/** The parsed `catalog/agent.json` profile, re-exported for dungeon-side consumers that
 *  need the raw capsule facts (step-up sweep, climb ceiling, clearance, slope limit) rather
 *  than the two derived constants below — e.g. the walk-probe verify verb. Its shape mirrors
 *  core's future `AgentProfile` type (not yet defined; this is a plain data re-export, not a
 *  cast to that type). */
export const AGENT = agent;

/** Max walkable slope angle in radians, from `agent.slopeLimitDeg`. */
const SLOPE_LIMIT_RAD = (agent.slopeLimitDeg * Math.PI) / 180;
/** Cosine of the max walkable slope: a surface is walkable when its unit normal's Y >= this. */
export const SLOPE_LIMIT_COS = Math.cos(SLOPE_LIMIT_RAD);
/** Max auto-step height (m): a rise below this is climbable in one tick. From `agent.stepHeight`
 *  — deliberately NOT `agent.climbCeiling`, the mover's real (larger) climb ceiling; see the
 *  module comment above. */
export const STEP_HEIGHT = agent.stepHeight;
