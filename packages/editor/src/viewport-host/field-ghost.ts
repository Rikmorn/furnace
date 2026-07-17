// Ghost target-marker math for the field host — pure, GPU-free, extracted from
// field-host.ts so the formulas are unit-testable (the F2a carry-over): the
// sphere-brush preview ring segments and the box-ghost corner layout. The host
// wraps these in segmentsToBatch / boxEdges and draws occlude:false.

type Vec3T = [number, number, number];

/** The ghost target ring/box preview colour — hologram-blue (research
 *  convention), drawn occlude:false so it reads through solid geometry. */
export const GHOST_COLOR: [number, number, number, number] = [0.4, 0.8, 1, 1];
// Ghost sphere preview: two great-circle rings (XZ + XY), this many segments each.
const GHOST_RING_SEGMENTS = 16;

// One point on a ring: centre + radius·(cosθ·u + sinθ·v) for orthonormal plane
// axes u, v.
const ringPoint = (
  center: Vec3T,
  radius: number,
  u: Vec3T,
  v: Vec3T,
  theta: number,
): Vec3T => {
  const cs = Math.cos(theta);
  const sn = Math.sin(theta);
  return [
    center[0] + radius * (cs * u[0] + sn * v[0]),
    center[1] + radius * (cs * u[1] + sn * v[1]),
    center[2] + radius * (cs * u[2] + sn * v[2]),
  ];
};

/** The sphere-brush ghost as line segments: two great-circle rings (XZ then XY
 *  plane), {@link GHOST_RING_SEGMENTS} segments each. The host feeds the result
 *  to segmentsToBatch (same path as the grid / AABB highlight). */
export const sphereGhostSegments = (
  center: Vec3T,
  radius: number,
): [Vec3T, Vec3T][] => {
  const planes: [Vec3T, Vec3T][] = [
    [
      [1, 0, 0],
      [0, 0, 1],
    ], // XZ ring
    [
      [1, 0, 0],
      [0, 1, 0],
    ], // XY ring
  ];
  const segments: [Vec3T, Vec3T][] = [];
  for (const [u, v] of planes)
    for (let i = 0; i < GHOST_RING_SEGMENTS; i++) {
      const a = (2 * Math.PI * i) / GHOST_RING_SEGMENTS;
      const b = (2 * Math.PI * (i + 1)) / GHOST_RING_SEGMENTS;
      segments.push([
        ringPoint(center, radius, u, v, a),
        ringPoint(center, radius, u, v, b),
      ]);
    }
  return segments;
};

/** The 8 world corners of a centre+halfExtents box in boxEdges' bit-layout order
 *  (bit0=x, bit1=y, bit2=z), as a length-24 Float32Array. */
export const boxCorners = (center: Vec3T, half: Vec3T): Float32Array => {
  const out = new Float32Array(24);
  for (let i = 0; i < 8; i++) {
    out[i * 3] = (i & 1) === 0 ? center[0] - half[0] : center[0] + half[0];
    out[i * 3 + 1] = (i & 2) === 0 ? center[1] - half[1] : center[1] + half[1];
    out[i * 3 + 2] = (i & 4) === 0 ? center[2] - half[2] : center[2] + half[2];
  }
  return out;
};
