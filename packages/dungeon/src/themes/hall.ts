// src/themes/hall.ts — the parameterized grid-built hall stamper (W2 spec §3):
// ONE archetype family; the mesh trio's identities are presets. Emits a SEALED
// coarse shell (portals are metadata; a connector opens the door cells on
// consume — D-W2-9), flat floor, pillar lattice, door-class portals on the
// OUTER shell plane with EXACT cardinal facings (integer/lattice math only).
// Shared door/anchor machinery lives in grid-stamp.ts (W3 Task 1) — hall and
// maze consume ONE implementation.
import type { Connection } from "../region.ts";
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

// Re-exports: this was hall.ts's public surface before the W3 extraction —
// existing consumers keep their import paths.
export {
  DOOR_H_CELLS,
  DOOR_LANE_DEPTH,
  DOOR_W_CELLS,
  type HallWall,
} from "./grid-stamp.ts";

export type HallParams = {
  /** INTERIOR size in coarse cells: [w(x), h(y), d(z)]. h must be >= DOOR_H_CELLS (3.0 m door). */
  size: [number, number, number];
  pillars: { kind: "none" } | { kind: "grid" | "colonnade"; spacing: number };
  doors: GridDoor[];
};

/** The hall's stamp IS the shared grid-stamp shape (the W3 plug point). */
export type HallStamp = GridStamp;

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
    validateDoorApproach(coarse, [w, d], door, spec, "hall");
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
