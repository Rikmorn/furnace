// Budget ceilings for the F2b search/generate loops (premise P-F2-5's core
// half): generator evaluation and selection floods carry wall-clock ceilings
// from day one — the working-standards §Planning rule. These are MEASUREMENTS,
// not behaviour tests: median-of-20 with warmup (medians shrug off transient
// CI load spikes; uniformly slower hardware is the ceilings' slack to absorb);
// every scenario logs a `[f2b-budget]` line the tranche report collects.
import { describe, expect, test } from "bun:test";
import type { BrushOp, MaterialTable } from "@furnace/core/field";
import {
  applyOp,
  createFieldStore,
  generatorById,
  MAX_SELECTION_BUDGET,
  materializeSelection,
} from "@furnace/core/field";

const CEILING_EVAL_MS = 50;
const CEILING_FLOOD_MS = 100;

// Vacuity floors for the evaluate scenarios (the flood scenarios assert exact
// counts instead): a degenerate/empty op span would pass any ceiling, so each
// timed evaluate first proves it emits a real span. Measured minima over
// seeds 0–24: hall 337 (seed-independent), both maze scenarios ≥ 757.
const FLOOR_HALL_OPS = 300;
const FLOOR_MAZE_OPS = 500;

const WARMUP_RUNS = 5;
const TIMED_RUNS = 20;

/** Median-of-20 with warmup. The median is robust to TRANSIENT load spikes
 *  (GC pauses, CI neighbours) — uniformly slower hardware shifts the whole
 *  distribution and is the ceilings' slack to absorb, not the median's job.
 *  `run` gets the iteration index; the MAZE scenarios feed it as the seed so
 *  their measurements span distinct plans (the hall voids its seed — its
 *  structure is params-determined, so its runs repeat one shape). */
function medianMs(run: (i: number) => void): number {
  for (let i = 0; i < WARMUP_RUNS; i++) run(i);
  const times: number[] = [];
  for (let i = 0; i < TIMED_RUNS; i++) {
    const t0 = performance.now();
    run(i);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[TIMED_RUNS / 2] as number;
}

const TABLE: MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
    { id: 1, name: "dirt", kind: "organic", color: [0.4, 0.3, 0.2, 1] },
    {
      id: 2,
      name: "masonry",
      kind: "kit",
      color: [0.5, 0.5, 0.5, 1],
      kit: {
        panelProud: 0.06,
        panelReveal: 0.02,
        collarSection: 0.14,
        backingColor: [0.4, 0.4, 0.4, 1],
        pieceColors: {
          panel: [0.55, 0.53, 0.5, 1],
          floor: [0.42, 0.4, 0.38, 1],
          trim: [0.35, 0.33, 0.3, 1],
          collar: [0.3, 0.28, 0.26, 1],
        },
      },
    },
  ],
};

// Region derivations (evaluate reads only region.min for the origin snap; max
// documents the stamp AABB). Hall 16×9×24: mini-grid dims [w+2, h+2, d+2] =
// [18, 11, 26] coarse cells at CELL 0.5 m → 9 × 5.5 × 13 m.
const REGION_BIG = {
  min: [0, 0, 0] as [number, number, number],
  max: [9, 5.5, 13] as [number, number, number],
};
// Maze 8×8 at PITCH 5: interior w = d = 5·8 − 1 = 39 coarse cells; grid dims
// [41, 8, 41] → 20.5 × 4 × 20.5 m.
const REGION_MAZE_MAX = {
  min: [0, 0, 0] as [number, number, number],
  max: [20.5, 4, 20.5] as [number, number, number],
};

const digBox = (
  center: [number, number, number],
  halfExtents: [number, number, number],
): BrushOp => ({
  id: 0,
  kind: "brush",
  effect: "dig",
  shape: { kind: "box", center, halfExtents },
});

