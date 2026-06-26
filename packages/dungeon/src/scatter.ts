import type { Rng } from "@furnace/core/rng";
import type { Vec3 } from "./region.ts";
import type { MeshData } from "./surface-nets.ts";

/** One scatter placement: a point on the surface plus that point's face normal. */
export type Sample = { position: Vec3; normal: Vec3 };

/** A surface that scatter can area-weight-sample: a triangle count, a per-triangle
 *  area, and a barycentric point+normal sampler. One code path for caves
 *  (mesh triangles) and rooms (a flat rect adapter — Task 10). */
export type SampleableSurface = {
  triCount: number;
  /** Area of triangle `t`, in world units squared. */
  area(t: number): number;
  /** A barycentric (√-debiased) point + face normal on triangle `t`, given two
   *  `[0,1)` draws. */
  sample(t: number, r1: number, r2: number): Sample;
};

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Adapt a Surface-Nets `MeshData` into a `SampleableSurface` (one triangle per
 *  index triple; face normal from the winding). */
export function meshSurface(md: MeshData): SampleableSurface {
  const P = md.positions;
  const I = md.indices;
  const vtx = (v: number): Vec3 => [
    P[3 * v] as number,
    P[3 * v + 1] as number,
    P[3 * v + 2] as number,
  ];
  const tri = (t: number): [Vec3, Vec3, Vec3] => [
    vtx(I[3 * t] as number),
    vtx(I[3 * t + 1] as number),
    vtx(I[3 * t + 2] as number),
  ];
  return {
    triCount: I.length / 3,
    area(t) {
      const [a, b, c] = tri(t);
      const n = cross(sub(b, a), sub(c, a));
      return 0.5 * Math.hypot(n[0], n[1], n[2]);
    },
    sample(t, r1, r2) {
      const [a, b, c] = tri(t);
      const u = Math.sqrt(r1);
      const v = r2;
      const w0 = 1 - u;
      const w1 = u * (1 - v);
      const w2 = u * v; // PBR §13.6 uniform barycentric (√ removes corner bias)
      const position: Vec3 = [
        a[0] * w0 + b[0] * w1 + c[0] * w2,
        a[1] * w0 + b[1] * w1 + c[1] * w2,
        a[2] * w0 + b[2] * w1 + c[2] * w2,
      ];
      return { position, normal: norm(cross(sub(b, a), sub(c, a))) };
    },
  };
}

/** Build the area CDF once, then draw `n` area-weighted samples from `surf`.
 *  Pure given `rng` — draws in a fixed order (CDF pick, then two barycentric
 *  floats per sample), so the same seed yields byte-identical placements. */
export function _sampleSurface(
  surf: SampleableSurface,
  n: number,
  rng: Rng,
): Sample[] {
  const cdf = new Float64Array(surf.triCount);
  let total = 0;
  for (let t = 0; t < surf.triCount; t++) {
    total += surf.area(t);
    cdf[t] = total;
  }
  const out: Sample[] = [];
  for (let i = 0; i < n; i++) {
    const r = rng.float() * total;
    let lo = 0;
    let hi = surf.triCount - 1; // binary search the CDF
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if ((cdf[m] as number) < r) lo = m + 1;
      else hi = m;
    }
    out.push(surf.sample(lo, rng.float(), rng.float()));
  }
  return out;
}
