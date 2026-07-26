// P-F4-1: stage-1 per-chunk analysis cost. Target ≤ 2 ms median per 16³ chunk,
// hard ceiling 5 (the field-mesher-budget band, on the same M1 machine) — the
// analyzer runs per dirty chunk in a background worker as you edit, so a chunk
// that costs more than a remesh would make the advisor the bottleneck. The
// ceiling is generous on purpose: hard-fail only above it, the `[f4-budget]`
// log line is the real deliverable.
import { describe, expect, test } from "bun:test";
import type { AgentProfile, FieldStore } from "@furnace/core/field";
import {
  AIR,
  analyzeChunk,
  BUILTIN_TABLE,
  CHUNK_DIM,
  chunkKey,
  commitGenerator,
  createFieldStore,
  createOpLog,
  DEFAULT_CELL_SIZE,
  generatorById,
  setDensity,
} from "@furnace/core/field";
import { at } from "./_helpers/expect.ts";

const CEILING_MS = 5;
const TARGET_MS = 2;

/** The dungeon's capsule (`packages/dungeon/catalog/agent.json`), copied — core
 *  tests must not import a consumer package. */
const AGENT: AgentProfile = {
  capsule: { radius: 0.3, halfHeight: 0.6 },
  stepHeight: 0.4,
  climbCeiling: 0.7,
  clearance: 1.8,
  slopeLimitDeg: 55,
};

/** The F3b default cave region: 20×10×20 m at the 0.25 m default cell size. */
const REGION = {
  min: [0, 0, 0] as [number, number, number],
  max: [20, 10, 20] as [number, number, number],
};
const SEED = 1;

const WARMUP_PASSES = 2;
const TIMED_PASSES = 5;
const TALL_RUNS = 11;

/** The two headrooms the scaling case compares: 2 m (a corridor, what the cave
 *  fixture is made of) and 16 m (a cavern or a shaft). */
const SHORT_HEADROOM_CELLS = 8;
const TALL_HEADROOM_CELLS = 64;
/** Runaway guard for the tall case — NOT a perf gate; see the test's comment
 *  for why the 5 ms chunk ceiling deliberately does not apply there. */
const RUNAWAY_MS = 60;

/** Median `analyzeChunk` time for the floor chunk of an open column. */
function medianOf(store: FieldStore): number {
  const key = chunkKey(0, 0, 0);
  for (let i = 0; i < WARMUP_PASSES; i++) analyzeChunk(store, key, AGENT);
  const times: number[] = [];
  for (let i = 0; i < TALL_RUNS; i++) {
    const t0 = performance.now();
    analyzeChunk(store, key, AGENT);
    times.push(performance.now() - t0);
  }
  return median(times.sort((a, b) => a - b));
}

/** A chunk-footprint column of open air `headroom` cells tall, with a margin
 *  wider than the capsule's XZ probe so wall effects don't distort the cost. */
function openColumn(headroom: number): FieldStore {
  const s = createFieldStore();
  const margin = 4;
  for (let z = -margin; z < CHUNK_DIM + margin; z++)
    for (let x = -margin; x < CHUNK_DIM + margin; x++)
      for (let y = 1; y <= headroom; y++) setDensity(s, x, y, z, AIR);
  return s;
}

const median = (sorted: readonly number[]): number =>
  at(sorted, (sorted.length - 1) >> 1);

describe("analyzeChunk — budget (P-F4-1)", () => {
  test("per-chunk median over a carved cave stays under the ceiling", () => {
    const store = createFieldStore();
    const cave = generatorById("cave");
    commitGenerator(store, createOpLog(), cave, {
      params: cave.defaults,
      seed: SEED,
      region: REGION,
      policy: "replace",
      table: BUILTIN_TABLE,
    });
    const keys = [...store.chunks.keys()];

    for (let pass = 0; pass < WARMUP_PASSES; pass++)
      for (const key of keys) analyzeChunk(store, key, AGENT);

    const perChunk = new Map<string, number[]>();
    let flags = 0;
    for (let pass = 0; pass < TIMED_PASSES; pass++)
      for (const key of keys) {
        const t0 = performance.now();
        const found = analyzeChunk(store, key, AGENT);
        const dt = performance.now() - t0;
        let times = perChunk.get(key);
        if (times === undefined) {
          times = [];
          perChunk.set(key, times);
        }
        times.push(dt);
        if (pass === 0) flags += found.length;
      }

    const chunkMedians = [...perChunk.values()]
      .map((times) => median(times.sort((a, b) => a - b)))
      .sort((a, b) => a - b);
    const med = median(chunkMedians);
    const worst = at(chunkMedians, chunkMedians.length - 1);
    const total = chunkMedians.reduce((n, t) => n + t, 0);

    console.log(
      `[f4-budget] analyzeChunk 16³ over ${keys.length} cave chunks: median ` +
        `${med.toFixed(3)} ms, worst ${worst.toFixed(3)} ms, whole-world ` +
        `${total.toFixed(1)} ms, ${flags} flags (target ≤ ${TARGET_MS}, ceiling ${CEILING_MS})`,
    );

    // Vacuity guard: a real carve with real walkable floor, not an empty store.
    expect(keys.length).toBeGreaterThan(0);
    expect(flags).toBeGreaterThan(0);

    expect(med).toBeLessThan(CEILING_MS);
  });

  test("cost scales with open headroom — the shape, measured not asserted", () => {
    // The cave above cannot see this: its columns are short, so its median says
    // nothing about the one input per-chunk cost actually scales on. Every
    // anchor searches its ceiling and then scans each of 4 neighbours up to it,
    // so cost is O(anchors × headroom) — LINEAR in the height of contiguous
    // open air above the floor, which a cavern or a shaft supplies freely.
    //
    // Before the last-chunk memo in `isSolid`, 16 m of headroom cost 6.1 ms —
    // over the per-chunk ceiling, and this case existed to document that
    // honestly rather than gate it. The memo cut the constant ~7x (0.9 ms at
    // 16 m), so the ceiling assertion below is now a real bar this code meets
    // AND a tooth that bites if that win is ever undone. What it is NOT is a
    // bound on the shape: cost stays linear in headroom, extrapolating to 5 ms
    // only past ~100 m of open air. The `[f4-budget]` line remains the
    // deliverable; RUNAWAY_MS catches a quadratic or unbounded regression.
    const short = medianOf(openColumn(SHORT_HEADROOM_CELLS));
    const tall = medianOf(openColumn(TALL_HEADROOM_CELLS));
    const metres = (cells: number): number => cells * DEFAULT_CELL_SIZE;

    console.log(
      `[f4-budget] analyzeChunk 16³ open column: ${metres(SHORT_HEADROOM_CELLS)} m headroom ` +
        `median ${short.toFixed(3)} ms, ${metres(TALL_HEADROOM_CELLS)} m headroom median ` +
        `${tall.toFixed(3)} ms (${(tall / short).toFixed(1)}x — cost is linear in headroom; ` +
        `ceiling ${CEILING_MS}, runaway guard ${RUNAWAY_MS})`,
    );

    // The scaling itself is an assertion, and it is also the vacuity guard: a
    // pass that bailed early would cost the same at both heights. (A flat floor
    // is legitimately FLAG-free, so flag count proves nothing here.)
    expect(tall).toBeGreaterThan(short);
    expect(tall).toBeLessThan(CEILING_MS);
    expect(tall).toBeLessThan(RUNAWAY_MS);
  });
});
