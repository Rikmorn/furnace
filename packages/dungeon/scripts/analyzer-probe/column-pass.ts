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
import { STEP_HEIGHT } from "../../src/agent/walkability.ts";
import { cellFloorWorld, type Occupancy } from "./occupancy.ts";

export type FlagKind = "lip-near-wall" | "ledge" | "low-clearance" | "narrow";

export type Flag = {
  kind: FlagKind;
  /** The floor cell of interest. NOT guaranteed to be in `walkable`:
   *  `low-clearance` anchors on the offending NEIGHBOUR cell, which by
   *  construction failed the walkable clearance test. Stage 2 must not assume
   *  `flags[].cell` is a subset of `walkable`. */
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
/** Height above the floor at which the `narrow` filter probes for walls. */
const TORSO_PROBE_M = 0.5;
/** A "wall" beside a lip = solid within this height above the lip's floor. */
const WALL_PROBE_M = 1.0;

/** The 4 cardinal XZ neighbours. */
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

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
  const wallProbeUp = Math.ceil(WALL_PROBE_M / sy);

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
  // Deduped by (kind, cell): the rise checks run once per direction but key the
  // CENTRE cell, so a cell with rises on two sides would otherwise emit the same
  // flag twice. `Flag` carries no direction, so a duplicate holds zero extra
  // information — it would only double stage 2's expensive real-mover sweeps and
  // inflate the report's counts. Stage 2 sweeps all 4 directions itself.
  const seen = new Set<string>();
  const push = (kind: FlagKind, x: number, y: number, z: number): void => {
    const key = `${kind}@${x},${y},${z}`;
    if (seen.has(key)) return;
    seen.add(key);
    flags.push({ kind, cell: [x, y, z], world: cellFloorWorld(occ, x, y, z) });
  };

  const stepCells = Math.floor(STEP_HEIGHT / sy); // rise <= this is "steppable"

  /** The first solid cell above a walkable cell = the CEILING of the air volume it stands in
   *  (`ny` when the column is open to the top of the grid). */
  const ceilingAbove = (x: number, y: number, z: number): number => {
    let cy = y + 1;
    while (cy < ny && at(x, cy, z) === 0) cy++;
    return cy;
  };

  for (const key of walkable) {
    const [x, y, z] = key.split(",").map(Number) as [number, number, number];
    const ceiling = ceilingAbove(x, y, z);
    // low-clearance flag: bounded air run above (already excluded from
    // walkable) is flagged from the adjacent walkable side.
    for (const [dx, dz] of DIRS) {
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
      // Rise: the neighbour's FIRST floor surface above ours, searched all the way up to OUR
      // OWN CEILING. `ledge` means "there is floor over there that you cannot reach" — how far
      // above it sits is irrelevant, since anything past the mover's ~0.7 m climb ceiling is
      // equally unreachable. An earlier cap of `stepCells + 2` (3 cells = 0.75 m) made every
      // rise TALLER than that — strictly HARDER for the mover — invisible: a 1.0 m or 1.5 m rim
      // stalls the capsule and emitted NO flag at all. That is a false negative, the one class
      // this probe exists to rule out, and the corpus passed only because RIM_H / POCKET_D sit
      // exactly on the last value the cap could see.
      //
      // The bound is the CEILING, not the grid top, and that is load-bearing. `voxelsFromField`
      // is shellOnly: enclosed rock is DROPPED, so in this occupancy a wall is HOLLOW — solid
      // where it borders air, then nothing. Scanning past our ceiling finds the top of that
      // shell ("solid below, air above"), reads it as reachable-looking floor 4 m up, and flags
      // a `ledge` on every wall-adjacent cell in the map. A rise only concerns us if it stands
      // in the air volume we are standing in; above our ceiling is another volume, or rock.
      for (let ry = 1; y + ry < ceiling; ry++) {
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
    // narrow: solid within capsule radius at torso height on two+ sides.
    // Scans EVERY offset out to wallCellsXZ, not just the cell at exactly that
    // distance — probing only the far cell skips intermediate solids at finer
    // XZ sizes, and a missed hazard is the one failure mode this probe exists
    // to rule out. (At the production [0.5, _, 0.5], wallCellsXZ === 1, so this
    // is the same single probe.)
    const torsoY = y + Math.ceil(TORSO_PROBE_M / sy);
    let sides = 0;
    for (const [dx, dz] of DIRS) {
      let hit = false;
      for (let d = 1; d <= wallCellsXZ && !hit; d++) {
        const px = x + dx * d;
        const pz = z + dz * d;
        if (inb(px, torsoY, pz) && at(px, torsoY, pz) === 1) hit = true;
      }
      if (hit) sides++;
    }
    if (sides >= 2) push("narrow", x, y, z);
  }
  return { walkable, flags };
}
