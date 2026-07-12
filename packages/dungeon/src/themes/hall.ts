// src/themes/hall.ts — the parameterized grid-built hall stamper (spec §3):
// ONE archetype family; the mesh trio's identities are presets. Emits a SEALED
// coarse shell (portals are metadata; a connector opens the door cells on
// consume — D-W2-9), flat floor, pillar lattice, door-class portals on the
// OUTER shell plane with EXACT cardinal facings (integer/lattice math only).
import type { Connection, Vec3 } from "../region.ts";
import {
  AIR,
  CELL,
  type CoarseGrid,
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
};

export const DOOR_W_CELLS = 4; // 2.0 m
export const DOOR_H_CELLS = 6; // 3.0 m

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
    portals.push(portal);
    doorSpecs.push(spec);
  }
  void seed; // structure is params-determined; seed feeds skin variants later
  return { coarse, portals, doorSpecs };
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
