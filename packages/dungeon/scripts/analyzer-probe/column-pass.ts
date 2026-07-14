// Stage 1 of the hybrid analyzer: Recast-style walkable-column filters over
// collider occupancy. Emits FLAGS (candidate hazards) — stage 2 (sweep.ts)
// confirms or clears them with the real CharacterMover.
//
// Resolution note: this pass reads the voxel COLLIDER's own occupancy. The
// collider IS the runtime ground truth (it is what the capsule touches), so
// analysing at collider resolution is exact w.r.t. the runtime geometry. The
// research's "cells << capsule radius" condition applies to analysing SMOOTH
// SOURCE geometry (where a coarse grid aliases the true surface) — which we
// deliberately do not do here.
import { STEP_HEIGHT } from "../../src/walkability.ts";
import type { Occupancy } from "./occupancy.ts";

export type FlagKind = "lip-near-wall" | "ledge" | "low-clearance" | "narrow";

export type Flag = {
  kind: FlagKind;
  /** Grid cell of the walkable floor cell the flag attaches to. */
  cell: [number, number, number];
  /** World-space centre of that floor surface. */
  world: [number, number, number];
};

export type ColumnPassResult = {
  /** Walkable floor cells, keyed "x,y,z" (y = the AIR cell above the floor). */
  walkable: Set<string>;
  flags: Flag[];
};

const CAPSULE_HEIGHT_M = 1.8; // 2*(halfHeight 0.6 + radius 0.3), main.ts capsule
const CAPSULE_RADIUS_M = 0.3;

/** Walkable-column pass. Filters (Recast's set, over voxel columns):
 *  - clearance: air run above a floor >= capsule height, else low-clearance
 *  - step: neighbour floor rise in (0, STEP_HEIGHT] near a wall -> lip-near-wall
 *  - ledge: neighbour floor rise > STEP_HEIGHT -> ledge
 *  - radius: walkable cell within capsule radius of a wall -> narrow
 *  Thresholds are strictly TIGHTER than the controller (borderline flags). */
export function columnPass(occ: Occupancy): ColumnPassResult {
  const [nx, ny, nz] = occ.dims;
  const [sx, sy, sz] = occ.size;
  const at = (x: number, y: number, z: number): number =>
    occ.solid[x + nx * (y + ny * z)] === 1 ? 1 : 0;
  const inb = (x: number, y: number, z: number): boolean =>
    x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz;

  const clearCells = Math.ceil(CAPSULE_HEIGHT_M / sy);
  const wallCellsXZ = Math.ceil(CAPSULE_RADIUS_M / Math.min(sx, sz));
  const wallProbeUp = Math.ceil(1.0 / sy); // "wall" = solid within 1 m above floor

  // Walkable = an air cell directly above solid, with a capsule-height air run.
  const walkable = new Set<string>();
  for (let z = 0; z < nz; z++)
    for (let x = 0; x < nx; x++)
      for (let y = 1; y < ny; y++) {
        if (at(x, y - 1, z) === 1 && at(x, y, z) === 0) {
          // clearance run
          let clear = 0;
          while (y + clear < ny && at(x, y + clear, z) === 0) clear++;
          if (y + clear >= ny) clear = clearCells; // open to sky of the grid
          if (clear >= clearCells) walkable.add(`${x},${y},${z}`);
        }
      }

  const flags: Flag[] = [];
  const world = (x: number, y: number, z: number): [number, number, number] => [
    occ.origin[0] + (x + 0.5) * sx,
    occ.origin[1] + y * sy,
    occ.origin[2] + (z + 0.5) * sz,
  ];
  const push = (kind: FlagKind, x: number, y: number, z: number): void => {
    flags.push({ kind, cell: [x, y, z], world: world(x, y, z) });
  };

  const stepCells = Math.floor(STEP_HEIGHT / sy); // rise <= this is "steppable"
  for (const key of walkable) {
    const [x, y, z] = key.split(",").map(Number) as [number, number, number];
    // low-clearance flag: bounded air run above (already excluded from
    // walkable) is flagged from the adjacent walkable side.
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ax = x + dx;
      const az = z + dz;
      if (!inb(ax, y, az)) continue;
      // neighbour floor at same-ish level but with clearance below capsule?
      if (at(ax, y - 1, az) === 1 && at(ax, y, az) === 0) {
        let clear = 0;
        while (y + clear < ny && at(ax, y + clear, az) === 0) clear++;
        if (y + clear < ny && clear < clearCells)
          push("low-clearance", ax, y, az);
      }
      // rise: find neighbour's floor above our y
      for (let ry = 1; ry <= stepCells + 2 && y + ry < ny; ry++) {
        if (at(ax, y + ry - 1, az) === 1 && at(ax, y + ry, az) === 0) {
          if (ry > stepCells) {
            push("ledge", x, y, z);
          } else {
            // steppable lip — flag only if a wall stands within capsule
            // radius beyond it (the wedge CONJUNCTION).
            let wall = false;
            for (let wx = -wallCellsXZ; wx <= wallCellsXZ && !wall; wx++)
              for (let wz = -wallCellsXZ; wz <= wallCellsXZ && !wall; wz++)
                for (let wy = 1; wy <= wallProbeUp && !wall; wy++) {
                  const px = ax + wx;
                  const pz = az + wz;
                  const py = y + ry + wy - 1;
                  if (inb(px, py, pz) && at(px, py, pz) === 1) wall = true;
                }
            if (wall) push("lip-near-wall", x, y, z);
          }
          break;
        }
      }
    }
    // narrow: solid within capsule radius at torso height on both sides
    let sides = 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const px = x + dx * wallCellsXZ;
      const pz = z + dz * wallCellsXZ;
      const py = y + Math.ceil(0.5 / sy);
      if (inb(px, py, pz) && at(px, py, pz) === 1) sides++;
    }
    if (sides >= 2) push("narrow", x, y, z);
  }
  return { walkable, flags };
}
