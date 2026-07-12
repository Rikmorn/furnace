// src/themes/hall.ts — the parameterized grid-built hall stamper (spec §3):
// ONE archetype family; the mesh trio's identities are presets. Emits a SEALED
// coarse shell (portals are metadata; a connector opens the door cells on
// consume — D-W2-9), flat floor, pillar lattice, door-class portals on the
// OUTER shell plane with EXACT cardinal facings (integer/lattice math only).
import type { Connection, Vec3 } from "../region.ts";
import type { FloorRect } from "../scatter.ts";
import {
  AIR,
  CELL,
  type CoarseGrid,
  coarseGet,
  coarseSet,
  createCoarse,
  MASONRY,
} from "../substrate/grid.ts";
import type { DoorSpec } from "../substrate/skin.ts";

export type HallWall = "north" | "south" | "east" | "west";

export type HallParams = {
  /** INTERIOR size in coarse cells: [w(x), h(y), d(z)]. h must be >= DOOR_H_CELLS (3.0 m door). */
  size: [number, number, number];
  pillars: { kind: "none" } | { kind: "grid" | "colonnade"; spacing: number };
  doors: { wall: HallWall; offset: number }[];
};

export type HallStamp = {
  coarse: CoarseGrid;
  /** Door-class portals (metadata; shell stays sealed until consumed). Portal i
   *  pairs with doorSpecs[i]. */
  portals: Connection[];
  doorSpecs: DoorSpec[];
  /** Dressable floor: the interior floor plane (LOCAL frame, world units, y=0) MINUS
   *  every solid column's 1-cell surround (pillars AND the shell wall ring) MINUS each
   *  door's walk lane. `world-build.ts` scatters the hall's dressing layers over these
   *  (see {@link floorAnchors}). */
  anchors: FloorRect[];
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
const WALL_NORMAL: Record<HallWall, Vec3> = {
  east: [1, 0, 0],
  west: [-1, 0, 0],
  north: [0, 0, 1],
  south: [0, 0, -1],
};
const WALL_FACE: Record<HallWall, DoorSpec["face"]> = {
  east: 0,
  west: 1,
  north: 4,
  south: 5,
};

export function hall(params: HallParams, seed: string): HallStamp {
  const [w, h, d] = params.size;
  if (h < DOOR_H_CELLS) {
    throw new Error(
      `hall: interior height ${h} cells < door height ${DOOR_H_CELLS}`,
    );
  }
  const dims: [number, number, number] = [w + 2, h + 2, d + 2];
  const coarse = createCoarse([0, -CELL, 0], dims, MASONRY);
  for (let k = 1; k <= d; k++)
    for (let j = 1; j <= h; j++)
      for (let i = 1; i <= w; i++) coarseSet(coarse, i, j, k, AIR);
  stampPillars(coarse, params);
  const portals: Connection[] = [];
  const doorSpecs: DoorSpec[] = [];
  for (const door of params.doors) {
    const { portal, spec } = doorAt(dims, door);
    validateDoorApproach(coarse, params, door, spec);
    portals.push(portal);
    doorSpecs.push(spec);
  }
  void seed; // structure is params-determined; seed feeds skin variants later
  return {
    coarse,
    portals,
    doorSpecs,
    anchors: floorAnchors(coarse, [w, d], portals),
  };
}

/** An XZ rectangle in the hall's local frame — the door-lane footprint a cell is tested
 *  against. */
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

/** The dressable floor rectangles of a stamped hall: scan the interior columns at the
 *  floor layer, keep the ones that are {@link columnFree} and clear of every door lane,
 *  and merge each row's contiguous run of keepers into one rect (fewer, larger rects →
 *  a cheaper area CDF for `scatter`). Deterministic: pure integer/lattice math. */
function floorAnchors(
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

/** How deep (coarse cells) a door's centre walk-lane must be clear of pillars. */
const DOOR_CLEARANCE_DEPTH_CELLS = 4; // 2.0 m — the player-spawn / probe inset

/** Traversability by construction (charter §2.2): a door whose CENTRE walk lane
 *  (the middle 2 of its 4 width cells × `DOOR_CLEARANCE_DEPTH_CELLS` inward ×
 *  full door height) is blocked by a pillar is invalid content — throw at stamp
 *  time, setup-loud. The W2 gate found exactly this: a colonnade pillar dead on
 *  a door's approach axis, masked until then by an over-carving connector that
 *  had been eating the pillar. Door-EDGE cells may still pass close to pillars
 *  (atmospheric); only the centre capsule lane is guaranteed. */
function validateDoorApproach(
  g: CoarseGrid,
  params: HallParams,
  door: { wall: HallWall; offset: number },
  spec: DoorSpec,
): void {
  const alongX = door.wall === "north" || door.wall === "south";
  const [w, , d] = params.size;
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
            `hall: door on ${door.wall} at offset ${door.offset} has a blocked walk lane ` +
              `(pillar at cell ${i},${j},${k}) — move the door or adjust the pillar lattice`,
          );
        }
      }
}

function stampPillars(g: CoarseGrid, p: HallParams): void {
  if (p.pillars.kind === "none") return;
  const [w, h, d] = p.size;
  const s = Math.max(2, p.pillars.spacing);
  if (p.pillars.kind === "grid") {
    for (let k = s; k <= d - 1; k += s)
      for (let i = s; i <= w - 1; i += s)
        for (let j = 1; j <= h; j++) coarseSet(g, i, j, k, MASONRY);
    return;
  }
  // colonnade: twin rows flanking the central z-aisle (spike pillar-hall look).
  const centre = Math.floor(w / 2) + 1; // interior-centre i (1-based grid coords; exact for odd w too)
  const rows = [centre - 2, centre + 2];
  for (const i of rows)
    for (let k = s; k <= d - 1; k += s)
      for (let j = 1; j <= h; j++) coarseSet(g, i, j, k, MASONRY);
}

/** Portal + door cells for one wall door. Portal position = threshold centre on
 *  the OUTER shell plane (the join/collar seat plane); facing = exact cardinal. */
function doorAt(
  dims: [number, number, number],
  door: { wall: HallWall; offset: number },
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

/** The mesh trio's identities as presets of the one stamper (D-W2-2). */
export const HALL_PRESETS: Record<
  "boxRoom" | "pillarHall" | "greatHall",
  HallParams
> = {
  boxRoom: { size: [8, 6, 8], pillars: { kind: "none" }, doors: [] },
  pillarHall: {
    size: [10, 7, 16],
    pillars: { kind: "colonnade", spacing: 3 },
    doors: [],
  },
  greatHall: {
    size: [16, 9, 24],
    pillars: { kind: "grid", spacing: 4 },
    doors: [],
  },
};
