// tests/hall-stamp.test.ts
import { expect, test } from "bun:test";
import { AIR, CELL, coarseGet, MASONRY } from "../src/substrate/grid.ts";
import { HALL_PRESETS, type HallParams, hall } from "../src/themes/hall.ts";

const P: HallParams = {
  size: [8, 8, 12], // interior cells w(x) x h(y) x d(z) = 4m x 4m x 6m
  pillars: { kind: "none" },
  doors: [{ wall: "south", offset: 2 }],
};

test("stamp: sealed shell, AIR interior, grid min/dims per convention", () => {
  const s = hall(P, "h1");
  expect(s.coarse.min).toEqual([0, -CELL, 0]);
  expect(s.coarse.dims).toEqual([10, 10, 14]); // interior + 1-cell shell each side
  // interior cell is AIR; shell cells are MASONRY on all 6 sides:
  expect(coarseGet(s.coarse, 5, 4, 7)).toBe(AIR);
  expect(coarseGet(s.coarse, 0, 4, 7)).toBe(MASONRY); // -X shell
  expect(coarseGet(s.coarse, 5, 0, 7)).toBe(MASONRY); // floor
  expect(coarseGet(s.coarse, 5, 9, 7)).toBe(MASONRY); // ceiling
  expect(coarseGet(s.coarse, 5, 4, 0)).toBe(MASONRY); // -Z (south) shell SEALED
});

test("portal: door-class, on the floor plane, exact cardinal facing, 2.0x3.0", () => {
  const s = hall(P, "h1");
  expect(s.portals.length).toBe(1);
  const p = s.portals[0];
  if (!p) throw new Error("no portal");
  expect(p.kind).toBe("door");
  expect(p.width).toBe(2.0);
  expect(p.height).toBe(3.0);
  expect(p.facing).toEqual([0, 0, -1]); // south, EXACT cardinal (no float dust)
  expect(p.position[1]).toBe(0); // threshold on the interior floor plane
  // Door x-centre: offset 2 cells from the interior's -X edge + half the 4-cell
  // door width → x = (1 + 2 + 2) * CELL = 2.5.
  expect(p.position[0]).toBe(2.5);
  expect(p.position[2]).toBe(0); // outer face of the south shell (OUTER shell plane)
});

test("doorSpec matches its portal (cells the connector opens on consume)", () => {
  const s = hall(P, "h1");
  const d = s.doorSpecs[0];
  if (!d) throw new Error("no doorSpec");
  expect(d.face).toBe(5); // -Z outward
  expect(d.size).toEqual([4, 6]); // 2.0 x 3.0 in cells
  expect(d.min[1]).toBe(1); // first interior-height cell (floor is j=0)
});

test("pillar grid: lattice cells are MASONRY, spacing respected", () => {
  const s = hall(
    { size: [8, 8, 12], pillars: { kind: "grid", spacing: 4 }, doors: [] },
    "h1",
  );
  // First lattice pillar sits `spacing` cells into the interior.
  expect(coarseGet(s.coarse, 4, 4, 4)).toBe(MASONRY);
  expect(coarseGet(s.coarse, 5, 4, 4)).toBe(AIR);
});

test("colonnade: twin rows flank the central z-aisle", () => {
  const s = hall(
    { size: [8, 8, 12], pillars: { kind: "colonnade", spacing: 3 }, doors: [] },
    "h1",
  );
  let pillarCells = 0;
  for (let k = 1; k <= 12; k++)
    for (let i = 1; i <= 8; i++)
      if (coarseGet(s.coarse, i, 4, k) === MASONRY) pillarCells++;
  expect(pillarCells).toBeGreaterThan(0);
  // The twin rows flank the aisle at i=3 and i=7 (centre 5 ± 2), stamped on the
  // spacing-3 lattice (k=3): pin them so a centre-offset regression is caught.
  expect(coarseGet(s.coarse, 3, 4, 3)).toBe(MASONRY);
  expect(coarseGet(s.coarse, 7, 4, 3)).toBe(MASONRY);
  // The central aisle column (interior centre x) stays clear:
  for (let k = 1; k <= 12; k++) expect(coarseGet(s.coarse, 5, 4, k)).toBe(AIR);
});

test("presets exist and stamp without throwing", () => {
  for (const preset of Object.values(HALL_PRESETS)) {
    expect(hall(preset, "p").portals.length).toBeGreaterThanOrEqual(0);
  }
});

test("determinism: same params+seed → byte-identical stamp", () => {
  const a = hall(P, "same");
  const b = hall(P, "same");
  expect([...a.coarse.cells]).toEqual([...b.coarse.cells]);
});
