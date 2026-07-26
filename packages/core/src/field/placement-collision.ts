// Placement colliders as field-resolution solidity (D-F4-5). Props carry their
// OWN colliders in the runtime physics world — the "if you can dig it, it's
// field, else it's an entity with its own collider" jurisdiction rule — so the
// walkability analyzer, which reads only chunk density, would be blind to every
// rock and stalagmite in the world. This module rasterizes those colliders into
// the same per-chunk solidity the analyzer consumes (`AnalyzeOptions.extraSolid`).
//
// It shares nothing with the column pass but that encoding, and deliberately
// lives apart from it: `collisionExtentY` is not an analysis function — the
// dungeon's field-world loader imports it to POSITION rigid bodies, and the two
// uses must not drift.
import {
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  voxelChunk,
  worldToVoxel,
} from "./chunks.ts";
import type { ChunkKey, PlacementRecord } from "./types.ts";

/** Cells one record may cover before the rasterizer refuses it. Generous by
 *  design — a 64-cell cube is 16 m on a side at the default cell size, well past
 *  any prop — so crossing it means garbage dimensions, not an ambitious asset.
 *  Budgets are day-one semantics: without one, a single bad number turns a
 *  per-record loop into tens of millions of writes with nothing to notice it. */
const MAX_RECORD_CELLS = 1 << 18;

/**
 * A placed prop's collision primitive: the catalog's authored shape, in the
 * archetype's own unit frame (a record's `scale` applies on top).
 *
 * `anchor` says where the record's `position` sits on the shape — `"center"`
 * (the default, and the pre-F4 catalog's implicit meaning) puts it at the
 * primitive's centre; `"base"` puts it at the primitive's BOTTOM, which is what
 * a prop authored to stand on the floor wants. {@link collisionExtentY} is the
 * distance the two differ by.
 */
export type PlacementCollision =
  | {
      kind: "box";
      halfExtents: [number, number, number];
      anchor?: "center" | "base";
    }
  | { kind: "sphere"; radius: number; anchor?: "center" | "base" }
  | {
      kind: "capsule";
      halfHeight: number;
      radius: number;
      anchor?: "center" | "base";
    };

/**
 * One archetype's collision primitive with the records placed under it — the
 * batching {@link voxelizePlacements} consumes, and the shape a placement
 * artifact already has (`parsePlacements` groups by archetype, the catalog
 * resolves each group's collision).
 */
export type PlacementCollisionGroup = {
  collision: PlacementCollision;
  records: readonly PlacementRecord[];
};

/** Row-major 3×3 rotation matrix. */
type Mat3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** The inclusive global-cell box an AABB covers. */
type CellBox = {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
};

/** Rotation matrix of a unit quaternion `[x, y, z, w]`, row-major. Written once
 *  here because both uses below — the world-AABB widening and the base-anchor
 *  lift — must come from the SAME matrix; two hand-written copies is how the
 *  rasterized solidity and the placed rigid body would drift apart. */
function quatMatrix(q: readonly [number, number, number, number]): Mat3 {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}

/** Half-extents of the primitive's own AABB, in its LOCAL frame, after scale.
 *
 *  The scale rule mirrors the runtime collider derivation exactly (the dungeon's
 *  `placementCollider`): a box scales PER AXIS, while a sphere/capsule has no
 *  per-axis form and takes the MAX scale axis. Exact for the uniform-scale
 *  records scatter emits, a conservative over-approximation otherwise. Diverging
 *  from it would put analyzed solidity where the physics collider is not, which
 *  is the one thing D-F4-5 exists to prevent.
 *
 *  Magnitudes only: an extent is a distance, so a MIRRORED record (a negative
 *  scale axis) covers the same box. Signed arithmetic here would invert the cell
 *  range and rasterize the record to nothing at all — silence, in a pass whose
 *  whole job is not going quiet about solid things. */
function localHalfExtents(
  c: PlacementCollision,
  scale: readonly [number, number, number],
): [number, number, number] {
  const sx = Math.abs(scale[0]);
  const sy = Math.abs(scale[1]);
  const sz = Math.abs(scale[2]);
  const maxAxis = Math.max(sx, sy, sz);
  if (c.kind === "box")
    return [
      c.halfExtents[0] * sx,
      c.halfExtents[1] * sy,
      c.halfExtents[2] * sz,
    ];
  if (c.kind === "sphere") {
    const r = c.radius * maxAxis;
    return [r, r, r];
  }
  const r = c.radius * maxAxis;
  return [r, (c.halfHeight + c.radius) * maxAxis, r];
}

