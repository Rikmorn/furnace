import { describe, expect, test } from "bun:test";
import {
  columnPass,
  type Flag,
} from "../scripts/analyzer-probe/column-pass.ts";
import {
  type Occupancy,
  occupancyFromProxy,
} from "../scripts/analyzer-probe/occupancy.ts";

/** Hand-built 6x8x6 occupancy: flat solid floor at y=0, air above. */
function flatFloor(): Occupancy {
  const size: [number, number, number] = [0.5, 0.25, 0.5];
  const dims: [number, number, number] = [6, 8, 6];
  const solid = new Uint8Array(6 * 8 * 6);
  for (let z = 0; z < 6; z++)
    for (let x = 0; x < 6; x++) solid[x + 6 * (0 + 8 * z)] = 1;
  return { solid, dims, size, origin: [0, 0, 0] };
}

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
      occ.solid[x + occ.dims[0] * (y + occ.dims[1] * z)];
    expect(at(1, 0, 0)).toBe(1);
    expect(at(0, 1, 0)).toBe(0);
  });
});

describe("columnPass", () => {
  test("flat floor with full clearance produces walkable cells and no flags", () => {
    const res = columnPass(flatFloor());
    expect(res.walkable.size).toBeGreaterThan(0);
    expect(res.flags).toEqual([]);
  });

  test("a lip below step height adjacent to a wall flags lip-near-wall", () => {
    const occ = flatFloor();
    const at = (x: number, y: number, z: number) =>
      x + occ.dims[0] * (y + occ.dims[1] * z);
    // Raise a one-cell lip (0.25 m < STEP_HEIGHT 0.4) along x=2 ...
    for (let z = 0; z < 6; z++) occ.solid[at(2, 1, z)] = 1;
    // ... and a wall right next to it at x=3 (solid up high).
    for (let z = 0; z < 6; z++)
      for (let y = 1; y < 8; y++) occ.solid[at(3, y, z)] = 1;
    const res = columnPass(occ);
    const kinds = res.flags.map((f: Flag) => f.kind);
    expect(kinds).toContain("lip-near-wall");
  });

  test("a rise above step height flags ledge", () => {
    const occ = flatFloor();
    const at = (x: number, y: number, z: number) =>
      x + occ.dims[0] * (y + occ.dims[1] * z);
    // Two-cell rise (0.5 m > 0.4) at x>=3.
    for (let z = 0; z < 6; z++)
      for (let x = 3; x < 6; x++) {
        occ.solid[at(x, 1, z)] = 1;
        occ.solid[at(x, 2, z)] = 1;
      }
    const res = columnPass(occ);
    expect(res.flags.map((f: Flag) => f.kind)).toContain("ledge");
  });

  test("headroom below capsule height flags low-clearance", () => {
    const occ = flatFloor();
    const at = (x: number, y: number, z: number) =>
      x + occ.dims[0] * (y + occ.dims[1] * z);
    // Ceiling at y=6 over x in [2,3]: clearance 5 cells * 0.25 = 1.25 m < 1.8 m.
    for (let z = 0; z < 6; z++)
      for (let x = 2; x <= 3; x++) occ.solid[at(x, 6, z)] = 1;
    const res = columnPass(occ);
    expect(res.flags.map((f: Flag) => f.kind)).toContain("low-clearance");
  });
});
