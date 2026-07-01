// packages/dungeon/src/occupancy.ts
// The placement engine's spatial rules — pure math over AABBs + exact voxel cells,
// run BEFORE realize (no GPU, no Rapier). Three classes: piece ENVELOPES (pieces never
// interpenetrate), piece SOLIDS (what connector air must not cross), and connector
// CLEARANCE volumes (reserved walking air). See the 2.2.5a spec §2.
import { aabbContains, aabbIntersection, aabbIntersects } from "./aabb.ts";
import type { Aabb, Vec3 } from "./region.ts";

/** A solid obstacle: a conservative world AABB (cuboids, connector slabs) or an exact
 *  yaw-rotatable voxel-cell set (cave proxies — the grid AABB covers mostly AIR, so
 *  membership must be per-cell or every cave-mouth connector would false-reject). */
export type Solid =
  | { kind: "box"; aabb: Aabb }
  | {
      kind: "voxels";
      /** Body position: cell (i,j,k) spans position + (i,j,k)·size (corner-anchored). */
      position: Vec3;
      /** Body yaw about world-up (our pipeline never pitches voxel bodies). */
      yaw: number;
      size: Vec3;
      cells: Set<string>;
    };

/** Key an Int32Array of 3-per-cell coords into a membership set. */
export function voxelCellsOf(coords: Int32Array): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < coords.length; i += 3) {
    s.add(`${coords[i]},${coords[i + 1]},${coords[i + 2]}`);
  }
  return s;
}

const MAX_CELL_QUERY = 200_000; // setup-loud cap — a runaway query means wrong inputs

type VoxelSolid = Extract<Solid, { kind: "voxels" }>;

/** World-space min/max envelope of a query AABB re-expressed in the voxel body's local
 *  (unrotated) frame — the conservative box that must be scanned cell-by-cell. */
function localEnvelope(v: VoxelSolid, q: Aabb): { min: Vec3; max: Vec3 } {
  const c = Math.cos(-v.yaw);
  const s = Math.sin(-v.yaw);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const wx = (i & 1 ? q.max[0] : q.min[0]) - v.position[0];
    const wy = (i & 2 ? q.max[1] : q.min[1]) - v.position[1];
    const wz = (i & 4 ? q.max[2] : q.min[2]) - v.position[2];
    const lx = wx * c + wz * s;
    const lz = -wx * s + wz * c;
    if (lx < min[0]) min[0] = lx;
    if (lx > max[0]) max[0] = lx;
    if (wy < min[1]) min[1] = wy;
    if (wy > max[1]) max[1] = wy;
    if (lz < min[2]) min[2] = lz;
    if (lz > max[2]) max[2] = lz;
  }
  return { min, max };
}

/** Inclusive [lo,hi] cell-index range covered by a local scalar span, given a cell size
 *  on that axis. Half-open EPS slack keeps exact-touch spans from spuriously widening. */
function cellRange(lo: number, hi: number, size: number): [number, number] {
  const EPS = 1e-3;
  return [Math.floor((lo + EPS) / size), Math.ceil((hi - EPS) / size) - 1];
}

function voxelsIntersect(v: VoxelSolid, q: Aabb): boolean {
  const { min, max } = localEnvelope(v, q);
  const [i0, i1] = cellRange(min[0], max[0], v.size[0]);
  const [j0, j1] = cellRange(min[1], max[1], v.size[1]);
  const [k0, k1] = cellRange(min[2], max[2], v.size[2]);
  const count = (i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1);
  if (count > MAX_CELL_QUERY) {
    throw new Error(
      `occupancy: voxel query covers ${count} cells — query box too large`,
    );
  }
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      for (let k = k0; k <= k1; k++) {
        if (v.cells.has(`${i},${j},${k}`)) return true;
      }
    }
  }
  return false;
}

/** The world AABB span of one voxel cell (unrotated fast path only). */
function cellAabb(v: VoxelSolid, i: number, j: number, k: number): Aabb {
  return {
    min: [
      v.position[0] + i * v.size[0],
      v.position[1] + j * v.size[1],
      v.position[2] + k * v.size[2],
    ],
    max: [
      v.position[0] + (i + 1) * v.size[0],
      v.position[1] + (j + 1) * v.size[1],
      v.position[2] + (k + 1) * v.size[2],
    ],
  };
}

/** Does `solid` intersect `q` OUTSIDE all `exemptions`? A box solid is exempt when its
 *  intersection with `q` lies entirely inside one exemption box; a voxel solid is exempt
 *  per-cell. (Rotated voxel bodies take the conservative route: any hit cell counts
 *  unless the WHOLE query lies inside an exemption.) */
