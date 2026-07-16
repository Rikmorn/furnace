// packages/core/src/field/selection.ts — selection specs materialized against
// the CURRENT field state: deterministic, budgeted, core-side (F2b).
import {
  CHUNK_SAMPLES,
  chunkKey,
  localIndex,
  SOLID,
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
 *  (64 × 16³). {@link materializeSelection} rejects budgets above it: an op
 *  carrying an unbounded flood would break replay budgets. */
export const MAX_SELECTION_BUDGET = 262144;

/**
 * Setup-loud validation of a selection spec: flood seeds must be integer
 * sample coordinates and flood budgets integers in
 * [1, {@link MAX_SELECTION_BUDGET}]; region specs are always valid. Shared by
 * {@link materializeSelection} and the op-embedded mask validation in
 * assertOpValid, so a bad spec never enters the op log and both paths throw
 * the same messages.
 *
 * @throws {@link Error} if a flood seed coordinate is not an integer, or the
 *   flood budget is not an integer in [1, {@link MAX_SELECTION_BUDGET}].
 */
export function assertSelectionSpecValid(spec: SelectionSpec): void {
  if (spec.kind === "region") return;
  const [sx, sy, sz] = spec.seed;
  if (!Number.isInteger(sx) || !Number.isInteger(sy) || !Number.isInteger(sz))
    throw new Error(
      "field selection: flood seed must be integer sample coordinates",
    );
  const budget = spec.budget;
  if (!Number.isInteger(budget) || budget < 1 || budget > MAX_SELECTION_BUDGET)
    throw new Error(
      `field selection: flood budget must be an integer in [1, ${MAX_SELECTION_BUDGET}]`,
    );
}

/**
 * Materializes a selection spec against the CURRENT field state. Regions pass
 * through as pure predicates (bounds copied — never aliased to the spec's
 * arrays). Floods are 6-connected BFS from the seed — `flood-void` selects
 * density ≥ 0 (the surface's exact-zero samples count as void),
 * `flood-material` selects solid cells (density < 0) of exactly `classId` —
 * capped at `budget` selected cells. `truncated` is true exactly when a
 * further matching cell would exceed the budget (surface it, never silent);
 * an exact fit stays untruncated. Pure query — the store is never mutated.
 *
 * @throws {@link Error} if the spec fails {@link assertSelectionSpecValid}
 *   (setup-loud — selections are user-action-frequency, not per-frame).
 */
export function materializeSelection(
  store: FieldStore,
  spec: SelectionSpec,
): MaterializedSelection {
  assertSelectionSpecValid(spec);
  if (spec.kind === "region")
    return { kind: "region", min: [...spec.min], max: [...spec.max] };
  const [sx, sy, sz] = spec.seed;
  const budget = spec.budget;
  const isVoid = spec.kind === "flood-void";
  const classId = isVoid ? 0 : spec.classId;
  const chunks = new Map<ChunkKey, Uint8Array>();
  // Mark-at-enqueue BFS, tuned for the full-budget flood (262144 cells,
  // ~1.6M neighbour probes) to stay well under the editor's 100ms interaction
  // ceiling: the chunk bitsets double as the visited set (no seen-set), the
  // queue is three flat number arrays (no per-cell tuples), and a one-entry
  // chunk cache elides the per-probe chunkKey string + Map lookups — density
  // is read straight off the cached store chunk (FieldStore's density layout
  // is public surface; materials stay behind their accessor wall).
  const qx: number[] = [];
  const qy: number[] = [];
  const qz: number[] = [];
  let count = 0;
  let truncated = false;
  let bounds: {
    min: [number, number, number];
    max: [number, number, number];
  } | null = null;
  let lastCx = 0.5; // non-integer sentinel: never matches a real chunk coord
  let lastCy = 0.5;
  let lastCz = 0.5;
  let lastKey: ChunkKey = "";
  let lastBits: Uint8Array | undefined;
  let lastDensity: Int8Array | undefined;
  const visit = (x: number, y: number, z: number): void => {
    if (truncated) return;
    const cx = voxelChunk(x);
    const cy = voxelChunk(y);
    const cz = voxelChunk(z);
    if (cx !== lastCx || cy !== lastCy || cz !== lastCz) {
      lastCx = cx;
      lastCy = cy;
      lastCz = cz;
      lastKey = chunkKey(cx, cy, cz);
      lastBits = chunks.get(lastKey);
      lastDensity = store.chunks.get(lastKey);
    }
    const bit = localIndex(x, y, z);
    const byte = bit >> 3;
    const mask = 1 << (bit & 7);
    if (lastBits !== undefined && ((lastBits[byte] as number) & mask) !== 0)
      return; // already selected
    const d = lastDensity === undefined ? SOLID : (lastDensity[bit] as number);
    if (isVoid) {
      if (d < 0) return; // rock — flood-void stops at walls
    } else if (d >= 0 || getMaterial(store, x, y, z) !== classId) {
      return; // air, or a different material class
    }
    if (count >= budget) {
      truncated = true; // a matching cell exists beyond the cap — never silent
      return;
    }
    if (lastBits === undefined) {
      lastBits = new Uint8Array(CHUNK_SAMPLES / 8);
      chunks.set(lastKey, lastBits);
    }
    lastBits[byte] = (lastBits[byte] as number) | mask;
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
    qx.push(x);
    qy.push(y);
    qz.push(z);
  };
  visit(sx, sy, sz);
  for (let head = 0; head < qx.length && !truncated; head++) {
    const x = qx[head];
    const y = qy[head];
    const z = qz[head];
    if (x === undefined || y === undefined || z === undefined) break; // unreachable: head < length
    visit(x + 1, y, z);
    visit(x - 1, y, z);
    visit(x, y + 1, z);
    visit(x, y - 1, z);
    visit(x, y, z + 1);
    visit(x, y, z - 1);
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
  const bit = localIndex(x, y, z);
  return ((bits[bit >> 3] as number) & (1 << (bit & 7))) !== 0;
}
