// F3b Task 4 — P-F3-1 probe: the stepped-floor capsule fuzz-walk (a DELIVERABLE, not a
// blocker). Per D-F3-11, failures are CLASSIFIED and RECORDED, never repaired: there is no
// search / retry / repair loop anywhere here. Individual lane failures are DATA; the WALK
// asserts only three things — (a) fixture validity, (b) the composite mouth→deepest lane
// walking on >= half the configs (the systemic-collapse tripwire), (c) the report is written.
//
// F4 Task 8 added a fourth, separate contract on top of the same runs: the QUIET-LANE TOOTH
// (see its own section below), which asserts the advisor stays silent on the ground these walks
// demonstrably cover. That one IS a blocker — it is the regression guard for the amended
// severity model — and it is deliberately scoped to walked lanes so off-lane terrain findings
// stay data.
//
// The walk plumbing (bake -> stub fetch -> loadWorld -> runWalk against the per-chunk shell
// voxel colliders — the SAME collision the game uses) is lifted from field-world.gpu.test.ts;
// `runWalk` + `bakedFetchStub` are reused VERBATIM from tests/_helpers/field-walk.ts. Only
// the cave fixture build, the skeleton-derived lanes, and the classifier are new.
//
// DEVIATIONS from the plan's literal recipe (each justified in place below):
//   1. A lane is walked SEGMENT-BY-SEGMENT along its polyline (runWalk is single-direction);
//      a straight drive across a whole winding passage would cut the tube corners and read as
//      a spurious `blocked`. See `walkLane`.
//   2. Failures are classified via a loose-bounds `expectStop` RE-DRIVE (not by parsing bun's
//      assertion text, which is fragile across versions). See `classifyThrow`.

import { describe, expect, test } from "bun:test";
import {
  analyzeWorld,
  BUILTIN_TABLE,
  bakeFieldWorld,
  buildCaveSkeleton,
  type CaveChamber,
  type CaveMouth,
  type CavePassage,
  type CaveSkeleton,
  type ChunkKey,
  chunkKey,
  commitGenerator,
  createFieldStore,
  createOpLog,
  DEFAULT_CELL_SIZE,
  detectPits,
  type FieldFlag,
  type FieldStore,
  generatorById,
  getDensity,
  markUnreachable,
  voxelChunk,
  worldToVoxel,
} from "@furnace/core/field";
import * as gpu from "@furnace/core/gpu";
import * as physics from "@furnace/core/physics";
import { AGENT, STEP_HEIGHT } from "../src/agent/walkability.ts";
import { MaterialCache } from "../src/world/realize.ts";
import type { Vec3 } from "../src/world/region.ts";
import { loadWorld } from "../src/world/world-loader.ts";
import {
  CAVE_EXTENT,
  CAVE_REGION,
  type CaveConfig,
  caveConfigs,
} from "./_helpers/cave-matrix.ts";
import { at } from "./_helpers/expect.ts";
import {
  along,
  bakedFetchStub,
  FRAME_STEP,
  REST_OFFSET,
  runWalk,
  SPAWN_RISE,
} from "./_helpers/field-walk.ts";
import {
  bunWebGpuAvailable,
  ensureBunWebGpu,
  makeOffscreenCanvas,
} from "./_helpers/gpu-fixture.ts";

await ensureBunWebGpu();

// ─── probe constants ───
/** The floor-height quantum the cave quantizes to — DEFAULT_CELL_SIZE by construction
 *  (`cave.ts`: RISER === CARVE_CELL === DEFAULT_CELL_SIZE), so a public import single-sources
 *  it without reaching into core's internal cave.ts. */
const RISER = DEFAULT_CELL_SIZE; // 0.25 m
/** The physics contact skin the capsule carries. The premise gate demands one riser fit UNDER
 *  the mover's step-up with this margin to spare (matches the deleted `STEP_MARGIN` 0.05 the
 *  walkability backlog records). */
const SKIN_MARGIN = 0.05;
/** Capsule centre height above the floor at spawn — grounded rest + a touch, so the first
 *  frame settles rather than teleports (the field-walk harness convention). */
const SPAWN_ABOVE_FLOOR = REST_OFFSET + SPAWN_RISE; // 1.0 m
/** Passage headroom the cave fixture carves above a floor — sizes the
 *  per-lane ceiling guard so a legitimate stepped climb never reads as a launch. */
const PASSAGE_HEADROOM = 3.0;
/** `floorY` guard drop below a lane's lowest floor: a real fall-through still trips it, a
 *  legitimate one-riser descent (0.25 m) does not. */
const FALL_MARGIN = 1.0;
/** `ceilY` guard rise above a lane's highest floor + headroom. */
const CEIL_MARGIN = 1.0;
/** A segment "reached" its next waypoint when its along-advance is within this of the
 *  waypoint's projection (runWalk clean-breaks strictly PAST the target, so this is slack for
 *  the rare budget-exhausted short return). */
const REACH_MARGIN = 0.1;
/** Below one tread of along-progress ⇒ the geometry occluded the lane from the start. */
const BLOCKED_EPS = RISER; // 0.25 m
/** A drop past this (well beyond one riser + settle) is a genuine fall-through, not a step
 *  down. */
const FALL_THRESHOLD = 1.5;
/** Extra frames beyond the nominal crossing for the classification re-drive budget. */
const REDRIVE_SLACK = 120;
/** Tiny epsilon for coincident-point / floor-height comparisons. */
const EPS = 1e-6;

// ─── matrix: 3 themes × 2 verticality × 2 seeds = 12 configs ───
// The matrix and the carve region are SHARED with `scripts/measure-analyze.ts` through
// `_helpers/cave-matrix.ts` (Task 8). Neither side restates the other any more, so a matrix
// edit can no longer leave the P-F4-3b measurement quietly measuring the old twelve.
const EXTENT = CAVE_EXTENT;
const REGION = CAVE_REGION;
const CAVE = generatorById("cave");

