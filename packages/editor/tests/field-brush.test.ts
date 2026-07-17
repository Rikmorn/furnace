import { expect, test } from "bun:test";
import {
  createFieldStore,
  materializeSelection,
  selectionHas,
} from "@furnace/core/field";
import {
  computeBrushCenter,
  regionSampleCount,
  snappedKitBox,
  snapSpan,
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

test("snapSpan snaps OUTWARD to the 0.5 lattice in either endpoint order", () => {
  expect(snapSpan(1.1, 2.3)).toEqual([1, 2.5]);
  expect(snapSpan(2.3, 1.1)).toEqual([1, 2.5]);
  expect(snapSpan(-0.2, 0.6)).toEqual([-0.5, 1]);
  expect(snapSpan(1.5, 2.5)).toEqual([1.5, 2.5]); // already on the lattice
});

test("a degenerate span (one lattice plane) widens to one lattice step", () => {
  expect(snapSpan(1.5, 1.5)).toEqual([1.5, 2]);
  expect(snapSpan(1.6, 1.9)).toEqual([1.5, 2]); // both inside one cell
});

test("regionSampleCount matches brute-force selectionHas over a small store", () => {
  const s = createFieldStore(); // cellSize 0.25
  // Negative-reaching, lattice-snapped region (the snapSpan output shape).
  const min: [number, number, number] = [-0.5, 0, -1];
  const max: [number, number, number] = [1, 0.5, 0.5];
  const sel = materializeSelection(s, { kind: "region", min, max });
  let count = 0;
  for (let z = -8; z <= 8; z++)
    for (let y = -8; y <= 8; y++)
      for (let x = -8; x <= 8; x++)
        if (selectionHas(sel, x, y, z, s.cellSize)) count++;
  expect(regionSampleCount(min, max, s.cellSize)).toBe(count);
  expect(count).toBeGreaterThan(0);
});

test("regionSampleCount of an empty or inverted span is 0", () => {
  expect(regionSampleCount([0, 0, 0], [0, 1, 1], 0.25)).toBe(0);
  expect(regionSampleCount([1, 0, 0], [0, 1, 1], 0.25)).toBe(0);
});
