import type { Rng } from "@furnace/core/rng";

/** Scalar density field: `> 0` = open air (walkable), `< 0` = solid rock;
 *  the surface is the 0 isosurface. */
export type Field = (x: number, y: number, z: number) => number;

const dist = (x: number, y: number, z: number): number =>
  Math.sqrt(x * x + y * y + z * z);

/** A spherical pocket of air of `radius` centered at (cx,cy,cz). */
export function sphereCavern(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
): Field {
  return (x, y, z) => radius - dist(x - cx, y - cy, z - cz);
}

/** A box-shaped pocket of air (half-extents hx,hy,hz) centered at (cx,cy,cz). */
export function boxCavern(
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
): Field {
  return (x, y, z) =>
    Math.min(
      hx - Math.abs(x - cx),
      hy - Math.abs(y - cy),
      hz - Math.abs(z - cz),
    );
}

/** A vertical cylindrical shaft of air (radius r around the y-axis at cx,cz),
 *  capped between yBottom and yTop. */
export function shaft(
  cx: number,
  cz: number,
  r: number,
  yBottom: number,
  yTop: number,
): Field {
  return (x, y, z) =>
    Math.min(r - Math.hypot(x - cx, z - cz), Math.min(y - yBottom, yTop - y));
}

/** Air ∪ air (carve more space). */
export function union(...fields: Field[]): Field {
  return (x, y, z) => {
    let m = -Infinity;
    for (const f of fields) m = Math.max(m, f(x, y, z));
    return m;
  };
}

/** Air ∩ air (keep only overlap). */
export function intersect(...fields: Field[]): Field {
  return (x, y, z) => {
    let m = Infinity;
    for (const f of fields) m = Math.min(m, f(x, y, z));
    return m;
  };
}

/** Deterministic 3D value noise in [-1,1], lattice-hashed from `rng`. */
function makeValueNoise(rng: Rng): (x: number, y: number, z: number) => number {
  // 256 random gradient scalars; lattice points index into them.
  const perm = new Float32Array(256);
  for (let i = 0; i < 256; i++) perm[i] = rng.float() * 2 - 1;
  const hash = (xi: number, yi: number, zi: number): number => {
    const h = (xi * 73856093) ^ (yi * 19349663) ^ (zi * 83492791);
    return perm[(h >>> 0) & 255] as number;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  return (x, y, z) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const tx = smooth(x - xi);
    const ty = smooth(y - yi);
    const tz = smooth(z - zi);
    const c = (dx: number, dy: number, dz: number): number =>
      hash(xi + dx, yi + dy, zi + dz);
    const x00 = lerp(c(0, 0, 0), c(1, 0, 0), tx);
    const x10 = lerp(c(0, 1, 0), c(1, 1, 0), tx);
    const x01 = lerp(c(0, 0, 1), c(1, 0, 1), tx);
    const x11 = lerp(c(0, 1, 1), c(1, 1, 1), tx);
    return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
  };
}

/** Roughen a field's surface with bounded value noise (|delta| <= amplitude). */
export function noiseDisplace(
  base: Field,
  rng: Rng,
  amplitude: number,
  frequency: number,
): Field {
  const noise = makeValueNoise(rng);
  return (x, y, z) =>
    base(x, y, z) +
    amplitude * noise(x * frequency, y * frequency, z * frequency);
}