/** Strict cave params from the schema defaults + overrides (evaluate is setup-loud). */
const fullParams = (o: Record<string, unknown>): Record<string, unknown> => ({
  ...CAVE.defaults,
  ...o,
});

/** A matrix cell plus the BAKED WORLD NAME this harness gives it (the measurement script
 *  derives its own table label from the same three axes). */
type Cfg = CaveConfig & { name: string };

const CONFIGS: Cfg[] = caveConfigs().map((c) => ({
  ...c,
  name: `cave-probe-${c.theme}-v${c.verticality}-s${c.seed}`,
}));

// ─── skeleton helpers ───
const chamberFloorY = (c: CaveChamber): number => c.center[1] - c.radii[1];

/** World-point density (nearest sample); region min is [0,0,0] so world == region-local. */
const dAt = (
  s: ReturnType<typeof createFieldStore>,
  wx: number,
  wy: number,
  wz: number,
): number =>
  getDensity(
    s,
    Math.round(wx / RISER),
    Math.round(wy / RISER),
    Math.round(wz / RISER),
  );

const coincident = (a: Vec3, b: Vec3): boolean =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < EPS;

/** Unit XZ direction a→b as a `Vec3` `[x, 0, z]`; null for a coincident (no-horizontal) pair
 *  (the mover's step-up owns a pure vertical, so such a segment is skipped). */
function horizDirTo(a: Vec3, b: Vec3): Vec3 | null {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < EPS) return null;
  return [dx / len, 0, dz / len];
}

const deepestChamberIndex = (sk: CaveSkeleton): number => {
  let best = 0;
  let bestY = Number.POSITIVE_INFINITY;
  sk.chambers.forEach((c, i) => {
    const y = chamberFloorY(c);
    if (y < bestY) {
      bestY = y;
      best = i;
    }
  });
  return best;
};

/** The mouth passage (chamber→mouth terminal) whose far end lands on mouth `mouthIdx`. */
function mouthPassageIndex(sk: CaveSkeleton, mouthIdx: number): number {
  const at = sk.mouths[mouthIdx]?.at;
  if (at === undefined) return -1;
  return sk.passages.findIndex(
    (p) =>
      p.to === -1 &&
      coincident(p.waypoints[p.waypoints.length - 1] as Vec3, at),
  );
}

/** BFS a chamber-index path `src`→`dst` over chamber-chamber passages (mouth terminals
 *  excluded); `[]` if disconnected (connectivity is guaranteed, so only a degenerate skeleton
 *  hits that). */
function chamberPath(sk: CaveSkeleton, src: number, dst: number): number[] {
  if (src === dst) return [src];
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  };
  for (const p of sk.passages)
    if (p.from >= 0 && p.to >= 0) {
      link(p.from, p.to);
      link(p.to, p.from);
    }
  const prev = new Map<number, number>();
  const seen = new Set([src]);
  const queue = [src];
  while (queue.length > 0) {
    const u = queue.shift() as number;
    if (u === dst) break;
    for (const v of adj.get(u) ?? [])
      if (!seen.has(v)) {
        seen.add(v);
        prev.set(v, u);
        queue.push(v);
      }
  }
  if (!seen.has(dst)) return [];
  const path = [dst];
  let cur = dst;
  while (cur !== src) {
    cur = prev.get(cur) as number;
    path.push(cur);
  }
  return path.reverse();
}

/** The waypoints of the passage joining chambers `u`,`v`, oriented `u`→`v`. */
function orientedWaypoints(sk: CaveSkeleton, u: number, v: number): Vec3[] {
  const p = sk.passages.find(
    (q) => (q.from === u && q.to === v) || (q.from === v && q.to === u),
  ) as CavePassage;
  const wps = p.waypoints.map((w) => [...w] as Vec3);
  return p.from === u ? wps : wps.reverse();
}

/** The composite mouth→deepest-chamber polyline: the reversed mouth passage (mouth→its
 *  nearest chamber) then the chamber-graph path to the deepest chamber, junction points
 *  de-duplicated. Null when the skeleton has no chambers/mouths or no path. */
function buildCompositePoly(sk: CaveSkeleton): Vec3[] | null {
  if (sk.chambers.length === 0 || sk.mouths.length === 0) return null;
  const mi = mouthPassageIndex(sk, 0);
  if (mi < 0) return null;
  const mp = sk.passages[mi] as CavePassage;
  const path = chamberPath(sk, mp.from, deepestChamberIndex(sk));
  if (path.length === 0) return null;
  const poly: Vec3[] = mp.waypoints.map((w) => [...w] as Vec3).reverse();
  for (let k = 0; k + 1 < path.length; k++) {
    const seg = orientedWaypoints(sk, path[k] as number, path[k + 1] as number);
    for (const w of seg) {
      const last = poly[poly.length - 1];
      if (last && coincident(last, w)) continue;
      poly.push(w);
    }
  }
  return poly;
}

// ─── classification (D-F3-11: record, never repair) ───
type FailClass =
  | "wedge"
  | "ghost-launch"
  | "fall-through"
  | "blocked"
  | "too-steep";
type LaneOutcome =
  | { walked: true }
  | { walked: false; failClass: FailClass; segment: number };

type SegCtx = { startAlong: number; startY: number; ascending: boolean };

/** A stall-family outcome (no throw): occluded-from-start vs couldn't-climb vs level-catch. */
function classifyStall(advanced: number, seg: SegCtx): FailClass {
  const progress = advanced - seg.startAlong;
  if (progress < BLOCKED_EPS) return "blocked";
  if (seg.ascending) return "too-steep";
  return "wedge";
}

