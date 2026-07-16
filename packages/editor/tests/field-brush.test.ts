import { expect, test } from "bun:test";
import {
  computeBrushCenter,
  snappedKitBox,
} from "../src/frontend/lib/field-brush.ts";

test("surface hit bites INTO the rock along the ray", () => {
  const c = computeBrushCenter(
    { origin: [0, 0, 0], dir: [1, 0, 0], eyeInRock: false, hit: [4, 0, 0] },
    1,
  );
  expect(c).toEqual([4.7, 0, 0]); // hit + dir·0.7·radius
});

test("embedded eye carves from the eye forward, radius-deep", () => {
  const c = computeBrushCenter(
    { origin: [1, 2, 3], dir: [0, 0, 1], eyeInRock: true, hit: null },
    1.25,
  );
  expect(c).toEqual([1, 2, 3 + 1.25]); // origin + dir·radius — mining, not far-plane stamping
});

test("open-space miss digs ahead at the legacy first-dig distance", () => {
  const c = computeBrushCenter(
    { origin: [0, 0, 0], dir: [0, 1, 0], eyeInRock: false, hit: null },
    1,
  );
  expect(c).toEqual([0, 4, 0]);
});

test("kit box snaps its FACES to the 0.5 lattice", () => {
  const box = snappedKitBox([1.13, 0.9, 2.6], 0.8);
  // size = max(0.5, round(1.6/0.5)·0.5) = 1.5; min corner rounded to lattice
  expect(box.halfExtents).toEqual([0.75, 0.75, 0.75]);
  for (let a = 0; a < 3; a++) {
    const lo = (box.center[a] as number) - (box.halfExtents[a] as number);
    expect(Math.abs(lo / 0.5 - Math.round(lo / 0.5))).toBeLessThan(1e-9);
  }
});
