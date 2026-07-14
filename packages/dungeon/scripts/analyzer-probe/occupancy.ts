// F0 analyzer probe — throwaway posture, kept to seed F4.
// Occupancy analyzes the voxel COLLIDER's own grid: the collider IS the
// runtime ground truth, so collider-resolution analysis is exact w.r.t.
// what the capsule touches (the research "cells << radius" condition
// applies to smooth-source analysis, which this deliberately is not).
import type { Placement } from "../../src/placement.ts";
import type { VoxelsProxy } from "../../src/proxy.ts";

/** Dense boolean grid over a voxel proxy's bounding box. */
export type Occupancy = {
  solid: Uint8Array; // x + dims[0]*(y + dims[1]*z), 1 = rock
  dims: [number, number, number];
  size: [number, number, number]; // cell size in metres (per axis)
  /** Position of cell (0,0,0)'s min corner in the occupancy's OWN frame — for a proxy, the
   *  physics BODY's local frame (where the voxel coords live), not world. `place` maps that
   *  frame to world. */
  origin: [number, number, number];
  /** The rigid placement seating this occupancy's own frame in the world: yaw about world-up,
   *  then translation (the body's world position). Absent = the own frame IS the world frame,
   *  which is what a hand-built grid or a `mergeOccupancies` result is. */
  place?: Placement;
};

/** Tolerance for treating a body quaternion as a pure yaw. */
const YAW_ONLY_EPS = 1e-6;

/** The yaw of a body rotation quaternion `[x,y,z,w]`.
 *
 *  @throws if the rotation has any X/Z component. Every dungeon body placement is a rigid
 *  yaw-about-Y (`placement.ts` composes `quat.fromAxisAngle(…, [0,1,0], yaw)`), and this
 *  whole module — column scans up a Y axis, floor cells, `worldToColumn` — assumes the cell
 *  lattice's Y stays world-up. A tilted body would silently invalidate every flag, so it
 *  throws rather than analysing geometry it cannot represent. */
function yawOf(rotation: [number, number, number, number]): number {
  const [x, y, z, w] = rotation;
  if (Math.abs(x) > YAW_ONLY_EPS || Math.abs(z) > YAW_ONLY_EPS)
    throw new Error(
      `occupancyFromProxy: body rotation [${rotation.join(", ")}] is not a pure yaw — the occupancy lattice assumes world-up Y`,
    );
  return 2 * Math.atan2(y, w);
}

