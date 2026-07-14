// F0 analyzer probe — throwaway posture, kept to seed F4.
// Occupancy analyzes the voxel COLLIDER's own grid: the collider IS the
// runtime ground truth, so collider-resolution analysis is exact w.r.t.
// what the capsule touches (the research "cells << radius" condition
// applies to smooth-source analysis, which this deliberately is not).
import type { VoxelsProxy } from "../../src/proxy.ts";

/** Dense boolean grid over a voxel proxy's bounding box. */
export type Occupancy = {
  solid: Uint8Array; // x + dims[0]*(y + dims[1]*z), 1 = rock
  dims: [number, number, number];
  size: [number, number, number]; // cell size in metres (per axis)
  origin: [number, number, number]; // world position of cell (0,0,0) corner
};

/** Builds a dense occupancy grid from a corner-anchored voxels proxy.
 *  `bodyPosition` is the physics body's world position (proxy.ts convention:
 *  coords are grid ints, corner-anchored, HALF_VOXEL = 0).
 *
 *  PRECONDITION — the body is AXIS-ALIGNED. This takes a position but no
 *  rotation, so a proxy placed with a non-zero yaw is mapped as if unrotated,
 *  which silently misplaces its cells. This is not hypothetical: `cave-c` in
 *  the baked default world has `yaw = π`. A caller with rotated bodies must
 *  resolve rotation before calling (see the F0 report; unresolved as of stage 1). */
export function occupancyFromProxy(
  proxy: VoxelsProxy,
  bodyPosition: [number, number, number],
): Occupancy {
  const n = proxy.coords.length / 3;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const x = proxy.coords[3 * i] as number;
    const y = proxy.coords[3 * i + 1] as number;
    const z = proxy.coords[3 * i + 2] as number;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  // +1 air row above the topmost rock (Y max only). A tight bbox has no air
  // cell above the highest solid, and columnPass defines a floor as "air cell
  // directly above solid" — so without this pad the highest walkable surface of
  // every proxy is silently dropped. The pad is at max, so `origin` is unchanged.
  const dims: [number, number, number] = [
    maxX - minX + 1,
    maxY - minY + 2,
    maxZ - minZ + 1,
  ];
  const solid = new Uint8Array(dims[0] * dims[1] * dims[2]);
  for (let i = 0; i < n; i++) {
    const x = (proxy.coords[3 * i] as number) - minX;
    const y = (proxy.coords[3 * i + 1] as number) - minY;
    const z = (proxy.coords[3 * i + 2] as number) - minZ;
    solid[x + dims[0] * (y + dims[1] * z)] = 1;
  }
  const origin: [number, number, number] = [
    bodyPosition[0] + minX * proxy.size[0],
    bodyPosition[1] + minY * proxy.size[1],
    bodyPosition[2] + minZ * proxy.size[2],
  ];
  return { solid, dims, size: [...proxy.size], origin };
}

/** World-space centre of the FLOOR SURFACE a capsule standing in cell (x,y,z) rests on:
 *  the cell's XZ centre, and the Y of its BOTTOM face (= the top of the solid cell below).
 *  Shared by stage 1 (flag positions) and stage 2 (spawn placement) so the two stages
 *  cannot drift apart on the one mapping they both depend on. */
export function cellFloorWorld(
  occ: Occupancy,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    occ.origin[0] + (x + 0.5) * occ.size[0],
    occ.origin[1] + y * occ.size[1],
    occ.origin[2] + (z + 0.5) * occ.size[2],
  ];
}

/** Tolerance (in cells) for the lattice-alignment check. */
const LATTICE_EPS = 1e-6;

/** Merges several occupancies (e.g. all voxel bodies of a loaded world) into
 *  one grid.
 *
 *  Preconditions (setup-path, so both THROW rather than degrade — a silent
 *  mis-merge would corrupt every downstream flag):
 *  - all inputs share the same cell size;
 *  - every origin lies on the shared cell lattice. The merge reconstructs each
 *    body's grid offset as `origin / size`, so an origin that is not a whole
 *    number of cells would be rounded — displacing that body's every solid cell
 *    by up to half a cell. `voxelProxyPosition` (src/proxy.ts) does NOT
 *    guarantee alignment: it returns `regionOrigin + grid.min`, which is only
 *    on-lattice if the caller's region origin happens to be. */
export function mergeOccupancies(list: Occupancy[]): Occupancy {
  const first = list[0];
  if (first === undefined) throw new Error("mergeOccupancies: empty");
  const size = first.size;
  for (const o of list) {
    if (o.size[0] !== size[0] || o.size[1] !== size[1] || o.size[2] !== size[2])
      throw new Error("mergeOccupancies: mixed cell sizes");
    for (let a = 0; a < 3; a++) {
      const cells = (o.origin[a] as number) / (o.size[a] as number);
      if (Math.abs(cells - Math.round(cells)) > LATTICE_EPS)
        throw new Error(
          `mergeOccupancies: off-lattice origin on axis ${a} — ${o.origin[a]} is not a whole number of ${o.size[a]}m cells (${cells} cells)`,
        );
    }
  }
  const min = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const o of list) {
    for (let a = 0; a < 3; a++) {
      const lo = Math.round((o.origin[a] as number) / (o.size[a] as number));
      min[a] = Math.min(min[a] as number, lo);
      max[a] = Math.max(max[a] as number, lo + (o.dims[a] as number));
    }
  }
  const dims: [number, number, number] = [
    (max[0] as number) - (min[0] as number),
    (max[1] as number) - (min[1] as number),
    (max[2] as number) - (min[2] as number),
  ];
  const solid = new Uint8Array(dims[0] * dims[1] * dims[2]);
  for (const o of list) {
    const ox = Math.round(o.origin[0] / size[0]) - (min[0] as number);
    const oy = Math.round(o.origin[1] / size[1]) - (min[1] as number);
    const oz = Math.round(o.origin[2] / size[2]) - (min[2] as number);
    for (let z = 0; z < o.dims[2]; z++)
      for (let y = 0; y < o.dims[1]; y++)
        for (let x = 0; x < o.dims[0]; x++) {
          if (o.solid[x + o.dims[0] * (y + o.dims[1] * z)] === 1) {
            const gx = x + ox;
            const gy = y + oy;
            const gz = z + oz;
            solid[gx + dims[0] * (gy + dims[1] * gz)] = 1;
          }
        }
  }
  return {
    solid,
    dims,
    size,
    origin: [
      (min[0] as number) * size[0],
      (min[1] as number) * size[1],
      (min[2] as number) * size[2],
    ],
  };
}
