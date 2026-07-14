// Stage 2 of the hybrid analyzer: for each stage-1 flag, drive the REAL `CharacterMover`
// from nearby walkable floor toward and past the flag, and classify it. "Test the code,
// not the data" (Walk Monster) — this probe runs `char-move.ts` itself, so a verdict is a
// statement about the SHIPPED controller, never about a model of it.
//
// WHAT STAGE 2 IS ACTUALLY FOR. The F0 brief expected stage 2 to DETECT a class stage 1
// structurally cannot see (the sub-step-height two-contact wedge). Task 2 measured the real
// mover and that class does not reproduce: a lip below STEP_HEIGHT beside a vertical wall is
// always climbed. What the measurements DID find is that the mover's real climb ceiling is
// ~0.7 m, not STEP_HEIGHT (0.4) — so stage 1's `ledge` filter over-flags every rise in the
// 0.4–0.7 m band. Stage 2's value is therefore as a FILTER, and it must be trustworthy in
// BOTH directions. The two errors are not symmetric:
//   - a false CLEAR is a MISS — the analyzer blesses a floor the mover cannot walk. It is the
//     one thing F0 exists to rule out, and every rule below is biased against it: a flag with
//     no usable evidence is `inconclusive`, NEVER `clear`.
//   - a false TRAP is noise — the analyzer keeps a flag it could have dropped. It costs the
//     filter its value but never ships a broken floor.
//
// THE LEVITATION BUG IS THE MOST DANGEROUS FAILURE MODE HERE (`char-move.ts:124-132`, a
// SHIPPED defect, not a probe artifact). `applyGravity`'s rest sweep lifts the capsule to
// `pos.y + STEP_HEIGHT` BEFORE sweeping down. Started inside rock, `castShape`
// (stopAtPenetration) returns `toi: 0`, which reads as "ground at the lift height" — so the
// capsule climbs STEP_HEIGHT per frame while REPORTING GROUNDED. It fires on any floor with
// less than CAPSULE_HEIGHT + STEP_HEIGHT = 2.2 m of headroom, and stage 1 calls a floor
// walkable at 1.8 m — so the sweep spawns capsules into it by construction. A levitating
// capsule still advances horizontally, so left undetected it would drift past a flag and be
// recorded as a CLEAR: a MISS. Two independent guards below refuse that:
//   1. per-frame: a GROUNDED frame that rises more than LEVITATION_RISE_M while the pose has
//      less than STEP_HEIGHT of air above it is levitation — abort the lane, no verdict.
//   2. at the clear bar: a lane may only be declared CLEAR from a pose that is grounded AND
//      lift-free. No clear is ever issued from a compromised pose.
import type { Context } from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { type Capsule, CharacterMover } from "../../src/char-move.ts";
import type { Vec3 } from "../../src/region.ts";
import { STEP_HEIGHT } from "../../src/walkability.ts";
import type { Flag } from "./column-pass.ts";
import { cellFloorWorld, type Occupancy } from "./occupancy.ts";

/** The game capsule (`main.ts`, and `tests/_helpers/walk-fixture.ts` CAPSULE). */
export const SWEEP_CAPSULE: Capsule = { halfHeight: 0.6, radius: 0.3 };
/** Capsule centre height above the floor it rests on. */
const REST_OFFSET = SWEEP_CAPSULE.halfHeight + SWEEP_CAPSULE.radius;
/** Total capsule height (m). */
const CAPSULE_HEIGHT_M = 2 * REST_OFFSET;
/** Spawn a touch above rest so frame 1 settles rather than teleports (walk-fixture). */
const SPAWN_RISE = 0.1;