/** Disambiguate a per-frame guard throw WITHOUT parsing bun's assertion text: re-drive the
 *  failing segment in `expectStop` mode (stall assert + stopAlong disabled) with loosened
 *  floor/ceil, so the ONLY hard asserts left are the hardcoded rise/horiz FLING guards. A
 *  throw there ⇒ ghost-launch; otherwise the returned trajectory tells fall-through from the
 *  stall family. */
function classifyThrow(
  ctx: gpu.Context,
  world: physics.World,
  start: Vec3,
  dir: Vec3,
  stopAlong: number,
  seg: SegCtx,
): FailClass {
  const budget =
    Math.ceil((stopAlong - seg.startAlong) / FRAME_STEP) + REDRIVE_SLACK;
  try {
    const res = runWalk(ctx, world, {
      start,
      dir,
      floorY: -1e6,
      ceilY: 1e6,
      expectStop: true,
      maxIters: budget,
    });
    if (seg.startY - res.minY > FALL_THRESHOLD) return "fall-through";
    return classifyStall(res.advanced, seg);
  } catch {
    return "ghost-launch"; // single-frame rise > 0.55 m or horiz > 0.3 m — a KCC fling
  }
}

/** Walk one polyline lane segment-by-segment, chaining the mover's position and re-aiming at
 *  each next waypoint (runWalk is single-direction). Reused VERBATIM per segment; the whole
 *  lane is wrapped so a per-frame guard throw becomes a RECORDED class, never a test failure. */
function walkLane(
  ctx: gpu.Context,
  world: physics.World,
  poly: Vec3[],
): LaneOutcome {
  const floors = poly.map((w) => w[1]);
  const floorGuard = Math.min(...floors) - FALL_MARGIN;
  const ceilGuard = Math.max(...floors) + PASSAGE_HEADROOM + CEIL_MARGIN;
  const start = at(poly, 0);
  let pos: Vec3 = [start[0], start[1] + SPAWN_ABOVE_FLOOR, start[2]];
  for (let i = 0; i + 1 < poly.length; i++) {
    const next = poly[i + 1] as Vec3;
    const dir = horizDirTo(pos, next);
    if (dir === null) continue; // pure-vertical hop — the step-up owns it
    const stopAlong = along(next, dir);
    const seg: SegCtx = {
      startAlong: along(pos, dir),
      startY: pos[1],
      ascending: (poly[i + 1] as Vec3)[1] > (poly[i] as Vec3)[1] + EPS,
    };
    try {
      const res = runWalk(ctx, world, {
        start: pos,
        dir,
        stopAlong,
        floorY: floorGuard,
        ceilY: ceilGuard,
      });
      if (res.advanced >= stopAlong - REACH_MARGIN) {
        pos = res.pos;
        continue;
      }
      // Returned without reaching and without throwing ⇒ a stall family (no fall/launch).
      return {
        walked: false,
        failClass: classifyStall(res.advanced, seg),
        segment: i,
      };
    } catch {
      return {
        walked: false,
        failClass: classifyThrow(ctx, world, pos, dir, stopAlong, seg),
        segment: i,
      };
    }
  }
  return { walked: true };
}

// ─── the quiet-lane tooth (F4 Task 8 step 1) ───
// The permanent regression tooth for the property P-F4-3b measured after the severity model was
// amended: on the ground this harness DEMONSTRABLY walks, the advisor is quiet. Premise P-F4-3
// failed at 323 candidate flags on walkable ground (default cave) / 1485 (largest local world);
// Task 7.1 rewrote `narrow` to a true sub-cell opposing-face width, Task 7.2 demoted `ledge` to
// always-`info` and added `detectPits`, and Task 7.3 re-measured 0 pit regions across all 12
// walked configs with a worst config of 3 candidates on walkable ground.
//
// WHAT A LANE PROVES, EXACTLY — read this before trusting either assertion.
// `walkLane` drives each polyline ONCE, waypoint 0 → waypoint n, and never drives it back. So:
//   - The `narrow` / `low-clearance` assertion IS a cross-check of the analyzer against the
//     mover: a candidate on a column the capsule demonstrably passed through is the analyzer
//     contradicting a walk that happened.
//   - The PIT assertion is NOT. A pit is "you can get in and not back OUT", and getting back out
//     is the one thing a single-direction walk never tests. It is a regression tooth on the
//     analyzer's own output over the walked population — it guards the measured 0, it does not
//     corroborate it against the mover.
// Both are also spine-scoped: columns are derived from the lane POLYLINE, not from the capsule's
// actual trajectory (`runWalk` returns an end pose, not a path) and not from its radius
// footprint. The mover slides and steps a little off the spine, so "the capsule stood on exactly
// these columns" is an approximation — a close one, since every segment is driven straight at
// the next waypoint.

/** Height above a lane waypoint the column probe starts its descent from: the capsule's own
 *  grounded centre. Any point inside the passage air would do — the probe snaps DOWN exactly as
 *  the analyzer's `seedAnchor` does — but this is the height the walk itself spawns at. */
const LANE_PROBE_RISE = REST_OFFSET;
/** Spacing (m) at which a lane segment is sampled for its floor columns: half a cell, so
 *  consecutive samples land in the same or an adjacent column and no column ON the spine is
 *  stepped over. */
const LANE_SAMPLE_M = RISER / 2;

/** Rock at (x,y,z). `getDensity < 0` is the `collider.ts` predicate AND — with no placement
 *  colliders in this harness, so no `extraSolid` — exactly what the analyzer's own `isSolid`
 *  reads. Unallocated chunks read SOLID; `getDensity` applies that rule itself. */
