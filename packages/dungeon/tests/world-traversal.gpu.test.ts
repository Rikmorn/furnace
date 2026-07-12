// W3 Task 10 — THE PHASE-GATE PROBE. `DEFAULT_WORLD` is the world the PLAYER boots, so this is
// the end-to-end acceptance walk over the committed default: the FULL collider set, built exactly
// as the game builds it (`loadWorld` against an IN-MEMORY bake, NOT a hand-picked subset — the
// 2.2.1 lesson: subset repros hide the seam wedge). WALK-IN, not drop-in: dropping a capsule rests
// it on top and hides a wedge, so every lane drives the real `CharacterMover`. The shared drive
// loop + world-loading fixture live in `_helpers/walk-fixture.ts`; the lanes below are
// gate-world-specific.
//
// What the gate world composes — FOUR regions (both region classes, BOTH grid vocabularies) joined
// by all three BUILT connector kinds:
//   hall-a (grid-built `hall`, pillarHall preset — the spawn)
//       --corridor-1 (stair flight, +1.5 m)--> maze-1 (grid-built `maze`, 4x4 cells, braid 0.15)
//   maze-1 --bore-1 (collar-bore)--> cave-c (field-organic)
//   maze-1 --aperture-1 (a pure, flush hole)--> hall-b (grid-built `hall`, boxRoom preset)
// W3's claim is "ONE pipeline, TWO grid vocabularies". These lanes are what makes that real: the
// maze is walked as a REGION (every seam in and out of it) and as an INTERIOR (lane (g) BFS-solves
// its passage graph from the stamp and walks the actual solution path leg by leg).
//
// Geometry (measured off the baked manifest — the lanes below DERIVE it at runtime, never hard-code
// it; these numbers are here to read the file by):
//   corridor-1 .a = hall-a north door [3, 0, 9] facing [0,0,1]  .b = maze-1 south door [3, 1.5, 15]
//   bore-1     .a = maze-1 east door [9.5, 1.5, 21.5] f [1,0,0] .b = cave-c mouth   [17.5, 1.5, 21.5]
//   aperture-1 .a = maze-1 west door [-1, 1.5, 21.5] f [-1,0,0] .b = hall-b east door, COINCIDENT
// The baked spawn [3, 1.1, 7] sits 2 m inward of hall-a's NORTH door — i.e. on the corridor axis —
// so lane (a) (the game's opening walk) starts from it, while every other lane builds its own start
// on its own connector's axis.
//
// Lanes break EARLY inside the target region rather than driving to its far wall: walking into a far
// wall reads as a wedge and would false-trip runWalk's no-stall guard. Breaking inside keeps that
// guard ARMED across the whole seam, which is this probe's primary wedge detector. That is why the
// three BREAK_INSIDE_* constants below exist, and why each is sized by its TARGET's interior depth.
//
// All lanes are ON-AXIS by design. Off-centre lanes into the organic cave interior trip the
// ghost-launch guard on a known cave-floor undulation — the tracked voxel-KCC-on-organic-terrain
// class, NOT a seam defect (see docs/backlog/dungeon/organic-cave-mouth-offaxis-rimride.md; the
// off-axis carve/bore seam itself is covered on-axis-adjacent by collar-bore.gpu.test.ts). Each lane
// runs in its OWN freshly-loaded world: the hall + cave dressing is shovable, so a shared world
// would let one lane displace obstacles for the next and mask that lane's real path.
import { expect, test } from "bun:test";
import type { WorldManifest } from "../src/bake.ts";
import type { Connection, Vec3 } from "../src/region.ts";
import { AIR, coarseGet } from "../src/substrate/grid.ts";
import { type MazeParams, maze } from "../src/themes/maze.ts";
import { DEFAULT_WORLD } from "../src/world-spec.ts";
import { bunWebGpuAvailable, ensureBunWebGpu } from "./_helpers/gpu-fixture.ts";
import {
  along,
  REST_OFFSET,
  runWalk,
  SPAWN_RISE,
  WALL_HUG_ITERS,
  withLoadedWorld,
} from "./_helpers/walk-fixture.ts";

