import { getDensity, worldToVoxel } from "./chunks.ts";
import type { FieldStore } from "./types.ts";

/** Result of a field raycast: the first rock voxel the ray enters, the air
 *  voxel just before it, and the entry point (world metres). */
export type FieldHit = {
  voxel: [number, number, number];
  prev: [number, number, number];
  point: [number, number, number];
};

/** Safety net against a ray escaping into unbounded solid space; the maxDist
 *  ceiling is the real terminator for any ray with a non-degenerate
 *  direction (reach is metres, `< MAX_STEPS * cellSize`). */
const MAX_STEPS = 4096;

/** Index of the axis whose next voxel boundary is nearest along the ray. */
const nearestAxis = (tMax: readonly [number, number, number]): 0 | 1 | 2 => {
  if (tMax[0] <= tMax[1] && tMax[0] <= tMax[2]) return 0;
  return tMax[1] <= tMax[2] ? 1 : 2;
};

/** Distance t at which the ray leaves voxel index `i` along one axis (or
 *  Infinity when the ray is parallel to that axis). */
const axisBoundaryT = (
  i: number,
  origin: number,
  d: number,
  step: number,
  h: number,
): number => {
  if (d === 0) return Infinity;
  const edge = (step > 0 ? i + 1 : i) * h;
  return (edge - origin) / d;
};

/** Amanatides–Woo DDA over the sample lattice (voxel (i,j,k) spans world
 *  [i·h,(i+1)·h)). Rock = density < 0. Returns null if no rock within
 *  `maxDist` metres. A start inside rock hits its own voxel at t=0.
 *
 *  `opts.maxY` is the slice view's DISPLAY clip (world metres): every voxel
 *  whose base sample world y (`iy·cellSize`) is at/above the clip reads as
 *  air — the ray passes through clipped rock (including an eye's own rock
 *  voxel above the clip, which suppresses the t=0 start-in-rock hit) and
 *  lands on the first sub-clip rock voxel, matching what the sliced render
 *  shows. `prev` semantics are unchanged: the last voxel traversed before
 *  the hit, which under a clip can be a clipped (rock-but-reads-air) voxel.
 *  Omitting `opts` is byte-identical to the unclipped contract. */
export function raycastField(
  store: FieldStore,
  origin: [number, number, number],
  dir: [number, number, number],
  maxDist: number,
  opts?: { maxY?: number },
): FieldHit | null {
  const h = store.cellSize;
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d: [number, number, number] = [
    dir[0] / len,
    dir[1] / len,
    dir[2] / len,
  ];
  let ix = worldToVoxel(origin[0], h);
  let iy = worldToVoxel(origin[1], h);
  let iz = worldToVoxel(origin[2], h);
  let prev: [number, number, number] = [ix, iy, iz];
  const step: [number, number, number] = [
    d[0] > 0 ? 1 : -1,
    d[1] > 0 ? 1 : -1,
    d[2] > 0 ? 1 : -1,
  ];
  const tDelta: [number, number, number] = [
    d[0] !== 0 ? Math.abs(h / d[0]) : Infinity,
    d[1] !== 0 ? Math.abs(h / d[1]) : Infinity,
    d[2] !== 0 ? Math.abs(h / d[2]) : Infinity,
  ];
  const tMax: [number, number, number] = [
    axisBoundaryT(ix, origin[0], d[0], step[0], h),
    axisBoundaryT(iy, origin[1], d[1], step[1], h),
    axisBoundaryT(iz, origin[2], d[2], step[2], h),
  ];
  const maxY = opts?.maxY;
  let t = 0;
  for (let stepsTaken = 0; stepsTaken < MAX_STEPS; stepsTaken++) {
    // The loop's density read is the function's ONLY hit test (it covers the
    // start voxel too), so clipping here clips every read consistently.
    const clipped = maxY !== undefined && iy * h >= maxY;
    if (!clipped && getDensity(store, ix, iy, iz) < 0) {
      return {
        voxel: [ix, iy, iz],
        prev,
        point: [
          origin[0] + d[0] * t,
          origin[1] + d[1] * t,
          origin[2] + d[2] * t,
        ],
      };
    }
    prev = [ix, iy, iz];
    const axis = nearestAxis(tMax);
    t = tMax[axis];
    if (t > maxDist) return null;
    if (axis === 0) {
      ix += step[0];
      tMax[0] += tDelta[0];
    } else if (axis === 1) {
      iy += step[1];
      tMax[1] += tDelta[1];
    } else {
      iz += step[2];
      tMax[2] += tDelta[2];
    }
  }
  return null;
}