// The drive loop is `tests/_helpers/walk-fixture.ts` runWalk's, constant for constant: the
// probe must move the capsule exactly the way the game does, or its verdicts are about a
// different mover than the one that ships.
const DT = 1 / 60;
const SPEED = 3; // m/s — the game walk speed
const FRAME_STEP = SPEED * DT; // ≈0.05 m nominal horizontal advance per frame
/** ~4 s per lane. A lane needs ~1.7 m (approach + clear bar); this is ~12 m of slack. */
const MAX_ITERS = 240;
/** ~0.75 s of no horizontal progress = wedged (walk-fixture's MAX_STALL_FRAMES). */
const STALL_LIMIT = 45;
/** Per-frame horizontal progress at or below this is no progress (walk-fixture's literal). */
const STALL_EPS = 0.005;

/** Preferred spawn distance before the flag, against the sweep direction. */
const APPROACH_M = 1.2;
/** The spawn search: the preferred distance can put the capsule INSIDE rock (it is a point on
 *  a line through the flag, not a validated pose), and which distance is safe is geometry-
 *  dependent — 1.2 m clears the slab-pinch's front face but 1.5 m would bury the capsule in
 *  the floor-pocket's near rim. So candidates are enumerated and each is VALIDATED (walkable
 *  column at a compatible level + penetration-free), nearest-to-APPROACH_M first. */
const MIN_APPROACH_M = 0.9;
const MAX_APPROACH_M = 2.0;
const APPROACH_STEP_M = 0.25;
/** Lateral nudges (m, perpendicular to the sweep dir) tried when the flag's own line is not a
 *  legal capsule pose. A floor cell whose centre is under a capsule radius from a wall is
 *  `walkable` to stage 1 but cannot hold the capsule's CENTRE — without this, every
 *  wall-adjacent flag would be unsweepable, and in a real cave that is most of them. Capped at
 *  a half cell so the nudged capsule (0.6 m wide) still covers the flag's own column: a bigger
 *  nudge could route the mover AROUND the hazard and manufacture a false CLEAR. */
const LATERAL_M = [0, 0.25, -0.25];
/** CLEARED = the capsule's CENTRE got past the flag's own centre, grounded and lift-free. It
 *  has then physically traversed the flagged cell, which is the question stage 1 asked.
 *
 *  The F0 plan's draft bar — a radius + margin PAST the flag — is unreachable and produced a
 *  false TRAP on the first run: a capsule stops radius + SKIN (0.38 m) short of ANY wall, so a
 *  wall standing one cell beyond a perfectly benign flag pins it at flag + 0.37 m and the bar
 *  is never met. Measured over every lane of all five geometries, a lane's stop position is
 *  BIMODAL, and the two modes are what the bar has to separate:
 *      -0.13 m  blocked by geometry at the flag cell's FAR face  = the real traps
 *      +0.37 m  traversed the flag, stopped at a wall a cell on  = benign
 *  A bar at the flag's centre splits them with 0.13 m / 0.37 m of margin.
 *
 *  PRECONDITION (asserted in `sweepFlags`): half a cell must be under a capsule radius. The
 *  -0.13 m mode IS `halfCell - (radius + SKIN)`; on a lattice coarse enough for that to go
 *  positive, a capsule blocked at the flag's far face would stop PAST the flag's centre and
 *  read as CLEAR — a MISS. Production is [0.5, _, 0.5] (halfCell 0.25 < radius 0.3). */
const CLEAR_AT_FLAG_CENTRE = 0;
/** A stalled lane blames the FLAG only if it stopped within this of it. A capsule blocked BY
 *  the flag's own geometry necessarily stops short of the flag's centre — by radius + skin +
 *  half a cell (measured worst case in the corpus: 0.63 m, the slab-pinch and the lintel). A
 *  lane that dies further back than that was stopped by something else on the way in, and says
 *  nothing about this flag: it is `blocked-upstream`, and contributes NO evidence (not a
 *  clear). */
const REACH_TOL = 1.0;
/** A spawn/exit column's floor must be within this of the flag's floor, else it is a different
 *  storey and its lane would test different geometry. One capsule height is the natural bar. */
