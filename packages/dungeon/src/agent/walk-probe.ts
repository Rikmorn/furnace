// packages/dungeon/src/walk-probe.ts
// Stage 2 of the walkability advisor (D-F4-10): for one stage-1 flag, build a LOCAL physics
// scene around it and drive the REAL `CharacterMover` at it from all four cardinal directions.
// "Test the code, not the data" — this probe runs `char-move.ts` itself, so a verdict is a
// statement about the SHIPPED controller, never about a model of it.
//
// Ported in spirit from the F0 probe `scripts/analyzer-probe/sweep.ts` (which swept a dense
// per-body occupancy grid); the algorithm, the constants and the guards are that file's, the
// data source is the sparse `FieldStore` and the scene is built headlessly.
//
// STAGE 2 IS A FILTER, AND IT MUST BE TRUSTWORTHY IN BOTH DIRECTIONS. The two errors are not
// symmetric:
//   - a false CLEAR is a MISS — the advisor blesses a floor the mover cannot walk. Every rule
//     below is biased against it: a flag with no usable evidence is `inconclusive`, NEVER
//     `clear`.
//   - a false TRAP is noise — the advisor keeps a flag it could have dropped. It costs the
//     filter its value but never ships a broken floor.
//
// ADVISOR, NEVER CERTIFIER (D-F4-1): nothing here mutates the store, and no verdict blocks a
// bake. `inconclusive` means the flag KEEPS its stage-1 status.
import * as field from "@furnace/core/field";
import * as physics from "@furnace/core/physics";
import { placementCollider } from "../world/placement-collider.ts";
import { type Capsule, CharacterMover, GROUND_SNAP } from "./char-move.ts";
import { AGENT } from "./walkability.ts";

// The drive loop is `tests/_helpers/walk-fixture.ts` runWalk's, constant for constant: the probe
// must move the capsule exactly the way the game does, or its verdicts are about a different
// mover than the one that ships.
const DT = 1 / 60;
/** The game walk speed (m/s). */
const SPEED = 3;
/** ≈0.05 m nominal horizontal advance per frame. */
const FRAME_STEP = SPEED * DT;
/** ~4 s per lane. A lane needs ~1.7 m (approach + clear bar); this is ~12 m of slack. */
const MAX_ITERS = 240;
/** ~0.75 s of no horizontal progress = wedged (walk-fixture's MAX_STALL_FRAMES). */
const STALL_LIMIT = 45;
/** Per-frame horizontal progress at or below this is no progress (walk-fixture's literal). */
const STALL_EPS = 0.005;

/** Preferred spawn distance before the flag, against the sweep direction. */
const APPROACH_M = 1.2;
/** The spawn search: the preferred distance can put the capsule INSIDE rock (it is a point on a
 *  line through the flag, not a validated pose), and which distance is safe is geometry-
 *  dependent — so candidates are enumerated and each is VALIDATED, nearest-to-APPROACH_M first. */
const MIN_APPROACH_M = 0.9;
const MAX_APPROACH_M = 2.0;
const APPROACH_STEP_M = 0.25;
/** Spawn a touch above rest so frame 1 settles rather than teleports (walk-fixture). */
const SPAWN_RISE = 0.1;
/** Lateral nudges (m, perpendicular to the sweep dir) tried when the flag's own line is not a
 *  legal capsule pose. A floor cell whose centre is under a capsule radius from a wall is
 *  `walkable` to stage 1 but cannot hold the capsule's CENTRE — without this, every wall-adjacent
 *  flag would be unsweepable, and in a real cave that is most of them. Capped at a half cell so
 *  the nudged capsule still covers the flag's own column: a bigger nudge could route the mover
 *  AROUND the hazard and manufacture a false CLEAR. */
const LATERAL_M = [0, 0.25, -0.25];
/** CLEARED = the capsule's CENTRE got past the flag's own centre, grounded and lift-free.
 *
 *  READ THAT LITERALLY. It proves the capsule REACHED the flagged cell's centre under its own
 *  power, on ground it could hold — it does NOT prove the capsule ended up somewhere good. A lane
 *  can score `clear` while the mover is in real trouble: a lane spawning on TOP of a pit rim
 *  walks OFF it and clears the flag on the way down. Such flags are still correctly reported
 *  `trapped`, but ONLY because {@link verdictOf} gives trap-precedence and an opposing lane traps.
 *
 *  So flag-level miss-safety rests on TRAP-PRECEDENCE ACROSS THE 4 LANES, not on any one lane
 *  being sound. A future change that lets the TRAPPING lane degrade to `no-lane` (a stricter exit
 *  gate, a spawn search that gives up sooner) while a DESCENDING lane still clears would turn a
 *  trap into a CLEAR — a MISS. Guard that invariant before touching lane selection.
 *
 *  The F0 plan's draft bar — a radius + margin PAST the flag — is unreachable and produced a
 *  false TRAP on the first run: a capsule stops radius + SKIN (0.38 m) short of ANY wall, so a
 *  wall standing one cell beyond a perfectly benign flag pins it at flag + 0.37 m and the bar is
 *  never met. Measured over every lane of all five F0 geometries, a lane's stop position is
 *  BIMODAL, and the two modes are what the bar has to separate:
 *      -0.13 m  blocked by geometry at the flag cell's FAR face  = the real traps
 *      +0.37 m  traversed the flag, stopped at a wall a cell on  = benign
 *  A bar at the flag's centre splits them with 0.13 m / 0.37 m of margin. */