const solidAt = (s: FieldStore, x: number, y: number, z: number): boolean =>
  getDensity(s, x, y, z) < 0;

/** The floor column a world point stands over, as the analyzer's own `x,y,z` cell key —
 *  `seedAnchor`'s rule: refuse a point buried in rock, else descend to the first air cell
 *  sitting on rock. The descent terminates on the data (unallocated space reads SOLID). */
function columnKeyAt(store: FieldStore, p: Vec3): string | undefined {
  const x = worldToVoxel(p[0], store.cellSize);
  const z = worldToVoxel(p[2], store.cellSize);
  let y = worldToVoxel(p[1], store.cellSize);
  if (solidAt(store, x, y, z)) return undefined;
  while (!solidAt(store, x, y - 1, z)) y--;
  return `${x},${y},${z}`;
}

/** The columns under a set of lane polylines, plus the coverage the derivation did NOT get. */
type LaneColumns = {
  /** `x,y,z` keys — what the assertions test flag anchors against. */
  keys: Set<string>;
  /** The chunks those columns live in, for the pit containment test. */
  chunks: Set<ChunkKey>;
  samples: number;
  /** Samples whose probe point was inside rock, so no column was derived. Reported rather than
   *  hidden: they are lane geometry the assertions below say nothing about. */
  buried: number;
};

function laneColumns(
  store: FieldStore,
  polys: readonly (readonly Vec3[])[],
): LaneColumns {
  const keys = new Set<string>();
  const chunks = new Set<ChunkKey>();
  let samples = 0;
  let buried = 0;
  for (const poly of polys)
    for (let i = 0; i + 1 < poly.length; i++) {
      const a = at(poly, i);
      const b = at(poly, i + 1);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const steps = Math.max(1, Math.ceil(len / LANE_SAMPLE_M));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        samples++;
        const key = columnKeyAt(store, [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t + LANE_PROBE_RISE,
          a[2] + (b[2] - a[2]) * t,
        ]);
        if (key === undefined) {
          buried++;
          continue;
        }
        keys.add(key);
        const [cx, cy, cz] = key.split(",").map(Number) as Vec3;
        chunks.add(chunkKey(voxelChunk(cx), voxelChunk(cy), voxelChunk(cz)));
      }
    }
  return { keys, chunks, samples, buried };
}

/** What one config's analysis found, split by whether it lands on walked ground. */
type Quiet = {
  walkedLanes: number;
  totalLanes: number;
  lane: LaneColumns;
  /** Pit regions in the whole config — recorded, not asserted. */
  pits: number;
  /** Pit regions whose chunk span meets a lane chunk. This is a SOUND over-approximation of
   *  "a region containing a lane column": containment implies chunk overlap, so zero here proves
   *  zero containment. It can fire on a region that merely shares a 4 m chunk with a lane and
   *  holds no lane column at all — over-strict in the miss-safe direction, and it costs nothing
   *  today because the walked configs produce no pit regions whatsoever. A pit flag carries its
   *  anchor, its size and its chunk span, but not its member columns, so this is the tightest
   *  containment test the public flag shape supports without re-deriving the flood. */
  pitsOnLaneChunks: number;
  /** `narrow` / `low-clearance` candidates anchored ON a lane column — the asserted zero. */
  onLane: FieldFlag[];
  /** Candidates elsewhere, after the reachability demotion (`unreachable !== true`). Recorded
   *  only: off-lane geometry is terrain this harness never walked, so a flag there is not a
   *  contradiction of anything. */
  offLaneVisible: number;
  /** The same count before the demotion, so a low visible number cannot be flattered by a flood
   *  that never left the spawn chamber. */
  offLaneRaw: number;
};

/** Run the full advisor over a config's store — column pass, reachability demotion, pit
 *  detection — seeded from the SAME `playerStart` this harness bakes, and split what it finds by
 *  the walked lanes. Pure CPU: it reads the store the bake was taken from and mutates nothing
 *  but the flag objects `markUnreachable` owns. */
function measureQuietLanes(
  store: FieldStore,
  spawn: Vec3,
  walkedPolys: readonly (readonly Vec3[])[],
  totalLanes: number,
): Quiet {
  const lane = laneColumns(store, walkedPolys);
  const byChunk = analyzeWorld(store, AGENT);
  markUnreachable(store, AGENT, byChunk, [spawn]);
  const pits = detectPits(store, AGENT, [spawn]);

  const onLane: FieldFlag[] = [];
  let offLaneVisible = 0;
  let offLaneRaw = 0;
  for (const list of byChunk.values())
    for (const f of list) {
      if (f.severity !== "candidate") continue;
      if (lane.keys.has(`${f.cell[0]},${f.cell[1]},${f.cell[2]}`)) {
        onLane.push(f);
        continue;
      }
      offLaneRaw++;
      if (f.unreachable !== true) offLaneVisible++;
    }
  return {
    walkedLanes: walkedPolys.length,
    totalLanes,
    lane,
    pits: pits.length,
    pitsOnLaneChunks: pits.filter((p) =>
      (p.chunks ?? [p.chunk]).some((c) => lane.chunks.has(c)),
    ).length,
    onLane,
    offLaneVisible,
    offLaneRaw,
  };
}

// ─── per-config bake -> load -> walk (mirrors field-world.gpu.test.ts) ───
type LaneRec = {
  cfg: Cfg;
  kind: "passage" | "composite";
  index: number;
  /** The polyline this lane was driven along — the tooth derives its columns from it. */
  poly: Vec3[];
  outcome: LaneOutcome;
};

