// Probe 2 (W3 spec §7): the aperture seam is a NEW boundary composition — two grid
// shells back-to-back — so per the W2 post-mortem rules it gets headless GEOMETRIC
// assertions, not realize-success: (a) sightlines through the doorway clear every
// kit/dressing instance AABB while a control lane through the sealed wall is BLOCKED;
// (b) the two region AABBs share exactly one plane. Collision through the doorway is
// the gate-world walk's job (Probe 1 aperture lanes) — the voxel proxy is opaque here
// (plan refinement 4). Instance AABBs are exact for our quarter-turn TRS mats.
import { expect, test } from "bun:test";
import type { RegionData, Vec3 } from "../src/region.ts";
import { CELL } from "../src/substrate/grid.ts";
import { realizeWorldSpec } from "../src/world-build.ts";
import { MAZE_APERTURE } from "./_helpers/world-fixtures.ts";

type Box = { min: Vec3; max: Vec3 };

/** World AABBs of every instanced cube: centre = the TRS translation column; per-axis
 *  half-extent = half the sum of |axis components| across the scaled basis columns
 *  (exact under quarter-turn yaw; conservative otherwise — fine for a blocker test). */
function instanceAabbs(data: RegionData): Box[] {
  const out: Box[] = [];
  for (const g of data.instances) {
    const m = g.transforms;
    for (let i = 0; i < m.length; i += 16) {
      const hx =
        (Math.abs(m[i] as number) +
          Math.abs(m[i + 4] as number) +
          Math.abs(m[i + 8] as number)) /
        2;
      const hy =
        (Math.abs(m[i + 1] as number) +
          Math.abs(m[i + 5] as number) +
          Math.abs(m[i + 9] as number)) /
        2;
      const hz =
        (Math.abs(m[i + 2] as number) +
          Math.abs(m[i + 6] as number) +
          Math.abs(m[i + 10] as number)) /
        2;
      const cx = m[i + 12] as number;
      const cy = m[i + 13] as number;
      const cz = m[i + 14] as number;
      out.push({
        min: [cx - hx, cy - hy, cz - hz],
        max: [cx + hx, cy + hy, cz + hz],
      });
    }
  }
  return out;
}

/** Segment–AABB intersection (slab test). */
function segHitsBox(p0: Vec3, p1: Vec3, box: Box): boolean {
  let tMin = 0;
  let tMax = 1;
  for (let axis = 0; axis < 3; axis++) {
    const o = p0[axis] as number;
    const d = (p1[axis] as number) - o;
    const lo = box.min[axis] as number;
    const hi = box.max[axis] as number;
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return false;
      continue;
    }
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return false;
  }
  return true;
}

// Fixture geometry (see MAZE_APERTURE's TSDoc): the coincident door portals sit at
// world [0, 0, 4]; the doorway is 2.0 wide (z 3..5) × 3.0 high, through two 0.5 m
// shells (x −0.5..0.5). hall-b interior lies x < −0.5; maze-a passages x > 0.5.
//
// LANE COORDINATES ARE NOT FREE PARAMETERS — read before touching them. The kit skins
// each 0.5 m cell face with a 0.46 m panel, so a shell is a LATTICE of panels separated
// by 0.04 m GROUT GAPS, in BOTH cross-axes: bands run [0.02,0.48], [0.52,0.98],
// [1.02,1.48], … off each axis's cell origin (y cells start at −0.5, z cells at 0). An
// axis-aligned lane whose (y, z) lands in a gap threads the skin ANYWHERE — sealed wall
// included — so it can neither prove clearance nor ever be blocked: a VACUOUS assertion.
// The two obvious "centre" picks are exactly the two worst: y = 1.50 is a y-gap, and the
// door-centre z = 4.00 is a z-gap.
//
// The invariant that makes a lane SAFE is not a lucky decimal: a lane on a CELL CENTRE is
// inside the panel band for any PANEL_REVEAL < CELL/2, since the band is the cell minus a
// symmetric per-side reveal. So the lanes below are DERIVED — cell INDICES (the honest free
// parameter) through `cellCentre` off the lattice origin — and a change to CELL or
// PANEL_REVEAL cannot silently re-vacuum this probe. Verified by sabotage: with the
// aperture's two `openPortals.push` lines commented out the doorway lanes are BLOCKED and
// this test fails — which is the only reason to believe it when it passes.