const CLEAR_AT_FLAG_CENTRE = 0;
/** A stalled lane blames the FLAG only if it stopped within this of it. A capsule blocked BY the
 *  flag's own geometry necessarily stops short of the flag's centre — by radius + skin + half a
 *  cell (measured worst case in the F0 corpus: 0.63 m). A lane that dies further back than that
 *  was stopped by something else on the way in, and says nothing about this flag: it is
 *  `blocked-upstream`, and contributes NO evidence (not a clear). */
const REACH_TOL = 1.0;
/** `castShape` is stopAtPenetration, so an overlapping start returns `toi: 0` — a sweep of this
 *  length is therefore a penetration probe, not a distance measurement. */
const PROBE_M = 1e-3;
/** A GROUNDED frame that rises more than this is the SYMPTOM of the historical rest-sweep
 *  levitation bug: a levitating frame gained exactly `stepHeight`, while a walk up the steepest
 *  legal slope gains ~0.07 m per frame at 3 m/s. Never fires alone — `liftPenetrates` must
 *  confirm the CAUSE, so a legitimate step-up (which happens in open headroom) cannot be mistaken
 *  for it. */
const LEVITATION_RISE_M = 0.3;
/** Chunks of padding around the flag's own chunk, when the caller names none. */
const DEFAULT_NEIGHBORHOOD_CHUNKS = 2;
/** The 4 cardinal XZ neighbours, matching the column pass's own DIRS. */
const CELL_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

type Vec3 = [number, number, number];

/** What one directed lane established about a flag. Only `trap` and `clear` are evidence. */
export type VerifyLaneOutcome =
  /** The capsule's centre got past the flag's, grounded and lift-free: it traversed the cell. */
  | "clear"
  /** The capsule reached the flag and stopped there. */
  | "trap"
  /** No legal lane: no walkable spawn, no legal capsule pose to start from, or nowhere to go
   *  past the flag (e.g. a rock wall). */
  | "no-lane"
  /** The capsule stopped well short of the flag — something else blocked it. No evidence. */
  | "blocked-upstream"
  /** The rest-sweep levitation class fired (bug fixed 2026-07-15; the guard is retained as
   *  regression insurance). No evidence. */
  | "levitating"
  /** The capsule left the analysed neighbourhood downward. No evidence. */
  | "fell"
  /** The wall-clock budget ran out mid-lane. No evidence. */
  | "budget";

/** One directed lane's result. `progressed` is metres advanced along `dir` from the spawn, at the
 *  lane's furthest — diagnostic only, never read by the verdict. */
export type VerifyLane = {
  /** The lane's XZ direction, as the cardinal cell step it was driven along. */
  dir: [number, number];
  outcome: VerifyLaneOutcome;
  progressed: number;
};

/** Why a verify came back `inconclusive`. Absent on `trapped` / `clear`, and absent on an
 *  inconclusive whose lanes simply produced no evidence (all `blocked-upstream`, say). */
export type VerifyReason = "budget" | "no-lanes" | "levitating";

/** `trapped` = the real mover demonstrably stalls at this flag. `clear` = it demonstrably walks
 *  through. `inconclusive` = neither was shown, and the flag KEEPS its stage-1 status. */
export type VerifyOutcome = "trapped" | "clear" | "inconclusive";

/** One flag's stage-2 verdict. */
export type VerifyVerdict = {
  outcome: VerifyOutcome;
  reason?: VerifyReason;
  lanes: VerifyLane[];
  /** Wall-clock milliseconds the whole verify took, scene build included. */
  ms: number;
};

