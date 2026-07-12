// src/substrate/suppress.ts — E1 per-face suppression (findings): a face piece
// drops iff the SUBxSUB fine face LAYER physically backing it was carved (an
// interior-only carve suppresses nothing — NOT AABB-based). Small pieces
// (posts/frames) use the whole-owner-cell conservative test via carvedCells().
import type { PreparedCarve } from "./carve.ts";
import {
  AIR,
  type CoarseGrid,
  coarseGet,
  fineIndex,
  MASONRY,
  SUB,
} from "./grid.ts";
import { FACE_NORMAL, faceKey } from "./skin.ts";

/** Exposed masonry faces whose backing fine face-layer was carved. */
export function suppressedFaces(
  g: CoarseGrid,
  carve: PreparedCarve,
): Set<string> {
  const out = new Set<string>();
  if (carve.carved.size === 0) return out;
  const [nx, ny, nz] = g.dims;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (coarseGet(g, i, j, k) !== MASONRY) continue;
        for (let face = 0; face < 6; face++) {
          const n = FACE_NORMAL[face];
          if (!n) continue;
          if (coarseGet(g, i + n[0], j + n[1], k + n[2]) !== AIR) continue;
          if (faceLayerCarved(carve, i, j, k, face))
            out.add(faceKey(i, j, k, face));
        }
      }
  return out;
}

/** Coarse cells with ANY carved fine cell (whole-owner-cell conservative test
 *  for small pieces: posts, frames). Keys are `i,j,k`. */
export function carvedCells(carve: PreparedCarve): Set<string> {
  const out = new Set<string>();
  const f = carve.fine;
  for (const idx of carve.carved) {
    const i = idx % f.dims[0];
    const j = Math.floor(idx / f.dims[0]) % f.dims[1];
    const k = Math.floor(idx / (f.dims[0] * f.dims[1]));
    out.add(`${(i / SUB) | 0},${(j / SUB) | 0},${(k / SUB) | 0}`);
  }
  return out;
}

/** The SUBxSUB fine layer of coarse cell (i,j,k) touching `face`: carved? */
function faceLayerCarved(
  carve: PreparedCarve,
  i: number,
  j: number,
  k: number,
  face: number,
): boolean {
  const f = carve.fine;
  const bx = i * SUB;
  const by = j * SUB;
  const bz = k * SUB;
  // The face layer is the SUB^3 block's outermost slab along the face axis.
  const axis = face <= 1 ? 0 : face <= 3 ? 1 : 2;
  const outer = face % 2 === 0 ? SUB - 1 : 0;
  for (let b = 0; b < SUB; b++)
    for (let a = 0; a < SUB; a++) {
      const [ci, cj, ck] = layerCell(bx, by, bz, axis, outer, a, b);
      if (carve.carved.has(fineIndex(f, ci, cj, ck))) return true;
    }
  return false;
}

/** Fine coord for the (a,b) slot of the outer slab along `axis`. Builds the
 *  tuple by switching on the axis rather than via variable-index compound
 *  assignment (`c[axis] += …`), which does not typecheck under
 *  noUncheckedIndexedAccess. Produces the identical cell set. */
function layerCell(
  bx: number,
  by: number,
  bz: number,
  axis: number,
  outer: number,
  a: number,
  b: number,
): [number, number, number] {
  if (axis === 0) return [bx + outer, by + a, bz + b];
  if (axis === 1) return [bx + a, by + outer, bz + b];
  return [bx + a, by + b, bz + outer];
}
