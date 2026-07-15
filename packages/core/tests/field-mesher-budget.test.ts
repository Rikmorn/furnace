import { describe, expect, test } from "bun:test";
import {
  applyOp,
  chunkKey,
  createFieldStore,
  extractApron,
  meshChunkApron,
} from "@furnace/core/field";

// Charter P2: v0 ceiling 5 ms per 16³ chunk on the M1 (measured band of the
// old naive mesher); target ≤ 2 ms. The ceiling is generous on purpose —
// hard-fail only above it; the log line is the real deliverable.
const CEILING_MS = 5;

describe("field mesher budget", () => {
  test("median remesh of a carved chunk stays under the ceiling", () => {
    const s = createFieldStore();
    applyOp(s, {
      id: 1,
      kind: "dig",
      shape: { kind: "sphere", center: [2, 2, 2], radius: 1.8 },
    });
    const key = chunkKey(0, 0, 0);
    for (let i = 0; i < 10; i++)
      meshChunkApron(extractApron(s, key), s.cellSize);
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const apron = extractApron(s, key);
      const t0 = performance.now();
      meshChunkApron(apron, s.cellSize);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[25] as number;
    console.log(
      `[f1-budget] meshChunkApron 16³ median ${median.toFixed(3)} ms (ceiling ${CEILING_MS})`,
    );
    expect(median).toBeLessThan(CEILING_MS);
  });
});
