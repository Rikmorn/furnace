import { expect, test } from "bun:test";
import {
  createFieldStore,
  materializeSelection,
  selectionHas,
} from "@furnace/core/field";
import {
  computeBrushCenter,
  nudgeRegion,
  regionSampleCount,
  snappedKitBox,
  snapSpan,
  spanCells,
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

test("spanCells counts whole 0.5 m lattice cells across a snapped span", () => {
  expect(spanCells(0, 12)).toBe(24); // 12 m / 0.5 = 24 coarse cells
  expect(spanCells(1.5, 2)).toBe(1); // one lattice step
  expect(spanCells(-0.5, 1)).toBe(3);
  expect(spanCells(4, 4)).toBe(0); // empty span
  // Composes with snapSpan: an off-lattice selection widens then counts whole.
  const [lo, hi] = snapSpan(0.2, 5.9);
  expect(spanCells(lo, hi)).toBe(12); // [0, 6] → 12 cells
});

test("nudgeRegion translates BOTH corners one lattice step per unit", () => {
  const region = {
    min: [1, 0.5, -2] as [number, number, number],
    max: [3, 2, -0.5] as [number, number, number],
  };
  expect(nudgeRegion(region, [1, 0, 0])).toEqual({
    min: [1.5, 0.5, -2],
    max: [3.5, 2, -0.5],
  });
  expect(nudgeRegion(region, [0, -1, 0])).toEqual({
    min: [1, 0, -2],
    max: [3, 1.5, -0.5],
  });
  expect(nudgeRegion(region, [0, 0, 2])).toEqual({
    min: [1, 0.5, -1],
    max: [3, 2, 0.5],
  });
  // The input is never mutated — the host swaps the returned region in.
  expect(region).toEqual({ min: [1, 0.5, -2], max: [3, 2, -0.5] });
});

test("nudgeRegion preserves the region's SIZE, whatever the steps", () => {
  const region = {
    min: [0, 0, 0] as [number, number, number],
    max: [4, 2.5, 6] as [number, number, number],
  };
  const size = (r: {
    min: [number, number, number];
    max: [number, number, number];
  }) => [r.max[0] - r.min[0], r.max[1] - r.min[1], r.max[2] - r.min[2]];
  expect(size(nudgeRegion(region, [-3, 5, -7]))).toEqual(size(region));
});

test("nudgeRegion keeps a lattice-snapped region ON the lattice", () => {
  // 0.5 is exactly representable, so repeated ±n·0.5 never drifts off-grid.
  // Drift wouldn't break determinism (generators floor their own anchor) — it
  // would silently build up to 0.5 m off from the region the user placed.
  let region = {
    min: [-0.5, 0, 1.5] as [number, number, number],
    max: [2, 1.5, 4] as [number, number, number],
  };
  for (let i = 0; i < 40; i++) region = nudgeRegion(region, [1, -1, 3]);
  expect(region.min).toEqual([19.5, -20, 61.5]);
  expect(region.max).toEqual([22, -18.5, 64]);
  for (const v of [...region.min, ...region.max])
    expect(v / 0.5).toBe(Math.round(v / 0.5));
});

test("nudgeRegion rounds fractional steps — the lattice invariant is the point", () => {
  const region = {
    min: [0, 0, 0] as [number, number, number],
    max: [1, 1, 1] as [number, number, number],
  };
  expect(nudgeRegion(region, [0.4, 0.6, -1.4])).toEqual({
    min: [0, 0.5, -0.5],
    max: [1, 1.5, 0.5],
  });
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
