// packages/dungeon/src/themes/maze.ts — the maze stamper (W3, D-W3-1..3): the second
// grid-built vocabulary, emitting the SAME GridStamp shape as hall.ts — the plug-point
// proof. Passages are 2.0 m (door width), internal walls 0.5 m, height 3.0 m (door
// height); pitch 5 coarse cells. Structure = seeded growing-tree spanning maze +
// probabilistic braid (dead ends opened into loops). INTEGER-ONLY randomness (FNV-1a
// seed hash → Math.imul mixer): the grid class stays structurally Pr-2-safe — no
// transcendentals anywhere in this module.
import { DOOR_H_CELLS, type GridDoor } from "./grid-stamp.ts";

export type MazeParams = {
  /** Maze-cell footprint [mx, mz]; integers >= 2. */
  cells: [number, number];
  /** Per-dead-end probability of opening it into a loop, 0..1 (0 = perfect maze). */
  braid: number;
  /** Doors on the outer shell; `offset` in MAZE-CELL units (0 <= offset < mx|mz). */
  doors: GridDoor[];
};

/** Passage height in coarse cells — fixed at the door standard (3.0 m), not a knob. */
export const MAZE_H_CELLS = DOOR_H_CELLS;

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
    const cur = stack[stack.length - 1] as number;
    const candidates = edgesOf(cur, mx, mz).filter(
      (e) => visited[e.next] !== 1,
    );
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
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
 *  (z-major) — deterministic. Opening only ADDS edges (degree never drops), so
 *  braid=1 leaves zero dead ends and can create no new ones. The probability draw
 *  is an exact power-of-two division of the integer stream — no float noise. */
function braidPass(
  open: Set<EdgeKey>,
  mx: number,
  mz: number,
  braid: number,
  rng: () => number,
): void {
  if (braid <= 0) return;
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