/**
 * The collider's half-extent along its OWN Y axis, after `scale` — the distance
 * an `anchor: "base"` collider's centre sits above the record's position.
 *
 * Per primitive: a box's `halfExtents[1]`, a sphere's `radius`, a capsule's
 * `halfHeight + radius` (the cap counts). Scaling follows the runtime collider's
 * rule — per-axis for a box, max-axis for the round primitives — so a body
 * created at `position + rotateByQuat(record.quat, [0, collisionExtentY(c,
 * record.scale), 0])` has its collider's bottom exactly on `position`. That is
 * the same lift {@link voxelizePlacements} rasterizes, and the reason both live
 * in this module: the analyzer's solidity and the physics body must agree.
 *
 * @param c - The archetype's authored collision primitive.
 * @param scale - The placement record's per-axis scale.
 * @returns Metres, positive for any valid primitive. Not validated here — this
 * is a pure query over data the caller already parsed; {@link
 * voxelizePlacements} is where a malformed primitive is refused.
 */
export const collisionExtentY = (
  c: PlacementCollision,
  scale: readonly [number, number, number],
): number => localHalfExtents(c, scale)[1];

/** World-AABB half-extents of a local box under rotation `m`: the standard
 *  `|R| · h`. A rotated box's AABB is strictly larger than the box, so this
 *  OVER-covers — conservative, the miss-safe direction for a pass hunting traps
 *  (it can invent a pinch, never hide one). An exact rasterizer is deliberately
 *  not built: stage 2 re-checks candidates with the real mover. */
const rotatedHalfExtents = (
  m: Mat3,
  h: readonly [number, number, number],
): [number, number, number] => [
  Math.abs(m[0]) * h[0] + Math.abs(m[1]) * h[1] + Math.abs(m[2]) * h[2],
  Math.abs(m[3]) * h[0] + Math.abs(m[4]) * h[1] + Math.abs(m[5]) * h[2],
  Math.abs(m[6]) * h[0] + Math.abs(m[7]) * h[1] + Math.abs(m[8]) * h[2],
];

function assertCollisionValid(c: PlacementCollision, at: number): void {
  const positive: [string, number][] = [];
  if (c.kind === "box")
    positive.push(
      ["halfExtents[0]", c.halfExtents[0]],
      ["halfExtents[1]", c.halfExtents[1]],
      ["halfExtents[2]", c.halfExtents[2]],
    );
  else if (c.kind === "sphere") positive.push(["radius", c.radius]);
  else positive.push(["halfHeight", c.halfHeight], ["radius", c.radius]);
  for (const [name, value] of positive)
    if (!Number.isFinite(value) || value <= 0)
      throw new Error(
        `voxelizePlacements: group ${at} collision ${c.kind}.${name} must be a positive finite number, got ${value}`,
      );
}

/** The inclusive cell box one record covers: the world AABB of its anchored,
 *  scaled, rotated primitive, widened to whole cells (a cell counts as covered
 *  when the AABB touches it at all). */
function coveredCells(
  c: PlacementCollision,
  r: PlacementRecord,
  cellSize: number,
): CellBox {
  const m = quatMatrix(r.quat);
  const half = rotatedHalfExtents(m, localHalfExtents(c, r.scale));
  // Column 1 of the matrix is where the collider's own +Y points in the world.
  const lift = c.anchor === "base" ? collisionExtentY(c, r.scale) : 0;
  const cx = r.position[0] + m[1] * lift;
  const cy = r.position[1] + m[4] * lift;
  const cz = r.position[2] + m[7] * lift;
  const centres = [cx, cy, cz];
  if (!centres.every(Number.isFinite) || !half.every(Number.isFinite))
    throw new Error(
      `voxelizePlacements: record "${r.archetypeId}" has a non-finite world AABB — its position, scale and quat must all be finite`,
    );
  const box: CellBox = {
    x0: worldToVoxel(cx - half[0], cellSize),
    x1: worldToVoxel(cx + half[0], cellSize),
    y0: worldToVoxel(cy - half[1], cellSize),
    y1: worldToVoxel(cy + half[1], cellSize),
    z0: worldToVoxel(cz - half[2], cellSize),
    z1: worldToVoxel(cz + half[2], cellSize),
  };
  const cells =
    (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1) * (box.z1 - box.z0 + 1);
  if (cells > MAX_RECORD_CELLS)
    throw new Error(
      `voxelizePlacements: record "${r.archetypeId}" covers ${cells} cells, past the ${MAX_RECORD_CELLS}-cell per-record budget — check its collision dimensions and scale`,
    );
  return box;
}