/** The `playerStart` a config bakes: chamber 0's floor, one grounded capsule-rest above it.
 *  ONE expression, read by both the bake and the advisor seeds, so the walk and the analysis
 *  cannot start from different places. */
const spawnOf = (sk: CaveSkeleton): Vec3 => {
  const c0 = sk.chambers[0] as CaveChamber;
  return [c0.center[0], chamberFloorY(c0) + REST_OFFSET, c0.center[2]];
};

/** Bake a config's cave, load it through the REAL `loadWorld` (per-chunk shell voxel
 *  colliders), and run `body` against the loaded world + skeleton — restoring fetch and
 *  tearing down the GPU/physics resources afterwards. `body` also gets the CARVED store, which
 *  the bake only read: the tooth analyses exactly the field that was walked. */
async function withLoadedCave<T>(
  cfg: Cfg,
  body: (
    ctx: gpu.Context,
    world: physics.World,
    sk: CaveSkeleton,
    store: FieldStore,
  ) => T,
): Promise<T> {
  const store = createFieldStore();
  const log = createOpLog();
  commitGenerator(store, log, CAVE, {
    params: cfg.params,
    seed: cfg.seed,
    region: REGION,
    policy: "replace",
    table: BUILTIN_TABLE,
  });
  const sk = buildCaveSkeleton(cfg.params, cfg.seed, EXTENT);
  const files = bakeFieldWorld(store, log, BUILTIN_TABLE, {
    name: cfg.name,
    playerStart: spawnOf(sk),
    playerYaw: 0,
  });

  const canvas = await makeOffscreenCanvas();
  const ctx = await gpu.requestContext(canvas, { surfaceFormat: "linear" });
  const world = await physics.createWorld(ctx, { gravity: [0, -9.81, 0] });
  const matCache = new MaterialCache(ctx);
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = bakedFetchStub(files, cfg.name);
    const loaded = await loadWorld(ctx, world, matCache);
    globalThis.fetch = orig; // walks cast against the world; no more fetches
    try {
      return body(ctx, world, sk, store);
    } finally {
      loaded.destroy();
    }
  } finally {
    globalThis.fetch = orig;
    matCache.destroy();
    physics.destroyWorld(ctx, world);
    gpu.dispose(ctx);
  }
}

type ConfigRun = { records: LaneRec[]; quiet: Quiet };

const walkConfig = (cfg: Cfg): Promise<ConfigRun> =>
  withLoadedCave(cfg, (ctx, world, sk, store) => {
    const composite = buildCompositePoly(sk);
    const records: LaneRec[] = sk.passages.map((p, index) => {
      const poly = p.waypoints.map((w) => [...w] as Vec3);
      return {
        cfg,
        kind: "passage",
        index,
        poly,
        outcome: walkLane(ctx, world, poly),
      };
    });
    if (composite !== null && composite.length >= 2)
      records.push({
        cfg,
        kind: "composite",
        index: 0,
        poly: composite,
        outcome: walkLane(ctx, world, composite),
      });
    // ONLY the lanes that walked end to end. A lane that stalled proves nothing about the
    // ground past its stall, and the analyzer flagging geometry the mover could not traverse
    // is correct behaviour rather than the defect this tooth guards.
    const walkedPolys = records
      .filter((r) => r.outcome.walked)
      .map((r) => r.poly);
    return {
      records,
      quiet: measureQuietLanes(store, spawnOf(sk), walkedPolys, records.length),
    };
  });

// ─── report rendering (the committed deliverable — F4's analyzer corpus) ───
const REPORT_PATH = new URL(
  "../../../docs/research/2026-07-23-f3b-p-f3-1-stepped-floor-probe.md",
  import.meta.url,
).pathname;

const FAIL_CLASSES: FailClass[] = [
  "wedge",
  "ghost-launch",
  "fall-through",
  "blocked",
  "too-steep",
];

const DISPOSITIONS: Record<FailClass, string> = {
  wedge:
    "manual massage (widen the pinch) OR F4 traversal verbs — a mid-passage horizontal catch, not a floor-grade problem.",
  "ghost-launch":
    "collider-bake edge classification (the internal-edge ghost class, explicitly outside the analyzer per the walkability-analyzer entry) — NOT a Task-3 default.",
  "fall-through":
    "manual massage / F4 spawn+reachability validation — a void the capsule dropped into, not a grade the risers failed to carry.",
  blocked:
    "F4 traversal verbs / manual massage — geometry occludes the straight spine; a winding sub-tube the KCC will not thread.",
  "too-steep":
    "Task-3 DEFAULT tuning candidate (MAX_GRADE / verticality profile) — the risers were too steep for the mover at this config. Report to the controller; do NOT tune here.",
};

/** The quiet-lane section: one row per config, plus the scope statement that says what the
 *  numbers do and do not establish. */
