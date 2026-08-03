// packages/dungeon/src/agent/walkability.ts
/** Single source for the locomotion constants that define what the CharacterMover can
 *  traverse. `char-move.ts` reads both: SLOPE_LIMIT_COS gates which surface normals count
 *  as ground, STEP_HEIGHT sizes the step-up sweep and the ground-snap reach. The voxel
 *  proxy (`proxy.ts`, and the grids in `connector.ts` / `themes/cave.ts`) sizes its
 *  anisotropic Y cell BELOW STEP_HEIGHT so a one-cell lip is always climbable.
 *
 *  The underlying capsule facts (radius, half-height, step/climb/clearance, slope limit)
 *  are authored once in `catalog/agent.json` (D-F4-4) — not restated here — so the game's
 *  locomotion constants and the walkability analyzer's thresholds can't drift apart the
 *  way STEP_HEIGHT and the mover's real ~0.7 m climb ceiling once did (see
 *  `docs/learnings/2026-07-15-analyzer-corpus-probe.md` §climb ceiling). STEP_HEIGHT and
 *  SLOPE_LIMIT_COS below are derived from that file; their values are unchanged.
 *  "The walkability analyzer" is `analyzeChunk` in `@furnace/core/field`, which reads this
 *  same profile via {@link AGENT}. */
import type { AgentProfile } from "@furnace/core/field";
import agent from "../../catalog/agent.json";

/** The parsed `catalog/agent.json` profile — the argument core's `analyzeChunk` /
 *  `analyzeWorld` are parameterized on, and the raw capsule facts (step-up sweep, climb
 *  ceiling, clearance, slope limit) for dungeon-side consumers that need more than the two
 *  derived constants below, e.g. the walk-probe verify verb. `AgentProfile`'s members are
 *  readonly at the source, so an importer cannot edit this shared instance without going
 *  around the type system — a compile-time guarantee only; the object is not frozen. */
export const AGENT: AgentProfile = agent;

/** Max walkable slope angle in radians, from `agent.slopeLimitDeg`. */
const SLOPE_LIMIT_RAD = (agent.slopeLimitDeg * Math.PI) / 180;
/** Cosine of the max walkable slope: a surface is walkable when its unit normal's Y >= this. */
export const SLOPE_LIMIT_COS = Math.cos(SLOPE_LIMIT_RAD);
/** Max auto-step height (m): a rise below this is climbable in one tick. From `agent.stepHeight`
 *  — deliberately NOT `agent.climbCeiling`, the mover's real (larger) climb ceiling; see the
 *  module comment above. */
export const STEP_HEIGHT = agent.stepHeight;
/** Contact margin (m) the mover keeps between the capsule and any surface, from `agent.skin`.
 *  `char-move.ts` casts with `maxDistance: dist + SKIN` and backs off `toi - SKIN`, so every
 *  cast's next start pose is strictly non-penetrating — `castShape` is stopAtPenetration, and a
 *  start pose at exact contact returns toi 0 with an arbitrary normal and stalls the slide (the
 *  2.2.1 wedge class; see also REST_GAP and LIFT_MARGIN there). The analyzer's `narrow` bar is
 *  `2 * radius + skin` for the same reason: a lane only wide enough for the bare diameter leaves
 *  the capsule at exact contact with both walls. */
export const SKIN = agent.skin;
