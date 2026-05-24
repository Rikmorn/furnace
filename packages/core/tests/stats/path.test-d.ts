import { expect, test } from "bun:test";
import type { Path, PathValue } from "../../src/stats/path.ts";

type Sample = {
  frame: { fps: number; ms: { mean: number; p99: number } };
  gpu: { drawCalls: number };
  custom: Record<string, number>;
};

// Assignability assertions — each line typechecks ONLY if Path/PathValue
// admit the given literal. Wrong types → typecheck fails before bun test runs.
const _p1: Path<Sample> = "frame";
const _p2: Path<Sample> = "frame.fps";
const _p3: Path<Sample> = "frame.ms";
const _p4: Path<Sample> = "frame.ms.mean";
const _p5: Path<Sample> = "frame.ms.p99";
const _p6: Path<Sample> = "gpu";
const _p7: Path<Sample> = "gpu.drawCalls";
const _p8: Path<Sample> = "custom";
const _p9: Path<Sample> = "custom.npcCount"; // template-literal match: `custom.${string}`

const _v1: PathValue<Sample, "frame.fps"> = 42;
const _v2: PathValue<Sample, "frame.ms.mean"> = 1.5;
const _v3: PathValue<Sample, "gpu.drawCalls"> = 7;

test("path.ts: type-level assertions compile", () => {
  // Type-level checks above are the real test — they fail at typecheck time
  // if Path / PathValue don't behave correctly. This runtime case exists so
  // bun test surfaces a passing assertion alongside.
  expect(_p1).toBe("frame");
  expect(_v1).toBe(42);
});