/** Rotate a point by yaw θ about world-up (`placement.ts`'s convention, `Ry(θ)`). */
function rotateY(
  p: readonly [number, number, number],
  yaw: number,
): [number, number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

/** Builds a dense occupancy grid from a corner-anchored voxels proxy, in the BODY'S OWN
 *  FRAME — the frame the voxel coords are expressed in (proxy.ts convention: coords are
 *  grid ints, corner-anchored, HALF_VOXEL = 0). `bodyPosition` / `bodyRotation` are the
 *  physics `BodyDescriptor`'s, verbatim, and are recorded as the occupancy's `place`: Rapier
 *  puts voxel-local point `q` at `bodyPosition + R·q`, so that pair IS the cell→world map.
 *
 *  A rotated body is therefore analysed EXACTLY, with no resampling: the grid stays the
 *  body's, and only `cellFloorWorld` / `worldToColumn` cross into world. This is not
 *  hypothetical — `cave-c` in the baked default world is placed at `yaw = π`, and mapping its
 *  cells as if unrotated mirrors every one of them. */
export function occupancyFromProxy(
  proxy: VoxelsProxy,
  bodyPosition: [number, number, number],
  bodyRotation?: [number, number, number, number],
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
  // Body-LOCAL: the proxy's own min corner. The body transform is carried in `place`.
  const origin: [number, number, number] = [
    minX * proxy.size[0],
    minY * proxy.size[1],
    minZ * proxy.size[2],
  ];
  const place: Placement = {
    yaw: bodyRotation === undefined ? 0 : yawOf(bodyRotation),
    translation: [...bodyPosition],
  };
  return { solid, dims, size: [...proxy.size], origin, place };
}

/** World-space centre of the FLOOR SURFACE a capsule standing in cell (x,y,z) rests on:
 *  the cell's XZ centre, and the Y of its BOTTOM face (= the top of the solid cell below).
 *  Shared by stage 1 (flag positions) and stage 2 (spawn placement) so the two stages
 *  cannot drift apart on the one mapping they both depend on — and, with `worldToColumn`,
 *  the ONLY two places the cell lattice meets world space. */
export function cellFloorWorld(
  occ: Occupancy,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const local: [number, number, number] = [
    occ.origin[0] + (x + 0.5) * occ.size[0],
    occ.origin[1] + y * occ.size[1],
    occ.origin[2] + (z + 0.5) * occ.size[2],
  ];
  return localToWorld(occ, local);
}

/** `place` applied: the occupancy's own frame → world. */
function localToWorld(
  occ: Occupancy,
  local: [number, number, number],
): [number, number, number] {
  const place = occ.place;
  if (place === undefined) return local;
  const r = rotateY(local, place.yaw);
  return [
    r[0] + place.translation[0],
    r[1] + place.translation[1],
    r[2] + place.translation[2],
  ];
}

/** The cell column (x, z) containing a world XZ point — the exact inverse of
 *  {@link cellFloorWorld}'s XZ (`place` undone, then the lattice floored). Stage 2 needs the
 *  reverse direction (where may a lane spawn? is there floor past the flag?), and having it
 *  here, beside the forward map, is what keeps the two from drifting: a second, hand-rolled
 *  world→cell map that forgot `place` would silently read the WRONG column of a rotated body
 *  and hand the sweep a spawn inside rock. */
export function worldToColumn(
  occ: Occupancy,
  wx: number,
  wz: number,
): [number, number] {
  const place = occ.place;
  const offset: [number, number, number] =
    place === undefined
      ? [wx, 0, wz]
      : [wx - place.translation[0], 0, wz - place.translation[2]];
  const local = place === undefined ? offset : rotateY(offset, -place.yaw);
  return [
    Math.floor((local[0] - occ.origin[0]) / occ.size[0]),
    Math.floor((local[2] - occ.origin[2]) / occ.size[2]),
  ];
}

/** The world Y of the occupancy's lowest cell floor — the bottom of the analysed volume.
 *  Yaw is about world-up, so `place` only shifts Y; it never rotates it. */
export function volumeFloorY(occ: Occupancy): number {
  return occ.origin[1] + (occ.place?.translation[1] ?? 0);
}

/** Tolerance (in cells) for the lattice-alignment check. */
const LATTICE_EPS = 1e-6;

/** An occupancy's cell (0,0,0) min corner in WORLD space (`place` applied). */
function worldOrigin(occ: Occupancy): [number, number, number] {
  return localToWorld(occ, occ.origin);
}

/** Merges several occupancies (e.g. all voxel bodies of a loaded world) into
 *  one grid. The result is world-frame (no `place`).
 *
 *  Preconditions (setup-path, so all THROW rather than degrade — a silent
 *  mis-merge would corrupt every downstream flag):
 *  - all inputs share the same cell size;
 *  - none is ROTATED. A merged grid has ONE cell lattice; a body at `yaw = π/3` has cell
 *    axes that do not lie on it at all, so there is no correct way to stamp it in. This is
 *    the reason the F0 known-good run does NOT merge: `cave-c` in the baked default world is
 *    placed at `yaw = π` (verified from the loader's own `BodyDescriptor`). Analyse each body
 *    in its OWN frame instead — `occupancyFromProxy` keeps that frame, and `cellFloorWorld`
 *    crosses to world exactly.
 *  - every WORLD origin lies on the shared cell lattice. The merge reconstructs each
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
    if (o.place !== undefined && Math.abs(o.place.yaw) > YAW_ONLY_EPS)
      throw new Error(
        `mergeOccupancies: rotated body (yaw ${o.place.yaw}) — a merged grid has one lattice, and a rotated body's cells do not lie on it; analyse it in its own frame`,
      );
    const world = worldOrigin(o);
    for (let a = 0; a < 3; a++) {
      const cells = (world[a] as number) / (o.size[a] as number);
      if (Math.abs(cells - Math.round(cells)) > LATTICE_EPS)
        throw new Error(
          `mergeOccupancies: off-lattice origin on axis ${a} — ${world[a]} is not a whole number of ${o.size[a]}m cells (${cells} cells)`,
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
    const world = worldOrigin(o);
    for (let a = 0; a < 3; a++) {
      const lo = Math.round((world[a] as number) / (o.size[a] as number));
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
    const world = worldOrigin(o);
    const ox = Math.round(world[0] / size[0]) - (min[0] as number);
    const oy = Math.round(world[1] / size[1]) - (min[1] as number);
    const oz = Math.round(world[2] / size[2]) - (min[2] as number);
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