function solidHitsOutsideExemptions(
  solid: Solid,
  q: Aabb,
  exemptions: Aabb[],
): boolean {
  if (solid.kind === "box") {
    if (!aabbIntersects(solid.aabb, q)) return false;
    const hit = aabbIntersection(solid.aabb, q);
    return !exemptions.some((e) => aabbContains(e, hit));
  }
  if (!voxelsIntersect(solid, q)) return false;
  if (exemptions.some((e) => aabbContains(e, q))) return false;
  if (solid.yaw !== 0) return true; // conservative for rotated grids

  const EPS = 1e-3;
  const i0 = Math.floor((q.min[0] - solid.position[0] + EPS) / solid.size[0]);
  const i1 =
    Math.ceil((q.max[0] - solid.position[0] - EPS) / solid.size[0]) - 1;
  const j0 = Math.floor((q.min[1] - solid.position[1] + EPS) / solid.size[1]);
  const j1 =
    Math.ceil((q.max[1] - solid.position[1] - EPS) / solid.size[1]) - 1;
  const k0 = Math.floor((q.min[2] - solid.position[2] + EPS) / solid.size[2]);
  const k1 =
    Math.ceil((q.max[2] - solid.position[2] - EPS) / solid.size[2]) - 1;
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      for (let k = k0; k <= k1; k++) {
        if (!solid.cells.has(`${i},${j},${k}`)) continue;
        const ca = cellAabb(solid, i, j, k);
        if (!exemptions.some((e) => aabbContains(e, aabbIntersection(ca, q))))
          return true;
      }
    }
  }
  return false;
}

type PieceEntry = { envelope: Aabb; solids: Solid[] };
type ClearanceEntry = {
  boxes: Aabb[];
  endpoints: [string, string];
  slabSolids: Solid[];
};

/** Rejection diagnostics: which rule fired against which entry. */
export type Rejection = { rule: string; against: string };

/** The placement engine's occupancy ledger: registered piece envelopes/solids and
 *  committed connector clearances, checked pairwise per the 2.2.5a spec §2 rules. */
export class Occupancy {
  private readonly pieces = new Map<string, PieceEntry>();
  private readonly clearances = new Map<string, ClearanceEntry>();

  /** Register a placed piece's envelope (rule 1/3 participant) and its solids (what
   *  later clearances must not cross, barring a portal exemption). */
  addPiece(id: string, envelope: Aabb, solids: Solid[]): void {
    this.pieces.set(id, { envelope, solids });
  }

  /** Commit a connector's reserved-air boxes. `slabSolids` (e.g. the floor slab) joins
   *  the solid set for all LATER clearance checks (rule 5) — the exemptions passed in
   *  are the connector's own portal-bore boxes, recorded only for provenance today. */
  addClearance(
    id: string,
    boxes: Aabb[],
    endpoints: [string, string],
    _exemptions: Aabb[],
    slabSolids: Solid[],
  ): void {
    this.clearances.set(id, { boxes, endpoints, slabSolids });
  }

  /** Roll back a piece or a committed clearance (undo a rejected/speculative placement). */
  remove(id: string): void {
    this.pieces.delete(id);
    this.clearances.delete(id);
  }

  /** Rule 1 (+3 from the piece side): a candidate piece envelope vs placed envelopes and
   *  vs committed clearance air. */
  checkPieceEnvelope(env: Aabb): Rejection | null {
    for (const [id, p] of this.pieces) {
      if (aabbIntersects(p.envelope, env))
        return { rule: "envelope-envelope", against: id };
    }
    for (const [id, c] of this.clearances) {
      if (c.boxes.some((b) => aabbIntersects(b, env))) {
        return { rule: "envelope-clearance", against: id };
      }
    }
    return null;
  }

  /** Rules 2–4 for a candidate clearance (a connector's reserved-air boxes). */
  checkClearance(
    boxes: Aabb[],
    endpoints: [string, string],
    exemptions: Aabb[],
  ): Rejection | null {
    for (const [id, p] of this.pieces) {
      for (const q of boxes) {
        for (const s of p.solids) {
          if (solidHitsOutsideExemptions(s, q, exemptions)) {
            return { rule: "clearance-solid", against: id };
          }
        }
        const isEndpoint = id === endpoints[0] || id === endpoints[1];
        if (!isEndpoint && aabbIntersects(p.envelope, q)) {
          return { rule: "clearance-envelope", against: id };
        }
      }
    }
    for (const [id, c] of this.clearances) {
      for (const q of boxes) {
        if (c.boxes.some((b) => aabbIntersects(b, q))) {
          return { rule: "clearance-clearance", against: id };
        }
        for (const s of c.slabSolids) {
          if (solidHitsOutsideExemptions(s, q, exemptions)) {
            return { rule: "clearance-slab", against: id };
          }
        }
      }
    }
    return null;
  }
}
