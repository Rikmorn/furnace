// packages/dungeon/scripts/measure/solidity.ts
// The analyzer's own solidity + standability predicates, RE-DERIVED here because none of them
// is exported. Everything in this measurement that says "on walkable ground" or "this seed
// resolves" reads through these — so if they ever disagree with `analyze.ts`, the tables are
// measuring the wrong thing rather than failing. Nothing here cross-checks itself the way
// `explain.ts` does, so each one is kept a literal transcription of its counterpart.
import * as field from "@furnace/core/field";
import type { Subject } from "./subjects.ts";

/** Rock at (x,y,z): the field's own `density < 0` (the `collider.ts` predicate), widened by the
 *  voxelized placement colliders the analyzer was given. Unallocated chunks read SOLID, the
 *  rule `getDensity` states — which `field.getDensity` already applies. */
export function solidAt(
  subject: Subject,
  x: number,
  y: number,
  z: number,
): boolean {
  const { store, extraSolid: extras } = subject;
  if (field.getDensity(store, x, y, z) < 0) return true;
  if (extras === undefined) return false;
  const cx = field.voxelChunk(x);
  const cy = field.voxelChunk(y);
  const cz = field.voxelChunk(z);
  const bits = extras.get(field.chunkKey(cx, cy, cz));
  if (bits === undefined) return false;
  const lx = x - cx * field.CHUNK_DIM;
  const ly = y - cy * field.CHUNK_DIM;
  const lz = z - cz * field.CHUNK_DIM;
  const bit = bits[lx + field.CHUNK_DIM * (ly + field.CHUNK_DIM * lz)];
  return bit !== undefined && bit !== 0;
}

/** An air cell sitting directly on rock — the node set both connectivity passes flood. */
export const isFloorAnchor = (
  subject: Subject,
  x: number,
  y: number,
  z: number,
): boolean => !solidAt(subject, x, y, z) && solidAt(subject, x, y - 1, z);

/** Air cells from (x,y,z) upward, counted to at most `limit` — the column pass's `airRun`. */
export function airRun(
  subject: Subject,
  x: number,
  y: number,
  z: number,
  limit: number,
): number {
  let n = 0;
  while (n < limit && !solidAt(subject, x, y + n, z)) n++;
  return n;
}

/** Is this a cell the agent can actually stand on — a floor surface with standing headroom?
 *  The column pass's own walkable test, applied to a flag's anchor.
 *
 *  Not redundant with reachability. Three of the five kinds anchor on a cell that passed the
 *  walkable test by construction, but `low-clearance` anchors on the OFFENDING NEIGHBOUR — a
 *  cell that failed it — and `pit` anchors on a node from the headroom-free node set, so both
 *  are exactly what this excludes. */
export function isStandable(
  subject: Subject,
  clearance: number,
  cell: readonly [number, number, number],
): boolean {
  const [x, y, z] = cell;
  if (!isFloorAnchor(subject, x, y, z)) return false;
  const need = Math.ceil(clearance / subject.store.cellSize);
  return airRun(subject, x, y, z, need) >= need;
}

/** The floor surface a seed STANDS on — `seedAnchor`'s rule: its own cell if that is already a
 *  floor anchor, else the first one straight down. A seed buried in rock has none: both
 *  connectivity passes warn about it and drop it, and skip ENTIRELY only when no seed at all
 *  survives (with nothing known to be reachable there is no honest verdict to give). */
export function seedAnchor(
  subject: Subject,
  seed: readonly [number, number, number],
): [number, number, number] | undefined {
  const cellSize = subject.store.cellSize;
  const x = field.worldToVoxel(seed[0], cellSize);
  const z = field.worldToVoxel(seed[2], cellSize);
  let y = field.worldToVoxel(seed[1], cellSize);
  if (solidAt(subject, x, y, z)) return undefined;
  while (!solidAt(subject, x, y - 1, z)) y--;
  return [x, y, z];
}
