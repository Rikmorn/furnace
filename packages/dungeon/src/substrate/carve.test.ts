// src/substrate/carve.test.ts
import { expect, test } from "bun:test";
import { at } from "../../tests/_helpers/expect.ts";
import { type CarveVolume, prepareCarve } from "./carve.ts";
import {
  AIR,
  CELL,
  coarseSet,
  createCoarse,
  FINE,
  fineGet,
  MASONRY,
  rasterize,
  SUB,
} from "./grid.ts";
import { faceKey } from "./skin.ts";
import { suppressedFaces } from "./suppress.ts";

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

// --- W2 gate regression: the cylinder carve through a GRID-EDGE wall ---------------
// The gate found the carved opening rendering CLOSED: the patch field read off-grid
// as unconditionally solid, so Surface-Nets manufactured a lid across the bore where
// the carve exits through the region's outer shell face; and the capsule's spherical
// end swept `radius` into the room, eating pillars/floor (the blob + void holes).
// This fixture mirrors the failing hall composition at carve level.

/** Room with its EAST shell on the grid edge: floor j=0, wall i=7, a pillar column
 *  at (4, 1..6, 4) — 1.5 m inside the room, which the old capsule carve clipped. */
function edgeRoomGrid() {
  const g = createCoarse([0, 0, 0], [8, 8, 8], AIR);
  for (let k = 0; k < 8; k++)
    for (let i = 0; i < 8; i++) coarseSet(g, i, 0, k, MASONRY); // floor
  for (let k = 0; k < 8; k++)
    for (let j = 0; j < 8; j++) coarseSet(g, 7, j, k, MASONRY); // east shell (grid edge)
  for (let j = 1; j < 7; j++) coarseSet(g, 4, j, 4, MASONRY); // pillar
  return g;
}

/** The gate-shaped opening: flat-ended cylinder through the east shell (outer plane
 *  x=4), centreline 1.6 above the threshold (floor top y=0.5), floor-clipped. */
const EDGE_CARVE: CarveVolume = {
  kind: "cylinder",
  a: [4.5, 2.1, 2], // 0.5 past the door plane (through the grid edge)
  b: [3.3, 2.1, 2], // 0.7 inward (shell 0.5 + proud pieces)
  radius: 1.6,
  clipBelowY: 0.5,
};

/** Möller–Trumbore segment–triangle intersection. */
function segTri(
  a: number[],
  b: number[],
  p0: number[],
  p1: number[],
  p2: number[],
): boolean {
  const e1 = [
    at(p1, 0) - at(p0, 0),
    at(p1, 1) - at(p0, 1),
    at(p1, 2) - at(p0, 2),
  ];
  const e2 = [
    at(p2, 0) - at(p0, 0),
    at(p2, 1) - at(p0, 1),
    at(p2, 2) - at(p0, 2),
  ];
  const d = [at(b, 0) - at(a, 0), at(b, 1) - at(a, 1), at(b, 2) - at(a, 2)];
  const h = [
    at(d, 1) * at(e2, 2) - at(d, 2) * at(e2, 1),
    at(d, 2) * at(e2, 0) - at(d, 0) * at(e2, 2),
    at(d, 0) * at(e2, 1) - at(d, 1) * at(e2, 0),
  ];
  const det =
    at(e1, 0) * at(h, 0) + at(e1, 1) * at(h, 1) + at(e1, 2) * at(h, 2);
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det;
  const s = [at(a, 0) - at(p0, 0), at(a, 1) - at(p0, 1), at(a, 2) - at(p0, 2)];
  const u =
    inv * (at(s, 0) * at(h, 0) + at(s, 1) * at(h, 1) + at(s, 2) * at(h, 2));
  if (u < 0 || u > 1) return false;
  const q = [
    at(s, 1) * at(e1, 2) - at(s, 2) * at(e1, 1),
    at(s, 2) * at(e1, 0) - at(s, 0) * at(e1, 2),
    at(s, 0) * at(e1, 1) - at(s, 1) * at(e1, 0),
  ];
  const v =
    inv * (at(d, 0) * at(q, 0) + at(d, 1) * at(q, 1) + at(d, 2) * at(q, 2));
  if (v < 0 || u + v > 1) return false;
  const t =
    inv * (at(e2, 0) * at(q, 0) + at(e2, 1) * at(q, 1) + at(e2, 2) * at(q, 2));
  return t >= 0 && t <= 1;
}

/** Does any patch triangle block segment ab? */
function patchBlocks(
  r: ReturnType<typeof prepareCarve>,
  a: number[],
  b: number[],
): boolean {
  const patch = r.patch;
  if (!patch) return false;
  const pos = patch.positions;
  const idx = patch.indices;
  const tri = (i: number, c: number): number[] => {
    const base = at(idx, i + c) * 3;
    return [at(pos, base), at(pos, base + 1), at(pos, base + 2)];
  };
  for (let i = 0; i < idx.length; i += 3) {
    if (segTri(a, b, tri(i, 0), tri(i, 1), tri(i, 2))) return true;
  }
  return false;
}

test("grid-edge cylinder carve: the patch does NOT lid the opening (gate regression)", () => {
  const fine = rasterize(edgeRoomGrid());
  const r = prepareCarve(fine, [EDGE_CARVE]);
  expect(r.carved.size).toBeGreaterThan(0);
  expect(r.patch).not.toBeNull();
  // Sightlines through the opening, room → past the grid edge: centreline + a
  // disc of offset lanes. Before the off-grid-inside-the-carve field rule, ALL
  // of these were blocked by a manufactured lid at the last cell layer.
  for (const [dy, dz] of [
    [0, 0],
    [0.5, 0],
    [-0.5, 0],
    [0, 0.5],
    [0, -0.5],
  ] as const) {
    expect(patchBlocks(r, [2.5, 2.1 + dy, 2 + dz], [5, 2.1 + dy, 2 + dz])).toBe(
      false,
    );
  }
  // The wall AROUND the opening still patches closed: inside the patch WINDOW
  // (carved AABB + margin, clamped to the grid) but outside the bore radius
  // (dz = 1.85 > 1.6). Walls beyond the window are kit-panel territory.
  expect(patchBlocks(r, [2.5, 2.1, 3.85], [5, 2.1, 3.85])).toBe(true);
});

test("grid-edge cylinder carve: floor un-grooved, interior pillar untouched (flat ends)", () => {
  const g = edgeRoomGrid();
  const fine = rasterize(g);
  const r = prepareCarve(fine, [EDGE_CARVE]);
  // clipBelowY: the floor's top fine layer beneath the opening stays SOLID —
  // the old carve grooved it (suppressed floor tiles = the gate's void holes).
  for (let di = 0; di < 2; di++) {
    expect(fineGet(r.fine, 13 + di, 1, 8)).toBe(1); // x≈3.4, y∈[0.25,0.5], z=2
  }
  // Flat ends: the pillar 1.5 m inside the room keeps every fine cell — the old
  // capsule's spherical end (reach = depth + radius) carved it.
  for (let j = SUB; j < 7 * SUB; j++) {
    expect(fineGet(r.fine, 4 * SUB, j, 4 * SUB)).toBe(1);
  }
});
