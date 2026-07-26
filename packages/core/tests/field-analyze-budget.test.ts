// P-F4-1: stage-1 per-chunk analysis cost. Target ≤ 2 ms median per 16³ chunk,
// hard ceiling 5 (the field-mesher-budget band, on the same M1 machine) — the
// analyzer runs per dirty chunk in a background worker as you edit, so a chunk
// that costs more than a remesh would make the advisor the bottleneck. The
// ceiling is generous on purpose: hard-fail only above it, the `[f4-budget]`
// log line is the real deliverable.
import { describe, expect, test } from "bun:test";
import type { AgentProfile } from "@furnace/core/field";
import {
  analyzeChunk,
  BUILTIN_TABLE,
  commitGenerator,
  createFieldStore,
  createOpLog,
  generatorById,
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
});
