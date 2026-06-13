import type { Vec3 } from "../transform/types.ts";
import { vec3 } from "../transform/vec3.ts";

/** Local-space axis-aligned bounds of a flat `[x,y,z, x,y,z, ...]` positions array. */
export type Bounds = { min: Vec3; max: Vec3 };

/** Compute the AABB min/max from interleaved-free flat positions (length `3N`). */
export function computeBounds(positions: Float32Array): Bounds {
  if (positions.length < 3) {
    return { min: vec3.create(), max: vec3.create() };
  }
  const min = vec3.fromValues(Infinity, Infinity, Infinity);
  const max = vec3.fromValues(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a] as number;
      if (v < (min[a] as number)) min[a] = v;
      if (v > (max[a] as number)) max[a] = v;
    }
  }
  return { min, max };
}
