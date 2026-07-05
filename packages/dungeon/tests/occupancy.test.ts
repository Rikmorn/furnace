import { expect, test } from "bun:test";
import { obbOfAabb } from "../src/aabb.ts";
import { Occupancy, voxelCellsOf } from "../src/occupancy.ts";
import type { Aabb } from "../src/region.ts";

const box = (
  min: [number, number, number],
  max: [number, number, number],
): Aabb => ({ min, max });

// Piece envelopes are exact yaw-0 Obbs (Task 1, B2c) — same numbers as `box`, wrapped.
const obb = (min: [number, number, number], max: [number, number, number]) =>
  obbOfAabb(box(min, max));

test("piece envelopes: overlap rejected, touch ok, containment rejected", () => {
  const occ = new Occupancy();
  occ.addPiece(
    "a",
    [obb([0, 0, 0], [10, 5, 10])],
    [{ kind: "box", aabb: box([0, 0, 0], [10, 5, 10]) }],
  );
  expect(occ.checkPieceEnvelope([obb([9, 0, 0], [15, 5, 5])])).not.toBeNull(); // overlap
  expect(occ.checkPieceEnvelope([obb([10, 0, 0], [15, 5, 5])])).toBeNull(); // exact touch
  expect(occ.checkPieceEnvelope([obb([2, 1, 2], [4, 3, 4])])).not.toBeNull(); // fully inside
});

test("compound piece envelopes: overlap with ONE of several claim boxes rejects, fitting between two passes", () => {
  const occ = new Occupancy();
  // Two disjoint claim boxes standing in for a cave's hub + a bore slab, with an
  // unclaimed gap between them (the 95%-air interior the whole-grid `bounds` used to
  // over-claim).
  occ.addPiece(
    "cave",
    [obb([0, 0, 0], [4, 3, 4]), obb([10, 0, 0], [14, 3, 4])],
    [],
  );
  // Overlaps only the SECOND claim box.
  expect(occ.checkPieceEnvelope([obb([13, 0, 1], [16, 3, 3])])).not.toBeNull();
  // Overlaps only the FIRST claim box.
  expect(occ.checkPieceEnvelope([obb([-2, 0, 1], [1, 3, 3])])).not.toBeNull();
  // Sits entirely in the gap between the two claim boxes — legal (this is exactly what
  // a per-cell whole-grid envelope would have wrongly rejected).
  expect(occ.checkPieceEnvelope([obb([5, 0, 1], [9, 3, 3])])).toBeNull();
});

test("compound piece envelopes: a candidate whose OWN box overlaps one of several placed claim boxes rejects", () => {
  const occ = new Occupancy();
  occ.addPiece(
    "cave",
    [obb([0, 0, 0], [4, 3, 4]), obb([10, 0, 0], [14, 3, 4])],
    [],
  );
  // The candidate's own compound claim: one box in the clear gap, one box overlapping
  // the cave's second claim box — should still reject (ANY box-pair intersecting).
  expect(
    occ.checkPieceEnvelope([
      obb([5, 0, 1], [9, 3, 3]),
      obb([11, 0, 1], [13, 3, 3]),
    ]),
  ).not.toBeNull();
});

test("clearance vs compound envelopes: overlap with one claim box (non-endpoint) rejects, gap between claim boxes passes", () => {
  const occ = new Occupancy();
  occ.addPiece(
    "cave",
    [obb([0, 0, 0], [4, 3, 4]), obb([10, 0, 0], [14, 3, 4])],
    [],
  );
  // Pokes into the SECOND claim box only; "cave" is not a connector endpoint.
  expect(
    occ.checkClearance([box([13, 0, 1], [16, 3, 3])], ["a", "b"], []),
  ).not.toBeNull();
  // Same box, but "cave" IS an endpoint — rule 3/4's envelope check exempts endpoints.
  expect(
    occ.checkClearance([box([13, 0, 1], [16, 3, 3])], ["cave", "b"], []),
  ).toBeNull();
  // Sits entirely in the gap between the two claim boxes — legal.
  expect(
    occ.checkClearance([box([5, 0, 1], [9, 3, 3])], ["a", "b"], []),
  ).toBeNull();
});