/** Input bundle for {@link analyzerVerify}. */
export type AnalyzerVerifyOptions = {
  /** The field to build the local scene from. Structural — an editor worker's mirror store
   *  satisfies it as readily as the game's own. */
  store: field.FieldStore;
  /** Placement colliders to include, batched by the archetype collision they share — the same
   *  grouping `field.voxelizePlacements` consumes, so stage 1 and stage 2 see one prop set.
   *  Records outside the probed neighbourhood are skipped. */
  placements?: readonly field.PlacementCollisionGroup[];
  /** The flag to verify. Only its `cell` and `world` are read; its severity is not consulted. */
  flag: field.FieldFlag;
  /** The agent under test. MUST describe the shipped mover — see {@link analyzerVerify}. */
  profile: field.AgentProfile;
  /** Hard wall-clock ceiling in milliseconds, checked before every lane AND every frame. */
  budgetMs: number;
  /** Chunk radius of the local scene around the flag. Default
   *  {@link DEFAULT_NEIGHBORHOOD_CHUNKS}. */
  neighborhoodChunks?: number;
};

/** The agent facts resolved once per verify, in the units each consumer wants. */
type Metrics = {
  capsule: Capsule;
  /** Capsule centre height above the floor it rests on. */
  restOffset: number;
  /** Total capsule height (m) — and the bar for "is that column the same storey as this one?". */
  capsuleHeight: number;
  /** Standing headroom in cells, the column pass's own walkability test. */
  clearCells: number;
  stepHeight: number;
};

/** The local scene one verify runs in, plus everything the lane machinery reads. */
type Probe = {
  ctx: physics.PhysicsContext;
  world: physics.World;
  store: field.FieldStore;
  m: Metrics;
  budget: Budget;
  /** World Y below which the capsule has left the probed neighbourhood. */
  floorY: number;
};

/** A hard wall-clock ceiling. Budgets are day-one semantics here: a verify runs inside an
 *  interactive editor loop, and an unbounded search is how one becomes a hang. */
type Budget = { readonly startedAt: number; readonly limitMs: number };

const budgetSpent = (b: Budget): number => performance.now() - b.startedAt;
const budgetExpired = (b: Budget): boolean => budgetSpent(b) >= b.limitMs;

/** Scalar advance of a point along a horizontal unit direction (walk-fixture's `along`). */
const along = (p: Vec3, dir: Vec3): number => p[0] * dir[0] + p[2] * dir[2];

/** ONE headless context for this module's whole lifetime, created on first use.
 *
 *  Context ids are 16 bits and recycle past 65535 with no guard (see
 *  `createHeadlessPhysicsContext`), so a context per verify would wrap after ~65k flags — well
 *  inside one long editor session's reach. A context holds no GPU objects and needs no dispose;
 *  what has to be freed promptly is each verify's `World`, which {@link analyzerVerify} does in a
 *  `finally`. */
let probeContext: physics.PhysicsContext | undefined;
function sharedContext(): physics.PhysicsContext {
  probeContext ??= physics.createHeadlessPhysicsContext();
  return probeContext;
}

/** The mover under test reads its own limits from `walkability.ts` (i.e. `catalog/agent.json`) as
 *  MODULE constants — `STEP_HEIGHT`, `SLOPE_LIMIT_COS` — not from anything passed in. A profile
 *  describing a different agent would therefore calibrate this probe's guards, spawn bar and
 *  clear bar to a capsule the mover is not, and every verdict would be about no real agent at
 *  all. Setup-loud, because that failure is silent and total. */
function assertProfileDrivesTheShippedMover(profile: field.AgentProfile): void {
  const mismatched = (
    [
      ["capsule.radius", profile.capsule.radius, AGENT.capsule.radius],
      [
        "capsule.halfHeight",
        profile.capsule.halfHeight,
        AGENT.capsule.halfHeight,
      ],
      ["stepHeight", profile.stepHeight, AGENT.stepHeight],
      ["slopeLimitDeg", profile.slopeLimitDeg, AGENT.slopeLimitDeg],
    ] as const
  ).filter(([, given, shipped]) => given !== shipped);
  if (mismatched.length > 0)
    throw new Error(
      `analyzerVerify: profile does not describe the shipped mover — ${mismatched
        .map(([name, given, shipped]) => `${name} ${given} != ${shipped}`)
        .join(
          ", ",
        )}. char-move.ts reads these from catalog/agent.json directly, so a verdict from a divergent profile describes no real agent`,
    );
}

function metricsFor(profile: field.AgentProfile, cellSize: number): Metrics {
  const capsule: Capsule = {
    radius: profile.capsule.radius,
    halfHeight: profile.capsule.halfHeight,
  };
  const restOffset = capsule.halfHeight + capsule.radius;
  return {
    capsule,
    restOffset,
    capsuleHeight: 2 * restOffset,
    clearCells: Math.ceil(profile.clearance / cellSize),
    stepHeight: profile.stepHeight,
  };
}

// ─── the solidity the probe reads (the column pass's own predicates, on the store) ───

