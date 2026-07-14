import { describe, expect, test } from "bun:test";
import {
  columnPass,
  type Flag,
} from "../scripts/analyzer-probe/column-pass.ts";
import {
  mergeOccupancies,
  type Occupancy,
  occupancyFromProxy,
} from "../scripts/analyzer-probe/occupancy.ts";

/** Hand-built 6x12x6 room: solid floor at y=0, solid rock CEILING at y=11, and
 *  10 air cells between (y=1..10 = 2.5 m). The headroom is genuinely above the
 *  1.8 m capsule (clearCells = 8), so the clearance filter is really exercised:
 *  a capped room never reaches the grid top, so the "open to sky" escape hatch
 *  cannot fire and cannot mask a broken clearance test. */
function room(): Occupancy {
  const size: [number, number, number] = [0.5, 0.25, 0.5];
  const dims: [number, number, number] = [6, 12, 6];
  const solid = new Uint8Array(6 * 12 * 6);
  const i = (x: number, y: number, z: number) => x + 6 * (y + 12 * z);
  for (let z = 0; z < 6; z++)
    for (let x = 0; x < 6; x++) {
      solid[i(x, 0, z)] = 1; // floor
      solid[i(x, 11, z)] = 1; // ceiling
    }
  return { solid, dims, size, origin: [0, 0, 0] };
}

/** Flat index into an occupancy's `solid`. */
function idx(occ: Occupancy, x: number, y: number, z: number): number {
  return x + occ.dims[0] * (y + occ.dims[1] * z);
}

const kindsOf = (flags: Flag[]): string[] => flags.map((f) => f.kind);

describe("occupancyFromProxy", () => {
  test("maps proxy coords into a dense grid with the proxy's cell size", () => {
    // Two solid voxels at (0,0,0) and (1,0,0).
    const coords = new Int32Array([0, 0, 0, 1, 0, 0]);
    const occ = occupancyFromProxy(
      { coords, size: [0.5, 0.25, 0.5] },
      [0, 0, 0],
    );
    expect(occ.dims[0]).toBeGreaterThanOrEqual(2);
    expect(occ.solid[0]).toBe(1);
    const at = (x: number, y: number, z: number) =>
      occ.solid[idx(occ, x, y, z)];
    expect(at(1, 0, 0)).toBe(1);
    // One air row above the topmost rock, else the highest floor is unanalysable.
    expect(at(0, 1, 0)).toBe(0);
  });
});

