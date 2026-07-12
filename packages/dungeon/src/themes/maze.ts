// packages/dungeon/src/themes/maze.ts — the maze stamper (W3, D-W3-1..3): the second
// grid-built vocabulary, emitting the SAME GridStamp shape as hall.ts — the plug-point
// proof. Passages are 2.0 m (door width), internal walls 0.5 m, height 3.0 m (door
// height); pitch 5 coarse cells. Structure = seeded growing-tree spanning maze +
// probabilistic braid (dead ends opened into loops). INTEGER-ONLY randomness (FNV-1a
// seed hash → Math.imul mixer): the grid class stays structurally Pr-2-safe — no
// transcendentals anywhere in this module.
import type { Connection, ScatterLayerSpec } from "../region.ts";
import {
  AIR,
  CELL,
  type CoarseGrid,
  coarseSet,
  createCoarse,
  MASONRY,
} from "../substrate/grid.ts";
import type { DoorSpec } from "../substrate/skin.ts";
import {
  DOOR_H_CELLS,
  doorAt,
  floorAnchors,
  type GridDoor,
  type GridStamp,
  validateDoorApproach,
} from "./grid-stamp.ts";

export type MazeParams = {
  /** Maze-cell footprint [mx, mz]; integers >= 2. */
  cells: [number, number];
  /** Per-dead-end probability of opening it into a loop, 0..1 (0 = perfect maze). */
  braid: number;
  /** Doors on the outer shell; `offset` in MAZE-CELL units (0 <= offset < mx|mz). */
  doors: GridDoor[];
};

/** Passage height in coarse cells — fixed at the door standard (3.0 m), not a knob. */
const MAZE_H_CELLS = DOOR_H_CELLS;

/** Passage width/depth in coarse cells — the door width (2.0 m), so a door always
 *  opens onto a full-width passage column.
 *
 *  COUPLED to `grid-stamp.ts`'s `DOOR_CLEARANCE_DEPTH_CELLS`: this must be `>=` it, or a
 *  door's centre approach lane reaches past its passage block into the wall band beyond and
 *  `validateDoorApproach` starts rejecting valid mazes. They are equal today — the invariant
 *  is pinned by a test in `maze.test.ts`, not by luck. */
export const PASSAGE_CELLS = 4;
/** Maze-cell pitch in coarse cells: a `PASSAGE_CELLS` passage block plus the 1-cell
 *  (0.5 m) internal wall band that separates it from the next block. */
const PITCH = PASSAGE_CELLS + 1;

/** FNV-1a 32-bit over the seed string (the pieces.ts variant-hash pattern). */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32-shape uint32 stream: Math.imul + shifts only. Every operation is
 *  integer (spec-exact in JS on every engine) — the Pr-2-safe RNG for grid content. */
