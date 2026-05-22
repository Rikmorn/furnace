import { expect, test } from "bun:test";
import { vec4 } from "../../src/transform/vec4.ts";

const approxArr = (a: Float32Array, b: number[], eps = 1e-6) =>
  a.length === b.length &&
  a.every((v, i) => Math.abs(v - (b[i] as number)) < eps);

test("create returns (0,0,0,0)", () => {
  expect(approxArr(vec4.create(), [0, 0, 0, 0])).toBe(true);
});

test("fromValues sets components", () => {
  expect(approxArr(vec4.fromValues(1, 2, 3, 4), [1, 2, 3, 4])).toBe(true);
});

test("set overwrites in place and returns out", () => {
  const v = vec4.create();
  const r = vec4.set(v, 5, 6, 7, 8);
  expect(r).toBe(v);
  expect(approxArr(v, [5, 6, 7, 8])).toBe(true);
});

test("copy duplicates", () => {
  const out = vec4.create();
  vec4.copy(out, vec4.fromValues(1, 2, 3, 4));
  expect(approxArr(out, [1, 2, 3, 4])).toBe(true);
});