await ensureBunWebGpu();

/** How far past a target's door/mouth plane (m) a lane must advance to count as having ENTERED it.
 *  2 m is one 0.5 m shell crossing plus a capsule's length of real interior beyond it, so a capsule
 *  merely WEDGED in the opening cannot satisfy this bar. Only lanes whose target has ≥ 2 m of
 *  interior on the far side of the door can use it — the maze-bound lanes cannot (see BREAK_INSIDE). */
const ENTERED = 2;

/** Where a MAZE-bound lane breaks early (m past the door plane). NOT a free parameter: a maze door
 *  opens onto exactly ONE passage block, `PASSAGE_CELLS` (4) × `CELL` (0.5 m) = 2.0 m deep (maze.ts).
 *  A lane driven the full `ENTERED` = 2 m would end ON that block's far wall and legitimately stall —
 *  reading as a wedge and false-tripping the no-stall guard. 1.5 m stops the capsule (radius 0.3)
 *  clear of it, still a full shell-crossing past the door plane. This is why the two maze-bound bars
 *  below assert against `stopAlong` and not against `ENTERED`. */
const BREAK_INSIDE = 1.5;
/** Where a HALL-bound lane breaks early (m past the door plane). hall-b is the boxRoom preset — only
 *  ~4 m of interior past its door plane — so the same far-wall/false-wedge risk applies, just further
 *  out; 2.5 m clears `ENTERED` (2 m) with margin and still stops well short of the far wall. */
const BREAK_INSIDE_HALL = 2.5;
/** How far a bore lane drives past the cave MOUTH (m). The cave is deep, so there is no far-wall risk
 *  here: this one is sized "well past the collar and into open cave", not by a wall. */
const BREAK_INSIDE_CAVE = 4;
/** Tolerance (m) around the nominal rest height (`floor + REST_OFFSET`) when asserting WHICH floor the
 *  capsule ended on. hall-a's floor and maze-1's are 1.5 m apart (the stair rise), so any tolerance
 *  under 0.75 m keeps the "stood high" and "stood low" bars DISJOINT: a capsule that never climbed
 *  cannot satisfy the high bar, and one still up top cannot satisfy the low bar. 0.4 m has margin on
 *  both sides of that ceiling. */
const REST_TOL = 0.4;
/** How far inward of a door a lane that cannot use the baked spawn starts (m). It must stay inside the
 *  door's dressing-free walk lane (`DOOR_LANE_DEPTH` = 3.0 m, grid-stamp.ts), so a start is never placed
 *  inside a crate or rubble instance; 2 m is comfortably within it. `startBeyond` uses the same depth on
 *  the FAR side of a portal. */
const INWARD_START = 2;

/** One named connector's two placed portals + its axis, from the baked manifest. `a` is the portal on
 *  the connector's A-end region (facing OUTWARD toward the far end), `b` the far portal; `dir = a.facing`
 *  is the cardinal axis pointing a → b. Looked up BY ID: the gate world has THREE connectors, so index 0
 *  is not a contract. */
function portalsOf(
  manifest: WorldManifest,
  id: string,
): { a: Connection; b: Connection; dir: Vec3 } {
  const c = manifest.connectors.find((k) => k.id === id);
  if (!c) throw new Error(`world-traversal: manifest has no connector ${id}`);
  return { a: c.a, b: c.b, dir: [c.a.facing[0], c.a.facing[1], c.a.facing[2]] };
}

/** A start `INWARD_START` m INSIDE the region a portal belongs to, at rest height: step BACK along the
 *  portal's OUTWARD facing (hence `-dir`). Used by every lane the baked spawn does not serve. */
function startInwardOf(portal: Connection, dir: Vec3): Vec3 {
  return [
    portal.position[0] - dir[0] * INWARD_START,
    portal.position[1] + REST_OFFSET + SPAWN_RISE,
    portal.position[2] - dir[2] * INWARD_START,
  ];
}

