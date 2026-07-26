// Placement colliders as field-resolution solidity (D-F4-5). Props carry their
// OWN colliders in the runtime physics world — the "if you can dig it, it's
// field, else it's an entity with its own collider" jurisdiction rule — so the
// walkability analyzer, which reads only chunk density, would be blind to every
// rock and stalagmite in the world. This module rasterizes those colliders into
// the same per-chunk solidity the analyzer consumes (`AnalyzeOptions.extraSolid`).
//
// It shares nothing with the column pass but that encoding, and deliberately
// lives apart from it: `collisionExtentY` and `collisionCenter` are not analysis
// functions — the dungeon's field-world loader calls `collisionCenter` to POSITION
// rigid bodies, and an editor's ghosts/proxies will call it to draw them. That is
// the point of exporting it: the analyzer rasterizes around the centre those
// consumers place, because it is the same function, not a matching recipe.
import {
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  voxelChunk,
  worldToVoxel,
} from "./chunks.ts";
import { QUAT_NORM_TOLERANCE } from "./ops.ts";
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
 *  here because {@link coveredCells}' two uses — the world-AABB widening and the
 *  base-anchor lift — must come from the SAME matrix; two hand-written copies is
 *  how the rasterized solidity and the placed rigid body would drift apart.
 *  {@link collisionCenter} builds its own (it has only a quaternion to start
 *  from) but reaches the lift through the same {@link anchorOffset}. */
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
 *  The scale rule matches the runtime collider derivation (the dungeon's
 *  `placementCollider`): a box scales PER AXIS, while a sphere/capsule has no
 *  per-axis form and takes the MAX scale axis, and both sides take MAGNITUDES.
 *  Exact for the uniform-scale records scatter emits, a conservative
 *  over-approximation otherwise. Diverging from it would put analyzed solidity
 *  where the physics collider is not, which is the one thing D-F4-5 exists to
 *  prevent.
 *
 *  Magnitudes: an extent is a distance, so a MIRRORED record (a negative scale
 *  axis) covers the same box. Signed arithmetic here would invert the cell range
 *  and rasterize the record to nothing at all — silence, in a pass whose whole
 *  job is not going quiet about solid things. */
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
 * `halfHeight + radius` (the cap counts). It applies the runtime collider's own
 * scale rule — per-axis for a box, max-axis for the round primitives, magnitudes
 * throughout. The dungeon's `field-world.ts` is the runtime half of that pair,
 * and its own tests pin its side of the rule.
 *
 * This is the EXTENT alone. To place a `"base"`-anchored collider, call {@link
 * collisionCenter} rather than composing the lift by hand: getting the world
 * pose right also means rotating that extent into the record's own frame, and a
 * recipe written out in prose is a recipe that drifts from the code.
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

/** How far an anchored collider's CENTRE sits from the record's position, given
 *  the record's rotation MATRIX. Column 1 of `m` is where the collider's own +Y
 *  points in the world, so a `"base"` primitive offsets by that column times its
 *  Y extent; `"center"` (the default) offsets by nothing.
 *
 *  Takes the matrix rather than the quaternion so {@link coveredCells} — which
 *  already built one for the AABB widening — passes that SAME matrix, which is
 *  the invariant {@link quatMatrix} exists to hold. {@link collisionCenter}
 *  builds one and calls straight through, so the public answer and the
 *  rasterizer's are one code path, not two that agree today. */
function anchorOffset(
  m: Mat3,
  c: PlacementCollision,
  scale: readonly [number, number, number],
): [number, number, number] {
  if (c.anchor !== "base") return [0, 0, 0];
  const lift = collisionExtentY(c, scale);
  return [m[1] * lift, m[4] * lift, m[7] * lift];
}

/**
 * Where a placed record's collider CENTRE is in world space — the pose to give
 * the rigid body, the proxy, or the ghost that stands in for it (D-F4-14).
 *
 * A `"center"` primitive (the default, and every pre-F4 catalog's implicit
 * meaning) sits at the record's `position` unchanged. A `"base"` one is lifted
 * by its own Y half-extent ({@link collisionExtentY}) along the record's LOCAL
 * +Y — so the collider's BOTTOM lands on `position`, which is what an archetype
 * whose mesh is base-origin needs to have its collider cover the mesh rather
 * than bury half of it.
 *
 * Call this rather than composing the lift per consumer: the extent rule
 * (per-axis box, max-axis round, magnitudes) and the rotation into the record's
 * own frame both have to be right, and every consumer that gets one of them
 * wrong puts its collider somewhere {@link voxelizePlacements} did not mark. The
 * analyzer's solidity, the runtime's rigid body and an editor's proxy come from
 * this one function for exactly that reason.
 *
 * @param c - The archetype's authored collision primitive.
 * @param r - The placed record, for its position, rotation and scale.
 * @returns A fresh world-space `[x, y, z]`, in metres.
 * @remarks Not validated — a pure query over data the caller already parsed, the
 * same stance as {@link collisionExtentY}. A non-unit `r.quat` rotates only
 * PARTIALLY here (it would shorten the lift); {@link voxelizePlacements} is
 * where such a record is refused.
 */
