// packages/dungeon/src/themes/grid-stamp.ts — the shared grid-vocabulary stamp
// machinery (W3 Task 1): the stamp shape every grid interior algorithm emits, plus
// door construction / door-approach validation / floor-anchor scanning. Extracted
// VERBATIM from hall.ts so hall AND maze consume one implementation. Integer/lattice
// math only — no trig, no dust, no RNG (stampers own their randomness).

import type { FloorRect } from "../props/scatter.ts";
import { AIR, CELL, type CoarseGrid, coarseGet } from "../substrate/grid.ts";
import type { DoorSpec } from "../substrate/skin.ts";
import type {
  Connection,
  RegionKind,
  ScatterLayerSpec,
  Vec3,
} from "../world/region.ts";

/** Which wall of a grid stamp's rectangular shell a door sits on. SHARED by every grid
 *  vocabulary (hall, maze, …) — not a hall concept. */
export type GridWall = "north" | "south" | "east" | "west";

/** A grid door request: which wall, and an offset along it. The offset UNIT is the
 *  stamper's own (hall: coarse cells; maze: maze cells — it converts before doorAt). */
export type GridDoor = { wall: GridWall; offset: number };

/** The stamp shape EVERY grid-built interior algorithm emits (the W3 plug point):
 *  a sealed coarse shell, door-class portal metadata (portal i pairs with
 *  doorSpecs[i]), and the dressable floor rects. `dressingLayers` optionally
 *  overrides the hall-default dressing set (absent = hall defaults) — the maze
 *  ships rubble-only (dynamic crates in 2.0 m passages are wedge-bait). */
export type GridStamp = {
  /** WHICH grid vocabulary stamped this — each stamper sets its own (`hall()` → `"hall"`,
   *  `maze()` → `"maze"`). `expandGridRegion` copies it straight into the realized region's
   *  `provenance.theme`, so a maze region self-reports as a maze. Carried on the STAMP (not
   *  hard-coded downstream) because the expand path is vocabulary-agnostic by design: the only
   *  place that knows the vocabulary is the stamper itself. */
  theme: RegionKind;
  coarse: CoarseGrid;
  portals: Connection[];
  doorSpecs: DoorSpec[];
  anchors: FloorRect[];
  dressingLayers?: ScatterLayerSpec[];
};

export const DOOR_W_CELLS = 4; // 2.0 m
export const DOOR_H_CELLS = 6; // 3.0 m

/** How far inward of a door's outer shell plane its dressing-free walk lane runs (m). */
export const DOOR_LANE_DEPTH = 3.0;
/** How wide that lane is (m) — the door opening (`DOOR_W_CELLS * CELL`). */
const DOOR_LANE_WIDTH = DOOR_W_CELLS * CELL;
/** The interior floor plane in local frame: coarse j=0 is the floor slab (min.y = -CELL),
 *  so the first interior cell layer (j=1) rests at y=0. */
const FLOOR_Y = 0;
/** The coarse height layer the anchor scan reads: the first interior layer above the
 *  floor, i.e. what a crate standing on the floor would occupy. */
const FLOOR_LAYER_J = 1;

/** Exact outward normals per wall — no trig, no dust. */
const WALL_NORMAL: Record<GridWall, Vec3> = {
  east: [1, 0, 0],
  west: [-1, 0, 0],
  north: [0, 0, 1],
  south: [0, 0, -1],
};
const WALL_FACE: Record<GridWall, DoorSpec["face"]> = {
  east: 0,
  west: 1,
  north: 4,
  south: 5,
};

/** An XZ rectangle in the stamp's local frame — the door-lane footprint a cell is
 *  tested against. */
type Lane = { x0: number; x1: number; z0: number; z1: number };

/** One door's walk lane: `DOOR_LANE_WIDTH` across the portal's lateral axis, running
 *  `DOOR_LANE_DEPTH` INWARD (against the portal's outward facing) from its outer shell
 *  plane. Cardinal facings only (exact ±1 components) — no trig, no dust. */
function doorLane(p: Connection): Lane {
  const half = DOOR_LANE_WIDTH / 2;
  const [px, , pz] = p.position;
  if (p.facing[2] !== 0) {
    const inward = pz - p.facing[2] * DOOR_LANE_DEPTH;
    return {
      x0: px - half,
      x1: px + half,
      z0: Math.min(pz, inward),
      z1: Math.max(pz, inward),
    };
  }
  const inward = px - p.facing[0] * DOOR_LANE_DEPTH;
  return {
    x0: Math.min(px, inward),
    x1: Math.max(px, inward),
    z0: pz - half,
    z1: pz + half,
  };
}

/** Whether coarse column `(i,k)` is dressable: its floor-layer cell and all eight of its
 *  floor-layer neighbours are AIR. Off-grid reads MASONRY (grid.ts), so this excludes the
 *  1-cell surround of every pillar AND the wall-hugging ring — a crate's half-extent (up
 *  to 0.3 m) can then never spawn inside masonry. */
function columnFree(g: CoarseGrid, i: number, k: number): boolean {
  for (let dk = -1; dk <= 1; dk++)
    for (let di = -1; di <= 1; di++)
      if (coarseGet(g, i + di, FLOOR_LAYER_J, k + dk) !== AIR) return false;
  return true;
}

/** Whether coarse column `(i,k)`'s floor footprint overlaps any door lane (touching edges
 *  do not count — the lane is a half-open footprint). */
function inAnyLane(i: number, k: number, lanes: Lane[]): boolean {
  const x0 = i * CELL;
  const x1 = x0 + CELL;
  const z0 = k * CELL;
  const z1 = z0 + CELL;
  return lanes.some((l) => x0 < l.x1 && x1 > l.x0 && z0 < l.z1 && z1 > l.z0);
}