/** A start `INWARD_START` m PAST a portal — inside the region on its FAR side — at rest height. The
 *  mirror of {@link startInwardOf}; every reverse lane starts here. */
function startBeyond(portal: Connection, dir: Vec3): Vec3 {
  return [
    portal.position[0] + dir[0] * INWARD_START,
    portal.position[1] + REST_OFFSET + SPAWN_RISE,
    portal.position[2] + dir[2] * INWARD_START,
  ];
}

/** The a→b axis flipped to b→a: what every reverse lane walks along. */
const reverse = (dir: Vec3): Vec3 => [-dir[0], -dir[1], -dir[2]];

/** The gate world's maze region entry (params + seed + placement) off the manifest. Lane (g) needs the
 *  maze's own STAMP inputs to rebuild its passage graph, and the manifest is where the baked world
 *  publishes them — so the probe reads the same `params`/`seed` the LOADER re-expands from, not a
 *  hand-copied duplicate that could drift from the committed spec. */
function mazeEntryOf(manifest: WorldManifest): {
  params: MazeParams;
  seed: string;
  translation: Vec3;
} {
  const r = manifest.regions.find((x) => x.id === "maze-1");
  if (!r || r.class !== "grid-built" || r.algorithm !== "maze") {
    throw new Error("world-traversal: maze-1 entry missing");
  }
  return {
    params: r.params,
    seed: r.seed,
    translation: r.placement.translation,
  };
}

/** Passage adjacency rebuilt from the maze STAMP: two lattice-adjacent maze cells connect iff the wall
 *  band between their passage blocks is AIR at the walk layer (j = 1, the first interior layer above
 *  the floor). Reads the PUBLIC stamp output only — it never imports the carve plan — so lane (g) walks
 *  the maze the SHELL actually has, not the one the planner intended. (A carve-plan-driven graph would
 *  agree with a stamper that mis-rasterized its own plan; this one cannot.)
 *
 *  THE LATTICE LITERALS ARE NOT FREE PARAMETERS — they mirror `maze.ts`'s stamp geometry exactly:
 *  maze cell (a, b) owns the 4×4 (`PASSAGE_CELLS`) coarse block whose corner is (1 + 5a, 1 + 5b) —
 *  the leading 1 is the shell ring, and 5 is the PITCH (4 passage cells + the 1-cell / 0.5 m internal
 *  wall band). So `1 + 5a + 4` is the wall band EAST of cell (a, b) and `1 + 5b + 4` the one NORTH of
 *  it, each probed at `+2` — mid-span of the neighbouring block's 4-cell face, where an opened wall is
 *  unambiguously AIR. If maze.ts's PITCH or PASSAGE_CELLS ever change, this graph goes silently wrong;
 *  it is pinned only by lane (g) failing to find a walkable path. */
function mazeAdjacency(params: MazeParams, seed: string): number[][] {
  const [mx, mz] = params.cells;
  const stamp = maze(params, seed);
  const adj: number[][] = Array.from({ length: mx * mz }, () => []);
  for (let b = 0; b < mz; b++)
    for (let a = 0; a < mx; a++) {
      const cell = b * mx + a;
      if (
        a + 1 < mx &&
        coarseGet(stamp.coarse, 1 + 5 * a + 4, 1, 1 + 5 * b + 2) === AIR
      ) {
        adj[cell]?.push(cell + 1);
        adj[cell + 1]?.push(cell);
      }
      if (
        b + 1 < mz &&
        coarseGet(stamp.coarse, 1 + 5 * a + 2, 1, 1 + 5 * b + 4) === AIR
      ) {
        adj[cell]?.push(cell + mx);
        adj[cell + mx]?.push(cell);
      }
    }
  return adj;
}

/** Shortest cell path `from` → `to` over the passage graph (BFS — unit edge costs). Throws if the two
 *  are unreachable, which for a braided SPANNING maze can only mean the stamp's shell disagrees with
 *  the carve plan (the maze tree spans every cell by construction, so a missing path is a real defect,
 *  not a bad fixture). */
