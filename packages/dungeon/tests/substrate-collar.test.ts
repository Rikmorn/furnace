// tests/substrate-collar.test.ts
import { expect, test } from "bun:test";
import { collarInstances } from "../src/substrate/collar.ts";
import {
  AIR,
  CELL,
  coarseSet,
  createCoarse,
  MASONRY,
} from "../src/substrate/grid.ts";
import { COLLAR_SECTION } from "../src/substrate/pieces.ts";
import { faceKey } from "../src/substrate/skin.ts";

/** Wall at k=1 in a 5x6x3 grid (air both sides in-grid). */
function wallGrid() {
  const g = createCoarse([0, 0, 0], [5, 6, 3], AIR);
  for (let j = 0; j < 6; j++)
    for (let i = 0; i < 5; i++) coarseSet(g, i, j, 1, MASONRY);
  return g;
}

test("suppressed wall face ringed by kept faces emits 4 collar pieces", () => {
  const g = wallGrid();
  const sup = new Set([faceKey(2, 3, 1, 4)]); // one +Z panel suppressed mid-wall
  const group = collarInstances(g, sup, "seed");
  // 4 junctions (left/right → rimPostV, up/down → rimEdgeH) — 4 instances.
  expect(group.transforms.length / 16).toBe(4);
});

test("adjacent suppressed faces do NOT collar their shared junction", () => {
  const g = wallGrid();
  const sup = new Set([faceKey(2, 3, 1, 4), faceKey(3, 3, 1, 4)]);
  const group = collarInstances(g, sup, "seed");
  // Each face has 4 in-plane neighbours; the shared junction is suppressed on
  // both sides → not a suppressed↔kept boundary. 2 faces x 3 kept junctions.
  expect(group.transforms.length / 16).toBe(6);
});

test("floor-rim path: a suppressed FLOOR face (+Y) collars with rimEdgeH", () => {
  // Floor slab at j=0 with air above: suppress one top face.
  const airAbove = createCoarse([0, 0, 0], [5, 2, 5], AIR);
  for (let k = 0; k < 5; k++)
    for (let i = 0; i < 5; i++) coarseSet(airAbove, i, 0, k, MASONRY);
  const sup = new Set([faceKey(2, 0, 2, 2)]); // +Y face of the centre floor cell
  const group = collarInstances(airAbove, sup, "seed");
  expect(group.transforms.length / 16).toBe(4); // ringed by 4 kept floor faces
});

test("no suppressed faces → empty collar group", () => {
  const group = collarInstances(wallGrid(), new Set(), "seed");
  expect(group.transforms.length).toBe(0);
});

test("dispatches rimPostV (vertical) vs rimEdgeH (horizontal) by junction edge", () => {
  // The module's headline behaviour: a suppressed +Z wall face rings into 2
  // vertical junctions (±X → rimPostV) and 2 horizontal (±Y → rimEdgeH). The
  // piece type survives only in the baked box scale; identity-rotation TRS
  // carries scale.x on the column-major diagonal at [0]. rimPostV.x =
  // COLLAR_SECTION, rimEdgeH.x = CELL, so the split is observable there.
  const group = collarInstances(
    wallGrid(),
    new Set([faceKey(2, 3, 1, 4)]),
    "seed",
  );
  const sx: number[] = [];
  for (let i = 0; i < group.transforms.length; i += 16)
    sx.push(group.transforms[i] as number);
  const posts = sx.filter((x) => Math.abs(x - COLLAR_SECTION) < 1e-6).length;
  const edges = sx.filter((x) => Math.abs(x - CELL) < 1e-6).length;
  expect(posts).toBe(2);
  expect(edges).toBe(2);
});
