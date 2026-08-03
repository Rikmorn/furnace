import { describe, expect, test } from "bun:test";
import type { MaterialTable } from "@furnace/core/field";
import {
  chunkKey,
  createFieldStore,
  createOpLog,
  extractFieldAprons,
  logApply,
  meshChunkField,
  skinChunkKit,
} from "@furnace/core/field";

// Charter P2: v0 ceiling 5 ms per 16³ chunk on the M1 (measured band of the
// old naive mesher); target ≤ 2 ms. The ceiling is generous on purpose —
// hard-fail only above it; the log line is the real deliverable. F2a re-asserts
// this over the FULL per-chunk cost: multi-class mesher (dispatch → bucket
// compaction) PLUS the kit skinner, the realistic per-remesh pair.
const CEILING_MS = 5;

// Local 3-class fixture (rock id0 organic, dirt id1 organic, masonry id2 kit) —
// each test file owns its copy. Mirrors field-skin-topology.test.ts's TABLE.
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

/** Wall-fixture-style store (mirrors field-skin-topology.test.ts's wallFixture):
 *  an organic room + a masonry (kit) wall on its floor + a dirt (organic) paint
 *  box retinting the floor rock. Three class buckets (rock + dirt + masonry
 *  backing) AND real kit cells for the skinner — a chunk (0,0,0) that exercises
 *  the full F2a per-remesh cost, not a trivial single-bucket carve. */
function wallFixture() {
  const s = createFieldStore();
  const log = createOpLog();
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "box", center: [2, 2, 2], halfExtents: [2, 1.5, 2] },
    },
    TABLE,
  );
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: 2,
      shape: { kind: "box", center: [2.25, 1.5, 2], halfExtents: [0.25, 1, 1] },
    },
    TABLE,
  );
  // Retint the solid floor rock to dirt (organic class 1) → a second organic
  // bucket. paint only affects solid cells inside the shape; the room floor sits
  // at y = 0.5, so this box (y 0.3..0.9) catches the solid cells just below it.
  logApply(
    s,
    log,
    {
      id: 0,
      kind: "brush",
      effect: "paint",
      material: 1,
      shape: { kind: "box", center: [2, 0.6, 2], halfExtents: [1.5, 0.3, 1.5] },
    },
    TABLE,
  );
  return s;
}

describe("field mesher budget", () => {
  test("median remesh + skin of a multi-class chunk stays under the ceiling", () => {
    const s = wallFixture();
    const key = chunkKey(0, 0, 0);

    // Sanity: the fixture must be non-trivial — ≥3 class buckets (rock + dirt +
    // masonry backing) and real kit cells to skin — or the budget below would
    // silently measure an empty chunk.
    const probe = meshChunkField(extractFieldAprons(s, key), TABLE, s.cellSize);
    expect(probe.buckets.length).toBeGreaterThanOrEqual(3);
    expect(
      skinChunkKit(extractFieldAprons(s, key), TABLE, s.cellSize, key).length,
    ).toBeGreaterThan(0);

    // Extract-once-call-both mirrors the real per-remesh cost: the editor/bake
    // extract the apron pair once, then mesh AND skin off it.
    for (let i = 0; i < 10; i++) {
      const aprons = extractFieldAprons(s, key);
      meshChunkField(aprons, TABLE, s.cellSize);
      skinChunkKit(aprons, TABLE, s.cellSize, key);
    }
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const aprons = extractFieldAprons(s, key);
      const t0 = performance.now();
      meshChunkField(aprons, TABLE, s.cellSize);
      skinChunkKit(aprons, TABLE, s.cellSize, key);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[25] as number;
    console.log(
      `[f2a-budget] meshChunkField+skin 16³ median ${median.toFixed(3)} ms (ceiling ${CEILING_MS})`,
    );
    expect(median).toBeLessThan(CEILING_MS);
  });
});