const MAX_LEVEL_DIFF_M = CAPSULE_HEIGHT_M;
/** `castShape` is stopAtPenetration, so an overlapping start returns `toi: 0` — a sweep of
 *  this length is therefore a penetration probe, not a distance measurement. */
const PROBE_M = 1e-3;
/** A GROUNDED frame that rises more than this is the SYMPTOM of the rest-sweep bug: a
 *  levitating frame gains exactly STEP_HEIGHT (the sweep returns `toi: 0`, so
 *  `restY = pos.y + STEP_HEIGHT`), while a walk up the steepest legal slope gains ~0.07 m per
 *  frame at 3 m/s. Never fires alone: `liftPenetrates` must confirm the CAUSE, so a legitimate
 *  step-up (which happens in open headroom) cannot be mistaken for it. */
const LEVITATION_RISE_M = 0.3;

/** Stage-1 output the sweep needs: the occupancy it analysed, and the floor cells it judged
 *  standable. The walkable set is what tells a lane where it may spawn and whether it has
 *  anywhere to GO — a sweep without it cannot tell "the mover is stuck" from "there was never
 *  a floor there". */
export type SweepScene = {
  occ: Occupancy;
  /** Stage 1's walkable cells, keyed "x,y,z" (y = the AIR cell above the floor). */
  walkable: ReadonlySet<string>;
};

/** What one directed lane established about a flag. Only `trap` and `clear` are evidence. */
export type LaneOutcome =
  /** The capsule's centre got past the flag's, grounded and lift-free: it traversed the cell. */
  | "clear"
  /** The capsule reached the flag and stopped there. */
  | "trap"
  /** No legal lane: no walkable spawn, or nowhere to go past the flag (e.g. a rock wall). */
  | "no-lane"
  /** The capsule stopped well short of the flag — something else blocked it. No evidence. */
  | "blocked-upstream"
  /** The shipped rest-sweep bug fired (header). The pose is not trustworthy. No evidence. */
  | "levitating"
  /** The capsule left the analysed volume downward. No evidence. */
  | "fell";

export type Lane = {
  dir: Vec3;
  outcome: LaneOutcome;
  /** Metres advanced along `dir` from the spawn, at the lane's furthest (diagnostic). */
  progressed: number;
  frames: number;
};

/** `trapped` = the real mover demonstrably stalls at this flag. `clear` = it demonstrably
 *  walks through. `inconclusive` = neither was shown — the flag KEEPS its stage-1 status. */
export type SweepOutcome = "trapped" | "clear" | "inconclusive";

export type SweepVerdict = {
  flag: Flag;
  outcome: SweepOutcome;
  /** `outcome === "trapped"`. A CONFIRMED trap, never a "we could not tell". */
  trapped: boolean;
  /** Metres progressed before stopping, best over the lanes (diagnostic). */
  progressed: number;
  /** Lanes aborted by the shipped levitation bug. A real number for the F0 report. */
  levitated: number;
  lanes: Lane[];
};