function renderQuietSection(quiets: readonly QuietRec[]): string {
  const rows = quiets
    .map(({ cfg, quiet: q }) => {
      const cols = q.lane.keys.size;
      const buried =
        q.lane.buried === 0 ? "0" : `${q.lane.buried}/${q.lane.samples}`;
      return `| ${cfg.theme} | ${cfg.verticality} | ${cfg.seed} | ${q.walkedLanes}/${q.totalLanes} | ${cols} | ${buried} | ${q.pits} | ${q.pitsOnLaneChunks} | ${q.onLane.length} | ${q.offLaneVisible} (${q.offLaneRaw}) |`;
    })
    .join("\n");

  const totalPits = quiets.reduce((n, q) => n + q.quiet.pits, 0);
  const totalOnLane = quiets.reduce((n, q) => n + q.quiet.onLane.length, 0);
  const offLane = quiets.map((q) => q.quiet.offLaneVisible);
  const worstOffLane = Math.max(...offLane);

  return `## Quiet-lane tooth (F4 Task 8)

After every config is walked, the FULL advisor runs on the same carved store — column pass,
\`markUnreachable\`, \`detectPits\` — seeded from the \`playerStart\` this harness bakes. Two
things assert, one is recorded:

- **(a)** no pit region meets a walked lane. Tested at CHUNK granularity: a pit flag carries its
  anchor, its size in columns and its chunk span, but not its member columns, so "region ∩ lane
  ≠ ∅" is over-approximated by "region's chunks ∩ lane's chunks ≠ ∅". Containment implies chunk
  overlap, so a zero here PROVES zero containment; the converse does not hold, which makes the
  test over-strict in the miss-safe direction.
- **(b)** no \`narrow\` / \`low-clearance\` candidate anchors on a walked-lane column.
- **(c)** off-lane candidates are counted, never asserted — that ground was not walked.

**What a lane proves.** Each lane is driven ONCE, first waypoint to last, and never driven back
(\`walkLane\` chains single-direction segments). So (b) is a real cross-check of the analyzer
against the mover: a candidate on a column the capsule passed through contradicts a walk that
happened. **(a) is not.** A pit means "you can get in and not back OUT", and getting back out is
precisely what a single-direction walk never tests — so the pit assertion guards the measured
zero against regression, it does not corroborate it against the mover. Columns are derived from
the lane POLYLINE (sampled at half-cell spacing and snapped down to the floor anchor), not from
the capsule's recorded trajectory — \`runWalk\` returns an end pose, not a path — and not widened
by the capsule radius. The \`buried\` column counts probe points that landed inside rock, where no
column could be derived: those samples are lane geometry these assertions say nothing about.

| theme | verticality | seed | lanes walked | lane columns | buried | pit regions | pits ∩ lane chunks | on-lane candidates | off-lane candidates (raw) |
|---|---|---|---|---|---|---|---|---|---|
${rows}

${totalPits} pit region(s) across the whole matrix, ${totalOnLane} candidate(s) on walked-lane
columns. Off-lane candidates after the reachability demotion run ${Math.min(...offLane)}–${worstOffLane} per config
(the parenthesised number is the same count before the demotion, so a flood that never left the
spawn chamber cannot flatter it).

Do NOT read that off-lane column against P-F4-3b's "candidates on walkable ground" (0–3, worst
config 3). It is a WIDER population: this column counts every candidate whose anchor is not a
lane column, while that measurement additionally required the anchor to be STANDABLE — which
excludes every \`low-clearance\` flag by construction, since that kind anchors on the offending
neighbour, a cell that failed the walkable test. Re-deriving standability here would be a second
copy of a predicate that is not exported; (c) is recorded rather than asserted, so it does not
need one.

The raw off-lane column IS directly comparable to that measurement's own \`(raw)\` column, and on
this run the twelve values agree exactly — which only holds while the on-lane count is zero, so
treat the agreement as a cross-check between two independent code paths rather than an identity.
`;
}

type QuietRec = { cfg: Cfg; quiet: Quiet };

