// src/substrate/carve.ts — single-carve consistency (findings §mechanisms):
// ONE prepareCarve computes the carved fine grid, the carved-cell set, the
// Surface-Nets patch AND the box it meshed; render suppression and collider
// build consume this same object, so they cannot diverge. The returned box is
// what the E2 property test asserts against (shared source of truth).

import { type MeshData, surfaceNets } from "../field/surface-nets.ts";
import type { Aabb, Vec3 } from "../world/region.ts";
import {
  FINE,
  type FineGrid,
  fineGet,
  fineIndex,
  fineSet,
  SUB,
} from "./grid.ts";

export type CarveVolume =
  | {
      kind: "capsule";
      /** Segment endpoints in the GRID's local frame. a === b degenerates to a sphere. */
      a: Vec3;
      b: Vec3;
      radius: number;
    }
  | {
      kind: "cylinder";
      /** Axis endpoints in the GRID's local frame — must be AXIS-ALIGNED (cardinal).
       *  FLAT ends (no spherical caps): the punch-a-wall primitive. A capsule's
       *  spherical end sweeps `radius` beyond the segment and eats interior
       *  content (pillars, floor) far from the wall band — the W2 gate blob. */
      a: Vec3;
      b: Vec3;
      radius: number;
      /** Cells whose entire box lies at or below this Y are never carved (and
       *  points below it are never inside the volume): a door-plane opening must
       *  not groove the floor beneath its threshold. */
      clipBelowY?: number;
    };

type CapsuleVolume = Extract<CarveVolume, { kind: "capsule" }>;
type CylinderVolume = Extract<CarveVolume, { kind: "cylinder" }>;

/** Patch-box margin in fine cells beyond the carved AABB: SUB+2 (spec D-W2 /
 *  findings E2 — SUB+1 measured ~0.05 m slack near corner/door pieces). */
export const PATCH_MARGIN = SUB + 2;

export type PreparedCarve = {
  /** Carved COPY of the input fine grid (input is not mutated). */
  fine: FineGrid;
  /** Linear fine indices (fineIndex) of cells the carve turned solid→air. */
  carved: Set<number>;
  patch: MeshData | null;
  /** Local-frame world-unit box the patch was meshed over — the E2 shared box. */
  patchBox: Aabb | null;
};

export function prepareCarve(
  input: FineGrid,
  volumes: CarveVolume[],
): PreparedCarve {
  const fine: FineGrid = {
    min: [...input.min],
    dims: [...input.dims],
    cells: new Uint8Array(input.cells),
  };
  const carved = new Set<number>();
  for (const v of volumes) {
    if (v.kind === "capsule") carveCapsule(fine, v, carved);
    else carveCylinder(fine, v, carved);
  }
  if (carved.size === 0) return { fine, carved, patch: null, patchBox: null };
  const cellBox = carvedCellBounds(fine, carved);
  const lo: [number, number, number] = [
    Math.max(0, cellBox.min[0] - PATCH_MARGIN),
    Math.max(0, cellBox.min[1] - PATCH_MARGIN),
    Math.max(0, cellBox.min[2] - PATCH_MARGIN),
  ];
  const hi: [number, number, number] = [
    Math.min(fine.dims[0], cellBox.max[0] + 1 + PATCH_MARGIN),
    Math.min(fine.dims[1], cellBox.max[1] + 1 + PATCH_MARGIN),
    Math.min(fine.dims[2], cellBox.max[2] + 1 + PATCH_MARGIN),
  ];
  const patchBox: Aabb = {
    min: [
      fine.min[0] + lo[0] * FINE,
      fine.min[1] + lo[1] * FINE,
      fine.min[2] + lo[2] * FINE,
    ],
    max: [
      fine.min[0] + hi[0] * FINE,
      fine.min[1] + hi[1] * FINE,
      fine.min[2] + hi[2] * FINE,
    ],
  };
  // Binary field over the carved occupancy (±0.5; air-positive like the caves).
  // Sampled by CONTAINING CELL. OFF-GRID: solid EXCEPT inside a carve volume —
  // a carve that exits through the grid boundary (a collar-bore through the
  // region's outer shell face) genuinely CONTINUES beyond the grid as the bore;
  // reading off-grid as unconditionally solid made Surface-Nets manufacture a
  // closing lid across the opening at the last cell layer (the W2 gate's
  // "carved opening shows as closed").
  const inBounds = (i: number, j: number, k: number): boolean =>
    i >= 0 &&
    i < fine.dims[0] &&
    j >= 0 &&
    j < fine.dims[1] &&
    k >= 0 &&
    k < fine.dims[2];
  const field = (x: number, y: number, z: number): number => {
    const i = Math.floor((x - fine.min[0]) / FINE);
    const j = Math.floor((y - fine.min[1]) / FINE);
    const k = Math.floor((z - fine.min[2]) / FINE);
    if (inBounds(i, j, k)) return fineGet(fine, i, j, k) === 1 ? -0.5 : 0.5;
    return volumes.some((v) => insideVolume(v, x, y, z)) ? 0.5 : -0.5;
  };
  const patch = surfaceNets(field, {
    min: patchBox.min,
    cellSize: FINE,
    dims: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
  });
  return { fine, carved, patch, patchBox };
}

