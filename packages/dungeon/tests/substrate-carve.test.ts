// tests/substrate-carve.test.ts
import { expect, test } from "bun:test";
import { prepareCarve } from "../src/substrate/carve.ts";
import {
  AIR,
  CELL,
  coarseSet,
  createCoarse,
  FINE,
  fineGet,
  MASONRY,
  rasterize,
} from "../src/substrate/grid.ts";
import { faceKey } from "../src/substrate/skin.ts";
import { suppressedFaces } from "../src/substrate/suppress.ts";

/** A 1-cell-thick wall slab: 5x6x1 coarse masonry, air on both Z sides is
 *  OFF-GRID (grid covers only the wall) — panels face in-grid air, so build a
 *  5x6x3 grid with the wall at k=1 and AIR at k=0,2. */
function wallGrid() {
  const g = createCoarse([0, 0, 0], [5, 6, 3], AIR);
  for (let j = 0; j < 6; j++)
    for (let i = 0; i < 5; i++) coarseSet(g, i, j, 1, MASONRY);
  return g;
}

/** A capsule (here: sphere via a==b) punched through the wall centre. */
const BREACH = {
  kind: "capsule" as const,
  a: [1.25, 1.5, 0.75] as [number, number, number],
  b: [1.25, 1.5, 0.75] as [number, number, number],
  radius: 0.7,
};

test("prepareCarve: carves fine cells, returns non-empty patch + box", () => {
  const fine = rasterize(wallGrid());
  const r = prepareCarve(fine, [BREACH]);
  expect(r.carved.size).toBeGreaterThan(0);
  expect(r.patch).not.toBeNull();
  expect(r.patchBox).not.toBeNull();
  // Some fine cell inside the bore is now air in the carved grid:
  const ci = Math.floor(1.25 / FINE),
    cj = Math.floor(1.5 / FINE),
    ck = Math.floor(0.75 / FINE);
  expect(fineGet(r.fine, ci, cj, ck)).toBe(0);
  // …but the INPUT grid is untouched (pure):
  expect(fineGet(fine, ci, cj, ck)).toBe(1);
});

test("E2 property: every suppressed face's backing layer lies inside patchBox", () => {
  const g = wallGrid();
  const fine = rasterize(g);
  const r = prepareCarve(fine, [BREACH]);
  const sup = suppressedFaces(g, r);
  expect(sup.size).toBeGreaterThan(0);
  const box = r.patchBox;
  if (!box) throw new Error("no patch box");
  for (const key of sup) {
    // face key "i,j,k:f" → the coarse cell must sit within the patch box
    // expanded to coarse resolution (the box must back the suppressed piece).
    const [cell] = key.split(":");
    const [i, j, k] = (cell ?? "").split(",").map(Number) as [
      number,
      number,
      number,
    ];
    const cx = (i + 0.5) * CELL,
      cy = (j + 0.5) * CELL,
      cz = (k + 0.5) * CELL;
    expect(cx).toBeGreaterThanOrEqual(box.min[0] - CELL);
    expect(cx).toBeLessThanOrEqual(box.max[0] + CELL);
    expect(cy).toBeGreaterThanOrEqual(box.min[1] - CELL);
    expect(cy).toBeLessThanOrEqual(box.max[1] + CELL);
    expect(cz).toBeGreaterThanOrEqual(box.min[2] - CELL);
    expect(cz).toBeLessThanOrEqual(box.max[2] + CELL);
  }
});

test("E1 exactness: an interior-only carve suppresses NOTHING", () => {
  // 3-cell-thick wall; carve a small pocket entirely inside the middle layer.
  const g = createCoarse([0, 0, 0], [5, 6, 5], AIR);
  for (let k = 1; k <= 3; k++)
    for (let j = 0; j < 6; j++)
      for (let i = 0; i < 5; i++) coarseSet(g, i, j, k, MASONRY);
  const fine = rasterize(g);
  const r = prepareCarve(fine, [
    {
      kind: "capsule",
      a: [1.25, 1.5, 1.25],
      b: [1.25, 1.5, 1.25],
      radius: 0.2,
    },
  ]);
  expect(r.carved.size).toBeGreaterThan(0);
  expect(suppressedFaces(g, r).size).toBe(0);
});

test("E1: a through-carve suppresses exactly the faces whose layer was hit", () => {
  const g = wallGrid();
  const fine = rasterize(g);
  const r = prepareCarve(fine, [BREACH]);
  const sup = suppressedFaces(g, r);
  // The breach centre cell's two Z faces must be suppressed…
  expect(sup.has(faceKey(2, 3, 1, 4))).toBe(true);
  expect(sup.has(faceKey(2, 3, 1, 5))).toBe(true);
  // …and a far corner cell untouched by the bore is NOT:
  expect(sup.has(faceKey(4, 5, 1, 4))).toBe(false);
});

test("prepareCarve with no volumes: no-op (empty carve, no patch)", () => {
  const fine = rasterize(wallGrid());
  const r = prepareCarve(fine, []);
  expect(r.carved.size).toBe(0);
  expect(r.patch).toBeNull();
  expect(r.patchBox).toBeNull();
});