function renderReport(records: LaneRec[], quiets: readonly QuietRec[]): string {
  const counts: Record<FailClass, number> = {
    wedge: 0,
    "ghost-launch": 0,
    "fall-through": 0,
    blocked: 0,
    "too-steep": 0,
  };
  const firstRepro: Partial<Record<FailClass, LaneRec>> = {};
  for (const r of records)
    if (!r.outcome.walked) {
      counts[r.outcome.failClass]++;
      firstRepro[r.outcome.failClass] ??= r;
    }

  const passageLanes = records.filter((r) => r.kind === "passage");
  const passageWalked = passageLanes.filter((r) => r.outcome.walked).length;
  const composites = records.filter((r) => r.kind === "composite");
  const compositeWalked = composites.filter((r) => r.outcome.walked).length;

  const matrixRows = CONFIGS.map((cfg) => {
    const mine = records.filter((r) => r.cfg.name === cfg.name);
    const p = mine.filter((r) => r.kind === "passage");
    const pw = p.filter((r) => r.outcome.walked).length;
    const comp = mine.find((r) => r.kind === "composite");
    const compTxt = comp
      ? comp.outcome.walked
        ? "yes"
        : `no (${(comp.outcome as { failClass: FailClass }).failClass})`
      : "n/a";
    return `| ${cfg.theme} | ${cfg.verticality} | ${cfg.seed} | ${pw}/${p.length} | ${compTxt} |`;
  }).join("\n");

  const classRows = FAIL_CLASSES.map((k) => {
    const repro = firstRepro[k];
    const reproTxt = repro
      ? `seed ${repro.cfg.seed}, ${repro.cfg.theme}, v${repro.cfg.verticality}, ${repro.kind} lane ${repro.index}, segment ${(repro.outcome as { segment: number }).segment}`
      : "—";
    return `| \`${k}\` | ${counts[k]} | ${reproTxt} |`;
  }).join("\n");

  const present = FAIL_CLASSES.filter((k) => counts[k] > 0);
  const envelope =
    `SN-skinned 0.25 m risers carry the capsule in ${passageWalked}/${passageLanes.length} ` +
    `per-passage lanes and ${compositeWalked}/${composites.length} composite mouth→deepest ` +
    `lanes across the ${CONFIGS.length}-config matrix. ` +
    (present.length === 0
      ? "Every lane walked cleanly — the strong-envelope outcome: the stepped-floor premise (P-F3-1) holds unconditionally on this matrix."
      : `Failure classes present: ${present.map((k) => `\`${k}\``).join(", ")}.`);

  const dispositionRows = present.length
    ? present
        .map((k) => `- **\`${k}\`** (${counts[k]}): ${DISPOSITIONS[k]}`)
        .join("\n")
    : "- None — no lane failed, so nothing is routed. The premise holds.";

  return `# F3b P-F3-1 probe — the stepped-floor capsule fuzz-walk

**GENERATED — \`packages/dungeon/tests/field-cave-walk.gpu.test.ts\` rewrites this file whole on
every full test run. Hand edits to it are overwritten; edit the report template in that test
instead.** The filename's 2026-07-23 is the day this doc first fed the F3b decision; the figures
below are from the CURRENT suite, re-derived on the run that last wrote the file.

*Generated by \`packages/dungeon/tests/field-cave-walk.gpu.test.ts\` (F3b Task 4). A COMMITTED
deliverable feeding F4's analyzer corpus. Per D-F3-11 this probe RECORDS failure classes — it
does not repair them; there is no search / retry / repair loop.*

## What this measures (P-F3-1)

Do the cave generator's SN-skinned, quantized **0.25 m stepped floors carry the walk capsule**
(\`{halfHeight:0.6, radius:0.3}\`)? Each config is carved into a field store, baked (v2 field
artifact), loaded through the REAL \`loadWorld\` (per-chunk shell voxel colliders — the same
collision the game uses), and walked with the real \`CharacterMover\` via \`runWalk\`. Lanes are
derived from the skeleton: one per passage (walked waypoint-to-waypoint) plus one composite
mouth→deepest-chamber lane per config. The mover's built-in step-up is the riser test;
\`MAX_FRAME_RISE\` 0.55 m is the ghost-launch guard.

**Premise gate:** \`STEP_HEIGHT\` = ${STEP_HEIGHT} m ≥ one riser (${RISER} m) + skin margin
(${SKIN_MARGIN} m) = ${(RISER + SKIN_MARGIN).toFixed(2)} m. The stepped-floor premise is
TESTABLE (a single riser fits under the mover's step-up).

## Config matrix

Fixed: extent ${EXTENT.join("×")} m, 3 chambers, radius 5 m, 1 extra loop, north mouth.

**Topology note (F4: do NOT over-count diversity).** \`theme\` selects only the SN carve SKIN —
it never reaches \`buildCaveSkeleton\`, so these 12 configs are **4 distinct passage LAYOUTS**
(2 verticality × 2 seeds) × 3 carve skins. For a given (verticality, seed) the walk LANES are
identical across themes; only the carved collider surface differs. So the 48 passage walks
cover 4 topologies, not 12 — the theme axis probes skin-vs-collision, not layout.

| theme | verticality | seed | passages walked | composite walked |
|---|---|---|---|---|
${matrixRows}

## Per-class failure counts (all ${records.length} lanes)

| class | count | first reproduction (seed · theme · verticality · lane · segment) |
|---|---|---|
${classRows}

## Envelope statement

${envelope}

## Systemic-collapse tripwire

Composite mouth→deepest lanes walked on **${compositeWalked} of ${composites.length}** configs
(threshold: ≥ ${Math.ceil(CONFIGS.length / 2)} = half). ${
    compositeWalked >= Math.ceil(CONFIGS.length / 2)
      ? "Above the tripwire — no systemic collapse; the stepped floors carry the through-lane."
      : "**BELOW the tripwire — SYSTEMIC COLLAPSE.** Per D-F3-11 the only permitted response is to tune Task 3's MAX_GRADE / verticality profile DEFAULTS (the controller's call), never to add repair/search here."
  }

## Dispositions (D-F3-11)

Failure classes are routed, never repaired in this task:

${dispositionRows}

${renderQuietSection(quiets)}
## Reproduction

\`bun test packages/dungeon/tests/field-cave-walk.gpu.test.ts\` regenerates this report from the
actual run (the cave is Pr-2-deterministic and the walk is deterministic, so the numbers are
stable). Each row's reproduction recipe names the seed, theme, verticality, lane, and segment
that first exhibits the class.

**Fed:** the F3b stepped-floor decision, cited by name in \`docs/learnings/seals/2026-07-25-epic3-f3b-cave-and-entities.md\`.
`;
}