function bfsPath(adj: number[][], from: number, to: number): number[] {
  const parent = new Map<number, number>([[from, -1]]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift() as number;
    if (cur === to) break;
    for (const n of adj[cur] ?? [])
      if (!parent.has(n)) {
        parent.set(n, cur);
        queue.push(n);
      }
  }
  if (!parent.has(to))
    throw new Error("world-traversal: maze path unreachable");
  const path: number[] = [];
  for (let c = to; c !== -1; c = parent.get(c) as number) path.unshift(c);
  return path;
}

// Lane (a): the GAME's opening walk — the BAKED spawn, UP the stair corridor, into maze-1. This is the
// only lane that starts where the player actually starts, so it is the one that would catch a spawn
// baked into masonry. Maze-bound, so `ENTERED` (2 m) is out of reach (the door cell is 2.0 m deep) and
// the bar sits just short of `stopAlong`: it proves the capsule crossed the corridor and reached the
// maze's door cell. The CLIMB assert is the sharp one here — see REST_TOL.
test.skipIf(!bunWebGpuAvailable())(
  "gate world: spawn -> UP the stair corridor -> into maze-1",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest, loaded }) => {
      const { a, b, dir } = portalsOf(manifest, "corridor-1");
      const bAlong = along(b.position, dir);
      const res = runWalk(ctx, world, {
        start: loaded.playerStart, // 2 m inside hall-a, on the corridor axis
        dir,
        stopAlong: bAlong + BREAK_INSIDE,
        floorY: a.position[1] - 1,
        ceilY: a.position[1] + 5, // generous: the climb tops out ~2.4 m (high floor + rest)
        maxIters: WALL_HUG_ITERS, // step-ups cost horizontal progress; give the flight room
      });
      // Reached maze-1's door cell (within 0.3 m of the early-break plane).
      expect(res.advanced).toBeGreaterThan(bAlong + BREAK_INSIDE - 0.3);
      // CLIMBED: ended resting on the HIGH floor — the maze's, +1.5 m above hall-a's.
      expect(res.pos[1]).toBeGreaterThan(
        b.position[1] + REST_OFFSET - REST_TOL,
      );
    });
  },
);

// Lane (b): reverse — maze-1's south door cell, DOWN the stair corridor, into hall-a. Hall-bound, so it
// can hold the full `ENTERED` bar. The DESCEND assert is its sharp one (REST_TOL keeps it disjoint from
// lane (a)'s climb bar, so neither lane can pass by simply never changing storey).
test.skipIf(!bunWebGpuAvailable())(
  "gate world: maze-1 -> DOWN the stair corridor -> hall-a",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { a, b, dir } = portalsOf(manifest, "corridor-1");
      const revDir = reverse(dir);
      const aAlongRev = along(a.position, revDir); // hall-a's door plane along the reverse axis
      const res = runWalk(ctx, world, {
        start: startBeyond(b, dir), // 2 m inside maze-1, on the HIGH floor
        dir: revDir,
        stopAlong: aAlongRev + BREAK_INSIDE_HALL,
        floorY: a.position[1] - 1, // the LOW hall's floor is the descent's floor
        ceilY: b.position[1] + 4, // above the HIGH start
        maxIters: WALL_HUG_ITERS,
      });
      // ENTERED hall-a: advanced past its door plane along the reverse axis.
      expect(res.advanced).toBeGreaterThan(aAlongRev + ENTERED);
      // DESCENDED: ended resting on the LOW floor (~1.5 m below where it started).
      expect(res.pos[1]).toBeLessThan(a.position[1] + REST_OFFSET + REST_TOL);
    });
  },
);