const isSolid = (
  store: field.FieldStore,
  x: number,
  y: number,
  z: number,
): boolean => field.getDensity(store, x, y, z) < 0;

/** An air cell sitting directly on rock — a floor surface. */
const isFloorAnchor = (
  store: field.FieldStore,
  x: number,
  y: number,
  z: number,
): boolean => !isSolid(store, x, y, z) && isSolid(store, x, y - 1, z);

/** Stage 1's walkable test — a floor surface with `clearance` of air above it — re-derived here
 *  over the store rather than shared with `analyze.ts` (whose predicate is module-private) or
 *  taken from a stage-1 result: a verify is asked about ONE flag, and re-running a whole-world
 *  pass just to learn where its lanes may spawn would cost more than the verify. If the two ever
 *  drift, a lane can spawn where stage 1 would not have put a flag. */
function isWalkableCell(
  store: field.FieldStore,
  m: Metrics,
  x: number,
  y: number,
  z: number,
): boolean {
  if (!isFloorAnchor(store, x, y, z)) return false;
  for (let n = 0; n < m.clearCells; n++)
    if (isSolid(store, x, y + n, z)) return false;
  return true;
}

/** The walkable cell in column (x,z) whose floor is nearest `refY` (a cell index) and within a
 *  capsule height of it, or null. A column with no such cell is either a wall or a different
 *  storey, and a lane through it would test different geometry.
 *
 *  The scan window IS the level bar, in cells: `floor(capsuleHeight / cellSize)` either side of
 *  `refY` — 7 cells (1.75 m) at the production 0.25 m lattice, the largest whole-cell offset whose
 *  metre distance still clears the 1.8 m bar. Searching only the window loses nothing: the nearest
 *  walkable cell inside it IS the nearest one overall whenever any exists there, and when none
 *  does the answer is null either way. */
function nearestWalkableY(
  store: field.FieldStore,
  m: Metrics,
  x: number,
  z: number,
  refY: number,
): number | null {
  const span = Math.floor(m.capsuleHeight / store.cellSize);
  if (isWalkableCell(store, m, x, refY, z)) return refY;
  // Outward from `refY`, lower level first on a tie — the donor's ordering.
  for (let d = 1; d <= span; d++) {
    if (isWalkableCell(store, m, x, refY - d, z)) return refY - d;
    if (isWalkableCell(store, m, x, refY + d, z)) return refY + d;
  }
  return null;
}

/** World centre of the floor surface under cell (x,y,z) — the column pass's own convention. */
const cellFloorWorld = (cellSize: number, y: number): number =>
  field.sampleToWorld(y, cellSize);

const worldColumn = (
  store: field.FieldStore,
  wx: number,
  wz: number,
): [number, number] => [
  field.worldToVoxel(wx, store.cellSize),
  field.worldToVoxel(wz, store.cellSize),
];

// ─── scene construction ───

/** The chunk-space box the local scene covers, and its world bounds. */
type Neighborhood = {
  keys: field.ChunkKey[];
  min: Vec3;
  max: Vec3;
};

/** Every chunk within `radius` of the one holding `cell`, plus that box's world bounds.
 *
 *  Centred on the chunk holding the flag's CELL rather than on `flag.chunk`: the two are the same
 *  chunk for every flag except a `low-clearance` one, whose owner is the chunk that ANALYSED it
 *  while its cell is the offending neighbour — at most one cell, hence at most one chunk, away.
 *  The cell is where the capsule walks, so it is what the scene is built around. */
function neighborhoodOf(
  store: field.FieldStore,
  cell: readonly [number, number, number],
  radius: number,
): Neighborhood {
  const cx = field.voxelChunk(cell[0]);
  const cy = field.voxelChunk(cell[1]);
  const cz = field.voxelChunk(cell[2]);
  const keys: field.ChunkKey[] = [];
  for (let dz = -radius; dz <= radius; dz++)
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++)
        keys.push(field.chunkKey(cx + dx, cy + dy, cz + dz));
  const span = field.CHUNK_DIM * store.cellSize;
  return {
    keys,
    min: [(cx - radius) * span, (cy - radius) * span, (cz - radius) * span],
    max: [
      (cx + radius + 1) * span,
      (cy + radius + 1) * span,
      (cz + radius + 1) * span,
    ],
  };
}

/** One static shell voxel collider per allocated chunk in the neighbourhood — the same derivation
 *  `field-world.ts` gives the running game, so the capsule touches the geometry it would touch
 *  in play. Bodies die with the world.
 *
 *  Geometry OUTSIDE the box is simply absent, which is the one place the probe and the column
 *  pass disagree: unallocated space reads SOLID to stage 1 but reads as EMPTY here. That
 *  asymmetry is miss-safe — a capsule that walks out of the box finds no ground, falls, and its
 *  lane returns `fell` (no evidence). It can never read the void as walkable floor. */