/** The 4 cardinal XZ neighbours, in cell space (matches column-pass's DIRS). */
const CELL_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Scalar advance of a point along a horizontal unit direction (walk-fixture's `along`). */
const along = (p: Vec3, dir: Vec3): number => p[0] * dir[0] + p[2] * dir[2];

/** Would `applyGravity`'s rest sweep — which lifts the capsule to `pos.y + STEP_HEIGHT`
 *  before sweeping DOWN — start inside rock from this pose? If so the sweep returns `toi: 0`
 *  and the mover levitates while reporting grounded. This is the bug's condition, probed
 *  directly rather than inferred. */
function liftPenetrates(
  ctx: Context,
  world: physics.World,
  body: physics.Body,
  pos: Vec3,
): boolean {
  const hit = physics.castShape(ctx, world, {
    shape: { capsule: SWEEP_CAPSULE },
    position: pos,
    dir: [0, 1, 0],
    maxDistance: STEP_HEIGHT,
    excludeBody: body,
  });
  return hit !== null && hit.toi < STEP_HEIGHT;
}

/** Is this capsule pose free of rock? `castShape` is stopAtPenetration, so an overlapping
 *  start reports `toi: 0` — a probe-length sweep is exactly the overlap test. */
function poseIsFree(
  ctx: Context,
  world: physics.World,
  pos: Vec3,
  dir: Vec3,
): boolean {
  const hit = physics.castShape(ctx, world, {
    shape: { capsule: SWEEP_CAPSULE },
    position: pos,
    dir,
    maxDistance: PROBE_M,
  });
  return hit === null || hit.toi > 0;
}

/** The walkable cell in column (x,z) whose floor is nearest `refY` (a cell index), or null if
 *  the column holds none within a capsule height of it. A column with no walkable cell is a
 *  wall, not a place the mover can stand or reach. */
function nearestWalkableY(
  scene: SweepScene,
  x: number,
  z: number,
  refY: number,
): number | null {
  const { occ, walkable } = scene;
  if (x < 0 || z < 0 || x >= occ.dims[0] || z >= occ.dims[2]) return null;
  let best: number | null = null;
  for (let y = 0; y < occ.dims[1]; y++) {
    if (!walkable.has(`${x},${y},${z}`)) continue;
    if (best === null || Math.abs(y - refY) < Math.abs(best - refY)) best = y;
  }
  if (best === null) return null;
  const levelDiff = Math.abs(best - refY) * occ.size[1];
  return levelDiff <= MAX_LEVEL_DIFF_M ? best : null;
}

/** The cell column containing a world XZ point. */
function columnAt(occ: Occupancy, wx: number, wz: number): [number, number] {
  return [
    Math.floor((wx - occ.origin[0]) / occ.size[0]),
    Math.floor((wz - occ.origin[2]) / occ.size[2]),
  ];
}

/** A lane needs somewhere to GO. The column a capsule radius past the flag must hold walkable
 *  floor at a comparable level; if it is solid rock, the capsule walking into it and stopping
 *  says nothing about the flag — it is the wall stopping it. Without this gate every flag
 *  against a wall would "trap" in the direction of that wall, and stage 2 would confirm
 *  everything, which is the same as confirming nothing. */
function hasExit(
  scene: SweepScene,
  flag: Flag,
  cell: readonly [number, number],
): boolean {
  const size = cell[0] !== 0 ? scene.occ.size[0] : scene.occ.size[2];
  const n = Math.max(1, Math.ceil(SWEEP_CAPSULE.radius / size));
  const x = flag.cell[0] + cell[0] * n;
  const z = flag.cell[2] + cell[1] * n;
  return nearestWalkableY(scene, x, z, flag.cell[1]) !== null;
}

/** Approach distances to try, nearest the preferred one first. */
function approachCandidates(): number[] {
  const out: number[] = [];
  for (let d = MIN_APPROACH_M; d <= MAX_APPROACH_M + 1e-9; d += APPROACH_STEP_M)
    out.push(d);
  return out.sort(
    (a, b) => Math.abs(a - APPROACH_M) - Math.abs(b - APPROACH_M),
  );
}

/** Spawn the capsule on walkable floor before the flag, against `dir`: the first candidate
 *  (approach distance x lateral nudge) whose column is standable at the flag's level and whose
 *  capsule pose is free of rock. Null when the flag has no approach in this direction. */
function findSpawn(
  ctx: Context,
  world: physics.World,
  scene: SweepScene,
  flag: Flag,
  dir: Vec3,
): Vec3 | null {
  const { occ } = scene;
  const side: Vec3 = [-dir[2], 0, dir[0]]; // the horizontal perpendicular
  for (const back of approachCandidates()) {
    for (const off of LATERAL_M) {
      const wx = flag.world[0] - dir[0] * back + side[0] * off;
      const wz = flag.world[2] - dir[2] * back + side[2] * off;
      const [cx, cz] = columnAt(occ, wx, wz);
      const cy = nearestWalkableY(scene, cx, cz, flag.cell[1]);
      if (cy === null) continue;
      const floorY = cellFloorWorld(occ, cx, cy, cz)[1];
      const pos: Vec3 = [wx, floorY + REST_OFFSET + SPAWN_RISE, wz];
      if (poseIsFree(ctx, world, pos, dir)) return pos;
    }
  }
  return null;
}

/** How a lane that did not clear is scored: it only indicts the flag if it got near it. */
function stalledOutcome(maxAlong: number, reachBar: number): LaneOutcome {
  return maxAlong >= reachBar ? "trap" : "blocked-upstream";
}

/** Drive the real mover down one lane: spawn on walkable floor before the flag, walk `dir`
 *  until the capsule clears the flag, stalls, levitates, falls out of the volume, or runs out
 *  of budget. The per-frame loop is walk-fixture's runWalk, minus its asserts (a lane walking
 *  into a hazard is SUPPOSED to stall) and plus the levitation guards. */
function runLane(
  ctx: Context,
  world: physics.World,
  scene: SweepScene,
  flag: Flag,
  dir: Vec3,
): Lane {
  if (!hasExit(scene, flag, cellOf(dir)))
    return { dir, outcome: "no-lane", progressed: 0, frames: 0 };
  const spawn = findSpawn(ctx, world, scene, flag, dir);
  if (spawn === null)
    return { dir, outcome: "no-lane", progressed: 0, frames: 0 };

  const startAlong = along(spawn, dir);
  const flagAlong = along(flag.world, dir);
  const clearBar = flagAlong + CLEAR_AT_FLAG_CENTRE;
  const reachBar = flagAlong - REACH_TOL;
  const volumeFloorY = scene.occ.origin[1];

  const body = physics.createBody(ctx, world, {
    type: "kinematicPosition",
    shape: { capsule: SWEEP_CAPSULE },
    position: spawn,
  });
  physics.step(ctx, world, DT); // one settle step before the measured walk
  const mover = new CharacterMover(SWEEP_CAPSULE, body);

  let pos: Vec3 = [spawn[0], spawn[1], spawn[2]];
  let maxAlong = startAlong;
  let stalls = 0;
  let frames = 0;
  let outcome: LaneOutcome | null = null;
  try {
    for (let i = 0; i < MAX_ITERS && outcome === null; i++) {
      frames = i + 1;
      const prev = pos;
      const step = mover.resolve(
        ctx,
        world,
        pos,
        [dir[0] * FRAME_STEP, 0, dir[2] * FRAME_STEP],
        DT,
      );
      pos = step.pos;
      physics.setBodyNextKinematicTranslation(ctx, body, pos);
      physics.step(ctx, world, DT);
      maxAlong = Math.max(maxAlong, along(pos, dir));

      const rose = pos[1] - prev[1];
      const climbedWhileGrounded = step.grounded && rose > LEVITATION_RISE_M;
      if (climbedWhileGrounded && liftPenetrates(ctx, world, body, pos)) {
        outcome = "levitating";
        break;
      }
      if (pos[1] < volumeFloorY) {
        outcome = "fell";
        break;
      }
      // A clear is only issued from a pose the mover can actually hold: grounded, and with the
      // headroom its own rest sweep needs. Anything else is the levitation bug wearing a
      // clear's clothes — the MISS this probe exists to prevent.
      if (step.grounded && along(pos, dir) > clearBar) {
        const trustworthy = !liftPenetrates(ctx, world, body, pos);
        outcome = trustworthy ? "clear" : "levitating";
        break;
      }
      const horizStep = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]);
      stalls = horizStep > STALL_EPS ? 0 : stalls + 1;
      if (stalls >= STALL_LIMIT) outcome = stalledOutcome(maxAlong, reachBar);
    }
  } finally {
    physics.destroyBody(ctx, body);
  }
  return {
    dir,
    // Budget exhausted without clearing = the capsule never got through: scored like a stall.
    outcome: outcome ?? stalledOutcome(maxAlong, reachBar),
    progressed: maxAlong - startAlong,
    frames,
  };
}