// Lane (c): maze-1, out through its CARVED east opening and the collar-bore, into cave-c. This is the
// built↔organic seam — the one W2 had to fix twice. Cave-bound, so the full `ENTERED` bar holds and the
// lane can drive well past the mouth (BREAK_INSIDE_CAVE) without any far-wall risk.
test.skipIf(!bunWebGpuAvailable())(
  "gate world: maze-1 -> collar-bore -> cave-c",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { a, b, dir } = portalsOf(manifest, "bore-1");
      const bAlong = along(b.position, dir);
      const res = runWalk(ctx, world, {
        start: startInwardOf(a, dir),
        dir,
        stopAlong: bAlong + BREAK_INSIDE_CAVE, // past the mouth, into open cave
        floorY: a.position[1] - 1,
        ceilY: a.position[1] + 4,
        maxIters: WALL_HUG_ITERS, // the bore/cave path grinds through cave dressing
      });
      // ENTERED cave-c: advanced past its mouth along the bore axis.
      expect(res.advanced).toBeGreaterThan(bAlong + ENTERED);
    });
  },
);

// Lane (d): reverse — cave-c, back through the bore + carved opening, into the maze's door cell.
// THE BAR. A maze-bound lane cannot assert `ENTERED` (2 m): the door cell is only 2.0 m deep, so the
// lane deliberately stops at `BREAK_INSIDE` (1.5 m) short of its far wall. What CAN be asserted is
// that the drive loop terminated by CROSSING `stopAlong` — runWalk breaks only when
// `along(pos, dir) > stopAlong` — rather than by exhausting `maxIters` short of it. So the bar IS
// `stopAlong`: pass ⇒ the capsule really walked the whole seam and got inside the maze. (This was
// previously spelled `ENTERED - 0.5`, which is the same number by coincidence and read like slack
// tuned to make the lane pass. Same value, honest name.)
test.skipIf(!bunWebGpuAvailable())(
  "gate world: cave-c -> collar-bore -> maze-1",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { a, b, dir } = portalsOf(manifest, "bore-1");
      const revDir = reverse(dir);
      const aAlongRev = along(a.position, revDir);
      const stopAlong = aAlongRev + BREAK_INSIDE;
      const res = runWalk(ctx, world, {
        start: startBeyond(b, dir),
        dir: revDir,
        stopAlong,
        floorY: b.position[1] - 1,
        ceilY: b.position[1] + 4,
        maxIters: WALL_HUG_ITERS,
      });
      // Broke via stopAlong (crossed it), not by exhausting the iteration budget.
      expect(res.advanced).toBeGreaterThan(stopAlong);
    });
  },
);

// Lane (e): maze-1 through the APERTURE doorway into hall-b — the aperture's FIRST walked coverage
// (Probe 2 proves its sightlines and its flush plane; only this proves you can walk it). An aperture is
// a pure hole: two shells back-to-back with both door cells opened and NO connector volume between
// them, so a wrongly-opened door or a mis-seated seam shows up here as a wall. Only ONE portal is
// needed — the pair is coincident by construction (assertApertureSeam), so `a` IS the doorway plane.
// Hall-bound, so the full `ENTERED` bar holds.
test.skipIf(!bunWebGpuAvailable())(
  "gate world: maze-1 -> aperture doorway -> hall-b",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { a, dir } = portalsOf(manifest, "aperture-1");
      const aAlong = along(a.position, dir);
      const res = runWalk(ctx, world, {
        start: startInwardOf(a, dir),
        dir,
        stopAlong: aAlong + BREAK_INSIDE_HALL,
        floorY: a.position[1] - 1,
        ceilY: a.position[1] + 4,
        maxIters: WALL_HUG_ITERS,
      });
      // ENTERED hall-b: advanced past the shared doorway plane.
      expect(res.advanced).toBeGreaterThan(aAlong + ENTERED);
    });
  },
);

// Lane (f): reverse — hall-b, back through the flush aperture doorway, into the maze's door cell.
// Same bar as lane (d), for the same reason: maze-bound, so the assertion is "the drive loop broke by
// CROSSING stopAlong, not by exhausting maxIters" — not an `ENTERED` distance the 2.0 m door cell
// cannot physically offer. (Also previously spelled `ENTERED - 0.5`; identical value, honest name.)
test.skipIf(!bunWebGpuAvailable())(
  "gate world: hall-b -> aperture doorway -> maze-1",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { a, dir } = portalsOf(manifest, "aperture-1");
      const revDir = reverse(dir);
      const aAlongRev = along(a.position, revDir);
      const stopAlong = aAlongRev + BREAK_INSIDE;
      const res = runWalk(ctx, world, {
        start: startBeyond(a, dir), // 2 m past the doorway, inside hall-b
        dir: revDir,
        stopAlong,
        floorY: a.position[1] - 1,
        ceilY: a.position[1] + 4,
        maxIters: WALL_HUG_ITERS,
      });
      // Broke via stopAlong (crossed it), not by exhausting the iteration budget.
      expect(res.advanced).toBeGreaterThan(stopAlong);
    });
  },
);