function buildChunkBodies(
  ctx: physics.PhysicsContext,
  world: physics.World,
  store: field.FieldStore,
  hood: Neighborhood,
): void {
  for (const key of hood.keys) {
    const col = field.chunkColliders(store, key);
    if (col === null) continue;
    physics.createBody(ctx, world, {
      type: "static",
      shape: { voxels: { coords: col.coords, size: col.size } },
      position: col.position,
    });
  }
}

/** A rotation-invariant bounding radius for a derived collider shape. Read off the DESCRIPTOR
 *  rather than recomputed from the primitive + scale, so the scale rule stays owned solely by
 *  {@link placementCollider} — the divergence D-F4-5 exists to prevent. */
function boundingRadius(shape: physics.ShapeDescriptor): number {
  if ("ball" in shape) return shape.ball;
  if ("capsule" in shape)
    return shape.capsule.halfHeight + shape.capsule.radius;
  if ("cuboid" in shape)
    return Math.hypot(shape.cuboid[0], shape.cuboid[1], shape.cuboid[2]);
  throw new Error(
    `analyzerVerify: placementCollider returned an unexpected shape (${Object.keys(shape).join()}) — only ball/capsule/cuboid are derivable from a catalog collision primitive`,
  );
}

/** Does a sphere at `centre` reach into the neighbourhood box? Conservative on purpose: a bound
 *  that over-includes only ever adds geometry that really is there, while one that under-includes
 *  deletes a collider the mover would have hit — a false CLEAR. */