describe("columnPass", () => {
  test("capped room with real 1.8 m clearance is walkable, with no flags", () => {
    const res = columnPass(room());
    // Exactly the 6x6 floor cells at y=1 — walkable because the air run is 10
    // cells >= the 8-cell capsule, NOT because the column is open to sky.
    expect(res.walkable.size).toBe(36);
    for (let z = 0; z < 6; z++)
      for (let x = 0; x < 6; x++)
        expect(res.walkable.has(`${x},1,${z}`)).toBe(true);
    expect(res.flags).toEqual([]);
  });

  test("a lip below step height adjacent to a wall flags lip-near-wall", () => {
    const occ = room();
    // Raise a one-cell lip (0.25 m < STEP_HEIGHT 0.4) along x=2 ...
    for (let z = 0; z < 6; z++) occ.solid[idx(occ, 2, 1, z)] = 1;
    // ... and a wall right next to it at x=3 (solid to the ceiling).
    for (let z = 0; z < 6; z++)
      for (let y = 1; y < 12; y++) occ.solid[idx(occ, 3, y, z)] = 1;
    const res = columnPass(occ);
    expect(kindsOf(res.flags)).toContain("lip-near-wall");
  });

  test("a lip with NO wall nearby is not flagged (the conjunction is real)", () => {
    const occ = room();
    // The same sub-step lip, but nothing standing next to it.
    for (let z = 0; z < 6; z++) occ.solid[idx(occ, 2, 1, z)] = 1;
    const res = columnPass(occ);
    expect(kindsOf(res.flags)).not.toContain("lip-near-wall");
  });

  test("a rise above step height flags ledge", () => {
    const occ = room();
    // Two-cell rise (0.5 m > 0.4) at x>=3.
    for (let z = 0; z < 6; z++)
      for (let x = 3; x < 6; x++) {
        occ.solid[idx(occ, x, 1, z)] = 1;
        occ.solid[idx(occ, x, 2, z)] = 1;
      }
    const res = columnPass(occ);
    expect(kindsOf(res.flags)).toContain("ledge");
  });

  test("headroom below capsule height flags low-clearance", () => {
    const occ = room();
    // Low ceiling at y=6 over x in [2,3]: clearance 5 cells * 0.25 = 1.25 m < 1.8 m.
    for (let z = 0; z < 6; z++)
      for (let x = 2; x <= 3; x++) occ.solid[idx(occ, x, 6, z)] = 1;
    const res = columnPass(occ);
    expect(kindsOf(res.flags)).toContain("low-clearance");
  });

  test("a lane narrower than the capsule flags narrow", () => {
    const occ = room();
    // Walls at x=1 and x=3 leave a one-cell walkable lane at x=2.
    for (let z = 0; z < 6; z++)
      for (const x of [1, 3])
        for (let y = 1; y < 11; y++) occ.solid[idx(occ, x, y, z)] = 1;
    const res = columnPass(occ);
    expect(kindsOf(res.flags)).toContain("narrow");
    // The lane, not the open floor on the far side of either wall.
    const narrow = res.flags.filter((f) => f.kind === "narrow");
    for (const f of narrow) expect(f.cell[0]).toBe(2);
  });

  test("narrow scans every offset out to the capsule radius, not just the far cell", () => {
    // Finer XZ cells (0.25 m) -> wallCellsXZ = ceil(0.3/0.25) = 2, so the walls
    // below sit at an INTERMEDIATE offset (d=1). Probing only the cell at
    // exactly d=2 would find air and miss them — an under-flag, the one failure
    // mode this probe exists to rule out. Production [0.5,_,0.5] cannot catch
    // this, since there wallCellsXZ === 1.
    const dims: [number, number, number] = [8, 12, 6];
    const solid = new Uint8Array(8 * 12 * 6);
    const occ: Occupancy = {
      solid,
      dims,
      size: [0.25, 0.25, 0.25],
      origin: [0, 0, 0],
    };
    for (let z = 0; z < 6; z++)
      for (let x = 0; x < 8; x++) {
        solid[idx(occ, x, 0, z)] = 1; // floor
        solid[idx(occ, x, 11, z)] = 1; // ceiling (10 air cells = 2.5 m)
      }
    // Walls one cell either side of the lane at x=3.
    for (let z = 0; z < 6; z++)
      for (const x of [2, 4])
        for (let y = 1; y < 11; y++) solid[idx(occ, x, y, z)] = 1;
    const res = columnPass(occ);
    expect(res.walkable.has("3,1,0")).toBe(true);
    const narrow = res.flags.filter((f) => f.kind === "narrow");
    expect(narrow.length).toBeGreaterThan(0);
    for (const f of narrow) expect(f.cell[0]).toBe(3);
  });

  test("a cell with rises on two sides emits one flag, not one per direction", () => {
    const occ = room();
    // Two-cell pillars at x=1 and x=3 -> x=2 has a ledge on BOTH sides.
    for (let z = 0; z < 6; z++)
      for (const x of [1, 3]) {
        occ.solid[idx(occ, x, 1, z)] = 1;
        occ.solid[idx(occ, x, 2, z)] = 1;
      }
    const res = columnPass(occ);
    expect(kindsOf(res.flags)).toContain("ledge");
    const keys = res.flags.map((f) => `${f.kind}@${f.cell.join(",")}`);
    expect(keys.length).toBe(new Set(keys).size); // no duplicate (kind, cell)
    expect(keys.filter((k) => k === "ledge@2,1,0").length).toBe(1);
  });
});

describe("mergeOccupancies", () => {
  /** One solid voxel at the proxy's local origin, placed at `pos`. */
  const unit = (pos: [number, number, number]): Occupancy =>
    occupancyFromProxy(
      { coords: new Int32Array([0, 0, 0]), size: [0.5, 0.25, 0.5] },
      pos,
    );

  test("unions two lattice-aligned occupancies into one grid", () => {
    // The second proxy sits 2 cells (1.0 m) along +x, leaving a one-cell gap.
    const merged = mergeOccupancies([unit([0, 0, 0]), unit([1.0, 0, 0])]);
    expect(merged.origin).toEqual([0, 0, 0]);
    expect(merged.dims).toEqual([3, 2, 1]);
    expect(merged.size).toEqual([0.5, 0.25, 0.5]);
    const at = (x: number, y: number, z: number) =>
      merged.solid[idx(merged, x, y, z)];
    expect(at(0, 0, 0)).toBe(1); // first proxy
    expect(at(1, 0, 0)).toBe(0); // the gap between them
    expect(at(2, 0, 0)).toBe(1); // second proxy
    expect(at(0, 1, 0)).toBe(0); // the padded air row survives the merge
  });

  test("throws on an empty list", () => {
    expect(() => mergeOccupancies([])).toThrow(/empty/);
  });

  test("throws on mixed cell sizes", () => {
    const a = unit([0, 0, 0]);
    const b: Occupancy = { ...unit([0, 0, 0]), size: [0.5, 0.5, 0.5] };
    expect(() => mergeOccupancies([a, b])).toThrow(/mixed cell sizes/);
  });

  test("throws on an off-lattice origin rather than silently snapping it", () => {
    // 0.3 is not a multiple of the 0.5 x-cell: Math.round would snap it half a
    // cell with no error, displacing every solid cell of this body.
    const bad: Occupancy = { ...unit([0, 0, 0]), origin: [0.3, 0, 0] };
    expect(() => mergeOccupancies([bad])).toThrow(/off-lattice/);
  });
});