/** Marks one record's cell box, chunk by chunk: the chunk is resolved ONCE per
 *  16³ block and the cells inside it are clipped to the box, so a record
 *  spanning many chunks never rebuilds a key per cell. */
function markCellBox(out: Map<ChunkKey, Uint8Array>, box: CellBox): void {
  for (let cz = voxelChunk(box.z0); cz <= voxelChunk(box.z1); cz++)
    for (let cy = voxelChunk(box.y0); cy <= voxelChunk(box.y1); cy++)
      for (let cx = voxelChunk(box.x0); cx <= voxelChunk(box.x1); cx++) {
        const key = chunkKey(cx, cy, cz);
        let bits = out.get(key);
        if (bits === undefined) {
          bits = new Uint8Array(CHUNK_SAMPLES);
          out.set(key, bits);
        }
        const bx = cx * CHUNK_DIM;
        const by = cy * CHUNK_DIM;
        const bz = cz * CHUNK_DIM;
        for (
          let z = Math.max(box.z0, bz);
          z <= Math.min(box.z1, bz + CHUNK_DIM - 1);
          z++
        )
          for (
            let y = Math.max(box.y0, by);
            y <= Math.min(box.y1, by + CHUNK_DIM - 1);
            y++
          )
            for (
              let x = Math.max(box.x0, bx);
              x <= Math.min(box.x1, bx + CHUNK_DIM - 1);
              x++
            )
              bits[x - bx + CHUNK_DIM * (y - by + CHUNK_DIM * (z - bz))] = 1;
      }
}

/**
 * Rasterizes placement colliders into per-chunk solidity for the walkability
 * analyzer (D-F4-5), so stage 1 sees the props the runtime physics sees.
 *
 * The result is `AnalyzeOptions.extraSolid`'s encoding exactly: one BYTE per
 * sample, a `Uint8Array` of length `CHUNK_SAMPLES` in `localIndex` order,
 * non-zero = solid. Deliberately NOT a packed bitset — a packed buffer reads as
 * plausible partial garbage rather than failing, which is why the analyzer
 * rejects one on length.
 *
 * Coverage is CONSERVATIVE: each record contributes the world AABB of its
 * anchored, scaled, quaternion-rotated primitive, and every cell that AABB
 * touches is marked, so a rotated or round collider reads slightly larger than
 * it is. Over-solidity is the miss-safe direction for a trap hunt — it can
 * invent a `narrow` or a `ledge`, never hide one — with one honest cost: filled
 * cells stop being floor anchors, so the analyzer says nothing at all about the
 * ground immediately under a prop. That matches the runtime, where the same
 * ground is inside a collider the mover cannot stand on either.
 *
 * @param groups - Records batched by the archetype collision they share; an
 * empty list, or a group with no records, contributes nothing.
 * @param cellSize - The target store's `cellSize`. The analyzer reads these
 * buffers on the store's own lattice, so this must be that store's value.
 * @returns One buffer per chunk any collider touched, to hand to `analyzeChunk`
 * / `analyzeWorld` / `markUnreachable` as `extraSolid`. Chunks no collider
 * reaches are absent, which those readers treat as "no extras" — the map need
 * not align with the store's allocated chunks (a prop overhanging the void marks
 * a chunk the field never allocated, where the analyzer simply finds no floor).
 * @throws Error - setup-loud, on a non-positive or non-finite collision
 * dimension, a non-positive `cellSize`, a record whose pose makes its world AABB
 * non-finite (which would otherwise rasterize to silent nothing), or a record
 * whose AABB exceeds the per-record cell budget.
 */
export function voxelizePlacements(
  groups: readonly PlacementCollisionGroup[],
  cellSize: number,
): Map<ChunkKey, Uint8Array> {
  if (!Number.isFinite(cellSize) || cellSize <= 0)
    throw new Error(
      `voxelizePlacements: cellSize must be a positive finite number, got ${cellSize}`,
    );
  const out = new Map<ChunkKey, Uint8Array>();
  for (const [index, group] of groups.entries()) {
    // Validated even when the group is empty: a broken primitive is bad input
    // whether or not this bake happened to place one.
    assertCollisionValid(group.collision, index);
    for (const r of group.records)
      markCellBox(out, coveredCells(group.collision, r, cellSize));
  }
  return out;
}
