// src/substrate/collider.ts — fine occupancy → the voxels collision shape the
// caves already use (spike P4-proven derivation). Mirrors proxy.ts
// voxelsFromField's shellOnly rule EXACTLY, including off-grid-as-solid: a
// boundary solid cell is kept only if it borders in-grid air, so the proxy
// follows the visible surface, never the grid box (no invisible walls).
import type { VoxelsProxy } from "../proxy.ts";
import { FINE, type FineGrid, fineGet } from "./grid.ts";

export function fineProxy(f: FineGrid): VoxelsProxy {
  const [nx, ny, nz] = f.dims;
  const solid = (i: number, j: number, k: number): boolean =>
    fineGet(f, i, j, k) === 1; // fineGet: off-grid reads solid
  const coords: number[] = [];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!solid(i, j, k)) continue;
        if (
          solid(i - 1, j, k) &&
          solid(i + 1, j, k) &&
          solid(i, j - 1, k) &&
          solid(i, j + 1, k) &&
          solid(i, j, k - 1) &&
          solid(i, j, k + 1)
        )
          continue; // fully enclosed — never contacted
        coords.push(i, j, k);
      }
  return { coords: new Int32Array(coords), size: [FINE, FINE, FINE] };
}