/** The dressable floor rectangles of a stamped grid interior: scan the interior columns
 *  at the floor layer, keep the ones that are {@link columnFree} and clear of every door
 *  lane, and merge each row's contiguous run of keepers into one rect (fewer, larger
 *  rects → a cheaper area CDF for `scatter`). Deterministic: pure integer/lattice math. */
export function floorAnchors(
  g: CoarseGrid,
  interior: [number, number],
  portals: Connection[],
): FloorRect[] {
  const [w, d] = interior;
  const lanes = portals.map(doorLane);
  const out: FloorRect[] = [];
  for (let k = 1; k <= d; k++) {
    let runStart = -1;
    for (let i = 1; i <= w + 1; i++) {
      const keep = i <= w && columnFree(g, i, k) && !inAnyLane(i, k, lanes);
      if (keep && runStart < 0) runStart = i;
      if (!keep && runStart >= 0) {
        out.push({
          minX: runStart * CELL,
          maxX: i * CELL,
          z0: k * CELL,
          z1: (k + 1) * CELL,
          y: FLOOR_Y,
        });
        runStart = -1;
      }
    }
  }
  return out;
}

/** How deep (coarse cells) a door's centre walk-lane must be clear of solids.
 *
 *  KNIFE-EDGE COUPLING: every grid stamper's door-adjacent passage depth must be
 *  `>= DOOR_CLEARANCE_DEPTH_CELLS`, or {@link validateDoorApproach}'s centre lane reaches
 *  past that passage into the solid band beyond it and rejects structurally valid content.
 *  The maze sits exactly on the edge (`PASSAGE_CELLS` = 4 = this) and pins it in a test. */
export const DOOR_CLEARANCE_DEPTH_CELLS = 4; // 2.0 m — the player-spawn / probe inset

/** Traversability by construction (charter §2.2): a door whose CENTRE walk lane
 *  (the middle 2 of its 4 width cells × `DOOR_CLEARANCE_DEPTH_CELLS` inward ×
 *  full door height) is blocked by a solid is invalid content — throw at stamp
 *  time, setup-loud. The W2 gate found exactly this: a colonnade pillar dead on
 *  a door's approach axis, masked until then by an over-carving connector that
 *  had been eating the pillar. Door-EDGE cells may still pass close to solids
 *  (atmospheric); only the centre capsule lane is guaranteed. `label` names the
 *  stamper in the error ("hall" / "maze"); `interior` is [w, d] in coarse cells. */
export function validateDoorApproach(
  g: CoarseGrid,
  interior: [number, number],
  door: GridDoor,
  spec: DoorSpec,
  label: string,
): void {
  const alongX = door.wall === "north" || door.wall === "south";
  const [w, d] = interior;
  // Middle 2 lateral cells of the 4-cell door span:
  const latLo = (alongX ? spec.min[0] : spec.min[2]) + 1;
  // Interior depth cells, from the wall inward:
  const depth: number[] = [];
  for (let step = 1; step <= DOOR_CLEARANCE_DEPTH_CELLS; step++) {
    if (door.wall === "east") depth.push(w + 1 - step);
    else if (door.wall === "west") depth.push(step);
    else if (door.wall === "north") depth.push(d + 1 - step);
    else depth.push(step);
  }
  for (const dc of depth)
    for (let lat = latLo; lat < latLo + 2; lat++)
      for (let j = 1; j <= DOOR_H_CELLS; j++) {
        const [i, k] = alongX ? [lat, dc] : [dc, lat];
        if (coarseGet(g, i, j, k) !== AIR) {
          throw new Error(
            `${label}: door on ${door.wall} at offset ${door.offset} has a blocked walk lane ` +
              `(solid at cell ${i},${j},${k}) — move the door or adjust the interior`,
          );
        }
      }
}

/** Portal + door cells for one wall door. Portal position = threshold centre on
 *  the OUTER shell plane (the join/collar seat plane); facing = exact cardinal.
 *  `door.offset` here is in COARSE cells along the wall (callers with a coarser
 *  authoring unit — the maze's maze-cell offsets — convert before calling). */
export function doorAt(
  dims: [number, number, number],
  door: GridDoor,
): { portal: Connection; spec: DoorSpec } {
  const n = WALL_NORMAL[door.wall];
  const face = WALL_FACE[door.wall];
  const alongX = door.wall === "north" || door.wall === "south";
  const interiorLen = (alongX ? dims[0] : dims[2]) - 2;
  const lo = 1 + Math.max(0, Math.min(door.offset, interiorLen - DOOR_W_CELLS));
  // Door AIR cells live in the SHELL layer (i or k = 0 | dims-1) once opened:
  const shell = (axisDim: number): number =>
    n[0] + n[2] > 0 ? axisDim - 1 : 0;
  const min: [number, number, number] = alongX
    ? [lo, 1, shell(dims[2])]
    : [shell(dims[0]), 1, lo];
  const spec: DoorSpec = { min, size: [DOOR_W_CELLS, DOOR_H_CELLS], face };
  const wallMid = lo * CELL + (DOOR_W_CELLS * CELL) / 2;
  const outerPlane = (axisDim: number): number =>
    n[0] + n[2] > 0 ? axisDim * CELL : 0;
  const position: Vec3 = alongX
    ? [wallMid, 0, outerPlane(dims[2])]
    : [outerPlane(dims[0]), 0, wallMid];
  return {
    portal: {
      position,
      facing: [...n] as Vec3,
      width: DOOR_W_CELLS * CELL,
      height: DOOR_H_CELLS * CELL,
      kind: "door",
    },
    spec,
  };
}
