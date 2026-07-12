// tests/substrate-grid.test.ts
import { expect, test } from "bun:test";
import { fineProxy } from "../src/substrate/collider.ts";
import {
  AIR,
  CELL,
  coarseGet,
  coarseSet,
  createCoarse,
  FINE,
  fineGet,
  fineGridConfig,
  fineSet,
  MASONRY,
  rasterize,
  SUB,
} from "../src/substrate/grid.ts";

test("coarse grid: set/get roundtrip, off-grid reads MASONRY", () => {
  const g = createCoarse([0, -CELL, 0], [4, 3, 4], AIR);
  expect(coarseGet(g, 1, 1, 1)).toBe(AIR);
  coarseSet(g, 1, 1, 1, MASONRY);
  expect(coarseGet(g, 1, 1, 1)).toBe(MASONRY);
  // Off-grid is MASONRY: skin never emits a panel toward off-grid (spike rule
  // "adjacent to IN-GRID air"), and the collider shell rule needs solid there.
  expect(coarseGet(g, -1, 0, 0)).toBe(MASONRY);
  expect(coarseGet(g, 4, 0, 0)).toBe(MASONRY);
});

test("rasterize: 2x per axis, solid follows coarse, fine min/dims match extent", () => {
  const g = createCoarse([0, 0, 0], [2, 1, 1], AIR);
  coarseSet(g, 0, 0, 0, MASONRY);
  const f = rasterize(g);
  expect(f.dims).toEqual([4, 2, 2]);
  expect(f.min).toEqual([0, 0, 0]);
  // All 8 fine cells of coarse (0,0,0) are solid; all of (1,0,0) are air.
  for (let dz = 0; dz < SUB; dz++)
    for (let dy = 0; dy < SUB; dy++)
      for (let dx = 0; dx < SUB; dx++) {
        expect(fineGet(f, dx, dy, dz)).toBe(1);
        expect(fineGet(f, SUB + dx, dy, dz)).toBe(0);
      }
});

test("fineGridConfig mirrors the fine grid for surfaceNets/proxy consumers", () => {
  const g = createCoarse([2, -0.5, -1], [2, 2, 2], MASONRY);
  const cfg = fineGridConfig(rasterize(g));
  expect(cfg).toEqual({ min: [2, -0.5, -1], cellSize: FINE, dims: [4, 4, 4] });
});

test("fineProxy: shell rule with off-grid-as-solid (proxy.ts contract)", () => {
  // A 3x3x3-coarse solid block with a single fine air pocket in the centre:
  // only the 6 fine cells facing the pocket survive shellOnly.
  const g = createCoarse([0, 0, 0], [3, 3, 3], MASONRY);
  const f = rasterize(g);
  fineSet(f, 3, 3, 3, 0);
  const proxy = fineProxy(f);
  expect(proxy.size).toEqual([FINE, FINE, FINE]);
  expect(proxy.coords.length / 3).toBe(6);
});

test("fineProxy on an all-solid grid emits nothing (no invisible outer wall)", () => {
  const f = rasterize(createCoarse([0, 0, 0], [2, 2, 2], MASONRY));
  expect(fineProxy(f).coords.length).toBe(0);
});
