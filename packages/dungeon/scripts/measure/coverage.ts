// packages/dungeon/scripts/measure/coverage.ts
// How much of a world did the floods actually SEE? The compact matrix's `reach` column is a
// share of FLAGS, and for `narrow` / `low-clearance` that is enough — a flag only exists where
// the column pass put one. It is CIRCULAR for `pit`: a pit only enters any flag count if the
// enterable flood found it, so "few pits, and most flags were reached" cannot rule out pits in
// the part of the world neither flood entered.
//
// So this measures the floods against the FLOOR COLUMNS themselves — every floor anchor in
// every allocated chunk — rather than against the flags. `enterable` is the number that matters
// for the pit question, and it is a strict superset of `reached` (same climb edges, plus the
// one-way fall edges), so the gap between `enterable` and `anchors` is terrain no agent can get
// to even by falling off something, where "is it a trap" has no meaning to begin with.
//
// SELF-CHECKING, and against the real pass rather than against itself: `markUnreachable` wrote
// a verdict into every non-pit flag, so `reached` must contain a flag's anchor cell EXACTLY
// when that flag came back `unreachable === false`. {@link Coverage.disagreements} counts the
// flags where this module and `analyze.ts` disagree, over hundreds of them per world. A nonzero
// count means this re-derivation of `climbNeighbours` has drifted and the numbers are junk.
import * as field from "@furnace/core/field";
import { isFloorAnchor, seedAnchor, solidAt } from "./solidity.ts";
import type { Subject } from "./subjects.ts";

/** The 4 cardinal XZ neighbours — `analyze.ts` DIRS. */
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export type Coverage = {
  /** Floor-anchor columns in allocated chunks — the whole node set both floods draw from. */
  anchors: number;
  /** Columns the undirected climb flood reaches: `markUnreachable`'s graph. */
  reached: number;
  /** Columns the directed enterable flood reaches: climb edges PLUS walking off an edge —
   *  `detectPits`' forward graph, and the population a pit could possibly be found in. */
  enterable: number;
  /** Flags where this module's `reached` set contradicts the verdict `markUnreachable` wrote.
   *  Must be 0; anything else means the re-derivation drifted. `undefined` when the comparison
   *  could not run (no usable seed, or nothing tagged). */
  disagreements: number | undefined;
};

const cellKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

/** Every floor-anchor column in the store's allocated chunks. Air only exists where a chunk has
 *  been written, so this is the complete node set — the same argument `analyzeWorld` makes for
 *  its anchors. */
function allAnchors(subject: Subject): number {
  let n = 0;
  for (const ck of subject.store.chunks.keys()) {
    const [cx, cy, cz] = field.parseChunkKey(ck);
    const bx = cx * field.CHUNK_DIM;
    const by = cy * field.CHUNK_DIM;
    const bz = cz * field.CHUNK_DIM;
    for (let z = bz; z < bz + field.CHUNK_DIM; z++)
      for (let y = by; y < by + field.CHUNK_DIM; y++)
        for (let x = bx; x < bx + field.CHUNK_DIM; x++)
          if (isFloorAnchor(subject, x, y, z)) n++;
  }
  return n;
}

type Visit = (x: number, y: number, z: number) => void;

/** `climbNeighbours`: floor anchors in the 4 XZ-adjacent columns within `climbCells`. */
function climbNeighbours(
  subject: Subject,
  climbCells: number,
  x: number,
  y: number,
  z: number,
  visit: Visit,
): void {
  for (const [dx, dz] of DIRS)
    for (let ny = y - climbCells; ny <= y + climbCells; ny++)
      if (isFloorAnchor(subject, x + dx, ny, z + dz)) visit(x + dx, ny, z + dz);
}

/** `fallTargets`: where walking off the edge LANDS, offered only past the climb band. */
function fallTargets(
  subject: Subject,
  climbCells: number,
  x: number,
  y: number,
  z: number,
  visit: Visit,
): void {
  for (const [dx, dz] of DIRS) {
    const nx = x + dx;
    const nz = z + dz;
    if (solidAt(subject, nx, y, nz)) continue;
    let ny = y;
    while (!solidAt(subject, nx, ny - 1, nz)) ny--;
    if (ny < y - climbCells) visit(nx, ny, nz);
  }
}

function flood(
  starts: readonly [number, number, number][],
  expand: (x: number, y: number, z: number, visit: Visit) => void,
): Set<string> {
  const seen = new Set<string>();
  const pending: [number, number, number][] = [];
  const visit: Visit = (x, y, z) => {
    const key = cellKey(x, y, z);
    if (seen.has(key)) return;
    seen.add(key);
    pending.push([x, y, z]);
  };
  for (const s of starts) visit(s[0], s[1], s[2]);
  while (pending.length > 0) {
    const cur = pending.pop();
    if (cur === undefined) break;
    expand(cur[0], cur[1], cur[2], visit);
  }
  return seen;
}

/** Count flags whose `unreachable` verdict disagrees with `reached` membership — `undefined`
 *  when `markUnreachable` never tagged anything, in which case there is nothing to compare. */
function crossCheck(
  flags: ReadonlyMap<field.ChunkKey, readonly field.FieldFlag[]>,
  reached: ReadonlySet<string>,
): number | undefined {
  let compared = 0;
  let disagreements = 0;
  for (const list of flags.values())
    for (const f of list) {
      if (f.kind === "pit" || f.unreachable === undefined) continue;
      compared++;
      const inFlood = reached.has(cellKey(f.cell[0], f.cell[1], f.cell[2]));
      if (inFlood === f.unreachable) disagreements++;
    }
  return compared === 0 ? undefined : disagreements;
}

/**
 * Flood coverage over the world's floor columns, plus the cross-check against the verdicts
 * `markUnreachable` already wrote into `flags`.
 */
export function measureCoverage(
  subject: Subject,
  profile: field.AgentProfile,
  flags: ReadonlyMap<field.ChunkKey, readonly field.FieldFlag[]>,
): Coverage {
  const anchors = allAnchors(subject);
  const starts = subject.seeds
    .map((s) => seedAnchor(subject, s))
    .filter((a): a is [number, number, number] => a !== undefined);
  if (starts.length === 0)
    return { anchors, reached: 0, enterable: 0, disagreements: undefined };

  const climbCells = Math.floor(profile.climbCeiling / subject.store.cellSize);
  const reached = flood(starts, (x, y, z, visit) =>
    climbNeighbours(subject, climbCells, x, y, z, visit),
  );
  const enterable = flood(starts, (x, y, z, visit) => {
    climbNeighbours(subject, climbCells, x, y, z, visit);
    fallTargets(subject, climbCells, x, y, z, visit);
  });
  return {
    anchors,
    reached: reached.size,
    enterable: enterable.size,
    disagreements: crossCheck(flags, reached),
  };
}