/** The cell-space direction of a world sweep dir. */
function cellOf(dir: Vec3): readonly [number, number] {
  return [dir[0], dir[2]] as const;
}

/** A flag is TRAPPED if any lane reached it and stalled — one blocked approach is a hazard,
 *  even if the mover can walk it from three others. It is CLEAR only if a lane demonstrably
 *  walked through and none trapped. Everything else — a levitating lane, no lane at all — is
 *  INCONCLUSIVE: silence is not a clear, and a flag with no evidence keeps its stage-1 status.
 *  A levitating lane cannot be traded for a clear, but it does not override a trap found by a
 *  different lane (that trap is real evidence in its own right). */
function verdictOf(lanes: Lane[]): SweepOutcome {
  if (lanes.some((l) => l.outcome === "trap")) return "trapped";
  if (lanes.some((l) => l.outcome === "levitating")) return "inconclusive";
  if (lanes.some((l) => l.outcome === "clear")) return "clear";
  return "inconclusive";
}

/** Sweep one flag: drive the real mover at it from all 4 cardinal directions. */
export function sweepFlag(
  ctx: Context,
  world: physics.World,
  scene: SweepScene,
  flag: Flag,
): SweepVerdict {
  // A world's colliders are INVISIBLE to castRay/castShape until it has stepped at least once
  // (`physics/query.ts`: "Obstacles are seen only after the world has stepped"). `findSpawn`
  // casts BEFORE any body of ours exists, so without this the spawn's penetration probe
  // queries an empty pipeline, reports every pose free, and plants the capsule inside rock —
  // where the rest sweep's lifted pose penetrates the wall and the mover levitates. That is
  // not hypothetical: it cost exactly one corrupted lane per geometry (the first one swept,
  // before runLane's own step had built the pipeline) until this line was added.
  physics.step(ctx, world, DT);
  const lanes = CELL_DIRS.map((d) =>
    runLane(ctx, world, scene, flag, [d[0], 0, d[1]]),
  );
  const outcome = verdictOf(lanes);
  return {
    flag,
    outcome,
    trapped: outcome === "trapped",
    progressed: Math.max(...lanes.map((l) => l.progressed)),
    levitated: lanes.filter((l) => l.outcome === "levitating").length,
    lanes,
  };
}