function reachesBox(centre: Vec3, radius: number, hood: Neighborhood): boolean {
  const overshoot = (c: number, lo: number, hi: number): number => {
    if (c < lo) return lo - c;
    if (c > hi) return c - hi;
    return 0;
  };
  const dx = overshoot(centre[0], hood.min[0], hood.max[0]);
  const dy = overshoot(centre[1], hood.min[1], hood.max[1]);
  const dz = overshoot(centre[2], hood.min[2], hood.max[2]);
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

/** One static collider per placed record reaching the neighbourhood: `placementCollider` for the
 *  shape, core's `field.collisionCenter` for the anchored pose — the same pair `field-world.ts`
 *  builds the game's props from, and the same pose `voxelizePlacements` rasterizes around. */
function buildPlacementBodies(
  ctx: physics.PhysicsContext,
  world: physics.World,
  groups: readonly field.PlacementCollisionGroup[],
  hood: Neighborhood,
): void {
  for (const group of groups)
    for (const record of group.records) {
      const shape = placementCollider(group.collision, record.scale);
      const centre = field.collisionCenter(group.collision, record);
      if (!reachesBox(centre, boundingRadius(shape), hood)) continue;
      physics.createBody(ctx, world, {
        type: "static",
        shape,
        position: centre,
        rotation: record.quat,
      });
    }
}

// ─── the pose gates ───

/** Would `applyGravity`'s rest sweep — which lifts the capsule before sweeping DOWN — start
 *  inside rock from this pose? If so the sweep returns `toi: 0` and the mover levitates while
 *  reporting grounded. This is the historical bug's condition, probed directly rather than
 *  inferred. */
function liftPenetrates(p: Probe, body: physics.Body, pos: Vec3): boolean {
  const hit = physics.castShape(p.ctx, p.world, {
    shape: { capsule: p.m.capsule },
    position: pos,
    dir: [0, 1, 0],
    maxDistance: p.m.stepHeight,
    excludeBody: body,
  });
  return hit !== null && hit.toi < p.m.stepHeight;
}

/** Is this capsule pose free of rock? `castShape` is stopAtPenetration, so an overlapping start
 *  reports `toi: 0` in EVERY direction — a probe-length sweep is exactly the overlap test.
 *
 *  Measured on the vendored Rapier: a deeply penetrating pose, a shallow one and a free one are
 *  distinguished at any positive `maxDistance` down to 1e-12, while `maxDistance: 0` returns
 *  `null` for all three (pinned in `tests/walk-probe.test.ts`). A zero-offset cast is therefore
 *  NOT a penetration detector, whatever its intuition; this probe length is. */
function poseIsFree(p: Probe, pos: Vec3, dir: Vec3): boolean {
  const hit = physics.castShape(p.ctx, p.world, {
    shape: { capsule: p.m.capsule },
    position: pos,
    dir,
    maxDistance: PROBE_M,
  });
  return hit === null || hit.toi > 0;
}

/** Is there ground under this pose within the mover's own reach? Mirrors `applyGravity`'s ground
 *  ray exactly (`foot + GROUND_SNAP` below the capsule's centre), so a spawn the probe accepts is
 *  one the mover's very first frame will call grounded. */
function hasSupport(p: Probe, pos: Vec3): boolean {
  return (
    physics.castRay(p.ctx, p.world, {
      origin: pos,
      dir: [0, -1, 0],
      maxDistance: p.m.restOffset + GROUND_SNAP,
    }) !== null
  );
}

// ─── lane machinery ───

/** How far past a flag the exit column sits (m): a capsule radius, rounded UP to a whole number
 *  of XZ cells so the probe always lands in a DIFFERENT column than the flag's. */
const exitStepM = (store: field.FieldStore, m: Metrics): number =>
  Math.max(1, Math.ceil(m.capsule.radius / store.cellSize)) * store.cellSize;

/** A lane needs somewhere to GO. The column a capsule radius past the flag must hold walkable
 *  floor at a comparable level; if it is solid rock, the capsule walking into it and stopping says
 *  nothing about the flag — it is the wall stopping it. Without this gate every flag against a
 *  wall would "trap" in the direction of that wall, and stage 2 would confirm everything, which
 *  is the same as confirming nothing. */
function hasExit(p: Probe, flag: field.FieldFlag, dir: Vec3): boolean {
  const d = exitStepM(p.store, p.m);
  const [x, z] = worldColumn(
    p.store,
    flag.world[0] + dir[0] * d,
    flag.world[2] + dir[2] * d,
  );
  return nearestWalkableY(p.store, p.m, x, z, flag.cell[1]) !== null;
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
 *  (approach distance × lateral nudge) whose column is standable at the flag's level, whose
 *  capsule pose is free of rock, and which has ground under it inside the mover's own snap reach.
 *  Null when the flag has no legal approach in this direction — which is a `no-lane`, never a
 *  trap: a flag the capsule cannot even be placed near has not been shown to stop anything. */
function findSpawn(p: Probe, flag: field.FieldFlag, dir: Vec3): Vec3 | null {
  const side: Vec3 = [-dir[2], 0, dir[0]]; // the horizontal perpendicular
  for (const back of approachCandidates())
    for (const off of LATERAL_M) {
      const wx = flag.world[0] - dir[0] * back + side[0] * off;
      const wz = flag.world[2] - dir[2] * back + side[2] * off;
      const [cx, cz] = worldColumn(p.store, wx, wz);
      const cy = nearestWalkableY(p.store, p.m, cx, cz, flag.cell[1]);
      if (cy === null) continue;
      // Spawn a touch above rest so frame 1 settles rather than teleports (walk-fixture).
      const floor = cellFloorWorld(p.store.cellSize, cy);
      const pos: Vec3 = [wx, floor + p.m.restOffset + SPAWN_RISE, wz];
      if (poseIsFree(p, pos, dir) && hasSupport(p, pos)) return pos;
    }
  return null;
}

/** How a lane that did not clear is scored: it only indicts the flag if it got near it. */
const stalledOutcome = (
  maxAlong: number,
  reachBar: number,
): VerifyLaneOutcome => (maxAlong >= reachBar ? "trap" : "blocked-upstream");

const noLane = (dir: Vec3): VerifyLane => ({
  dir: [dir[0], dir[2]],
  outcome: "no-lane",
  progressed: 0,
});

/** Drive the real mover down one lane: spawn on walkable floor before the flag, walk `dir` until
 *  the capsule clears the flag, stalls, levitates, falls out of the neighbourhood, or runs out of
 *  budget. The per-frame loop is walk-fixture's runWalk, minus its asserts (a lane walking into a
 *  hazard is SUPPOSED to stall) and plus the levitation guards. */
function runLane(p: Probe, flag: field.FieldFlag, dir: Vec3): VerifyLane {
  if (!hasExit(p, flag, dir)) return noLane(dir);
  const spawn = findSpawn(p, flag, dir);
  if (spawn === null) return noLane(dir);

  const startAlong = along(spawn, dir);
  const flagAlong = along([flag.world[0], flag.world[1], flag.world[2]], dir);
  const clearBar = flagAlong + CLEAR_AT_FLAG_CENTRE;
  const reachBar = flagAlong - REACH_TOL;

  const body = physics.createBody(p.ctx, p.world, {
    type: "kinematicPosition",
    shape: { capsule: p.m.capsule },
    position: spawn,
  });
  physics.step(p.ctx, p.world, DT); // one settle step before the measured walk
  const mover = new CharacterMover(p.m.capsule, body);

  let pos: Vec3 = [spawn[0], spawn[1], spawn[2]];
  let maxAlong = startAlong;
  let stalls = 0;
  let outcome: VerifyLaneOutcome | null = null;
  try {
    for (let i = 0; i < MAX_ITERS && outcome === null; i++) {
      if (budgetExpired(p.budget)) {
        outcome = "budget";
        break;
      }
      const prev = pos;
      const step = mover.resolve(
        p.ctx,
        p.world,
        pos,
        [dir[0] * FRAME_STEP, 0, dir[2] * FRAME_STEP],
        DT,
      );
      pos = step.pos;
      physics.setBodyNextKinematicTranslation(p.ctx, body, pos);
      physics.step(p.ctx, p.world, DT);
      maxAlong = Math.max(maxAlong, along(pos, dir));

      const climbedWhileGrounded =
        step.grounded && pos[1] - prev[1] > LEVITATION_RISE_M;
      if (climbedWhileGrounded && liftPenetrates(p, body, pos)) {
        outcome = "levitating";
        break;
      }
      if (pos[1] < p.floorY) {
        outcome = "fell";
        break;
      }
      // A clear is only issued from a pose the mover can actually hold: grounded, and with the
      // headroom its own rest sweep needs. Anything else is the levitation bug wearing a clear's
      // clothes — the MISS this probe exists to prevent.
      if (step.grounded && along(pos, dir) > clearBar) {
        outcome = liftPenetrates(p, body, pos) ? "levitating" : "clear";
        break;
      }
      const horizStep = Math.hypot(pos[0] - prev[0], pos[2] - prev[2]);
      stalls = horizStep > STALL_EPS ? 0 : stalls + 1;
      if (stalls >= STALL_LIMIT) outcome = stalledOutcome(maxAlong, reachBar);
    }
  } finally {
    physics.destroyBody(p.ctx, body);
  }
  return {
    dir: [dir[0], dir[2]],
    // Budget exhausted without clearing = the capsule never got through: scored like a stall.
    outcome: outcome ?? stalledOutcome(maxAlong, reachBar),
    progressed: maxAlong - startAlong,
  };
}

/** A flag is TRAPPED if any lane reached it and stalled — one blocked approach is a hazard, even
 *  if the mover can walk it from three others. It is CLEAR only if a lane demonstrably walked
 *  through and none trapped. Everything else is INCONCLUSIVE: silence is not a clear, and a flag
 *  with no evidence keeps its stage-1 status. A levitating lane cannot be traded for a clear, but
 *  it does not override a trap found by a different lane (that trap is real evidence in its own
 *  right).
 *
 *  THE TRAP-PRECEDENCE ORDER IS THE MISS-SAFETY GUARANTEE, not a tie-break convenience: a single
 *  lane's `clear` is a weaker claim than it looks (see {@link CLEAR_AT_FLAG_CENTRE}), and on the
 *  pit fixture the only thing standing between a real trap and a false CLEAR is that the trapping
 *  lane outvotes a clearing one. Do not reorder these checks.
 *
 *  The budget sits BELOW the trap check and ABOVE everything else for the same reason: a trap
 *  already demonstrated is real evidence a clock cannot un-demonstrate, while a clear that had
 *  not yet been reached when time ran out is exactly the claim this probe must not make. */
function verdictOf(
  lanes: readonly VerifyLane[],
  budgetHit: boolean,
): {
  outcome: VerifyOutcome;
  reason?: VerifyReason;
} {
  if (lanes.some((l) => l.outcome === "trap")) return { outcome: "trapped" };
  if (budgetHit) return { outcome: "inconclusive", reason: "budget" };
  if (lanes.some((l) => l.outcome === "levitating"))
    return { outcome: "inconclusive", reason: "levitating" };
  if (lanes.some((l) => l.outcome === "clear")) return { outcome: "clear" };
  if (lanes.length > 0 && lanes.every((l) => l.outcome === "no-lane"))
    return { outcome: "inconclusive", reason: "no-lanes" };
  return { outcome: "inconclusive" };
}

/** Half a cell must be under a capsule radius, or a verdict cannot MEAN anything: the "blocked at
 *  the flag's far face" stop position is `halfCell - (radius + SKIN)`, and on a lattice coarse
 *  enough for that to go positive a blocked capsule stops PAST the flag's centre and reads as
 *  CLEAR — the one failure this probe exists to prevent. Setup-path, so it throws rather than
 *  degrading. Production is 0.25 m (half a cell 0.125 < radius 0.3). */
function assertLatticeFineEnough(store: field.FieldStore, m: Metrics): void {
  const halfCell = store.cellSize / 2;
  if (halfCell >= m.capsule.radius)
    throw new Error(
      `analyzerVerify: XZ lattice too coarse — half a cell (${halfCell} m) must be under the capsule radius (${m.capsule.radius} m), else a capsule blocked at a flag's far face stops PAST the flag's centre and reads as CLEAR`,
    );
}

/**
 * Verify one stage-1 walkability flag by driving the SHIPPED `CharacterMover` at it from all four
 * cardinal directions in a locally-built physics scene (D-F4-10).
 *
 * ADVISORY ONLY (D-F4-1): it reads the store, never writes it, and blocks nothing. `trapped`
 * means the real mover demonstrably stalls there, `clear` that it demonstrably walks through, and
 * `inconclusive` that neither was shown — in which case the flag simply keeps its stage-1 status.
 * There is no fourth answer: a lane with no usable evidence NEVER contributes a clear.
 *
 * The scene is the flag's own neighbourhood, not the world: one static shell voxel collider per
 * allocated chunk within `neighborhoodChunks` of the flag's cell (`field.chunkColliders`, the same
 * derivation the game loads), plus every placement collider reaching that box.
 *
 * Stage 1's vertical reads are unbounded upward (its ceiling search runs until it finds rock), but
 * the MOVER's are not: `char-move.ts` casts at most `stepHeight` (0.4 m) above its own pose and
 * `halfHeight + radius + GROUND_SNAP` (1.35 m) below it. So the box has to contain the flag plus
 * roughly a capsule height either way, which the default 2-chunk radius — a 20 m cube at the
 * 0.25 m cell size — does many times over. It is NOT large enough to contain a lane that runs its
 * full frame budget (~12 m of travel) from a corner; that case is bounded instead by what leaving
 * the box means, which is `fell`: no ground, hence no evidence, and never a clear.
 *
 * @param opts - See {@link AnalyzerVerifyOptions}.
 * @returns The verdict, its per-lane detail, and the wall-clock cost. `lanes` is empty when the
 * budget was already spent building the scene.
 * @throws Error - setup-loud, before any physics is created: when `budgetMs` is not a positive
 * finite number, when `neighborhoodChunks` is not a non-negative integer, when the store's cell
 * size is too coarse for a lane's clear bar to separate a trap from a benign stop, or when
 * `profile` does not describe the mover this probe actually drives (`char-move.ts` reads its
 * `stepHeight` and slope limit from `catalog/agent.json` as module constants, so a divergent
 * profile would produce verdicts about no real agent).
 * @remarks Holds ONE process-wide headless physics context, created lazily, and a fresh `World`
 * per call which is destroyed in a `finally` — that is what releases the Rapier wasm promptly.
 */
export async function analyzerVerify(
  opts: AnalyzerVerifyOptions,
): Promise<VerifyVerdict> {
  const startedAt = performance.now();
  const { store, flag, profile, budgetMs } = opts;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0)
    throw new Error(
      `analyzerVerify: budgetMs must be a positive finite number, got ${budgetMs}`,
    );
  const radius = opts.neighborhoodChunks ?? DEFAULT_NEIGHBORHOOD_CHUNKS;
  if (!Number.isInteger(radius) || radius < 0)
    throw new Error(
      `analyzerVerify: neighborhoodChunks must be a non-negative integer, got ${radius}`,
    );
  assertProfileDrivesTheShippedMover(profile);
  const m = metricsFor(profile, store.cellSize);
  assertLatticeFineEnough(store, m);

  const hood = neighborhoodOf(store, flag.cell, radius);
  const ctx = sharedContext();
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  try {
    buildChunkBodies(ctx, world, store, hood);
    if (opts.placements !== undefined)
      buildPlacementBodies(ctx, world, opts.placements, hood);
    // A world's colliders are INVISIBLE to castRay/castShape until it has stepped at least once
    // (`physics/query.ts`: "Obstacles are seen only after the world has stepped"). The spawn
    // search casts before any body of ours exists, so without this it queries an empty pipeline,
    // reports every pose free, and plants the capsule inside rock.
    physics.step(ctx, world, DT);

    const probe: Probe = {
      ctx,
      world,
      store,
      m,
      budget: { startedAt, limitMs: budgetMs },
      floorY: hood.min[1],
    };
    // The budget is checked BETWEEN lanes as well as inside each one, so a scene that was already
    // too expensive to build returns with no lanes at all rather than starting a walk it cannot
    // finish.
    const lanes: VerifyLane[] = [];
    let budgetHit = false;
    for (const [dx, dz] of CELL_DIRS) {
      if (budgetExpired(probe.budget)) {
        budgetHit = true;
        break;
      }
      const lane = runLane(probe, flag, [dx, 0, dz]);
      if (lane.outcome === "budget") budgetHit = true;
      lanes.push(lane);
    }
    return {
      ...verdictOf(lanes, budgetHit),
      lanes,
      ms: performance.now() - startedAt,
    };
  } finally {
    physics.destroyWorld(ctx, world);
  }
}
