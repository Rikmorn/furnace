import type { Field } from "./field.ts";
import type { GridConfig } from "./surface-nets.ts";

/** A voxel collision proxy descriptor (matches @furnace/core/physics
 *  ShapeDescriptor.voxels). `coords` are 0-based solid-cell indices (3 ints each);
 *  placement is via `voxelProxyPosition`. */
export type VoxelsProxy = {
  coords: Int32Array;
  size: [number, number, number];
};

/** Sign-sample `field` per grid cell (centre `f < 0` = solid rock) → solid-cell
 *  coords. `voxelSize` defaults to cubic `grid.cellSize` (anisotropic = the
 *  blockiness lever). `shellOnly` drops cells whose 6 face-neighbours are all
 *  solid (interior rock is never contacted). */
export function voxelsFromField(
  field: Field,
  grid: GridConfig,
  voxelSize?: [number, number, number],
  shellOnly = true,
): VoxelsProxy {
  const [nx, ny, nz] = grid.dims;
  const [ox, oy, oz] = grid.min;
  const h = grid.cellSize;
  const solid = (i: number, j: number, k: number): boolean =>
    i >= 0 &&
    i < nx &&
    j >= 0 &&
    j < ny &&
    k >= 0 &&
    k < nz &&
    field(ox + (i + 0.5) * h, oy + (j + 0.5) * h, oz + (k + 0.5) * h) < 0;

  const coords: number[] = [];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!solid(i, j, k)) continue;
        if (
          shellOnly &&
          solid(i - 1, j, k) &&
          solid(i + 1, j, k) &&
          solid(i, j - 1, k) &&
          solid(i, j + 1, k) &&
          solid(i, j, k - 1) &&
          solid(i, j, k + 1)
        ) {
          continue;
        }
        coords.push(i, j, k);
      }
    }
  }
  return { coords: new Int32Array(coords), size: voxelSize ?? [h, h, h] };
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
