// Budget ceilings for the cave carve (P-F3-3): a default cave's patch must stay
// under a chunk-count, wall-clock, and serialized-size ceiling — the
// working-standards §Planning "budgets on day one" rule. The carve is a bounded
// region walk (no search), but its emission SIZE is the premise the plan's
// napkin estimate (~340 KB raw) is measured against here, and the wall-clock is
// asserted to catch runaway. Logs a `[f3-budget]` line the tranche report
// collects.
import { describe, expect, test } from "bun:test";
import type { FieldOp, PatchOp } from "@furnace/core/field";
import {
  BUILTIN_TABLE,
  generatorById,
  serializeOps,
} from "@furnace/core/field";

type Vec3 = [number, number, number];

/** Group into ≤ this many patch chunks (the plan's ceiling). */
const CEILING_CHUNKS = 200;
/** Evaluate wall-clock ceiling (ms) — a RUNAWAY guard (an unbounded loop or an
 *  accidental O(cells·features) blow-up would take seconds), NOT a perf gate.
 *  The median is ~100 ms here; the wide headroom to 500 is deliberate so a
 *  slower CI machine cannot flake. Chunk-count and serialized-size ceilings
 *  below ARE machine-independent — those stay tight. */
const CEILING_MS = 500;
/** Serialized (base64 JSON) size ceiling — the plan's 1 MB fallback trigger. */
const CEILING_SERIALIZED = 1_000_000;

// The default cave: a 20×10×20 m region at the store's 0.25 m cell size = an
// 80×40×80 sample grid (~256 k cells) — the plan's default-cave sizing.
const REGION = {
  min: [0, 0, 0] as Vec3,
  max: [20, 10, 20] as Vec3,
};
const SEED = 1;

const WARMUP_RUNS = 3;
const TIMED_RUNS = 11;

/** Median-of-N with warmup — robust to transient load spikes. */
function medianMs(run: () => void): number {
  for (let i = 0; i < WARMUP_RUNS; i++) run();
  const times: number[] = [];
  for (let i = 0; i < TIMED_RUNS; i++) {
    const t0 = performance.now();
    run();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[(TIMED_RUNS - 1) / 2] as number;
}

/** Raw patch payload bytes (masks + value arrays), the base64 pre-image. */
function rawBytes(patch: PatchOp): number {
  let n = 0;
  for (const c of patch.chunks)
    n +=
      c.densityMask.length +
      c.density.length +
      (c.materialMask?.length ?? 0) +
      (c.materials?.length ?? 0);
  return n;
}

describe("cave carve — budget (P-F3-3)", () => {
  test("default cave: chunk count, wall-clock, serialized size all within budget", () => {
    const cave = generatorById("cave");
    const { ops } = cave.evaluate(
      cave.defaults,
      SEED,
      REGION,
      BUILTIN_TABLE,
      "replace",
    );
    const patch = ops.find((o) => o.kind === "patch") as PatchOp | undefined;
    if (patch === undefined) throw new Error("cave emitted no patch op");

    const chunks = patch.chunks.length;
    const raw = rawBytes(patch);
    const serialized = serializeOps(ops as FieldOp[]);
    const base64Bytes = new TextEncoder().encode(serialized).length;
    const median = medianMs(() => {
      cave.evaluate(cave.defaults, SEED, REGION, BUILTIN_TABLE, "replace");
    });

    // The MEASUREMENT line the plan records (P-F3-3).
    console.log(
      `[f3-budget] cave 20x10x20 replace: ${chunks} chunks, ${raw} raw bytes, ` +
        `${base64Bytes} serialized bytes, evaluate median ${median.toFixed(3)} ms`,
    );

    // Vacuity guard: a real, non-empty emission.
    expect(chunks).toBeGreaterThan(0);
    expect(raw).toBeGreaterThan(0);

    expect(chunks).toBeLessThanOrEqual(CEILING_CHUNKS);
    expect(median).toBeLessThan(CEILING_MS);
    expect(base64Bytes).toBeLessThanOrEqual(CEILING_SERIALIZED);
  });
});
