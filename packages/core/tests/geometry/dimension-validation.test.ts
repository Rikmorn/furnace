import { expect, test } from "bun:test";
import { cube } from "../../src/geometry/factories/cube.ts";
import { plane } from "../../src/geometry/factories/plane.ts";
import { assertPositiveFinite } from "../../src/geometry/geometry-validation.ts";
import type { Context } from "../../src/gpu/index.ts";

// Validation runs before the Context is touched, so passing a stub ctx never
// dereferences it — these stay pure (no GPU) and fast.
const noCtx = null as unknown as Context;

test("assertPositiveFinite accepts finite positives", () => {
  expect(() => assertPositiveFinite("size", 1)).not.toThrow();
  expect(() => assertPositiveFinite("size", 0.001)).not.toThrow();
});

test("assertPositiveFinite rejects zero, negative, and non-finite", () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => assertPositiveFinite("size", bad)).toThrow();
  }
});

test("cube throws on non-positive size", () => {
  for (const bad of [0, -1, Number.NaN]) {
    expect(() => cube(noCtx, { size: bad })).toThrow();
  }
});

test("plane throws on non-positive size", () => {
  for (const bad of [0, -2, Number.NaN]) {
    expect(() => plane(noCtx, { size: bad })).toThrow();
  }
});
