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

/** A separable rectangular weight: 1 inside the core, smoothly ramping to 0
 *  across a `margin`-wide border of the [±hx, ±hz] footprint. Multiply a
 *  displacement by this so a carved floor stays flush with its surroundings at
 *  the seam (weight 0) while its interior (weight 1) is fully displaced. */
export function rectWeight(
  hx: number,
  hz: number,
  margin: number,
): (x: number, z: number) => number {
  // d = distance from the footprint edge inward; 0 at the edge → 1 at `margin` in.
  const ramp = (d: number): number => {
    const t = Math.min(Math.max(d / margin, 0), 1);
    return t * t * (3 - 2 * t); // smoothstep
  };
  return (x, z) => ramp(hx - Math.abs(x)) * ramp(hz - Math.abs(z));
}

/** Like {@link noiseDisplace}, but the displacement is multiplied by `weight(x,z)`
 *  so it tapers to 0 at a footprint's edges — a carved floor that is bumpy in its
 *  interior yet stays flush with the surrounding (flat) floor at the walk-across seam. */
export function taperedNoiseDisplace(
  base: Field,
  rng: Rng,
  amplitude: number,
  frequency: number,
  weight: (x: number, z: number) => number,
): Field {
  const noise = makeValueNoise(rng);
  return (x, y, z) =>
    base(x, y, z) +
    amplitude *
      weight(x, z) *
      noise(x * frequency, y * frequency, z * frequency);
}

/** Air-positive capsule/segment SDF: a tube of `r` around segment (ax,ay,az)→(bx,by,bz).
 *  `>0` inside the tube (air), `<0` outside (rock). The organic-tunnel primitive. */
export function capsuleCavern(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
): Field {
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const baLen2 = bax * bax + bay * bay + baz * baz || 1;
  return (x, y, z) => {
    const pax = x - ax;
    const pay = y - ay;
    const paz = z - az;
    const t = Math.min(
      1,
      Math.max(0, (pax * bax + pay * bay + paz * baz) / baLen2),
    );
    const dx = pax - bax * t;
    const dy = pay - bay * t;
    const dz = paz - baz * t;
    return r - Math.hypot(dx, dy, dz);
  };
}

/** Smooth maximum (air-positive smooth-union of two densities). `k` = blend thickness
 *  in distance units. Uses the Quilez polynomial smooth-max: equal inputs produce a
 *  lift of `k/4`, and inputs more than `k` apart degrade to a hard max. */
export function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0);
  return Math.max(a, b) + (h * h) / (4 * k);
}

/** Smooth `union` (air ∪ air with a fillet). Drop-in for {@link union}; keep
 *  `k >= cellSize` (~0.5m) or the blend degrades to a hard max. */
export function smoothUnion(k: number, ...fields: Field[]): Field {
  return (x, y, z) => {
    let m = -Infinity;
    for (const f of fields) m = smax(m, f(x, y, z), k);
    return m;
  };
}

/** Like {@link noiseDisplace}, but the displacement fades to 0 within `fade` metres of
 *  `floorY` (smoothstep) so walked floors stay smooth while walls/ceilings stay organic
 *  (research §1 walkable-floor technique). */
export function yTaperedNoiseDisplace(
  base: Field,
  rng: Rng,
  amplitude: number,
  frequency: number,
  floorY: number,
  fade: number,
): Field {
  const noise = makeValueNoise(rng);
  return (x, y, z) => {
    const d = Math.min(Math.max((y - floorY) / fade, 0), 1);
    const w = d * d * (3 - 2 * d); // smoothstep: 0 at floor → 1 a `fade` above
    return (
      base(x, y, z) +
      amplitude * w * noise(x * frequency, y * frequency, z * frequency)
    );
  };
}
