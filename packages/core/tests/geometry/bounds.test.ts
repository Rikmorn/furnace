import { expect, test } from "bun:test";
import { computeBounds } from "../../src/geometry/bounds.ts";

test("computeBounds: min/max over a flat positions array", () => {
  // two verts: (-1,-2,-3) and (4,5,6)
  const positions = new Float32Array([-1, -2, -3, 4, 5, 6]);
  const { min, max } = computeBounds(positions);
  expect([min[0], min[1], min[2]]).toEqual([-1, -2, -3]);
  expect([max[0], max[1], max[2]]).toEqual([4, 5, 6]);
});

test("computeBounds: empty positions → zero box", () => {
  const { min, max } = computeBounds(new Float32Array([]));
  expect([min[0], min[1], min[2]]).toEqual([0, 0, 0]);
  expect([max[0], max[1], max[2]]).toEqual([0, 0, 0]);
});