/** Turn every solid fine cell whose cube OVERLAPS the capsule volume to air.
 *  Overlap — not cell-centre-inside — so a solid voxel the capsule merely clips
 *  is removed too; nothing solid pokes into the swept bore the collider follows.
 *  The scan window is the segment AABB dilated by the radius plus a one-cell
 *  guard, so a cell whose far corner just grazes the radius is not missed. */
function carveCapsule(f: FineGrid, v: CapsuleVolume, out: Set<number>): void {
  const r2 = v.radius * v.radius;
  const lo: [number, number, number] = [
    Math.floor((Math.min(v.a[0], v.b[0]) - v.radius - f.min[0]) / FINE) - 1,
    Math.floor((Math.min(v.a[1], v.b[1]) - v.radius - f.min[1]) / FINE) - 1,
    Math.floor((Math.min(v.a[2], v.b[2]) - v.radius - f.min[2]) / FINE) - 1,
  ];
  const hi: [number, number, number] = [
    Math.ceil((Math.max(v.a[0], v.b[0]) + v.radius - f.min[0]) / FINE) + 1,
    Math.ceil((Math.max(v.a[1], v.b[1]) + v.radius - f.min[1]) / FINE) + 1,
    Math.ceil((Math.max(v.a[2], v.b[2]) + v.radius - f.min[2]) / FINE) + 1,
  ];
  for (let k = Math.max(0, lo[2]); k < Math.min(f.dims[2], hi[2]); k++)
    for (let j = Math.max(0, lo[1]); j < Math.min(f.dims[1], hi[1]); j++)
      for (let i = Math.max(0, lo[0]); i < Math.min(f.dims[0], hi[0]); i++) {
        if (fineGet(f, i, j, k) !== 1) continue;
        const cellLo: Vec3 = [
          f.min[0] + i * FINE,
          f.min[1] + j * FINE,
          f.min[2] + k * FINE,
        ];
        const cellHi: Vec3 = [
          cellLo[0] + FINE,
          cellLo[1] + FINE,
          cellLo[2] + FINE,
        ];
        if (segAabbDist2(v.a, v.b, cellLo, cellHi) > r2) continue;
        fineSet(f, i, j, k, 0);
        out.add(fineIndex(f, i, j, k));
      }
}

/** The two axes perpendicular to each cardinal axis. */
const PERP: Record<0 | 1 | 2, [0 | 1 | 2, 0 | 1 | 2]> = {
  0: [1, 2],
  1: [0, 2],
  2: [0, 1],
};

/** The cylinder's cardinal axis. Setup-loud on a non-axis-aligned segment —
 *  the substrate only emits cardinal carves (quarter-turn placements preserve
 *  axis-alignment), and the flat-end overlap test below relies on it. */
function cylinderAxis(v: CylinderVolume): 0 | 1 | 2 {
  const d: Vec3 = [
    Math.abs(v.b[0] - v.a[0]),
    Math.abs(v.b[1] - v.a[1]),
    Math.abs(v.b[2] - v.a[2]),
  ];
  const axis: 0 | 1 | 2 =
    d[0] >= d[1] && d[0] >= d[2] ? 0 : d[1] >= d[2] ? 1 : 2;
  const [p, q] = PERP[axis];
  if (d[p] > 1e-9 || d[q] > 1e-9) {
    throw new Error("carve: cylinder volume must be axis-aligned");
  }
  return axis;
}

/** Turn every solid fine cell whose cube overlaps the FLAT-ended cylinder to
 *  air: the cell's axial span must truly overlap the segment span (no
 *  spherical reach past the ends — the punch-a-wall primitive), and its box
 *  must lie within `radius` of the axis line on the two perpendicular axes.
 *  `clipBelowY` protects the floor beneath a door-plane opening. */
