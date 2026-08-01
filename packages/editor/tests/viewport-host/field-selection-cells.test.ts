// The pure half of the cell-level selection display (F4.5b Task 13, f2b item 1):
// which of a flood's selected cells the viewport draws, in which order, and where
// the cap cuts.
//
// Every fixture's bitsets come from core's own `materializeSelection` rather than
// from hand-built `Uint8Array`s — deliberately. The module decodes core's bit
// layout (`lx + CHUNK_DIM·(ly + CHUNK_DIM·lz)`, four bits of it per axis), and a
// hand-built fixture would encode MY reading of that layout on both sides of the
// assertion, which is the shape that passes while the production path draws cubes
// in the wrong places. Core writes the bits here; core's own `selectionHas` reads
// them back in the cross-checks below.
import { expect, test } from "bun:test";
import type { MaterializedSelection } from "@furnace/core/field";
import {
  AIR,
  CHUNK_DIM,
  createFieldStore,
  materializeSelection,
  selectionHas,
  setDensity,
} from "@furnace/core/field";
import {
  SELECTION_DISPLAY_CAP,
  selectionDisplayCells,
} from "../../src/viewport-host/field-selection-cells.ts";

type Cell = [number, number, number];

/** A store with `cells` carved to AIR and everything else solid. */
function carved(cells: readonly Cell[]) {
  const store = createFieldStore();
  for (const [x, y, z] of cells) setDensity(store, x, y, z, AIR);
  return store;
}

/** Every cell of the axis-aligned block spanning `min…max` INCLUSIVE. */
function block(min: Cell, max: Cell): Cell[] {
  const out: Cell[] = [];
  for (let x = min[0]; x <= max[0]; x++)
    for (let y = min[1]; y <= max[1]; y++)
      for (let z = min[2]; z <= max[2]; z++) out.push([x, y, z]);
  return out;
}

/** A flood-void selection seeded inside `cells`, materialized by CORE. */
function floodOf(cells: readonly Cell[], seed: Cell): MaterializedSelection {
  const mat = materializeSelection(carved(cells), {
    kind: "flood-void",
    seed,
    budget: 100_000,
  });
  if (mat.kind !== "cells") throw new Error("test: expected a cells selection");
  return mat;
}

/** The chunk map of a cells materialization, narrowed for the module's argument. */
const chunksOf = (
  mat: MaterializedSelection,
): ReadonlyMap<string, Uint8Array> =>
  mat.kind === "cells" ? mat.chunks : new Map();

/** `cells` as tuples — the flat triples are what the host packs into matrices, but
 *  a test reads them one cell at a time. */
function tuples(cells: Int32Array): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < cells.length; i += 3)
    out.push([
      cells[i] as number,
      cells[i + 1] as number,
      cells[i + 2] as number,
    ]);
  return out;
}

/** Whether a cell has at least one of its six face neighbours OUTSIDE the
 *  selection — computed here through CORE's reader, so the partition this file
 *  asserts is never the module's own answer read back. */
function isSurface(mat: MaterializedSelection, [x, y, z]: Cell): boolean {
  const h = (a: number, b: number, c: number): boolean =>
    selectionHas(mat, a, b, c, 0.25);
  return (
    !h(x + 1, y, z) ||
    !h(x - 1, y, z) ||
    !h(x, y + 1, z) ||
    !h(x, y - 1, z) ||
    !h(x, y, z + 1) ||
    !h(x, y, z - 1)
  );
}

// The layout cross-check, and the reason every other assertion here can be
// trusted: the module decodes core's bit index itself (core does not export
// `localIndex`), so a transposed or off-by-one decode would put every drawn cube
// somewhere plausible-looking and nothing else in this file would notice. Both
// directions are asserted — every cell it emits IS selected, and it emits as many
// as core counted — because either one alone passes under a decode that drops or
// duplicates whole rows.
test("what it enumerates is exactly what core selected", () => {
  const cells = block([2, 3, 4], [7, 6, 9]);
  const mat = floodOf(cells, [2, 3, 4]);
  const out = selectionDisplayCells(chunksOf(mat), SELECTION_DISPLAY_CAP);

  expect(out.displayed).toBe(mat.kind === "cells" ? mat.count : -1);
  expect(out.cells.length).toBe(out.displayed * 3);
  const emitted = tuples(out.cells);
  for (const [x, y, z] of emitted)
    expect([x, y, z, selectionHas(mat, x, y, z, 0.25)]).toEqual([
      x,
      y,
      z,
      true,
    ]);
  // …and no cell twice, which a decode that ignored one axis would produce.
  expect(new Set(emitted.map((c) => c.join(","))).size).toBe(out.displayed);
});