/** Stage 2 over every stage-1 flag. Returns a verdict for EVERY flag, not just the confirmed
 *  traps (the F0 plan's draft returned traps only): the clears are what prove stage 2 earns
 *  its cost as a false-positive filter, and the inconclusives are the honest gap. Use
 *  `confirmedTraps` for the traps alone.
 *
 *  @throws if the occupancy's XZ lattice is too coarse for a verdict to MEAN anything — see
 *  `CLEAR_AT_FLAG_CENTRE`. Setup-path, so it throws rather than degrading: a sweep run on a
 *  coarse lattice would return confident CLEARs it has not earned, and a false clear is the
 *  one failure this probe exists to prevent. */
export function sweepFlags(
  ctx: Context,
  world: physics.World,
  scene: SweepScene,
  flags: Flag[],
): SweepVerdict[] {
  const halfCell = Math.max(scene.occ.size[0], scene.occ.size[2]) / 2;
  if (halfCell >= SWEEP_CAPSULE.radius)
    throw new Error(
      `sweepFlags: XZ lattice too coarse — half a cell (${halfCell}m) must be under the capsule radius (${SWEEP_CAPSULE.radius}m), else a capsule blocked at a flag's far face stops PAST the flag's centre and reads as CLEAR`,
    );
  return flags.map((f) => sweepFlag(ctx, world, scene, f));
}

/** The flags the real mover demonstrably stalls at. */
export function confirmedTraps(verdicts: SweepVerdict[]): SweepVerdict[] {
  return verdicts.filter((v) => v.trapped);
}