function carveCylinder(f: FineGrid, v: CylinderVolume, out: Set<number>): void {
  const axis = cylinderAxis(v);
  const [p, q] = PERP[axis];
  const axLo = Math.min(v.a[axis], v.b[axis]);
  const axHi = Math.max(v.a[axis], v.b[axis]);
  const r2 = v.radius * v.radius;
  const lo: [number, number, number] = [
    Math.floor((Math.min(v.a[0], v.b[0]) - v.radius - f.min[0]) / FINE) - 1,
    Math.floor((Math.min(v.a[1], v.b[1]) - v.radius - f.min[1]) / FINE) - 1,
    Math.floor((Math.min(v.a[2], v.b[2]) - v.radius - f.min[2]) / FINE) - 1,
  ];
  const hi: [number, number, number] = [
    Math.ceil((Math.max(v.a[0], v.b[0]) + v.radius - f.min[0]) / FINE) + 1,
    Math.ceil((Math.max(v.a[1], v.b[1]) + v.radius - f.min[1]) / FINE) + 1,
    Math.ceil((Math.max(v.a[2], v.b[2]) + v.radius - f.min[2]) / FINE) + 1,
  ];
  for (let k = Math.max(0, lo[2]); k < Math.min(f.dims[2], hi[2]); k++)
    for (let j = Math.max(0, lo[1]); j < Math.min(f.dims[1], hi[1]); j++)
      for (let i = Math.max(0, lo[0]); i < Math.min(f.dims[0], hi[0]); i++) {
        if (fineGet(f, i, j, k) !== 1) continue;
        const cellLo: Vec3 = [
          f.min[0] + i * FINE,
          f.min[1] + j * FINE,
          f.min[2] + k * FINE,
        ];
        const cellHi: Vec3 = [
          cellLo[0] + FINE,
          cellLo[1] + FINE,
          cellLo[2] + FINE,
        ];
        if (v.clipBelowY !== undefined && cellHi[1] <= v.clipBelowY) continue;
        if (cellHi[axis] <= axLo || cellLo[axis] >= axHi) continue; // flat ends
        const dp = gap(v.a[p], cellLo[p], cellHi[p]);
        const dq = gap(v.a[q], cellLo[q], cellHi[q]);
        if (dp * dp + dq * dq > r2) continue;
        fineSet(f, i, j, k, 0);
        out.add(fineIndex(f, i, j, k));
      }
}

/** Is the POINT inside the carve volume? The patch field's off-grid rule: a
 *  carve exiting through the grid boundary continues beyond it as open air. */
function insideVolume(
  v: CarveVolume,
  x: number,
  y: number,
  z: number,
): boolean {
  const r2 = v.radius * v.radius;
  if (v.kind === "capsule") return pointSegDist2([x, y, z], v.a, v.b) <= r2;
  if (v.clipBelowY !== undefined && y <= v.clipBelowY) return false;
  const axis = cylinderAxis(v);
  const [p, q] = PERP[axis];
  const pt: Vec3 = [x, y, z];
  if (pt[axis] < Math.min(v.a[axis], v.b[axis])) return false;
  if (pt[axis] > Math.max(v.a[axis], v.b[axis])) return false;
  const dp = pt[p] - v.a[p];
  const dq = pt[q] - v.a[q];
  return dp * dp + dq * dq <= r2;
}

/** Squared distance from point `pt` to segment ab. */
function pointSegDist2(pt: Vec3, a: Vec3, b: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const abLen2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t =
    abLen2 === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((pt[0] - a[0]) * ab[0] +
              (pt[1] - a[1]) * ab[1] +
              (pt[2] - a[2]) * ab[2]) /
              abLen2,
          ),
        );
  const dx = pt[0] - (a[0] + ab[0] * t);
  const dy = pt[1] - (a[1] + ab[1] * t);
  const dz = pt[2] - (a[2] + ab[2] * t);
  return dx * dx + dy * dy + dz * dz;
}

/** Squared distance from segment ab to the AABB [lo,hi]. Exact for a === b
 *  (sphere → point-to-box) and for AXIS-ALIGNED segments — the only kinds the
 *  substrate emits (connectors are cardinal; worldToLocal's quarter-turns
 *  preserve axis-alignment). For an OBLIQUE segment it UPPER-bounds the true
 *  distance (it measures one specific segment point — the one nearest the box
 *  centre), so it can report `> r²` for a cell that truly overlaps and thus
 *  UNDER-carve (solid left in the bore). Moot today; revisit before feeding it
 *  a diagonal capsule. */
function segAabbDist2(a: Vec3, b: Vec3, lo: Vec3, hi: Vec3): number {
  const cx = (lo[0] + hi[0]) * 0.5;
  const cy = (lo[1] + hi[1]) * 0.5;
  const cz = (lo[2] + hi[2]) * 0.5;
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const abLen2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t =
    abLen2 === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((cx - a[0]) * ab[0] + (cy - a[1]) * ab[1] + (cz - a[2]) * ab[2]) /
              abLen2,
          ),
        );
  const dx = gap(a[0] + ab[0] * t, lo[0], hi[0]);
  const dy = gap(a[1] + ab[1] * t, lo[1], hi[1]);
  const dz = gap(a[2] + ab[2] * t, lo[2], hi[2]);
  return dx * dx + dy * dy + dz * dz;
}

/** 0 when v is within [lo,hi], else the distance to the nearer bound. */
function gap(v: number, lo: number, hi: number): number {
  if (v < lo) return lo - v;
  if (v > hi) return v - hi;
  return 0;
}

/** Integer cell AABB (inclusive) of the carved set. */
function carvedCellBounds(
  f: FineGrid,
  carved: Set<number>,
): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const idx of carved) {
    const i = idx % f.dims[0];
    const j = Math.floor(idx / f.dims[0]) % f.dims[1];
    const k = Math.floor(idx / (f.dims[0] * f.dims[1]));
    if (i < min[0]) min[0] = i;
    if (i > max[0]) max[0] = i;
    if (j < min[1]) min[1] = j;
    if (j > max[1]) max[1] = j;
    if (k < min[2]) min[2] = k;
    if (k > max[2]) max[2] = k;
  }
  return { min, max };
}
