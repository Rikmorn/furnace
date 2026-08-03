import type { Field } from "./field.ts";
import type { GridConfig } from "./surface-nets.ts";

/** A voxel collision proxy descriptor (matches @furnace/core/physics
 *  ShapeDescriptor.voxels). `coords` are 0-based solid-cell indices (3 ints each);
 *  placement is via `voxelProxyPosition`. */
export type VoxelsProxy = {
  coords: Int32Array;
  size: [number, number, number];
};

/** Sign-sample `field` (centre `f < 0` = solid rock) → solid-cell coords.
 *  `voxelSize` defaults to cubic `grid.cellSize`; a finer per-axis size (e.g. a
 *  smaller Y) subdivides the grid's world extent into more, smaller voxels along
 *  that axis — this is the blockiness lever. A finer Y shrinks floor-height
 *  quantization steps so the controller's step-up can climb them (one cubic 0.5m
 *  cell exceeds STEP_HEIGHT; two 0.25m cells do not). `shellOnly` drops cells
 *  whose 6 face-neighbours are all solid (interior rock is never contacted) —
 *  and crucially treats OFF-GRID neighbours as solid rock, so a grid-boundary
 *  rock cell is dropped unless it borders air *inside* the grid. Without that,
 *  the grid's outer rock faces (which Surface-Nets never meshes — there is no
 *  in-grid sign change there) become collision with no matching render surface:
 *  an invisible wall that protrudes into adjacent walkable space wherever two
 *  regions' grids overlap. Treating off-grid as solid makes the collision shell
 *  follow the rendered isosurface instead of the grid box. */
export function voxelsFromField(
  field: Field,
  grid: GridConfig,
  voxelSize?: [number, number, number],
  shellOnly = true,
): VoxelsProxy {
  const [ox, oy, oz] = grid.min;
  const h = grid.cellSize;
  const size: [number, number, number] = voxelSize ?? [h, h, h];
  const [sx, sy, sz] = size;
  // Voxel-cell counts per axis: the grid's world extent (dims·cellSize) divided
  // by the per-axis voxel size. Cubic (size = cellSize) → exactly grid.dims.
  const nx = Math.round((grid.dims[0] * h) / sx);
  const ny = Math.round((grid.dims[1] * h) / sy);
  const nz = Math.round((grid.dims[2] * h) / sz);
  const inGrid = (i: number, j: number, k: number): boolean =>
    i >= 0 && i < nx && j >= 0 && j < ny && k >= 0 && k < nz;
  const isRock = (i: number, j: number, k: number): boolean =>
    field(ox + (i + 0.5) * sx, oy + (j + 0.5) * sy, oz + (k + 0.5) * sz) < 0;
  // A cell to emit: an in-grid rock cell.
  const rockCell = (i: number, j: number, k: number): boolean =>
    inGrid(i, j, k) && isRock(i, j, k);
  // For the enclosure test, an off-grid neighbour counts as solid rock so a
  // boundary cell is only kept if it borders *in-grid* air (a real surface).
  const enclosing = (i: number, j: number, k: number): boolean =>
    !inGrid(i, j, k) || isRock(i, j, k);

  const coords: number[] = [];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!rockCell(i, j, k)) continue;
        if (
          shellOnly &&
          enclosing(i - 1, j, k) &&
          enclosing(i + 1, j, k) &&
          enclosing(i, j - 1, k) &&
          enclosing(i, j + 1, k) &&
          enclosing(i, j, k - 1) &&
          enclosing(i, j, k + 1)
        ) {
          continue;
        }
        coords.push(i, j, k);
      }
    }
  }
  return { coords: new Int32Array(coords), size };
}

// Rapier voxels are corner-anchored: voxel (0,0,0) occupies [0,1]³, so cell (0,0,0)
// aligns with the field/render cell when the proxy body sits at origin + grid.min
// exactly — no half-cell offset.
const HALF_VOXEL = 0;

/** World position for a voxel-proxy body so 0-based cell (0,0,0) aligns with the
 *  grid's first field cell, given the region's world `origin`. */
export function voxelProxyPosition(
  grid: GridConfig,
  origin: [number, number, number],
): [number, number, number] {
  const h = grid.cellSize;
  return [
    origin[0] + grid.min[0] + HALF_VOXEL * h,
    origin[1] + grid.min[1] + HALF_VOXEL * h,
    origin[2] + grid.min[2] + HALF_VOXEL * h,
  ];
}