// ─── the probe ───
describe("field cave walk — P-F3-1 stepped-floor probe", () => {
  test("premise gate: STEP_HEIGHT clears one riser + skin margin", () => {
    // If this fails the stepped-floor premise is UNTESTABLE (one riser won't fit under the
    // step-up) — that is a finding to report, not something to fudge. It holds: 0.4 ≥ 0.30.
    expect(STEP_HEIGHT).toBeGreaterThanOrEqual(RISER + SKIN_MARGIN);
  });

  test("fixture validity: a default cave carves air chambers inside rock", () => {
    // The F0 lesson — a probe over a broken fixture reports garbage. Re-run Task 3's carved-
    // output shape (air at chamber centres, rock present) against THIS fixture build.
    const store = createFieldStore();
    const log = createOpLog();
    const params = fullParams({});
    commitGenerator(store, log, CAVE, {
      params,
      seed: 1,
      region: REGION,
      policy: "replace",
      table: BUILTIN_TABLE,
    });
    const sk = buildCaveSkeleton(params, 1, EXTENT);
    for (const c of sk.chambers) {
      const fy = chamberFloorY(c);
      expect(dAt(store, c.center[0], fy + 1.0, c.center[2])).toBeGreaterThan(0);
    }
    // Sample bounds are the region in SAMPLES (world / RISER), derived so they track EXTENT.
    const [nx, ny, nz] = EXTENT.map((e) => Math.round(e / RISER)) as [
      number,
      number,
      number,
    ];
    const SCAN_STRIDE = 8; // coarse subsample — an air/rock census, not an exhaustive scan
    let rock = 0;
    let total = 0;
    for (let sx = 1; sx < nx; sx += SCAN_STRIDE)
      for (let sy = 1; sy < ny; sy += SCAN_STRIDE)
        for (let sz = 1; sz < nz; sz += SCAN_STRIDE) {
          total++;
          if (getDensity(store, sx, sy, sz) < 0) rock++;
        }
    expect(rock).toBeGreaterThan(0); // rock exists (teeth: an empty store trips this)
    expect(rock).toBeLessThan(total); // and air exists — a real cave, not a solid block
  });

  test.skipIf(!bunWebGpuAvailable())(
    "classifier teeth + no-leak invariant: an into-rock lane is RECORDED walked:false, and a clean lane on the SAME world still walks",
    async () => {
      // Proves two things the clean matrix never exercises: (1) the catch→classifyThrow→bucket
      // path actually runs (an unwalkable lane is recorded, not silently passed), and (2)
      // `runWalk` does NOT leak its capsule on throw — a leaked phantom would block the clean
      // lane driven next on the SAME world. Sabotage-verified: reverting runWalk's finally
      // turns the clean-lane assertion RED (the phantom blocks the mouth spawn).
      const cfg: Cfg = {
        theme: "mined",
        verticality: 0.75,
        seed: 1,
        name: "cave-probe-teeth",
        params: fullParams({ theme: "mined", verticality: 0.75 }),
      };
      await withLoadedCave(cfg, (ctx, world, sk) => {
        const composite = buildCompositePoly(sk);
        expect(composite).not.toBeNull();

        // Throwing lane: from the mouth, straight OUTWARD (away from the region centre) into
        // the boundary rock — the mover cannot advance, so a per-frame guard throws and the
        // classifier buckets it. This leaves a phantom AT the mouth without the finally.
        const mouth = (sk.mouths[0] as CaveMouth).at;
        const ox = mouth[0] - EXTENT[0] / 2;
        const oz = mouth[2] - EXTENT[2] / 2;
        const olen = Math.sqrt(ox * ox + oz * oz) || 1;
        const outward: Vec3 = [
          mouth[0] + (ox / olen) * 5,
          mouth[1],
          mouth[2] + (oz / olen) * 5,
        ];
        const thrown = walkLane(ctx, world, [mouth, outward]);
        expect(thrown.walked).toBe(false);
        if (!thrown.walked) expect(FAIL_CLASSES).toContain(thrown.failClass);

        // Clean lane on the SAME world: the composite (spawns at the mouth). It walks with the
        // finally in place; it is BLOCKED by the leaked phantom without it — this assertion is
        // the leak guard.
        const clean = walkLane(ctx, world, composite as Vec3[]);
        expect(clean.walked).toBe(true);
      });
    },
    60_000,
  );

  test.skipIf(!bunWebGpuAvailable())(
    "stepped-floor capsule fuzz-walk matrix (walk = deliverable; quiet-lane tooth = blocker)",
    async () => {
      const records: LaneRec[] = [];
      const quiets: QuietRec[] = [];
      for (const cfg of CONFIGS) {
        const run = await walkConfig(cfg);
        records.push(...run.records);
        quiets.push({ cfg, quiet: run.quiet });
      }

      // Write the committed report FIRST — it must exist even if the tripwire fires below.
      const report = renderReport(records, quiets);
      await Bun.write(REPORT_PATH, report);

      // (c) the report file is written.
      expect(await Bun.file(REPORT_PATH).exists()).toBe(true);

      // (b) THE TRIPWIRE — the composite mouth→deepest lane walks on >= half the configs.
      // Below half is systemic collapse: the ONLY response is the controller tuning Task 3's
      // profile/grade DEFAULTS (never repair/search here). Individual lane failures above are
      // DATA, recorded in the report, deliberately NOT asserted.
      const composites = records.filter((r) => r.kind === "composite");
      const compositeWalked = composites.filter((r) => r.outcome.walked).length;
      expect(compositeWalked).toBeGreaterThanOrEqual(
        Math.ceil(CONFIGS.length / 2),
      );

      // THE QUIET-LANE TOOTH. Asserted last because the two above are the probe's own contract;
      // these guard the AMENDED severity model (Task 7.1/7.2) against regression.
      // Every assertion is spelled as a LABELLED string so a failure names the config it came
      // from — 12 configs share this loop and `expect` carries no message argument.
      for (const { cfg, quiet } of quiets) {
        // Non-vacuity FIRST: over an empty column set both assertions below pass for free, so a
        // derivation that silently stopped resolving columns would read as a clean bill.
        expect(`${cfg.name}: ${quiet.lane.keys.size} lane columns`).not.toBe(
          `${cfg.name}: 0 lane columns`,
        );
        // (a) No pit region meets a walked lane — chunk-granular, a sound over-approximation of
        // containment (see `Quiet.pitsOnLaneChunks`). Single-direction walks do NOT corroborate
        // this; it guards the measured zero against regression.
        expect(
          `${cfg.name}: ${quiet.pitsOnLaneChunks} of ${quiet.pits} pit regions meet a lane chunk`,
        ).toBe(`${cfg.name}: 0 of ${quiet.pits} pit regions meet a lane chunk`);
        // (b) No `narrow` / `low-clearance` candidate on a column the capsule walked through.
        // THIS one is a genuine cross-check: such a flag contradicts a walk that happened.
        const onLane = quiet.onLane.map((f) => `${f.kind}@${f.cell.join(",")}`);
        expect(
          `${cfg.name}: ${onLane.length} on-lane candidates [${onLane.join(" ")}]`,
        ).toBe(`${cfg.name}: 0 on-lane candidates []`);
      }
    },
    300_000, // the 12-config × ~260-lane matrix runs the real mover headlessly — well over 5 s
  );
});