/** Centre of cell `j` on an axis whose lattice starts at `origin`. A grid region's
 *  `bounds.min` IS that origin (gridStampBounds = the coarse grid's corner), and both
 *  regions share ONE lattice — hall-b's derived placement is snapped to it. */
const cellCentre = (origin: number, j: number): number =>
  origin + (j + 0.5) * CELL;

/** Lane heights, as y-cell indices off the lattice: knee, waist, head. */
const LANE_Y_CELLS = [2, 3, 4];
/** Lanes through the OPEN doorway: the two MIDDLE z-cells of the 4-cell door span (z 3..5,
 *  i.e. cells 6..9) — inside the opening with a full cell of margin either side. */
const DOORWAY_LANE_Z_CELLS = [7, 8];
/** The CONTROL lane: a z-cell PAST the door span, still inside both interiors, so it crosses
 *  hall-b's east shell face and maze-a's west shell face where both are SEALED. (Panels sit
 *  PROUD of the masonry — in the air beside it — so a lane through the wall interior would
 *  miss every AABB; the control must cross the faces that meet interior air.) */
const SEALED_LANE_Z_CELL = 11;

test("aperture doorway: sightlines at three heights clear BOTH shells; the sealed wall blocks", () => {
  const realized = realizeWorldSpec(MAZE_APERTURE);
  const mazeA = realized.regions.get("maze-a");
  const hallB = realized.regions.get("hall-b");
  if (!mazeA || !hallB) throw new Error("fixture regions missing");
  const boxes = [...instanceAabbs(mazeA), ...instanceAabbs(hallB)];
  expect(boxes.length).toBeGreaterThan(0);
  const laneYs = LANE_Y_CELLS.map((j) => cellCentre(mazeA.bounds.min[1], j));
  const doorwayZs = DOORWAY_LANE_Z_CELLS.map((j) =>
    cellCentre(mazeA.bounds.min[2], j),
  );
  const sealedZ = cellCentre(mazeA.bounds.min[2], SEALED_LANE_Z_CELL);
  // (a) Through the doorway: hall-b interior (x −2) → maze passage (x +2), inside both
  // doors' dressing-free walk lanes. Clear at every height × every doorway lane.
  for (const z of doorwayZs) {
    for (const y of laneYs) {
      const hit = boxes.some((b) => segHitsBox([-2, y, z], [2, y, z], b));
      expect(hit).toBe(false);
    }
  }
  // (b) The control: the SAME lane geometry, moved onto the sealed wall — blocked.
  for (const y of laneYs) {
    const blocked = boxes.some((b) =>
      segHitsBox([-2, y, sealedZ], [2, y, sealedZ], b),
    );
    expect(blocked).toBe(true);
  }
});

test("aperture pair: AABBs share exactly ONE plane (flush face, real contact area)", () => {
  const realized = realizeWorldSpec(MAZE_APERTURE);
  const a = realized.regions.get("maze-a");
  const b = realized.regions.get("hall-b");
  if (!a || !b) throw new Error("fixture regions missing");
  const overlap = (axis: 0 | 1 | 2): number =>
    Math.min(a.bounds.max[axis], b.bounds.max[axis]) -
    Math.max(a.bounds.min[axis], b.bounds.min[axis]);
  expect(overlap(0)).toBeCloseTo(0, 9); // the shared door plane (x = 0)
  expect(overlap(1)).toBeGreaterThan(0); // real face contact, not corner-touching
  expect(overlap(2)).toBeGreaterThan(0);
});
