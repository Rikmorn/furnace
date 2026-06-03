import { expect } from "bun:test";
import type { GeometryData } from "../../src/geometry/types.ts";

const EPS = 1e-4;
const at = (arr: ArrayLike<number>, i: number): number => arr[i] ?? 0;

/** Every shading normal is unit length. */
export function expectUnitNormals(data: GeometryData): void {
  const n = data.normals;
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(at(n, i), at(n, i + 1), at(n, i + 2));
    expect(Math.abs(len - 1)).toBeLessThan(EPS);
  }
}

/**
 * Every non-degenerate triangle's geometric (face) normal points the same way
 * as its vertices' shading normals — i.e. outward, CCW-viewed-from-outside.
 * Catches winding bugs headlessly (rendering would just back-face-cull them).
 */
export function expectOutwardWinding(data: GeometryData): void {
  const p = data.positions;
  const n = data.normals;
  const indices = data.indices;
  if (!indices) throw new Error("expected indexed geometry");
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = at(indices, t) * 3;
    const i1 = at(indices, t + 1) * 3;
    const i2 = at(indices, t + 2) * 3;
    const ax = at(p, i1) - at(p, i0);
    const ay = at(p, i1 + 1) - at(p, i0 + 1);
    const az = at(p, i1 + 2) - at(p, i0 + 2);
    const bx = at(p, i2) - at(p, i0);
    const by = at(p, i2 + 1) - at(p, i0 + 1);
    const bz = at(p, i2 + 2) - at(p, i0 + 2);
    const fx = ay * bz - az * by;
    const fy = az * bx - ax * bz;
    const fz = ax * by - ay * bx;
    if (Math.hypot(fx, fy, fz) < EPS) continue; // degenerate (pole strip)
    const vx = at(n, i0) + at(n, i1) + at(n, i2);
    const vy = at(n, i0 + 1) + at(n, i1 + 1) + at(n, i2 + 1);
    const vz = at(n, i0 + 2) + at(n, i1 + 2) + at(n, i2 + 2);
    expect(fx * vx + fy * vy + fz * vz).toBeGreaterThan(0);
  }
}
