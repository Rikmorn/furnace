// tests/hall-stamp.test.ts
import { expect, test } from "bun:test";
import type { FloorRect } from "../src/props/scatter.ts";
import { AIR, CELL, coarseGet, MASONRY } from "../src/substrate/grid.ts";
import { DOOR_LANE_DEPTH } from "../src/themes/grid-stamp.ts";
import { HALL_PRESETS, type HallParams, hall } from "../src/themes/hall.ts";
import { TUNNEL_RADIUS } from "../src/world/connector.ts";
import { CARVE_DEPTH } from "../src/world/connector-built.ts";
import {
  expandGridRegion,
  MAT_DRESSING_CRATE,
  MAT_DRESSING_RUBBLE,
} from "../src/world/world-build.ts";

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

// --- Task 13: floor dressing (anchors + scatter layers) ---------------------

/** A 12x12-cell interior on a spacing-4 pillar lattice, with one south door at
 *  offset 4. Grid pillars land on coarse (i,k) ∈ {4,8}²; the door's cells are
 *  i∈[5,8] on the k=0 shell, so its portal centre is x=3.5 on the z=0 plane. */
const DRESSED: HallParams = {
  size: [12, 8, 12],
  pillars: { kind: "grid", spacing: 4 },
  doors: [{ wall: "south", offset: 4 }],
};

const inAnchor = (anchors: FloorRect[], x: number, z: number): boolean =>
  anchors.some((r) => x >= r.minX && x <= r.maxX && z >= r.z0 && z <= r.z1);

test("anchors: on the floor plane, avoid pillar surrounds and door lanes", () => {
  const s = hall(DRESSED, "dress");
  expect(s.anchors.length).toBeGreaterThan(0);
  for (const r of s.anchors) {
    expect(r.y).toBe(0); // floor top
    expect(r.maxX).toBeGreaterThan(r.minX);
    expect(r.z1).toBeGreaterThan(r.z0);
  }
  // A cell centre one cell away from the (4,4) pillar (its 1-cell surround):
  expect(inAnchor(s.anchors, 2.75, 2.25)).toBe(false); // cell (5,4)
  expect(inAnchor(s.anchors, 2.25, 2.75)).toBe(false); // cell (4,5)
  // The pillar cell itself:
  expect(inAnchor(s.anchors, 2.25, 2.25)).toBe(false); // cell (4,4)
  // A point in the south door's lane (2.0 m wide about x=3.5, 3.0 m inward of z=0):
  expect(inAnchor(s.anchors, 3.5, 1.5)).toBe(false);
  // …but open floor clear of both IS anchored (cell (2,2)).
  expect(inAnchor(s.anchors, 1.25, 1.25)).toBe(true);
});

test("dressing: expandGridRegion emits crate + rubble layers over the anchors", () => {
  const s = hall(DRESSED, "dress");
  const region = expandGridRegion(s, [0], [], "dress");
  const crates = region.instances.filter(
    (g) => g.material === MAT_DRESSING_CRATE,
  );
  const rubble = region.instances.filter(
    (g) => g.material === MAT_DRESSING_RUBBLE,
  );
  expect(crates.length).toBe(1);
  expect(rubble.length).toBe(1);
  const crate = crates[0];
  const rub = rubble[0];
  if (!crate || !rub) throw new Error("no dressing group");
  expect(crate.collision).toBe("dynamic"); // shovable
  expect(crate.transforms.length).toBeGreaterThan(0); // non-vacuous: crates were placed
  expect(crate.placements?.length).toBe(crate.transforms.length / 16);
  expect(rub.collision).toBeUndefined(); // ghost
  expect(rub.transforms.length).toBeGreaterThan(0);
});

test("door lane clears the collar-bore carve reach (no dressing over carved void)", () => {
  // Anchors are computed PRE-carve, so a door's dressing-free lane is the ONLY thing
  // keeping crates off floor that a collar-bore later carves away. The bore reaches
  // CARVE_DEPTH + TUNNEL_RADIUS inward of the door plane; the lane must cover at least
  // that, or a crate could spawn over the void. These constants live in three files with
  // nothing else tying them together — this is that tie.
  expect(DOOR_LANE_DEPTH).toBeGreaterThanOrEqual(CARVE_DEPTH + TUNNEL_RADIUS);
});

test("dressing determinism: same params+seed → byte-identical transforms", () => {
  const a = expandGridRegion(hall(DRESSED, "dress"), [0], [], "dress");
  const b = expandGridRegion(hall(DRESSED, "dress"), [0], [], "dress");
  const dressing = (r: typeof a) =>
    r.instances
      .filter(
        (g) =>
          g.material === MAT_DRESSING_CRATE ||
          g.material === MAT_DRESSING_RUBBLE,
      )
      .map((g) => [...g.transforms]);
  expect(dressing(a)).toEqual(dressing(b));
});

// W2 gate regression: a door whose CENTRE walk lane is blocked by a pillar is
// invalid content — the stamper rejects it setup-loud (traversability by
// construction). Offset 6 on pillarHall's east wall puts a colonnade pillar
// (row i=8, slot k=9) dead on the door axis; offset 5 seats the lane between
// pillar slots.
test("door-lane validation: pillar on the centre lane throws; clear lane passes", () => {
  const blocked = {
    ...HALL_PRESETS.pillarHall,
    doors: [{ wall: "east" as const, offset: 6 }],
  };
  expect(() => hall(blocked, "h")).toThrow(/blocked walk lane/);
  const clear = {
    ...HALL_PRESETS.pillarHall,
    doors: [{ wall: "east" as const, offset: 5 }],
  };
  expect(() => hall(clear, "h")).not.toThrow();
});
