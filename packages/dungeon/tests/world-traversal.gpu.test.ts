// W3 Task 10 — THE GATE-WORLD PROBE, rewritten for the 5-region phase-gate world:
//   hall-a --corridor-1 (stairs +1.5m)--> maze-1 --bore-1--> cave-c
//                                          maze-1 --aperture-1--> hall-b (flush)
// Same discipline as W2: full collider set via loadWorld on an in-memory bake, WALK-IN
// lanes driving the real CharacterMover, each lane in its own freshly-loaded world.
// The maze interior lane BFS-solves the passage graph from the stamp and walks the
// real solution path leg by leg — the maze-walkability probe.
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

const ENTERED = 2;
const BREAK_INSIDE = 1.5; // break inside a maze door cell (2.5 m pitch — stay short of its far wall)
const BREAK_INSIDE_HALL = 2.5;
const BREAK_INSIDE_CAVE = 4;
const REST_TOL = 0.4;
const INWARD_START = 2;

function portalsOf(
  manifest: WorldManifest,
  id: string,
): { a: Connection; b: Connection; dir: Vec3 } {
  const c = manifest.connectors.find((k) => k.id === id);
  if (!c) throw new Error(`world-traversal: manifest has no connector ${id}`);
  return { a: c.a, b: c.b, dir: [c.a.facing[0], c.a.facing[1], c.a.facing[2]] };
}

function startInwardOf(portal: Connection, dir: Vec3): Vec3 {
  return [
    portal.position[0] - dir[0] * INWARD_START,
    portal.position[1] + REST_OFFSET + SPAWN_RISE,
    portal.position[2] - dir[2] * INWARD_START,
  ];
}

function startBeyond(portal: Connection, dir: Vec3): Vec3 {
  return [
    portal.position[0] + dir[0] * INWARD_START,
    portal.position[1] + REST_OFFSET + SPAWN_RISE,
    portal.position[2] + dir[2] * INWARD_START,
  ];
}

const reverse = (dir: Vec3): Vec3 => [-dir[0], -dir[1], -dir[2]];

/** The gate world's maze region entry (params + seed + placement) off the manifest. */
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

/** Passage adjacency rebuilt from the maze STAMP: adjacent cells connect iff the wall
 *  band between their blocks is AIR at the walk layer. Public stamp output only. */
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

// Lane (a): the GAME's opening walk — baked spawn, UP the stairs, INTO the maze.
test.skipIf(!bunWebGpuAvailable())(
  "gate world: spawn -> UP the stair corridor -> into maze-1",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest, loaded }) => {
      const { a, b, dir } = portalsOf(manifest, "corridor-1");
      const bAlong = along(b.position, dir);
      const res = runWalk(ctx, world, {
        start: loaded.playerStart,
        dir,
        stopAlong: bAlong + BREAK_INSIDE,
        floorY: a.position[1] - 1,
        ceilY: a.position[1] + 5,
        maxIters: WALL_HUG_ITERS,
      });
      expect(res.advanced).toBeGreaterThan(bAlong + BREAK_INSIDE - 0.3);
      // CLIMBED onto the maze floor (+1.5 m).
      expect(res.pos[1]).toBeGreaterThan(
        b.position[1] + REST_OFFSET - REST_TOL,
      );
    });
  },
);

// Lane (b): reverse — maze-1 south door cell, DOWN the stairs, into hall-a.
test.skipIf(!bunWebGpuAvailable())(
  "gate world: maze-1 -> DOWN the stair corridor -> hall-a",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { a, b, dir } = portalsOf(manifest, "corridor-1");
      const revDir = reverse(dir);
      const aAlongRev = along(a.position, revDir);
      const res = runWalk(ctx, world, {
        start: startBeyond(b, dir),
        dir: revDir,
        stopAlong: aAlongRev + BREAK_INSIDE_HALL,
        floorY: a.position[1] - 1,
        ceilY: b.position[1] + 4,
        maxIters: WALL_HUG_ITERS,
      });
      expect(res.advanced).toBeGreaterThan(aAlongRev + ENTERED);
      expect(res.pos[1]).toBeLessThan(a.position[1] + REST_OFFSET + REST_TOL);
    });
  },
);