test("surface cells come first, and the interior is what is left", () => {
  // 3×3×3 of air: 27 cells, of which exactly ONE — the centre — has all six
  // neighbours selected. The numbers are the fixture's, not the module's.
  const mat = floodOf(block([4, 4, 4], [6, 6, 6]), [5, 5, 5]);
  const out = selectionDisplayCells(chunksOf(mat), SELECTION_DISPLAY_CAP);

  expect(out.displayed).toBe(27);
  expect(out.surface).toBe(26);
  const emitted = tuples(out.cells);
  // The PARTITION, checked against core's reader rather than against `surface`:
  // everything before the boundary is a surface cell and everything after is not.
  expect(emitted.slice(0, 26).every((c) => isSurface(mat, c))).toBe(true);
  expect(emitted.slice(26).map((c) => isSurface(mat, c))).toEqual([false]);
  expect(emitted[26]).toEqual([5, 5, 5]);
});

// The chunk-boundary case, and the one this module could most plausibly get wrong:
// the six-neighbour test has to look into the ADJACENT chunk's bitset, not just the
// one the cell sits in. The block straddles the x = CHUNK_DIM seam, so the centre
// cell's −X neighbour lives in a different chunk — a reader that only consulted the
// current chunk would call that neighbour unselected and promote the centre to the
// surface, which is how the whole interior lattice of a big flood comes back as
// "surface" and the cap then truncates the wrong cells.
test("a neighbour in the NEXT chunk is still a neighbour", () => {
  const min: Cell = [CHUNK_DIM - 1, 5, 5];
  const max: Cell = [CHUNK_DIM + 1, 7, 7];
  const mat = floodOf(block(min, max), min);
  const out = selectionDisplayCells(chunksOf(mat), SELECTION_DISPLAY_CAP);

  // Premise: the fixture really does straddle a seam (two chunks, not one) — so a
  // regression that collapsed it into one chunk could not make this test vacuous.
  expect(chunksOf(mat).size).toBe(2);
  expect(out.displayed).toBe(27);
  expect(out.surface).toBe(26);
  const emitted = tuples(out.cells);
  expect(emitted[26]).toEqual([CHUNK_DIM, 6, 6]);
});

test("the cap cuts, and it cuts the INTERIOR first", () => {
  const mat = floodOf(block([4, 4, 4], [6, 6, 6]), [5, 5, 5]);
  // One below the total: the interior cell is what has to go.
  const capped = selectionDisplayCells(chunksOf(mat), 26);
  expect(capped.displayed).toBe(26);
  expect(capped.surface).toBe(26);
  expect(tuples(capped.cells).every((c) => isSurface(mat, c))).toBe(true);

  // Below the SURFACE count: it takes a prefix of the surface and no interior at
  // all. `surface` reports what survived, not what was found — otherwise the host
  // could not tell how much it is drawing.
  const hard = selectionDisplayCells(chunksOf(mat), 10);
  expect([hard.displayed, hard.surface]).toEqual([10, 10]);
  expect(tuples(hard.cells).every((c) => isSurface(mat, c))).toBe(true);
});

// The cap's VALUE, and the reason it needs its own line: every other case here
// passes `cap` explicitly at a fixture-sized number (which is what makes the cut
// testable at all), and the two that use the real constant IMPORT it — so mutating
// 65 536 to 1 000 left all nine green. A budget nothing pins is a budget that can
// drift to a number nobody chose, and this is the fourth instance of that class in
// this slice alone (STEPPER_MAX_STEPS, HISTORY_TAIL, MAX_SEGMENT_M).
//
// Both halves are the claim. The literal catches drift; the RELATION is what the
// number means — the cap has to sit strictly below the host's flood budget
// (SELECTION_UI_BUDGET = 200 000, field-host.ts), or it could never fire and the
// whole shell-first ordering would be dead code. That constant is host-private, so
// it is restated here as the plain integer it is, with its home named.
test("the display cap is 65 536, and it is strictly below the flood budget", () => {
  expect(SELECTION_DISPLAY_CAP).toBe(65_536);
  const SELECTION_UI_BUDGET = 200_000; // field-host.ts, host-private
  expect(SELECTION_DISPLAY_CAP).toBeLessThan(SELECTION_UI_BUDGET);
});

test("an empty selection draws nothing rather than throwing", () => {
  const out = selectionDisplayCells(new Map(), SELECTION_DISPLAY_CAP);
  expect([out.displayed, out.surface, out.cells.length]).toEqual([0, 0, 0]);
});
