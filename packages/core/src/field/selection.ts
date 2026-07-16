// packages/core/src/field/selection.ts — selection specs materialized against
// the CURRENT field state: deterministic, budgeted, core-side (F2b).
import {
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  getDensity,
  sampleToWorld,
  voxelChunk,
} from "./chunks.ts";
import { getMaterial } from "./materials.ts";
import type {
  ChunkKey,
  FieldStore,
  MaterializedSelection,
  SelectionSpec,
} from "./types.ts";

/** Hard ceiling on any selection flood's `budget` — 64 chunks' worth of cells
 *  (64 × 16³). Specs embedded in ops must stay at or below it: an op carrying
 *  an unbounded flood would break replay budgets. */
export const MAX_SELECTION_BUDGET = 262144;

const STEPS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const localBit = (x: number, y: number, z: number): number => {
  const lx = x - voxelChunk(x) * CHUNK_DIM;
  const ly = y - voxelChunk(y) * CHUNK_DIM;
  const lz = z - voxelChunk(z) * CHUNK_DIM;
  return lx + CHUNK_DIM * (ly + CHUNK_DIM * lz);
};

const voidWants =
  (store: FieldStore) =>
  (x: number, y: number, z: number): boolean =>
    getDensity(store, x, y, z) >= 0;

const materialWants =
  (store: FieldStore, classId: number) =>
  (x: number, y: number, z: number): boolean =>
    getDensity(store, x, y, z) < 0 && getMaterial(store, x, y, z) === classId;

/** Sets sample (x,y,z)'s bit in its chunk's bitset, allocating on first touch. */
function mark(
  chunks: Map<ChunkKey, Uint8Array>,
  x: number,
  y: number,
  z: number,
): void {
  const key = chunkKey(voxelChunk(x), voxelChunk(y), voxelChunk(z));
  let bits = chunks.get(key);
  if (bits === undefined) {
    bits = new Uint8Array(CHUNK_SAMPLES / 8);
    chunks.set(key, bits);
  }
  const bit = localBit(x, y, z);
  bits[bit >> 3] = (bits[bit >> 3] as number) | (1 << (bit & 7));
}

/**
 * Materializes a selection spec against the CURRENT field state. Regions pass
 * through as pure predicates. Floods are 6-connected BFS from the seed —
 * `flood-void` selects density ≥ 0 (the surface's exact-zero samples count as
 * void), `flood-material` selects solid cells (density < 0) of exactly
 * `classId` — capped at `budget` selected cells (`truncated` = true when the
 * cap fired — surface it, never silent). Pure query — the store is never
 * mutated.
 */
export function materializeSelection(
  store: FieldStore,
  spec: SelectionSpec,
): MaterializedSelection {
  if (spec.kind === "region")
    return { kind: "region", min: spec.min, max: spec.max };
  const wants =
    spec.kind === "flood-void"
      ? voidWants(store)
      : materialWants(store, spec.classId);
  const chunks = new Map<ChunkKey, Uint8Array>();
  const seen = new Set<string>();
  const queue: [number, number, number][] = [];
  const [sx, sy, sz] = spec.seed;
  if (wants(sx, sy, sz)) {
    seen.add(`${sx},${sy},${sz}`);
    queue.push([sx, sy, sz]);
  }
  let head = 0; // index cursor — queue.shift() would be O(n)
  let count = 0;
  let truncated = false;
  let bounds: {
    min: [number, number, number];
    max: [number, number, number];
  } | null = null;
  while (head < queue.length) {
    if (count >= spec.budget) {
      truncated = true;
      break;
    }
    const cell = queue[head++];
    if (cell === undefined) break; // unreachable: head < queue.length
    const [x, y, z] = cell;
    mark(chunks, x, y, z);
    count++;
    if (bounds === null) {
      bounds = { min: [x, y, z], max: [x, y, z] };
    } else {
      if (x < bounds.min[0]) bounds.min[0] = x;
      if (y < bounds.min[1]) bounds.min[1] = y;
      if (z < bounds.min[2]) bounds.min[2] = z;
      if (x > bounds.max[0]) bounds.max[0] = x;
      if (y > bounds.max[1]) bounds.max[1] = y;
      if (z > bounds.max[2]) bounds.max[2] = z;
    }
    for (const [dx, dy, dz] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const k = `${nx},${ny},${nz}`;
      if (seen.has(k) || !wants(nx, ny, nz)) continue;
      seen.add(k);
      queue.push([nx, ny, nz]);
    }
  }
  return { kind: "cells", chunks, count, truncated, bounds };
}

/** Whether sample (x,y,z) is inside a materialized selection. Region kinds test
 *  the sample's world position against the metre AABB (min-inclusive,
 *  max-exclusive); cell kinds test the chunk bitset (false when the chunk is
 *  missing). */
export function selectionHas(
  sel: MaterializedSelection,
  x: number,
  y: number,
  z: number,
  cellSize: number,
): boolean {
  if (sel.kind === "region") {
    const wx = sampleToWorld(x, cellSize);
    const wy = sampleToWorld(y, cellSize);
    const wz = sampleToWorld(z, cellSize);
    return (
      wx >= sel.min[0] &&
      wx < sel.max[0] &&
      wy >= sel.min[1] &&
      wy < sel.max[1] &&
      wz >= sel.min[2] &&
      wz < sel.max[2]
    );
  }
  const bits = sel.chunks.get(
    chunkKey(voxelChunk(x), voxelChunk(y), voxelChunk(z)),
  );
  if (bits === undefined) return false;
  const bit = localBit(x, y, z);
  return ((bits[bit >> 3] as number) & (1 << (bit & 7))) !== 0;
}