// Lanes (c)+(d): maze-1 <-> cave-c through the collar-bore (both directions).
test.skipIf(!bunWebGpuAvailable())(
  "gate world: maze-1 -> collar-bore -> cave-c",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { a, b, dir } = portalsOf(manifest, "bore-1");
      const bAlong = along(b.position, dir);
      const res = runWalk(ctx, world, {
        start: startInwardOf(a, dir),
        dir,
        stopAlong: bAlong + BREAK_INSIDE_CAVE,
        floorY: a.position[1] - 1,
        ceilY: a.position[1] + 4,
        maxIters: WALL_HUG_ITERS,
      });
      expect(res.advanced).toBeGreaterThan(bAlong + ENTERED);
    });
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "gate world: cave-c -> collar-bore -> maze-1",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { a, b, dir } = portalsOf(manifest, "bore-1");
      const revDir = reverse(dir);
      const aAlongRev = along(a.position, revDir);
      const res = runWalk(ctx, world, {
        start: startBeyond(b, dir),
        dir: revDir,
        stopAlong: aAlongRev + BREAK_INSIDE,
        floorY: b.position[1] - 1,
        ceilY: b.position[1] + 4,
        maxIters: WALL_HUG_ITERS,
      });
      expect(res.advanced).toBeGreaterThan(aAlongRev + ENTERED - 0.5);
    });
  },
);

// Lanes (e)+(f): the APERTURE doorway, both directions (its first walked coverage).
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
      expect(res.advanced).toBeGreaterThan(aAlong + ENTERED);
    });
  },
);

test.skipIf(!bunWebGpuAvailable())(
  "gate world: hall-b -> aperture doorway -> maze-1",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { a, dir } = portalsOf(manifest, "aperture-1");
      const revDir = reverse(dir);
      const aAlongRev = along(a.position, revDir);
      const res = runWalk(ctx, world, {
        start: startBeyond(a, dir), // 2 m past the doorway, inside hall-b
        dir: revDir,
        stopAlong: aAlongRev + BREAK_INSIDE,
        floorY: a.position[1] - 1,
        ceilY: a.position[1] + 4,
        maxIters: WALL_HUG_ITERS,
      });
      expect(res.advanced).toBeGreaterThan(aAlongRev + ENTERED - 0.5);
    });
  },
);

// Lane (g): the MAZE-WALKABILITY probe — BFS-solve the passage graph from the stamp,
// then walk the real solution path leg by leg (south door cell -> east door cell).
test.skipIf(!bunWebGpuAvailable())(
  "gate world: maze-1 interior — the BFS passage path walks end to end",
  async () => {
    await withLoadedWorld(DEFAULT_WORLD, ({ ctx, world, manifest }) => {
      const { params, seed, translation: t } = mazeEntryOf(manifest);
      const [mx] = params.cells;
      const adj = mazeAdjacency(params, seed);
      const from = 0 * mx + 1; // south door cell (offset 1, b = 0)
      const to = 2 * mx + (mx - 1); // east door cell (b = 2, a = mx−1)
      const path = bfsPath(adj, from, to);
      expect(path.length).toBeGreaterThan(1);
      const centre = (cell: number): Vec3 => {
        const a = cell % mx;
        const b = (cell - a) / mx;
        return [t[0] + (3 + 5 * a) * 0.5, t[1], t[2] + (3 + 5 * b) * 0.5];
      };
      const first = centre(path[0] as number);
      let pos: Vec3 = [first[0], t[1] + REST_OFFSET + SPAWN_RISE, first[2]];
      for (let i = 1; i < path.length; i++) {
        const wp = centre(path[i] as number);
        const dir: Vec3 = [
          Math.sign(wp[0] - pos[0]),
          0,
          Math.sign(wp[2] - pos[2]),
        ];
        const res = runWalk(ctx, world, {
          start: pos,
          dir,
          stopAlong: along(wp, dir),
          floorY: t[1] - 1,
          ceilY: t[1] + 4,
          maxIters: WALL_HUG_ITERS,
        });
        expect(res.advanced).toBeGreaterThan(along(wp, dir) - 0.3);
        pos = [wp[0], res.pos[1], wp[2]]; // re-centre laterally for the next leg
      }
    });
  },
);
