import { expect, test } from "bun:test";
import { Occupancy, voxelCellsOf } from "../src/occupancy.ts";
import type { Aabb } from "../src/region.ts";

const box = (
  min: [number, number, number],
  max: [number, number, number],
): Aabb => ({ min, max });

test("piece envelopes: overlap rejected, touch ok, containment rejected", () => {
  const occ = new Occupancy();
  occ.addPiece("a", box([0, 0, 0], [10, 5, 10]), [
    { kind: "box", aabb: box([0, 0, 0], [10, 5, 10]) },
  ]);
  expect(occ.checkPieceEnvelope(box([9, 0, 0], [15, 5, 5]))).not.toBeNull(); // overlap
  expect(occ.checkPieceEnvelope(box([10, 0, 0], [15, 5, 5]))).toBeNull(); // exact touch
  expect(occ.checkPieceEnvelope(box([2, 1, 2], [4, 3, 4]))).not.toBeNull(); // fully inside
});

test("clearance vs solids: rejected outside the portal exemption, allowed inside it", () => {
  const occ = new Occupancy();
  occ.addPiece("wall", box([5, 0, -5], [5.4, 6, 5]), [
    { kind: "box", aabb: box([5, 0, -5], [5.4, 6, 5]) },
  ]);
  const clearance = [box([0, 0, -1], [8, 3, 1])]; // crosses the wall
  // "wall" is one of the connector's own endpoints (a connector bores through its own
  // endpoint's wall near the portal) — this isolates rule 2 (solid) from rule 3 (envelope,
  // which exempts only endpoint pieces per spec §2).
  expect(occ.checkClearance(clearance, ["wall", "b"], [])).not.toBeNull();
  const exempt = [box([4.5, -0.5, -1.5], [6, 6.5, 1.5])];
  expect(occ.checkClearance(clearance, ["wall", "b"], exempt)).toBeNull();
});

test("voxel solids: exact cells hit, air cells don't (whole-grid AABB must NOT be used)", () => {
  const coords: number[] = [];
  for (let k = 0; k < 4; k++) for (let j = 0; j < 2; j++) coords.push(0, j, k);
  const solid = {
    kind: "voxels" as const,
    position: [0, 0, 0] as [number, number, number],
    yaw: 0,
    size: [1, 1, 1] as [number, number, number],
    cells: voxelCellsOf(new Int32Array(coords)),
  };
  const occ = new Occupancy();
  occ.addPiece("cave", box([0, 0, 0], [4, 2, 4]), [solid]);
  // "cave" is the connector's own endpoint (its air query sits inside the cave's whole-grid
  // envelope, which is expected — only the exact solid cells, not the envelope, should gate it).
  expect(
    occ.checkClearance([box([2, 0, 0], [3, 2, 4])], ["cave", "y"], []),
  ).toBeNull();
  expect(
    occ.checkClearance([box([0.5, 0, 0], [3, 2, 4])], ["cave", "y"], []),
  ).not.toBeNull();
});

test("voxel solids respect body yaw (rotated grid queried in local frame)", () => {
  const coords: number[] = [];
  for (let k = 0; k < 4; k++) for (let j = 0; j < 2; j++) coords.push(0, j, k);
  const solid = {
    kind: "voxels" as const,
    position: [0, 0, 0] as [number, number, number],
    yaw: Math.PI / 2,
    size: [1, 1, 1] as [number, number, number],
    cells: voxelCellsOf(new Int32Array(coords)),
  };
  const occ = new Occupancy();
  occ.addPiece("cave", box([-1, 0, -4], [1, 2, 1]), [solid]);
  // Ry(90°)·[x,y,z] = [z, y, −x]. local x∈[0,1],z∈[0,4] probed at world x∈[1,2],z∈[−1,0] hits;
  // world x∈[1,2], z∈[1,2] misses.
  expect(
    occ.checkClearance([box([1, 0, -1], [2, 2, 0])], ["x", "y"], []),
  ).not.toBeNull();
  expect(
    occ.checkClearance([box([1, 0, 1], [2, 2, 2])], ["x", "y"], []),
  ).toBeNull();
});

test("clearance vs envelopes: endpoint pieces exempt, third pieces reject", () => {
  const occ = new Occupancy();
  occ.addPiece("a", box([0, 0, 0], [4, 4, 4]), []);
  occ.addPiece("c", box([10, 0, 0], [14, 4, 4]), []);
  const clr = [box([3, 0, 1], [11, 3, 3])]; // pokes into both a and c
  expect(occ.checkClearance(clr, ["a", "b"], [])).not.toBeNull(); // c is not an endpoint
  expect(occ.checkClearance(clr, ["a", "c"], [])).toBeNull();
});

test("clearance vs clearance: strict; committed slab becomes solid", () => {
  const occ = new Occupancy();
  occ.addClearance(
    "e1",
    [box([0, 1, 0], [10, 4, 2])],
    ["a", "b"],
    [],
    [
      { kind: "box", aabb: box([0, 0.7, 0], [10, 1, 2]) }, // its floor slab
    ],
  );
  expect(
    occ.checkClearance([box([4, 1, -3], [6, 4, 5])], ["c", "d"], []),
  ).not.toBeNull();
  expect(
    occ.checkClearance([box([4, 0.7, -3], [6, 0.95, 5])], ["c", "d"], []),
  ).not.toBeNull();
  expect(
    occ.checkClearance([box([4, 6, 0], [6, 8, 2])], ["c", "d"], []),
  ).toBeNull();
});

test("remove() rolls a piece and a clearance back out", () => {
  const occ = new Occupancy();
  occ.addPiece("a", box([0, 0, 0], [4, 4, 4]), []);
  occ.remove("a");
  expect(occ.checkPieceEnvelope(box([1, 1, 1], [2, 2, 2]))).toBeNull();
  occ.addClearance("e1", [box([0, 0, 0], [4, 4, 4])], ["x", "y"], [], []);
  occ.remove("e1");
  expect(
    occ.checkClearance([box([1, 1, 1], [2, 2, 2])], ["p", "q"], []),
  ).toBeNull();
});