export function collisionCenter(
  c: PlacementCollision,
  r: PlacementRecord,
): [number, number, number] {
  const off = anchorOffset(quatMatrix(r.quat), c, r.scale);
  return [
    r.position[0] + off[0],
    r.position[1] + off[1],
    r.position[2] + off[2],
  ];
}

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

/** Setup-loud check that a record's quaternion is unit-length, to the same
 *  tolerance {@link assertPlacementsValid} holds the artifact path to.
 *
 *  Not redundant with that check, and not a style guard: {@link quatMatrix} on a
 *  quat of norm `n` yields `I + n²(R − I)`, a PARTIAL rotation, whose AABB is
 *  SMALLER than the true one. (Worked: box `h = [0.5, 0.1, 0.1]` at 45° yaw with
 *  `|q|² = 0.5` gives `hz' = 0.181` against a true `0.424`.) Under-covering is
 *  the one direction this module promises never to go, and every other input
 *  class that could cause it already throws — so this one does too, rather than
 *  leaving the guarantee true only for callers who came through the parser. */
function assertUnitQuat(r: PlacementRecord): void {
  const [x, y, z, w] = r.quat;
  const norm2 = x * x + y * y + z * z + w * w;
  if (!Number.isFinite(norm2) || Math.abs(norm2 - 1) > QUAT_NORM_TOLERANCE)
    throw new Error(
      `voxelizePlacements: record "${r.archetypeId}" quat must be unit-length (|q|² = ${norm2}, tolerance ${QUAT_NORM_TOLERANCE}) — a non-unit quaternion rotates PARTIALLY, and its AABB would under-cover`,
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
  assertUnitQuat(r);
  const m = quatMatrix(r.quat);
  const half = rotatedHalfExtents(m, localHalfExtents(c, r.scale));
  const off = anchorOffset(m, c, r.scale);
  const cx = r.position[0] + off[0];
  const cy = r.position[1] + off[1];
  const cz = r.position[2] + off[2];
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

/** Marks the part of `box` that lands inside ONE chunk, the chunk's own cells
 *  clipped to the box. `b*` are the chunk's base cell coords, so the write index
 *  is the plain `localIndex` formula on the local offsets. */
function fillChunkSlice(
  bits: Uint8Array,
  box: CellBox,
  bx: number,
  by: number,
  bz: number,
): void {
  const xEnd = Math.min(box.x1, bx + CHUNK_DIM - 1);
  const yEnd = Math.min(box.y1, by + CHUNK_DIM - 1);
  const zEnd = Math.min(box.z1, bz + CHUNK_DIM - 1);
  for (let z = Math.max(box.z0, bz); z <= zEnd; z++)
    for (let y = Math.max(box.y0, by); y <= yEnd; y++)
      for (let x = Math.max(box.x0, bx); x <= xEnd; x++)
        bits[x - bx + CHUNK_DIM * (y - by + CHUNK_DIM * (z - bz))] = 1;
}

/** Marks one record's cell box, chunk by chunk: WHICH chunks it spans here, and
 *  which cells within each one in {@link fillChunkSlice}. Splitting the two
 *  halves keeps the key resolved ONCE per 16³ block — a record spanning many
 *  chunks never rebuilds a key per cell — without six nested loops in one body. */
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
        fillChunkSlice(
          bits,
          box,
          cx * CHUNK_DIM,
          cy * CHUNK_DIM,
          cz * CHUNK_DIM,
        );
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
 * dimension, a non-positive `cellSize`, a record whose quaternion is not
 * unit-length (it would rotate only partially, and UNDER-cover), a record whose
 * pose makes its world AABB non-finite (which would otherwise rasterize to
 * silent nothing), or a record whose AABB exceeds the per-record cell budget.
 * Every one of those is a way to cover LESS than the collider really does, which
 * is the failure this module refuses to have silently.
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