test("clearance vs solids: rejected outside the portal exemption, allowed inside it", () => {
  const occ = new Occupancy();
  occ.addPiece(
    "wall",
    [obb([5, 0, -5], [5.4, 6, 5])],
    [{ kind: "box", aabb: box([5, 0, -5], [5.4, 6, 5]) }],
  );
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
  occ.addPiece("cave", [obb([0, 0, 0], [4, 2, 4])], [solid]);
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
  occ.addPiece("cave", [obb([-1, 0, -4], [1, 2, 1])], [solid]);
  // Ry(90°)·[x,y,z] = [z, y, −x]. local x∈[0,1],z∈[0,4] probed at world x∈[1,2],z∈[−1,0] hits;
  // world x∈[1,2], z∈[1,2] misses.
  expect(
    occ.checkClearance([box([1, 0, -1], [2, 2, 0])], ["x", "y"], []),
  ).not.toBeNull();
  expect(
    occ.checkClearance([box([1, 0, 1], [2, 2, 2])], ["x", "y"], []),
  ).toBeNull();
});

test("voxel solids at non-zero yaw: exact per-cell exemption (rotated door threading)", () => {
  // A 90°-rotated wall: two jamb columns (local i=0, i=2) flanking a hollow bore/doorway
  // (local i=1, no cells) — the "mouth collar" idiom (AGENTS.md) where a connector's
  // clearance legitimately embeds into the jamb near the seam.
  const coords: number[] = [];
  for (const i of [0, 2]) for (const j of [0, 1]) coords.push(i, j, 0);
  const solid = {
    kind: "voxels" as const,
    position: [0, 0, 0] as [number, number, number],
    yaw: Math.PI / 2,
    size: [1, 1, 1] as [number, number, number],
    cells: voxelCellsOf(new Int32Array(coords)),
  };
  const occ = new Occupancy();
  occ.addPiece("wall", [obb([-1, -1, -3], [2, 3, 0])], [solid]);
  // Ry(90°) seats the jambs at world x∈[0,1], z∈[-1,0] (i=0) and z∈[-3,-2] (i=2); the
  // doorway (air, i=1) is world z∈[-2,-1]. This clearance box threads the doorway and
  // embeds 0.3m into each jamb.
  const clearance = [box([-1, 0, -2.3], [2, 2, -0.7])];
  const exempt = [box([-0.5, -0.5, -2.3], [1.5, 2.5, -0.7])];
  // No exemption: the jamb embed is real rock outside any exemption — rejected.
  expect(occ.checkClearance(clearance, ["wall", "y"], [])).not.toBeNull();
  // A portal exemption covering the embed: passes (FAILS before the fix — the old
  // `solid.yaw !== 0 → return true` shortcut never reaches the per-cell exemption test).
  expect(occ.checkClearance(clearance, ["wall", "y"], exempt)).toBeNull();
});

test("voxel solids at 45° yaw: conservative per-cell AABB test (near-cell rejects, open air passes)", () => {
  const solid = {
    kind: "voxels" as const,
    position: [0, 0, 0] as [number, number, number],
    yaw: Math.PI / 4,
    size: [1, 1, 1] as [number, number, number],
    cells: voxelCellsOf(new Int32Array([0, 0, 0])),
  };
  const occ = new Occupancy();
  occ.addPiece("rock", [obb([-1, -1, -1], [2, 2, 2])], [solid]);
  // Ry(45°) envelopes local cell (0,0,0) to world x≈[0,1.41], z≈[-0.71,0.71] — exact only
  // at cardinal yaws, conservative here. A query inside that envelope still rejects.
  const nearCell = [box([0.3, 0, 0], [0.6, 1, 0.3])];
  expect(occ.checkClearance(nearCell, ["rock", "y"], [])).not.toBeNull();
  const openAir = [box([10, 0, 10], [11, 1, 11])];
  expect(occ.checkClearance(openAir, ["rock", "y"], [])).toBeNull();
});

test("clearance vs envelopes: endpoint pieces exempt, third pieces reject", () => {
  const occ = new Occupancy();
  occ.addPiece("a", [obb([0, 0, 0], [4, 4, 4])], []);
  occ.addPiece("c", [obb([10, 0, 0], [14, 4, 4])], []);
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
  occ.addPiece("a", [obb([0, 0, 0], [4, 4, 4])], []);
  occ.remove("a");
  expect(occ.checkPieceEnvelope([obb([1, 1, 1], [2, 2, 2])])).toBeNull();
  occ.addClearance("e1", [box([0, 0, 0], [4, 4, 4])], ["x", "y"], [], []);
  occ.remove("e1");
  expect(
    occ.checkClearance([box([1, 1, 1], [2, 2, 2])], ["p", "q"], []),
  ).toBeNull();
});
