import { describe, expect, test } from "bun:test";
import type {
  BrushOp,
  MaterialTable,
  SelectionSpec,
} from "@furnace/core/field";
import {
  applyOp,
  createFieldStore,
  createOpLog,
  logApply,
  MAX_SELECTION_BUDGET,
  materializeSelection,
  selectionHas,
} from "@furnace/core/field";

// File-local op helpers (the field-ops.test.ts digSphere idiom): literals with
// id: 0 — applyOp takes ops as-is; logApply stamps real ids.
const digBox = (
  center: [number, number, number],
  halfExtents: [number, number, number],
): BrushOp => ({
  id: 0,
  kind: "brush",
  effect: "dig",
  shape: { kind: "box", center, halfExtents },
});

const paintBox = (
  center: [number, number, number],
  halfExtents: [number, number, number],
  material: number,
): BrushOp => ({
  id: 0,
  kind: "brush",
  effect: "paint",
  material,
  shape: { kind: "box", center, halfExtents },
});

const TABLE: MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
    { id: 1, name: "dirt", kind: "organic", color: [0.4, 0.3, 0.2, 1] },
  ],
};

describe("field selection", () => {
  test("flood-void selects exactly one room and stops at walls", () => {
    const s = createFieldStore();
    // two 2m rooms separated by solid rock: air spans samples 0..8 (room A)
    // and 20..28 (room B) per dug axis — the dig's boundary samples land at
    // exactly density 0, which counts as void.
    applyOp(s, digBox([1, 1, 1], [1, 1, 1]), TABLE);
    applyOp(s, digBox([6, 1, 1], [1, 1, 1]), TABLE);
    const chunksBefore = s.chunks.size;
    const materialsBefore = s.materials.size;
    const chunk0Before = Int8Array.from(s.chunks.get("0,0,0") as Int8Array);
    const sel = materializeSelection(s, {
      kind: "flood-void",
      seed: [4, 4, 4], // inside room A
      budget: 100000,
    });
    expect(sel.kind).toBe("cells");
    if (sel.kind !== "cells") return;
    expect(sel.truncated).toBe(false);
    expect(sel.count).toBe(729); // room A = 9³ air samples (0..8 per axis)
    expect(sel.bounds).toEqual({ min: [0, 0, 0], max: [8, 8, 8] });
    expect(selectionHas(sel, 4, 4, 4, s.cellSize)).toBe(true); // room A
    expect(selectionHas(sel, 24, 4, 4, s.cellSize)).toBe(false); // room B (sample 24 = 6m)
    // pure query: the store is never mutated — sizes AND the bytes of an
    // allocated chunk the flood traversed
    expect(s.chunks.size).toBe(chunksBefore);
    expect(s.materials.size).toBe(materialsBefore);
    expect(s.chunks.get("0,0,0")).toEqual(chunk0Before);
  });

  test("budget exact-fit (all reachable cells === budget) is NOT truncated", () => {
    const s = createFieldStore();
    applyOp(s, digBox([1, 1, 1], [1, 1, 1]), TABLE); // room A: exactly 729 air cells
    const sel = materializeSelection(s, {
      kind: "flood-void",
      seed: [4, 4, 4],
      budget: 729,
    });
    if (sel.kind !== "cells") throw new Error("expected cells");
    expect(sel.count).toBe(729);
    expect(sel.truncated).toBe(false);
  });

  test("cells bitsets use the documented lx + 16*(ly + 16*lz) layout", () => {
    const s = createFieldStore();
    // Distinct per-axis extents: the selected SET must be asymmetric under
    // coordinate transposition, not just the probed sample — a cubic room's
    // bitset is transposition-INVARIANT (every swapped index is also selected)
    // and would mask a transposed writer. Air set: x 0..8, y 2..6, z 1..7.
    applyOp(s, digBox([1, 1, 1], [1, 0.5, 0.75]), TABLE);
    const sel = materializeSelection(s, {
      kind: "flood-void",
      seed: [4, 4, 4],
      budget: 100000,
    });
    if (sel.kind !== "cells") throw new Error("expected cells");
    expect(sel.count).toBe(9 * 5 * 7);
    // Direct bitset read — deliberately NOT via selectionHas, which shares its
    // index formula with the writer (a self-consistent transposition would pass
    // every probe-based assert). Sample (8,2,1) is selected; under a transposed
    // layout, bit 296 would belong to an unselected cell (e.g. (1,2,8)).
    const bits = sel.chunks.get("0,0,0") as Uint8Array;
    const bit = 8 + 16 * (2 + 16 * 1); // = 296
    expect(((bits[bit >> 3] as number) >> (bit & 7)) & 1).toBe(1);
  });

  test("setup-loud validation: non-integer flood seeds throw", () => {
    const s = createFieldStore();
    expect(() =>
      materializeSelection(s, {
        kind: "flood-void",
        seed: [0.5, 0, 0],
        budget: 10,
      }),
    ).toThrow(/seed/);
    expect(() =>
      materializeSelection(s, {
        kind: "flood-material",
        seed: [0, 0, 2.25],
        classId: 0,
        budget: 10,
      }),
    ).toThrow(/seed/);
  });

  test("setup-loud validation: budget must be an integer in [1, MAX_SELECTION_BUDGET]", () => {
    const s = createFieldStore();
    const at = (budget: number): SelectionSpec => ({
      kind: "flood-void",
      seed: [0, 0, 0],
      budget,
    });
    expect(() => materializeSelection(s, at(0))).toThrow(/budget/);
    expect(() => materializeSelection(s, at(-5))).toThrow(/budget/);
    expect(() => materializeSelection(s, at(10.5))).toThrow(/budget/);
    expect(() => materializeSelection(s, at(MAX_SELECTION_BUDGET + 1))).toThrow(
      /budget/,
    );
    expect(() =>
      materializeSelection(s, at(MAX_SELECTION_BUDGET)),
    ).not.toThrow();
    expect(() => materializeSelection(s, at(1))).not.toThrow();
  });

  test("flood budget caps loudly (truncated, count === budget)", () => {
    const s = createFieldStore();
    applyOp(s, digBox([4, 1, 4], [4, 1, 4]), TABLE); // a big slab of air (9801 cells)
    const sel = materializeSelection(s, {
      kind: "flood-void",
      seed: [16, 4, 16],
      budget: 50,
    });
    if (sel.kind !== "cells") throw new Error("expected cells");
    expect(sel.truncated).toBe(true);
    expect(sel.count).toBe(50);
  });

  test("flood seeded in a non-matching cell yields an empty selection", () => {
    const s = createFieldStore(); // virgin store: uniform solid rock
    const sel = materializeSelection(s, {
      kind: "flood-void",
      seed: [4, 4, 4],
      budget: 100,
    });
    if (sel.kind !== "cells") throw new Error("expected cells");
    expect(sel.count).toBe(0);
    expect(sel.truncated).toBe(false);
    expect(sel.bounds).toBeNull();
    expect(selectionHas(sel, 4, 4, 4, s.cellSize)).toBe(false);
  });

  test("flood-material follows one class only", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digBox([2, 2, 2], [2, 2, 2]), TABLE);
    // Paint only retints SOLID cells, so the class-1 band sits in the rock
    // UNDER the room's floor (y ∈ (-0.8, -0.2)m → samples -3..-1; x,z strictly
    // inside (1, 3)m → samples 5..11): 7×3×7 = 147 painted cells.
    logApply(s, log, paintBox([2, -0.5, 2], [1, 0.3, 1], 1), TABLE);
    const sel = materializeSelection(s, {
      kind: "flood-material",
      seed: [8, -2, 8], // (2, -0.5, 2)m — inside the painted band
      classId: 1,
      budget: 100000,
    });
    if (sel.kind !== "cells") throw new Error("expected cells");
    expect(sel.truncated).toBe(false);
    expect(sel.count).toBe(147); // exactly the painted band, nothing else
    expect(selectionHas(sel, 8, -2, 8, s.cellSize)).toBe(true);
    // a rock (class 0) sample outside the painted band is NOT selected
    expect(selectionHas(sel, 8, 30, 8, s.cellSize)).toBe(false);
    // an air sample inside the room above the band is NOT selected
    expect(selectionHas(sel, 8, 4, 8, s.cellSize)).toBe(false);
  });

  test("region selection is a pure predicate over world metres", () => {
    const spec: SelectionSpec = {
      kind: "region",
      min: [0, 0, 0],
      max: [1, 1, 1],
    };
    const sel = materializeSelection(createFieldStore(), spec);
    expect(sel.kind).toBe("region");
    expect(selectionHas(sel, 2, 2, 2, 0.25)).toBe(true); // sample (2,2,2) = 0.5m
    expect(selectionHas(sel, 0, 0, 0, 0.25)).toBe(true); // min edge is inclusive
    expect(selectionHas(sel, 4, 2, 2, 0.25)).toBe(false); // 1.0m — exactly max (half-open)
    expect(selectionHas(sel, 8, 2, 2, 0.25)).toBe(false); // 2m — outside
    // the materialized selection COPIES the spec's bounds — a host mutating its
    // spec afterwards (drag-resize) must not retroactively change the selection
    if (spec.kind !== "region") throw new Error("unreachable");
    spec.max[0] = 100;
    spec.min[1] = -100;
    expect(selectionHas(sel, 8, 2, 2, 0.25)).toBe(false); // still outside
    expect(selectionHas(sel, 2, -2, 2, 0.25)).toBe(false); // still below min
  });
});
