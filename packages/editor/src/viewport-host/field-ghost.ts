// Ghost target-marker math for the field host — pure, GPU-free, extracted from
// field-host.ts so the formulas are unit-testable (the F2a carry-over): the
// sphere-brush preview ring segments, the box-ghost corner layout, and the
// committed-generator footprint behind the entity-highlight box. The host
// wraps these in segmentsToBatch / boxEdges and draws occlude:false.

import type { FieldOp, GeneratorEntity } from "@furnace/core/field";
import { CHUNK_DIM, opBounds, parseChunkKey } from "@furnace/core/field";

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
 *  plane), GHOST_RING_SEGMENTS (16) segments each. The host feeds the result
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

/** The stamped FOOTPRINT of a committed generator: the union AABB of its
 *  span's field-writing ops, read from the live log. The recorded `region` is
 *  the SELECTION the user drew — a stamp anchors at the region's snapped min
 *  corner with its size from params, so an oversized region can badly
 *  over-draw the actual content (the F3a gate finding: the highlight boxed
 *  mostly-empty space). Brush ops contribute their declared bounds; patch ops
 *  contribute their chunks' extents. Null when the span holds no
 *  field-writing ops — the caller falls back to the region. */
export const generatorFootprint = (
  ops: readonly FieldOp[],
  entity: GeneratorEntity,
  cellSize: number,
): { min: Vec3T; max: Vec3T } | null => {
  let box: { min: Vec3T; max: Vec3T } | null = null;
  const grow = (lo: Vec3T, hi: Vec3T): void => {
    if (box === null) {
      box = { min: [...lo], max: [...hi] };
      return;
    }
    box.min[0] = Math.min(box.min[0], lo[0]);
    box.min[1] = Math.min(box.min[1], lo[1]);
    box.min[2] = Math.min(box.min[2], lo[2]);
    box.max[0] = Math.max(box.max[0], hi[0]);
    box.max[1] = Math.max(box.max[1], hi[1]);
    box.max[2] = Math.max(box.max[2], hi[2]);
  };
  const [spanFirst, spanLast] = entity.opSpan;
  for (const op of ops) {
    if (op.kind === "entity") continue;
    if (op.id < spanFirst || op.id > spanLast) continue;
    if (op.kind === "brush") {
      const b = opBounds(op);
      grow(b.min, b.max);
      continue;
    }
    if (op.kind === "placement") {
      // MIGRATION (until Task 5): placement ops carry no field cells; a span's
      // AABB should grow by each record's world bounds. No committed span emits
      // placement ops until scatter arrives, so skip for now.
      continue;
    }
    for (const chunk of op.chunks) {
      const [cx, cy, cz] = parseChunkKey(chunk.key);
      const extent = CHUNK_DIM * cellSize;
      grow(
        [cx * extent, cy * extent, cz * extent],
        [(cx + 1) * extent, (cy + 1) * extent, (cz + 1) * extent],
      );
    }
  }
  return box;
};