function makeIntRng(seedWord: number): () => number {
  let state = seedWord >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** An open-edge key: `h:a,b` = wall between (a,b)-(a+1,b); `v:a,b` = (a,b)-(a,b+1). */
type EdgeKey = string;

/** The in-bounds edges around `cell`, paired with the neighbour they cross to. */
function edgesOf(
  cell: number,
  mx: number,
  mz: number,
): { edge: EdgeKey; next: number }[] {
  const a = cell % mx;
  const b = (cell - a) / mx;
  const out: { edge: EdgeKey; next: number }[] = [];
  if (a + 1 < mx) out.push({ edge: `h:${a},${b}`, next: cell + 1 });
  if (a - 1 >= 0) out.push({ edge: `h:${a - 1},${b}`, next: cell - 1 });
  if (b + 1 < mz) out.push({ edge: `v:${a},${b}`, next: cell + mx });
  if (b - 1 >= 0) out.push({ edge: `v:${a},${b - 1}`, next: cell - mx });
  return out;
}

/** The maze's open-edge plan: a growing-tree (backtracker) spanning maze, then the
 *  braid pass (Task 3). Deterministic per (mx, mz, braid, seed). */
function carvePlan(
  mx: number,
  mz: number,
  braid: number,
  seed: string,
): Set<EdgeKey> {
  const rng = makeIntRng(fnv1a(seed));
  const cellCount = mx * mz;
  const visited = new Uint8Array(cellCount);
  const open = new Set<EdgeKey>();
  const first = rng() % cellCount;
  const stack: number[] = [first];
  visited[first] = 1;
  while (stack.length > 0) {
    // Index is proven in-bounds for a non-empty stack; noUncheckedIndexedAccess
    // widens the element to number|undefined, so narrow it back.
    const cur = stack[stack.length - 1] as number;
    const candidates = edgesOf(cur, mx, mz).filter(
      (e) => visited[e.next] !== 1,
    );
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    // Index is proven in-bounds (rng() % length on a non-empty array); the flag
    // widens the element, so narrow it back.
    const pick = candidates[rng() % candidates.length] as {
      edge: EdgeKey;
      next: number;
    };
    open.add(pick.edge);
    visited[pick.next] = 1;
    stack.push(pick.next);
  }
  braidPass(open, mx, mz, braid, rng);
  return open;
}

/** Open a wall from each ORIGINAL dead end with probability `braid`. The dead-end
 *  list is computed ONCE, before any opening, and scanned in cell-index order
 *  (z-major) — deterministic. Opening only ADDS edges (degree never drops), so at
 *  braid=1 zero dead ends remain (for the mx,mz >= 2 footprints `maze()` admits —
 *  a degenerate 1xN corridor's end cells have no closed edge to open) and no new
 *  ones can appear. The probability draw is an exact power-of-two division of the
 *  integer stream — no float noise; the divisor is 0x1000000, NOT 0xFFFFFF, so the
 *  draw is half-open [0, 1): that is precisely what makes braid=1 open EVERY dead
 *  end (a draw can never reach 1.0 and skip one). The guard is `!(braid > 0)`, not
 *  `braid <= 0`, so a NaN braid fails SAFE to a perfect maze instead of full-braiding
 *  (every NaN comparison is false, so `>= braid` would never skip). */
function braidPass(
  open: Set<EdgeKey>,
  mx: number,
  mz: number,
  braid: number,
  rng: () => number,
): void {
  if (!(braid > 0)) return;
  const cellCount = mx * mz;
  const isDeadEnd = (cell: number): boolean =>
    edgesOf(cell, mx, mz).filter((e) => open.has(e.edge)).length === 1;
  const originalDeadEnds: number[] = [];
  for (let cell = 0; cell < cellCount; cell++)
    if (isDeadEnd(cell)) originalDeadEnds.push(cell);
  for (const cell of originalDeadEnds) {
    if ((rng() >>> 8) / 0x1000000 >= braid) continue;
    const closed = edgesOf(cell, mx, mz).filter((e) => !open.has(e.edge));
    if (closed.length === 0) continue;
    // Index is proven in-bounds (rng() % length on a non-empty array); the flag
    // widens the element, so narrow it back.
    const pick = closed[rng() % closed.length] as { edge: EdgeKey };
    open.add(pick.edge);
  }
}

/** TEST-ONLY window onto the carve plan (the maze's structural core) so the tree/braid
 *  properties are assertable without decoding a coarse grid. Not part of the stamp API. */
export function carvePlanForTest(
  mx: number,
  mz: number,
  braid: number,
  seed: string,
): Set<EdgeKey> {
  return carvePlan(mx, mz, braid, seed);
}

/** The maze's floor dressing: ghost rubble ONLY (no dynamic crates — a shovable body
 *  in a 2.0 m passage is wedge-bait for the walk probe; halls keep their crates). */
const MAZE_DRESSING_LAYERS: ScatterLayerSpec[] = [
  {
    name: "mazeRubble",
    geometry: { primitive: "cube" },
    posture: "lit",
    material: {
      color: [0.4, 0.38, 0.34, 1],
      specular: [0.03, 0.03, 0.03, 10],
    },
    target: "floor",
    spacing: { min: 0.9, max: 1.6 },
    scale: { min: 0.1, max: 0.25 },
    tint: { rgb: [0.5, 0.46, 0.4], jitter: 0.12 },
  },
];

/** Carve one AIR block: `wCells × MAZE_H_CELLS × dCells` starting at coarse (i0, 1, k0). */
function carveBlock(
  g: CoarseGrid,
  i0: number,
  k0: number,
  wCells: number,
  dCells: number,
): void {
  for (let k = k0; k < k0 + dCells; k++)
    for (let j = 1; j <= MAZE_H_CELLS; j++)
      for (let i = i0; i < i0 + wCells; i++) coarseSet(g, i, j, k, AIR);
}

export function maze(params: MazeParams, seed: string): GridStamp {
  const [mx, mz] = params.cells;
  if (!Number.isInteger(mx) || !Number.isInteger(mz) || mx < 2 || mz < 2) {
    throw new Error(`maze: cells must be integers >= 2 (got ${mx}x${mz})`);
  }
  if (!Number.isFinite(params.braid) || params.braid < 0 || params.braid > 1) {
    throw new Error(`maze: braid ${params.braid} outside [0, 1]`);
  }
  const w = PITCH * mx - 1;
  const d = PITCH * mz - 1;
  const dims: [number, number, number] = [w + 2, MAZE_H_CELLS + 2, d + 2];
  const coarse = createCoarse([0, -CELL, 0], dims, MASONRY);

  // Passage blocks: maze cell (a,b) owns the PASSAGE_CELLS × MAZE_H_CELLS × PASSAGE_CELLS
  // (4×6×4) block whose floor-layer XZ corner is (1 + PITCH·a, 1 + PITCH·b).
  for (let b = 0; b < mz; b++)
    for (let a = 0; a < mx; a++)
      carveBlock(
        coarse,
        1 + PITCH * a,
        1 + PITCH * b,
        PASSAGE_CELLS,
        PASSAGE_CELLS,
      );

  // Open walls per the carve plan: a 1-cell band across the shared wall.
  for (const key of carvePlan(mx, mz, params.braid, seed)) {
    const m = /^([hv]):(\d+),(\d+)$/.exec(key);
    if (!m) throw new Error(`maze: bad edge key ${key}`);
    const a = Number(m[2]);
    const b = Number(m[3]);
    if (m[1] === "h") {
      carveBlock(
        coarse,
        1 + PITCH * a + PASSAGE_CELLS,
        1 + PITCH * b,
        1,
        PASSAGE_CELLS,
      );
    } else {
      carveBlock(
        coarse,
        1 + PITCH * a,
        1 + PITCH * b + PASSAGE_CELLS,
        PASSAGE_CELLS,
        1,
      );
    }
  }

  // Doors: maze-cell offsets index PASSAGE columns (coarse offset = PITCH·offset —
  // a door can never be authored onto an internal wall band). Duplicate {wall,offset}
  // rejected; the shared approach-lane validation still runs (setup-loud).
  const portals: Connection[] = [];
  const doorSpecs: DoorSpec[] = [];
  const seen = new Set<string>();
  for (const door of params.doors) {
    const alongCells = door.wall === "north" || door.wall === "south" ? mx : mz;
    if (
      !Number.isInteger(door.offset) ||
      door.offset < 0 ||
      door.offset >= alongCells
    ) {
      throw new Error(
        `maze: door on ${door.wall} offset ${door.offset} outside [0, ${alongCells})`,
      );
    }
    const dupeKey = `${door.wall}:${door.offset}`;
    if (seen.has(dupeKey)) throw new Error(`maze: duplicate door ${dupeKey}`);
    seen.add(dupeKey);
    const coarseDoor: GridDoor = {
      wall: door.wall,
      offset: PITCH * door.offset,
    };
    const { portal, spec } = doorAt(dims, coarseDoor);
    validateDoorApproach(coarse, [w, d], door, spec, "maze");
    portals.push(portal);
    doorSpecs.push(spec);
  }

  return {
    theme: "maze",
    coarse,
    portals,
    doorSpecs,
    anchors: floorAnchors(coarse, [w, d], portals),
    dressingLayers: MAZE_DRESSING_LAYERS,
  };
}