describe("field budgets — generator evaluate", () => {
  test("greatHall-scale evaluate stays under the ceiling", () => {
    const hall = generatorById("hall");
    // pillarSpacing 5, not the plan's 4: spacing 4 puts a grid pillar at
    // interior (8, j, 4) — inside the centred south door's walk lane
    // (lat i ∈ {8,9} × depth k ∈ {1..4}) — and evaluate throws setup-loud
    // (the donor validateDoorApproach contract). Spacing 5 keeps the same
    // scale with pillars at i ∈ {5,10,15}, k ∈ {5..20}, clear of both lanes.
    const params = {
      width: 16,
      height: 9,
      depth: 24,
      pillars: "grid",
      pillarSpacing: 5,
      doorNorth: true,
      doorSouth: true,
      doorEast: false,
      doorWest: false,
    };
    // Vacuity guard: the timed evaluate must emit a real op span.
    expect(
      hall.evaluate(params, 0, REGION_BIG, TABLE, "replace").ops.length,
    ).toBeGreaterThanOrEqual(FLOOR_HALL_OPS);
    const median = medianMs((i) =>
      hall.evaluate(params, i, REGION_BIG, TABLE, "replace"),
    );
    console.log(
      `[f2b-budget] hall 16x9x24 evaluate median ${median.toFixed(3)} ms (ceiling ${CEILING_EVAL_MS})`,
    );
    expect(median).toBeLessThan(CEILING_EVAL_MS);
  });

  test("maze 8x8 braid 0.5 evaluate stays under the ceiling", () => {
    const mz = generatorById("maze");
    const params = {
      cellsX: 8,
      cellsZ: 8,
      braid: 0.5,
      doorNorth: true,
      doorSouth: false,
      doorEast: false,
      doorWest: false,
    };
    // Vacuity guard: the timed evaluate must emit a real op span.
    expect(
      mz.evaluate(params, 0, REGION_MAZE_MAX, TABLE, "replace").ops.length,
    ).toBeGreaterThanOrEqual(FLOOR_MAZE_OPS);
    const median = medianMs((i) =>
      mz.evaluate(params, i, REGION_MAZE_MAX, TABLE, "replace"),
    );
    console.log(
      `[f2b-budget] maze 8x8 braid 0.5 evaluate median ${median.toFixed(3)} ms (ceiling ${CEILING_EVAL_MS})`,
    );
    expect(median).toBeLessThan(CEILING_EVAL_MS);
  });

  test("max-maze (8x8, braid 1, four doors — the 979-op span) stays under the ceiling", () => {
    const mz = generatorById("maze");
    const params = {
      cellsX: 8,
      cellsZ: 8,
      braid: 1,
      doorNorth: true,
      doorSouth: true,
      doorEast: true,
      doorWest: true,
    };
    // Vacuity guard: the timed evaluate must emit a real op span.
    expect(
      mz.evaluate(params, 0, REGION_MAZE_MAX, TABLE, "replace").ops.length,
    ).toBeGreaterThanOrEqual(FLOOR_MAZE_OPS);
    const median = medianMs((i) =>
      mz.evaluate(params, i, REGION_MAZE_MAX, TABLE, "replace"),
    );
    console.log(
      `[f2b-budget] maze 8x8 braid 1 four-door (max) evaluate median ${median.toFixed(3)} ms (ceiling ${CEILING_EVAL_MS})`,
    );
    expect(median).toBeLessThan(CEILING_EVAL_MS);
  });
});

describe("field budgets — selection floods", () => {
  test("flood-void at MAX_SELECTION_BUDGET over a hollowed 8-chunk volume stays under the ceiling", () => {
    // Dig [0,8]³ m (2×2×2 chunks' worth of air at cellSize 0.25): air samples
    // 0..32 per axis → 33³ = 35937 cells — the flood EXHAUSTS the room well
    // before the 262144 budget (pins the common case, not the worst case).
    const s = createFieldStore();
    applyOp(s, digBox([4, 4, 4], [4, 4, 4]), TABLE);
    const spec = {
      kind: "flood-void" as const,
      seed: [16, 16, 16] as [number, number, number],
      budget: MAX_SELECTION_BUDGET,
    };
    const sel = materializeSelection(s, spec);
    if (sel.kind !== "cells") throw new Error("expected cells");
    expect(sel.count).toBe(35937);
    expect(sel.truncated).toBe(false);
    const median = medianMs(() => materializeSelection(s, spec));
    console.log(
      `[f2b-budget] flood-void 8-chunk hollow (35937 cells, exhausts) median ${median.toFixed(3)} ms (ceiling ${CEILING_FLOOD_MS})`,
    );
    expect(median).toBeLessThan(CEILING_FLOOD_MS);
  });

  test("flood-material truncating at the FULL 262144-cell budget stays under the ceiling", () => {
    // The real worst case (Task 2's review measurement): flood-material
    // class 0 seeded in virgin rock spreads unbounded — missing chunks read
    // SOLID rock of the default class — so it ALWAYS marks the full budget
    // and truncates. Without this the exhausting scenario above is vacuous
    // against the ceiling.
    const s = createFieldStore();
    const spec = {
      kind: "flood-material" as const,
      seed: [0, 0, 0] as [number, number, number],
      classId: 0,
      budget: MAX_SELECTION_BUDGET,
    };
    const sel = materializeSelection(s, spec);
    if (sel.kind !== "cells") throw new Error("expected cells");
    expect(sel.count).toBe(MAX_SELECTION_BUDGET);
    expect(sel.truncated).toBe(true);
    const median = medianMs(() => materializeSelection(s, spec));
    console.log(
      `[f2b-budget] flood-material full-budget truncation (262144 cells) median ${median.toFixed(3)} ms (ceiling ${CEILING_FLOOD_MS})`,
    );
    expect(median).toBeLessThan(CEILING_FLOOD_MS);
  });
});
