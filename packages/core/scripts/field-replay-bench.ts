// packages/core/scripts/field-replay-bench.ts — the P-F3-2 probe.
// Measures (a) full-prefix scratch-replay cost and (b) per-op apply cost over a
// synthetic region-scale op log, on the gate machine. A bench, NOT a test: the
// FILENAME is what keeps `bun test` from collecting it — discovery is
// glob-based project-wide (no bunfig.toml test root), so the directory does not
// protect it. Run: bun packages/core/scripts/field-replay-bench.ts
import type {
  BrushOp,
  FieldOp,
  FieldStore,
  MaterialTable,
  OpLog,
} from "@furnace/core/field";
import {
  commitGenerator,
  createFieldStore,
  createOpLog,
  DEFAULT_CELL_SIZE,
  generatorById,
  isBrushOp,
  logApply,
} from "@furnace/core/field";
import { create as createRng } from "@furnace/core/rng";

/** A kit-bearing catalog — the stamp generators resolve their masonry through
 *  a setup-loud `kitClassId(table)`, so the rock-only BUILTIN_TABLE cannot
 *  drive hall/maze commits. Mirrors the tests/field-generators.test.ts fixture. */
const BENCH_TABLE: MaterialTable = {
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

const STROKE_SEED = 42;
const STAMP_COUNT = 8;
/** Spacing that keeps the alternating hall/maze footprints from overlapping
 *  (the widest default stamp is the 8 m maze). Nothing enforces it: a stamp's
 *  region `max` is provenance only — both generators anchor at
 *  `snapDown(region.min)` and size themselves from params (`hallGenerator`
 *  and `mazeGenerator` in src/field/generators.ts) — so raising a maze
 *  `cellsX` default would silently overlap neighbours with nothing throwing. */
const STAMP_SPACING_M = 20;
const STAMP_REGION_SPAN: [number, number, number] = [16, 8, 16];
/** The hand-edit tail riding on top of the stamps. */
const HAND_STROKES = 2000;
const STROKE_MIN_RADIUS_M = 0.5;
const STROKE_RADIUS_SPREAD_M = 1;
/** Stroke centres scatter across a box CONTAINING the stamped run, so replay
 *  touches chunks along its whole length instead of one corner of the field.
 *  The box is a loose superset — roughly 2× the stamped extent in y and z — so
 *  most strokes land in virgin rock beside a stamp rather than inside one. */
const STROKE_SPAN_M: [number, number, number] = [
  STAMP_COUNT * STAMP_SPACING_M,
  STAMP_REGION_SPAN[1],
  STAMP_REGION_SPAN[2],
];
/** Replay positions as a fraction of the finished log. */
const REPLAY_FRACTIONS = [0.25, 0.5, 0.75];

function commitStamps(store: FieldStore, log: OpLog): void {
  for (let i = 0; i < STAMP_COUNT; i++) {
    const def = generatorById(i % 2 === 0 ? "hall" : "maze");
    const min: [number, number, number] = [i * STAMP_SPACING_M, 0, 0];
    commitGenerator(store, log, def, {
      params: structuredClone(def.defaults),
      seed: i,
      region: {
        min,
        max: [
          min[0] + STAMP_REGION_SPAN[0],
          STAMP_REGION_SPAN[1],
          STAMP_REGION_SPAN[2],
        ],
      },
      policy: "replace",
      table: BENCH_TABLE,
    });
  }
}

function applyHandStrokes(store: FieldStore, log: OpLog): void {
  const rng = createRng(STROKE_SEED);
  for (let i = 0; i < HAND_STROKES; i++) {
    const op: BrushOp = {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: {
        kind: "sphere",
        center: [
          rng.float() * STROKE_SPAN_M[0],
          rng.float() * STROKE_SPAN_M[1],
          rng.float() * STROKE_SPAN_M[2],
        ],
        radius: STROKE_MIN_RADIUS_M + rng.float() * STROKE_RADIUS_SPREAD_M,
      },
    };
    logApply(store, log, op, BENCH_TABLE);
  }
}

/** Replays the log's first `upTo` ops into a fresh store and returns the wall
 *  clock. The definition of "replay cost" measured here is the FULL rebuild —
 *  via `logApply`, not `applyOp`: a scratch replay has to reconstruct the log
 *  and undo stack, not just the store, so every op also pays `assertOpValid`,
 *  an id re-stamp, and a per-op inverse that stays live for the whole replay.
 *  (`redo` takes the cheaper `applyOp` path; that is NOT what this times.)
 *  Entity ops are skipped — they carry provenance and never touch the field.
 *  Slicing happens before the clock starts so only the replay is measured. */
function replayPrefix(ops: readonly FieldOp[], upTo: number): number {
  const prefix = ops.slice(0, upTo);
  const started = performance.now();
  const scratch = createFieldStore(DEFAULT_CELL_SIZE);
  const scratchLog = createOpLog();
  for (const op of prefix) {
    if (!isBrushOp(op)) continue;
    logApply(scratch, scratchLog, op, BENCH_TABLE);
  }
  return performance.now() - started;
}

const store = createFieldStore(DEFAULT_CELL_SIZE);
const log = createOpLog();

const stampsStarted = performance.now();
commitStamps(store, log);
const stampsMs = performance.now() - stampsStarted;
const stampOps = log.ops.length;

const strokesStarted = performance.now();
applyHandStrokes(store, log);
const strokesMs = performance.now() - strokesStarted;

console.log(
  `build: ${STAMP_COUNT} stamps → ${stampOps} ops in ${stampsMs.toFixed(1)} ms; ` +
    `${HAND_STROKES} hand strokes in ${strokesMs.toFixed(1)} ms ` +
    `(${(strokesMs / HAND_STROKES).toFixed(3)} ms/op)`,
);

for (const frac of REPLAY_FRACTIONS) {
  const upTo = Math.floor(log.ops.length * frac);
  const ms = replayPrefix(log.ops, upTo);
  console.log(`prefix replay ${upTo} ops: ${ms.toFixed(1)} ms`);
}
console.log(`total ops: ${log.ops.length}, chunks: ${store.chunks.size}`);
