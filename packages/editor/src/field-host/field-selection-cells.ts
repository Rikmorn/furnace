// Which of a flood selection's cells the viewport DRAWS — pure and GPU-free (the
// field-flags.ts / field-ghost.ts sibling). The host owns the instanced mesh; this
// module owns the only two decisions behind it: which cells, and in what order.
//
// WHY THERE IS A DECISION AT ALL (f2b gate item 1). A flood selection was drawn as
// one AABB outline, and a 200k-cell flood in an open world encloses the camera — so
// from inside, the only thing telling the user what they had selected was a box
// they were standing in the middle of and could not see. Drawing the cells is the
// fix, and drawing 200 000 blended cubes is not: the cap below is the budget, and
// SURFACE-FIRST is what makes spending it well possible.
//
// SURFACE-FIRST, precisely: a cell with all six face neighbours selected is buried
// inside the volume and contributes nothing but blend cost, so it is the first
// thing the cap discards. Cells with at least one unselected neighbour are the
// shell — the shape the user is actually looking at — and they are emitted first,
// so a truncated draw is a partial shell rather than an arbitrary subset.
import {
  CHUNK_DIM,
  type ChunkKey,
  chunkKey,
  parseChunkKey,
  voxelChunk,
} from "@furnace/core/field";

/** How many cell cubes the selection display will draw, at most.
 *
 *  65 536 is a budget, not a property of the selection: the UI flood budget is
 *  `SELECTION_UI_BUDGET` (200 000, `shared/field-limits.ts` since T3b2) and
 *  every one of these is a blended, depth-write-free instance, so the full flood
 *  would be ~2.4 M triangles of overdraw for a display. Above the cap the shell
 *  is truncated and the host SAYS so through {@link SelectionInfo.displayed} —
 *  never silently. */
export const SELECTION_DISPLAY_CAP = 65_536;

/** The cells to draw, already ordered.
 *
 *  `cells` is FLAT — three sample ints per cell — because the host's next move is
 *  to pack them into instance matrices, and an array of tuples would allocate one
 *  object per cell on a path whose whole reason for existing is the cost of doing
 *  65 000 of something. */
export type SelectionCells = {
  cells: Int32Array;
  /** `cells.length / 3`. */
  displayed: number;
  /** How many of the leading cells are SHELL cells (at least one unselected face
   *  neighbour) — i.e. where the surface half ends and the interior fill begins.
   *  Reported rather than left implicit because it is the only externally
   *  checkable statement of the ordering rule this module exists for; under the
   *  cap it is what SURVIVED, not what was found. */
  surface: number;
};

const EMPTY: SelectionCells = {
  cells: new Int32Array(0),
  displayed: 0,
  surface: 0,
};

/** A membership reader over the chunk bitsets, with a one-entry chunk cache.
 *
 *  Core's own `selectionHas` answers the same question and is deliberately NOT
 *  used: it builds a `chunkKey` STRING on every call, and the six-neighbour test
 *  below makes six calls per selected cell — 1.2 M string allocations on a
 *  full-budget flood, for a rebuild that runs on a click. The cache makes the five
 *  in-chunk probes of a typical cell string-free. The agreement between this reader
 *  and core's is asserted in `field-selection-cells.test.ts`, which cross-checks
 *  every emitted cell through `selectionHas`. */
function membership(chunks: ReadonlyMap<ChunkKey, Uint8Array>) {
  let lastCx = 0.5; // non-integer sentinel: never equals a real chunk coord
  let lastCy = 0.5;
  let lastCz = 0.5;
  let lastBits: Uint8Array | undefined;
  return (x: number, y: number, z: number): boolean => {
    const cx = voxelChunk(x);
    const cy = voxelChunk(y);
    const cz = voxelChunk(z);
    if (cx !== lastCx || cy !== lastCy || cz !== lastCz) {
      lastCx = cx;
      lastCy = cy;
      lastCz = cz;
      lastBits = chunks.get(chunkKey(cx, cy, cz));
    }
    if (lastBits === undefined) return false;
    // Core's layout, x-fastest, restated from CHUNK_DIM rather than from a literal
    // 16 (`localIndex` is not on the field barrel, so this is the one place the
    // editor spells it — see the test file's header).
    const bit =
      x -
      cx * CHUNK_DIM +
      CHUNK_DIM * (y - cy * CHUNK_DIM + CHUNK_DIM * (z - cz * CHUNK_DIM));
    return ((lastBits[bit >> 3] as number) & (1 << (bit & 7))) !== 0;
  };
}

/**
 * The cells to draw for a `cells` materialization, shell first, capped.
 *
 * `cap` is a parameter rather than a read of {@link SELECTION_DISPLAY_CAP} so the
 * cut is testable at a fixture-sized number: a test that had to build 65 537 cells
 * to reach the boundary would not be written, and an untested cap is the class this
 * slice has caught repeatedly.
 *
 * Cost is O(selected cells) — one pass to classify (six membership probes each,
 * five of them cache hits for an interior cell) plus one to fill. Region
 * selections never reach here: they keep the honest AABB box, because a region IS
 * its box and there is nothing a per-cell draw would add.
 */
export function selectionDisplayCells(
  chunks: ReadonlyMap<ChunkKey, Uint8Array>,
  cap: number,
): SelectionCells {
  if (cap <= 0 || chunks.size === 0) return EMPTY;
  const has = membership(chunks);
  const shell: number[] = [];
  const inner: number[] = [];
  const bitsPerChunk = CHUNK_DIM * CHUNK_DIM * CHUNK_DIM;
  const plane = CHUNK_DIM * CHUNK_DIM;

  for (const [key, bits] of chunks) {
    const [cx, cy, cz] = parseChunkKey(key);
    const ox = cx * CHUNK_DIM;
    const oy = cy * CHUNK_DIM;
    const oz = cz * CHUNK_DIM;
    for (let byte = 0; byte < bits.length; byte++) {
      const packed = bits[byte] as number;
      // Eight cells at a time when the byte is empty, which most of them are on
      // anything but a solid blob.
      if (packed === 0) continue;
      for (let b = 0; b < 8; b++) {
        if ((packed & (1 << b)) === 0) continue;
        const bit = byte * 8 + b;
        if (bit >= bitsPerChunk) break; // defensive: a bitset longer than a chunk
        const x = ox + (bit % CHUNK_DIM);
        const y = oy + (Math.floor(bit / CHUNK_DIM) % CHUNK_DIM);
        const z = oz + Math.floor(bit / plane);
        const buried =
          has(x + 1, y, z) &&
          has(x - 1, y, z) &&
          has(x, y + 1, z) &&
          has(x, y - 1, z) &&
          has(x, y, z + 1) &&
          has(x, y, z - 1);
        const into = buried ? inner : shell;
        into.push(x, y, z);
      }
    }
  }

  const surface = Math.min(shell.length / 3, cap);
  const filled = Math.min(surface + inner.length / 3, cap);
  const out = new Int32Array(filled * 3);
  out.set(shell.slice(0, surface * 3), 0);
  out.set(inner.slice(0, (filled - surface) * 3), surface * 3);
  return { cells: out, displayed: filled, surface };
}