// Lane (g): the MAZE-WALKABILITY probe, and the reason the maze counts as a real second vocabulary
// rather than a differently-shaped hall. The other six lanes cross SEAMS; this one walks the maze's own
// INTERIOR: BFS-solve the passage graph off the stamp (see mazeAdjacency — public stamp output, never
// the carve plan), then walk the resulting solution path leg by leg with the real CharacterMover. A
// maze whose walls rasterized 0.5 m thick in the shell but solid in the voxel proxy would pass every
// seam lane and fail here.
//
// The endpoints are the two DOOR cells of the committed spec — south offset 1 and east offset 2 — so
// the path walked is the one the PLAYER walks between the corridor and the bore, not an arbitrary pair.
// (Derived from `params.cells`, so a re-shaped maze re-derives them rather than silently aiming at a
// cell that no longer exists.)
test.skipIf(!bunWebGpuAvailable())(
  "gate world: maze-1 interior — the BFS passage path walks end to end",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { params, seed, translation: t } = mazeEntryOf(manifest);
      const [mx] = params.cells;
      const adj = mazeAdjacency(params, seed);
      const from = 0 * mx + 1; // south door cell (DEFAULT_WORLD: south offset 1 → a = 1, b = 0)
      const to = 2 * mx + (mx - 1); // east door cell (east offset 2 → b = 2, a = mx−1, the east column)
      const path = bfsPath(adj, from, to);
      expect(path.length).toBeGreaterThan(1);
      // World-space floor centre of a maze cell's passage block. The block spans coarse x
      // [1 + 5a, 5 + 5a] (shell ring + PITCH 5), so its centre sits at (3 + 5a) coarse cells =
      // (3 + 5a) · CELL metres off the region origin; same in z. `t` is the region's baked
      // translation and local y = 0 IS the floor plane (grid-stamp.ts), so `t[1]` is the walk floor.
      const centre = (cell: number): Vec3 => {
        const a = cell % mx;
        const b = (cell - a) / mx;
        return [t[0] + (3 + 5 * a) * 0.5, t[1], t[2] + (3 + 5 * b) * 0.5];
      };
      const first = centre(path[0] as number);
      let pos: Vec3 = [first[0], t[1] + REST_OFFSET + SPAWN_RISE, first[2]];
      for (let i = 1; i < path.length; i++) {
        const wp = centre(path[i] as number);
        // Legs are single cardinal hops between lattice-adjacent cells, so the axis is a pure sign.
        const dir: Vec3 = [
          Math.sign(wp[0] - pos[0]),
          0,
          Math.sign(wp[2] - pos[2]),
        ];
        const res = runWalk(ctx, world, {
          start: pos,
          dir,
          stopAlong: along(wp, dir), // the leg's own waypoint — each hop is its own drive
          floorY: t[1] - 1,
          ceilY: t[1] + 4,
          maxIters: WALL_HUG_ITERS,
        });
        // Reached this leg's waypoint (within 0.3 m — the mover stops a capsule-radius short when it
        // grazes a passage corner). A leg blocked by a mis-rasterized wall cannot get this far.
        expect(res.advanced).toBeGreaterThan(along(wp, dir) - 0.3);
        // Re-centre laterally for the next leg: the walked Y is kept (it is the floor the mover really
        // found), but X/Z snap back to the cell centre so a grazed corner cannot accumulate drift
        // across legs and walk the next hop into a wall.
        pos = [wp[0], res.pos[1], wp[2]];
      }
    });
  },
);
