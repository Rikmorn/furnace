// src/substrate/grid.ts — the two-resolution substrate grids (spec §2, D-W2-5).
// Coarse 0.5 m cells are authoritative for BUILT structure; the fine 0.25 m grid
// derives by 2x-per-axis rasterization plus carve edits and is the single source
// for collision and carve-patch meshing. Dense per-region Uint8Array storage — the
// region IS the chunk (palette/RLE deferred behind these accessors; see backlog).
// Pure integer ops throughout: no rng, no transcendentals (Pr-2 class absent).

import type { GridConfig } from "../field/surface-nets.ts";
import type { Vec3 } from "../world/region.ts";

export const CELL = 0.5;
export const FINE = 0.25;
export const SUB = 2; // fine cells per coarse cell, per axis

export const AIR = 0;
export const MASONRY = 1;

export type CoarseGrid = {
  /** Local-frame, lattice-aligned world position of cell (0,0,0)'s min corner. */
  min: Vec3;
  dims: [number, number, number];
  /** Do not index directly — use the accessors (the palette/RLE seam). */
  cells: Uint8Array;
};

export type FineGrid = {
  min: Vec3;
  dims: [number, number, number];
  /** 1 = solid, 0 = air. Same accessor rule as CoarseGrid. */
  cells: Uint8Array;
};

export function createCoarse(
  min: Vec3,
  dims: [number, number, number],
  fill: number,
): CoarseGrid {
  const cells = new Uint8Array(dims[0] * dims[1] * dims[2]).fill(fill);
  return { min: [...min], dims: [...dims], cells };
}

export function coarseIndex(
  g: CoarseGrid,
  i: number,
  j: number,
  k: number,
): number {
  return i + g.dims[0] * (j + g.dims[1] * k);
}

const inBounds = (
  dims: [number, number, number],
  i: number,
  j: number,
  k: number,
): boolean =>
  i >= 0 && i < dims[0] && j >= 0 && j < dims[1] && k >= 0 && k < dims[2];

/** Off-grid reads MASONRY: skin never faces off-grid; collider shell sees solid. */
export function coarseGet(
  g: CoarseGrid,
  i: number,
  j: number,
  k: number,
): number {
  if (!inBounds(g.dims, i, j, k)) return MASONRY;
  // Hot-path fixed-shape indexing; index proven in-bounds by the guard above.
  return g.cells[coarseIndex(g, i, j, k)] as number;
}

export function coarseSet(
  g: CoarseGrid,
  i: number,
  j: number,
  k: number,
  v: number,
): void {
  if (!inBounds(g.dims, i, j, k)) {
    throw new Error(`substrate: coarseSet out of bounds (${i},${j},${k})`);
  }
  g.cells[coarseIndex(g, i, j, k)] = v;
}

/** Fine occupancy from the coarse stamp: SUB^3 fine cells per coarse cell. */
export function rasterize(g: CoarseGrid): FineGrid {
  const dims: [number, number, number] = [
    g.dims[0] * SUB,
    g.dims[1] * SUB,
    g.dims[2] * SUB,
  ];
  const f: FineGrid = {
    min: [...g.min],
    dims,
    cells: new Uint8Array(dims[0] * dims[1] * dims[2]),
  };
  for (let k = 0; k < dims[2]; k++)
    for (let j = 0; j < dims[1]; j++)
      for (let i = 0; i < dims[0]; i++) {
        const solid =
          coarseGet(g, (i / SUB) | 0, (j / SUB) | 0, (k / SUB) | 0) === MASONRY;
        if (solid) f.cells[fineIndex(f, i, j, k)] = 1;
      }
  return f;
}

export function fineIndex(
  f: FineGrid,
  i: number,
  j: number,
  k: number,
): number {
  return i + f.dims[0] * (j + f.dims[1] * k);
}

/** Off-grid reads SOLID (mirrors proxy.ts off-grid-as-rock — no invisible walls). */
export function fineGet(f: FineGrid, i: number, j: number, k: number): number {
  if (!inBounds(f.dims, i, j, k)) return 1;
  return f.cells[fineIndex(f, i, j, k)] as number;
}

export function fineSet(
  f: FineGrid,
  i: number,
  j: number,
  k: number,
  v: number,
): void {
  if (!inBounds(f.dims, i, j, k)) {
    throw new Error(`substrate: fineSet out of bounds (${i},${j},${k})`);
  }
  f.cells[fineIndex(f, i, j, k)] = v;
}

/** The fine grid as a GridConfig for surfaceNets / proxy-position consumers. */
export function fineGridConfig(f: FineGrid): GridConfig {
  return { min: [...f.min], cellSize: FINE, dims: [...f.dims] };
}
