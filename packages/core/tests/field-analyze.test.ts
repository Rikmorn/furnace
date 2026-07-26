// Stage-1 walkability column pass (F4, D-F4-3/5/6/7). Ported from the F0
// throwaway probe `packages/dungeon/scripts/analyzer-probe/column-pass.ts` and
// its suite: every case there is rebuilt here on a `FieldStore` (global voxel
// coords, one lattice), plus the severity bands and the FieldStore-only
// semantics the probe's bounded grid had no equivalent for (unallocated =
// rock, per-chunk anchors, extra solidity).
import { describe, expect, test } from "bun:test";
import type {
  AgentProfile,
  ChunkKey,
  FieldFlag,
  PlacementRecord,
} from "@furnace/core/field";
import {
  AIR,
  analyzeChunk,
  analyzeWorld,
  CHUNK_DIM,
  CHUNK_SAMPLES,
  chunkKey,
  createFieldStore,
  DEFAULT_CELL_SIZE,
  type FieldStore,
  getDensity,
  markUnreachable,
  type PlacementCollision,
  SOLID,
  setDensity,
  voxelizePlacements,
} from "@furnace/core/field";
import { at, expectDefined } from "./_helpers/expect.ts";

/** The dungeon's capsule (`packages/dungeon/catalog/agent.json`), copied — core
 *  tests must not import a consumer package. At the 0.25 m default cell size
 *  this derives: clearCells 8, stepCells 1, climbCells 2, wallCellsXZ 2, and a
 *  `narrow` pinch threshold of 2·0.3 + 0.08 = 0.68 m reached over
 *  ceil(0.68 / 0.25) = 3 cells. */
const AGENT: AgentProfile = {
  capsule: { radius: 0.3, halfHeight: 0.6 },
  stepHeight: 0.4,
  climbCeiling: 0.7,
  clearance: 1.8,
  slopeLimitDeg: 55,
  skin: 0.08,
};

/** A deliberately fat capsule: its pinch threshold is 2·0.55 + 0.08 = 1.18 m,
 *  reached over ceil(1.18 / 0.25) = 5 cells, so a wall at offset 2 is
 *  INTERMEDIATE — the case the "nearest solid, not the far cell" rule is for. */
const WIDE: AgentProfile = {
  capsule: { radius: 0.55, halfHeight: 0.6 },
  stepHeight: 0.4,
  climbCeiling: 0.7,
  clearance: 2.3,
  slopeLimitDeg: 55,
  skin: 0.08,
};

// The room: 48x48 cells of floor (3 chunks wide in XZ) carved out of rock,
// centred on chunk (0,0,0), with 12 cells (3.0 m) of air above it. Analysing the
// CENTRE chunk keeps every anchor 16 cells clear of the surrounding rock, so a
// clean room really is quiet — a one-chunk room would pinch `narrow` at its
// corners (see the unallocated-rock test, which relies on exactly that).
const ROOM_MIN = -CHUNK_DIM;
const ROOM_MAX = 2 * CHUNK_DIM; // exclusive
const AIR_LO = 1;
const AIR_HI = 13; // exclusive — rock ceiling at y = 13
const CENTER: ChunkKey = chunkKey(0, 0, 0);
/** The room's single floor level: the air cell directly above the y=0 rock. */
const FLOOR = AIR_LO;

/** Solid box over INCLUSIVE voxel bounds. */
function solidBox(
  s: FieldStore,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): void {
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) setDensity(s, x, y, z, SOLID);
}

/** Air box over INCLUSIVE voxel bounds. */
function airBox(
  s: FieldStore,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): void {
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) setDensity(s, x, y, z, AIR);
}

function room(): FieldStore {
  const s = createFieldStore(DEFAULT_CELL_SIZE);
  airBox(s, ROOM_MIN, ROOM_MAX - 1, AIR_LO, AIR_HI - 1, ROOM_MIN, ROOM_MAX - 1);
  return s;
}

// A cavern taller than any cap a scan might be tempted to impose: 60 air cells
// (15 m) of headroom, with a plateau whose top sits 40 cells (10 m) above the
// floor — well past 4 capsule clearances (32 cells), and still inside the air
// volume the mover stands in. Kept narrower in XZ than `room()` (walls 4 cells
// beyond the analysed chunk, still clear of wallCellsXZ) to bound fixture cost.
const TALL_MIN = -4;
const TALL_MAX = CHUNK_DIM + 3; // inclusive
const TALL_CEILING = 61;
const PLATEAU_TOP = 40;

/** A feature spanning the room's full Z extent, as the donor's fixtures did. */
const spanZ = (
  s: FieldStore,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): void => solidBox(s, x0, x1, y0, y1, ROOM_MIN, ROOM_MAX - 1);

/** The lane the `narrow` cases are built around, at the centre chunk's middle. */
const LANE_X = 8;

/** Two full-height walls either side of the lane at {@link LANE_X}, `minus` and
 *  `plus` cells out from it. The free width between their near faces — what the
 *  pinch predicate measures — is `(minus + plus - 1) * 0.25` m. */
function lane(minus: number, plus: number): FieldStore {
  const s = room();
  spanZ(s, LANE_X - minus, LANE_X - minus, AIR_LO, AIR_HI - 1);
  spanZ(s, LANE_X + plus, LANE_X + plus, AIR_LO, AIR_HI - 1);
  return s;
}

const kindsOf = (flags: readonly FieldFlag[]): string[] =>
  flags.map((f) => f.kind);
const only = (flags: readonly FieldFlag[], kind: string): FieldFlag[] =>
  flags.filter((f) => f.kind === kind);

describe("analyzeChunk — walkable column pass", () => {
  test("an open room with real capsule clearance is quiet", () => {
    // 12 air cells (3.0 m) over the floor, genuinely above the 1.8 m capsule
    // (clearCells = 8) — and bounded by rock, so no "open to the top of the
    // grid" escape hatch can mask a broken clearance test.
    expect(analyzeChunk(room(), CENTER, AGENT)).toEqual([]);

    // Vacuity guard: the same fixture DOES flag when a hazard is added, so the
    // quiet above is "nothing to find", not "the pass found no floor".
    const hazard = room();
    spanZ(hazard, 9, ROOM_MAX - 1, AIR_LO, 4);
    expect(analyzeChunk(hazard, CENTER, AGENT).length).toBeGreaterThan(0);
  });

  test("a lip below step height beside a wall flags lip-near-wall (info)", () => {
    const s = room();
    spanZ(s, 8, 8, AIR_LO, AIR_LO); // one-cell lip: 0.25 m <= stepHeight 0.4
    spanZ(s, 9, 9, AIR_LO, AIR_HI - 1); // wall right beyond it, floor to ceiling
    const flags = analyzeChunk(s, CENTER, AGENT);
    expect(kindsOf(flags)).toContain("lip-near-wall");
    for (const f of only(flags, "lip-near-wall")) {
      expect(f.cell[0]).toBe(7); // anchored at the foot of the lip
      expect(f.severity).toBe("info"); // F0: this class is always climbed
    }
  });

  test("a lip with NO wall nearby is silent (the conjunction is real)", () => {
    const s = room();
    spanZ(s, 8, 8, AIR_LO, AIR_LO);
    expect(kindsOf(analyzeChunk(s, CENTER, AGENT))).not.toContain(
      "lip-near-wall",
    );
  });

  test("a 0.5 m rise flags ledge, info inside the climb ceiling", () => {
    const s = room();
    spanZ(s, 9, ROOM_MAX - 1, AIR_LO, 2); // 2 cells = 0.5 m, in (0.4, 0.7]
    const flags = analyzeChunk(s, CENTER, AGENT);
    expect(kindsOf(flags)).toContain("ledge");
    for (const f of only(flags, "ledge")) {
      expect(f.cell[0]).toBe(8);
      expect(f.severity).toBe("info");
    }
  });

  test("a 1.0 m rise flags ledge as a candidate (past the climb ceiling)", () => {
    const s = room();
    spanZ(s, 9, ROOM_MAX - 1, AIR_LO, 4); // 4 cells = 1.0 m > climbCeiling 0.7
    const ledges = only(analyzeChunk(s, CENTER, AGENT), "ledge");
    expect(ledges.length).toBeGreaterThan(0);
    for (const f of ledges) expect(f.severity).toBe("candidate");
  });

  test("a rise FAR above step height still flags ledge (the blind spot)", () => {
    // The F0 regression: the rise scan once stopped at `stepCells + 2`, so a
    // rise TALLER than that — strictly HARDER for the mover, which stalls dead
    // at a 1.0 m or 1.5 m rim — matched nothing and emitted NO flag. A false
    // negative, the one class this pass exists to catch.
    const s = room();
    spanZ(s, 9, ROOM_MAX - 1, AIR_LO, 6); // 6 cells = 1.5 m
    const ledges = only(analyzeChunk(s, CENTER, AGENT), "ledge");
    expect(ledges.length).toBeGreaterThan(0);
    for (const f of ledges) {
      expect(f.cell[0]).toBe(8); // the LOW cell, where the mover stands
      expect(f.severity).toBe("candidate");
    }
  });

  test("a plateau far above the floor still flags ledge in a TALL cavern", () => {
    // The other side of the ceiling bound, and the case that caught a shipped
    // regression: a "safety" cap on the ceiling SEARCH is the stepCells+2
    // mistake wearing a bigger number. Capping at 4 clearances (32 cells =
    // 8.00 m) flagged a 7.75 m rise and silently lost this one — a hard
    // false-negative cliff at exactly the cap. The plateau below stands in the
    // SAME air volume as the mover, so it is a genuine, mover-relevant rise, and
    // the only correct bound is the real ceiling.
    const s = createFieldStore(DEFAULT_CELL_SIZE);
    airBox(s, TALL_MIN, TALL_MAX, AIR_LO, TALL_CEILING - 1, TALL_MIN, TALL_MAX);
    solidBox(s, 9, TALL_MAX, AIR_LO, PLATEAU_TOP, TALL_MIN, TALL_MAX);
    const ledges = only(analyzeChunk(s, CENTER, AGENT), "ledge");
    expect(ledges.length).toBeGreaterThan(0);
    for (const f of ledges) {
      expect(f.cell[0]).toBe(8);
      expect(f.severity).toBe("candidate");
    }
  });

  test("a HOLLOW wall top is not a ledge — the scan stops at our ceiling", () => {
    // The other half of the fix, and why the bound is our CEILING and not
    // "uncapped". Collider derivation is shell-only: rock whose neighbours are
    // all rock is dropped, so a real wall is HOLLOW — solid where it borders the
    // air volume, nothing above. An uncapped scan reads that top as reachable
    // floor 3 m up and flags a ledge on every wall-adjacent cell in the map.
    const s = room();
    spanZ(s, 9, 9, AIR_LO, AIR_HI - 1); // wall, floor to ceiling
    // Its capping cell is ABSENT — enclosed rock, dropped by the shell pass.
    airBox(s, 9, 9, AIR_HI, AIR_HI, ROOM_MIN, ROOM_MAX - 1);
    // The hollow top IS "solid below, air above" — the shape of a floor surface.
    expect(getDensity(s, 9, AIR_HI - 1, 0)).toBeLessThan(0);
    expect(getDensity(s, 9, AIR_HI, 0)).toBeGreaterThanOrEqual(0);
    // ...but it sits at the ceiling of the volume the mover stands in.
    expect(analyzeChunk(s, CENTER, AGENT)).toEqual([]);
  });

  test("headroom below capsule height flags low-clearance on the neighbour", () => {
    const s = room();
    spanZ(s, 8, 9, 6, 6); // low ceiling: 5 air cells = 1.25 m < 1.8 m
    const flags = analyzeChunk(s, CENTER, AGENT);
    expect(kindsOf(flags)).toContain("low-clearance");
    for (const f of only(flags, "low-clearance")) {
      // Anchored on the OFFENDING cell, which is not itself walkable.
      expect([8, 9]).toContain(f.cell[0]);
      expect(f.cell[1]).toBe(FLOOR);
      expect(f.severity).toBe("candidate");
    }
  });

  // ─── narrow: a sub-cell opposing pinch, measured in metres ───
  // The bar is the free width between the near faces of the nearest solid EITHER
  // SIDE of the anchor on one XZ axis, against `2 * radius + skin` — 0.68 m for
  // AGENT. Nothing here is rounded to cells: the cases below straddle that bar
  // between lattice widths, and each names the width it builds.

  test("a 0.25 m lane — one cell either side — is pinched", () => {
    const flags = analyzeChunk(lane(1, 1), CENTER, AGENT);
    const narrow = only(flags, "narrow");
    expect(narrow.length).toBeGreaterThan(0);
    for (const f of narrow) {
      expect(f.cell[0]).toBe(LANE_X); // the lane, not the open floor beyond a wall
      expect(f.severity).toBe("candidate");
    }
  });

  test("a 0.50 m lane — one cell one side, two the other — is pinched", () => {
    // Asymmetric on purpose: the two sides are measured independently and summed,
    // so 0.125 + 0.375 must read the same as any other pair totalling 0.50 m.
    const narrow = only(analyzeChunk(lane(1, 2), CENTER, AGENT), "narrow");
    expect(narrow.length).toBeGreaterThan(0);
    for (const f of narrow)
      expect([LANE_X, LANE_X + 1]).toContain(at(f.cell, 0));
  });

  test("a 0.50 m slot between two SLABS still pinches — thickness is irrelevant", () => {
    // The F0 `slab-pinch` fixture's own shape: two full-height slabs three cells
    // thick with a 0.50 m slot between them. Only the NEAREST solid each way can
    // matter, so a slab reads exactly as a one-cell wall does.
    const s = room();
    spanZ(s, 4, 6, AIR_LO, AIR_HI - 1);
    spanZ(s, 9, 11, AIR_LO, AIR_HI - 1); // slot at x = 7, 8
    const narrow = only(analyzeChunk(s, CENTER, AGENT), "narrow");
    expect(narrow.length).toBeGreaterThan(0);
    for (const f of narrow) {
      expect([7, 8]).toContain(at(f.cell, 0));
      expect(f.severity).toBe("candidate");
    }
  });

  test("a 0.75 m lane is NOT pinched — the two-cell probe was a rounding artifact", () => {
    // `ceil(0.3 / 0.25)` is 2 cells = 0.50 m of reach for a 0.30 m radius, so the
    // old side-counting probe called this lane pinched. It is 0.75 m of free
    // width for a capsule that needs 0.68 — the mover walks it.
    const s = lane(2, 2);
    expect(only(analyzeChunk(s, CENTER, AGENT), "narrow")).toEqual([]);
    // Vacuity: the SAME geometry pinches a capsule that genuinely needs the
    // width (WIDE's bar is 2·0.55 + 0.08 = 1.18 m), so the quiet above is a
    // measurement rather than a blind spot.
    expect(
      only(analyzeChunk(s, CENTER, WIDE), "narrow").length,
    ).toBeGreaterThan(0);
  });

  test("the nearest solid wins, so an intermediate wall is never stepped over", () => {
    // WIDE reaches 5 cells (ceil(1.18 / 0.25)); the walls sit at offset 2. A
    // probe that read only the cell at its reach would find air there and miss
    // both walls — the donor probe's "scan every offset" rule, kept as
    // "first hit outward wins", which also fixes the pinch's measured width.
    const narrow = only(analyzeChunk(lane(2, 2), CENTER, WIDE), "narrow");
    // Exactly the three air cells of the lane: 0.75 m of width at x = 8, and
    // 0.125 + 0.625 = 0.75 m at each shoulder.
    const lanes = [...new Set(narrow.map((f) => f.cell[0]))];
    expect(lanes.sort((a, b) => a - b)).toEqual([7, 8, 9]);
  });

  test("the pinch bar is metres, not cells — `skin` moves it on its own", () => {
    // SNUG rounds to the SAME wallCellsXZ as AGENT (ceil(0.35 / 0.25) === 2), so
    // no cell-quantized probe could tell these two capsules apart on this lane.
    const s = lane(2, 2); // 0.75 m of free width
    const SNUG: AgentProfile = {
      ...AGENT,
      capsule: { radius: 0.35, halfHeight: 0.6 },
      clearance: 1.9,
    };
    // 2·0.35 + 0.08 = 0.78 > 0.75 → pinched…
    expect(
      only(analyzeChunk(s, CENTER, SNUG), "narrow").length,
    ).toBeGreaterThan(0);
    // …and the same capsule with a thinner contact margin clears it:
    // 2·0.35 + 0.01 = 0.71 < 0.75.
    expect(
      only(analyzeChunk(s, CENTER, { ...SNUG, skin: 0.01 }), "narrow"),
    ).toEqual([]);
  });

  test("perpendicular walls never pinch — a corner is not a lane", () => {
    // The refutation fix (P-F4-3): the old probe counted the four cardinals
    // INDEPENDENTLY and flagged at two, so an inside corner — walls on +X and
    // +Z, open on -X and -Z — read as a pinch. Nothing is pinched there; the
    // capsule walks out along either open axis.
    const s = room();
    spanZ(s, 9, 9, AIR_LO, AIR_HI - 1); // wall to the +X
    solidBox(s, ROOM_MIN, ROOM_MAX - 1, AIR_LO, AIR_HI - 1, 9, 9); // to the +Z
    expect(only(analyzeChunk(s, CENTER, AGENT), "narrow")).toEqual([]);
    // Vacuity: give the +X wall an OPPOSING partner and the same fixture pinches.
    spanZ(s, 7, 7, AIR_LO, AIR_HI - 1);
    const narrow = only(analyzeChunk(s, CENTER, AGENT), "narrow");
    expect(narrow.length).toBeGreaterThan(0);
    for (const f of narrow) expect(f.cell[0]).toBe(LANE_X);
  });

  test("a cell with rises on two sides emits one flag, not one per direction", () => {
    const s = room();
    spanZ(s, 7, 7, AIR_LO, 2);
    spanZ(s, 9, 9, AIR_LO, 2); // pillars either side of x = 8
    const flags = analyzeChunk(s, CENTER, AGENT);
    expect(kindsOf(flags)).toContain("ledge");
    const keys = flags.map((f) => `${f.kind}@${f.cell.join(",")}`);
    expect(keys.length).toBe(new Set(keys).size);
    expect(keys.filter((k) => k === `ledge@8,${FLOOR},0`).length).toBe(1);
  });

  test("a flag carries its owner chunk and the floor-surface world position", () => {
    const s = room();
    spanZ(s, 9, ROOM_MAX - 1, AIR_LO, 2);
    const flags = analyzeChunk(s, CENTER, AGENT);
    const f = expectDefined(
      flags.find((g) => g.cell[0] === 8 && g.cell[2] === 0),
      "flag at x=8,z=0",
    );
    expect(f.chunk).toBe(CENTER);
    // Cell XZ centre; Y = the cell's BOTTOM face = the top of the rock below.
    expect(f.world).toEqual([8.5 * 0.25, FLOOR * 0.25, 0.5 * 0.25]);
    expect(f.unreachable).toBeUndefined();
  });

  test("the owner chunk is the ANALYSED chunk, even when the anchor cell is not in it", () => {
    // low-clearance anchors on the offending neighbour, which at a chunk border
    // lives in the next chunk over. Replacement is per OWNER, so the flag must
    // be owned by the chunk whose pass found it.
    const s = room();
    spanZ(s, CHUNK_DIM, CHUNK_DIM, 6, 6); // low ceiling over x = 16 only
    const lows = only(analyzeChunk(s, CENTER, AGENT), "low-clearance");
    expect(lows.length).toBeGreaterThan(0);
    for (const f of lows) {
      expect(f.cell[0]).toBe(CHUNK_DIM); // in chunk (1,0,0)
      expect(f.chunk).toBe(CENTER); // owned by the chunk we analysed
    }
  });

  test("unallocated chunks read as solid rock", () => {
    // getDensity's own rule (missing chunk = SOLID), which is also what the
    // runtime collider derives from — so a lane carved to a chunk's own border is
    // walled by the neighbouring chunk that was never written. The lane is two
    // cells (0.50 m) wide, so its -X wall is that unallocated chunk: read it as
    // air and the lane has one side only, which cannot pinch.
    const s = createFieldStore(DEFAULT_CELL_SIZE);
    airBox(s, 0, 1, AIR_LO, AIR_HI - 1, 0, CHUNK_DIM - 1);
    const narrow = only(analyzeChunk(s, CENTER, AGENT), "narrow");
    expect(narrow.length).toBeGreaterThan(0);
    for (const f of narrow) expect([0, 1]).toContain(at(f.cell, 0));
    // The open room, by contrast, is quiet: reading the rim as rock no longer
    // grows a fringe of `narrow` at the region's edge, because a rim corner
    // pinches nothing — the opposite side of both axes is 4 m of open floor.
    const walled = createFieldStore(DEFAULT_CELL_SIZE);
    airBox(walled, 0, CHUNK_DIM - 1, AIR_LO, AIR_HI - 1, 0, CHUNK_DIM - 1);
    expect(only(analyzeChunk(walled, CENTER, AGENT), "narrow")).toEqual([]);
    // A column open into the unallocated chunk ABOVE still terminates and stays
    // walkable: the scan hits that chunk's rock instead of running away.
    const open = createFieldStore(DEFAULT_CELL_SIZE);
    airBox(open, 0, CHUNK_DIM - 1, AIR_LO, CHUNK_DIM - 1, 0, CHUNK_DIM - 1);
    solidBox(open, 9, CHUNK_DIM - 1, AIR_LO, 4, 0, CHUNK_DIM - 1);
    expect(kindsOf(analyzeChunk(open, CENTER, AGENT))).toContain("ledge");
  });

  test("extraSolid contributes solidity exactly like field rock", () => {
    // Task 3 fills this from voxelized placement colliders; the contract is the
    // per-chunk byte array in localIndex order.
    const s = room();
    const bits = new Uint8Array(CHUNK_SAMPLES);
    for (let z = 0; z < CHUNK_DIM; z++)
      for (let y = AIR_LO; y < AIR_HI; y++)
        for (const x of [7, 9]) bits[x + CHUNK_DIM * (y + CHUNK_DIM * z)] = 1;
    expect(analyzeChunk(s, CENTER, AGENT)).toEqual([]);
    const narrow = only(
      analyzeChunk(s, CENTER, AGENT, {
        extraSolid: new Map([[CENTER, bits]]),
      }),
      "narrow",
    );
    expect(narrow.length).toBeGreaterThan(0);
    for (const f of narrow) expect(f.cell[0]).toBe(8);
  });

  test("rejects a wrongly-encoded extraSolid buffer (setup-loud)", () => {
    // A PACKED bitset is the plausible wrong encoding — and the dangerous one:
    // it reads without error and yields a partial subset of the true flags
    // (measured 14 where the byte-per-cell buffer gives 16), so a producer that
    // guessed wrong would ship silent false negatives. Length is the only tell.
    const s = room();
    const packed = new Uint8Array(CHUNK_SAMPLES / 8);
    expect(() =>
      analyzeChunk(s, CENTER, AGENT, {
        extraSolid: new Map([[CENTER, packed]]),
      }),
    ).toThrow(/one BYTE per sample/);
    // The check covers every buffer in the map, not just the analysed chunk's:
    // neighbour reads cross borders, so a bad neighbour buffer is read too.
    expect(() =>
      analyzeChunk(s, CENTER, AGENT, {
        extraSolid: new Map([[chunkKey(1, 0, 0), packed]]),
      }),
    ).toThrow(/one BYTE per sample/);
  });

  test("an unallocated chunk analyses to no flags", () => {
    expect(analyzeChunk(room(), chunkKey(9, 9, 9), AGENT)).toEqual([]);
  });

  test("rejects an invalid agent profile (setup-loud)", () => {
    const s = room();
    const run = (p: AgentProfile) => () => analyzeChunk(s, CENTER, p);
    expect(run({ ...AGENT, capsule: { radius: 0, halfHeight: 0.6 } })).toThrow(
      /positive finite/,
    );
    expect(run({ ...AGENT, stepHeight: Number.NaN })).toThrow(
      /positive finite/,
    );
    expect(run({ ...AGENT, climbCeiling: AGENT.stepHeight })).toThrow(
      /climbCeiling/,
    );
    expect(run({ ...AGENT, clearance: 1.0 })).toThrow(/clearance/);
    expect(run({ ...AGENT, skin: 0 })).toThrow(/positive finite/);
    // A contact margin at or above the radius would put the pinch bar past three
    // radii, flagging lanes the capsule strolls through.
    expect(run({ ...AGENT, skin: AGENT.capsule.radius })).toThrow(/skin/);
    // The exact-capsule clearance is legal (float tolerance, not a strict >).
    expect(run({ ...AGENT, clearance: 2 * (0.6 + 0.3) })).not.toThrow();
  });
});

describe("analyzeWorld", () => {
  test("returns one entry per allocated chunk, matching the per-chunk pass", () => {
    const s = room();
    spanZ(s, 9, ROOM_MAX - 1, AIR_LO, 4);
    const world = analyzeWorld(s, AGENT);
    expect([...world.keys()].sort()).toEqual([...s.chunks.keys()].sort());
    expect(world.get(CENTER)).toEqual(analyzeChunk(s, CENTER, AGENT));
    const total = [...world.values()].reduce((n, f) => n + f.length, 0);
    expect(total).toBeGreaterThan(expectDefined(world.get(CENTER)).length);
  });

  test("an allocated chunk with no floor anchors maps to an empty array", () => {
    const s = createFieldStore(DEFAULT_CELL_SIZE);
    // One air cell, floating: no solid-below anchor anywhere in the chunk.
    setDensity(s, 4, 4, 4, AIR);
    expect(analyzeWorld(s, AGENT).get(CENTER)).toEqual([]);
  });
});

// ─── Placement colliders as analyzed solidity (D-F4-5) ───

const placed = (position: [number, number, number]): PlacementRecord => ({
  archetypeId: "prop",
  position,
  quat: [0, 0, 0, 1],
  scale: [1, 1, 1],
  variantIndex: 0,
});

/** World centre of cell (x, z) at the room's floor SURFACE — where a
 *  base-anchored prop's bottom sits. */
const onFloor = (x: number, z: number): [number, number, number] => [
  (x + 0.5) * DEFAULT_CELL_SIZE,
  FLOOR * DEFAULT_CELL_SIZE,
  (z + 0.5) * DEFAULT_CELL_SIZE,
];

describe("voxelizePlacements feeding analyzeChunk", () => {
  // The producer/consumer pair of the extraSolid contract. The encoding test
  // above proves the analyzer READS byte-per-sample; these prove the rasterizer
  // WRITES it, end to end — the seam where a packed producer would have shipped
  // a plausible flag subset instead of an error.
  const PROP: PlacementCollision = {
    kind: "box",
    halfExtents: [0.3, 0.5, 0.3],
    anchor: "base",
  };
  const PEBBLE: PlacementCollision = {
    kind: "box",
    halfExtents: [0.3, 0.1, 0.3],
    anchor: "base",
  };

  test("a prop taller than the climb ceiling makes its neighbours flag ledge", () => {
    const s = room();
    expect(analyzeChunk(s, CENTER, AGENT)).toEqual([]);
    const extraSolid = voxelizePlacements(
      [{ collision: PROP, records: [placed(onFloor(8, 0))] }],
      s.cellSize,
    );
    const ledges = only(
      analyzeChunk(s, CENTER, AGENT, { extraSolid }),
      "ledge",
    );
    expect(ledges.length).toBeGreaterThan(0);
    for (const f of ledges) expect(f.severity).toBe("candidate");
    // 1.0 m of collider standing on the floor, so the columns beside it read a
    // rise past the climb ceiling — exactly as field rock of the same shape does.
    expect(
      ledges.some(
        (f) => f.cell[0] === 6 && f.cell[1] === FLOOR && f.cell[2] === 0,
      ),
    ).toBe(true);
  });

  test("two props either side of a one-cell lane make it flag narrow", () => {
    const s = room();
    const extraSolid = voxelizePlacements(
      [
        {
          collision: PROP,
          records: [placed(onFloor(6, 0)), placed(onFloor(10, 0))],
        },
      ],
      s.cellSize,
    );
    const narrow = only(
      analyzeChunk(s, CENTER, AGENT, { extraSolid }),
      "narrow",
    );
    expect(narrow.length).toBeGreaterThan(0);
    for (const f of narrow) expect(f.cell[0]).toBe(8);
  });

  test("a sub-step pebble changes nothing", () => {
    const s = room();
    const extraSolid = voxelizePlacements(
      [{ collision: PEBBLE, records: [placed(onFloor(8, 0))] }],
      s.cellSize,
    );
    expect(analyzeChunk(s, CENTER, AGENT, { extraSolid })).toEqual([]);
  });
});

// ─── Reachability fixtures (D-F4-8) ───

// A hall tall enough to stand a shelf 3.5 m up and still leave the capsule its
// full 1.8 m of headroom on top of it. Kept to ~24 cells in XZ (one chunk plus
// a margin) to bound fixture cost.
const HALL_MIN = -4;
const HALL_MAX = CHUNK_DIM + 3; // 19, inclusive
const HALL_TOP = 32; // inclusive top air layer

function hall(): FieldStore {
  const s = createFieldStore(DEFAULT_CELL_SIZE);
  airBox(s, HALL_MIN, HALL_MAX, AIR_LO, HALL_TOP, HALL_MIN, HALL_MAX);
  return s;
}

/** A feature spanning the hall's full Z extent. */
const spanHall = (
  s: FieldStore,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): void => solidBox(s, x0, x1, y0, y1, HALL_MIN, HALL_MAX);

/** The shelf's own floor level: the air cell above the floating slab's top. */
const SHELF = 15;

/** A slab floating 3.25 m over the only floor, with a 1.0 m block on top of it
 *  so its surface HAS flags to demote, and a matching block on the main floor so
 *  the reachable side has flags too. Nothing connects the two levels. */
function floatingShelfHall(): FieldStore {
  const s = hall();
  spanHall(s, 4, 10, 13, 14); // the slab: top at y = 14, surface at y = 15
  spanHall(s, 8, 10, SHELF, 18); // 1.0 m block ON the shelf
  solidBox(s, -3, -1, AIR_LO, 4, 0, 4); // 1.0 m block on the main floor
  return s;
}

/** The same hall, made traversable: a 0.5 m staircase up to the shelf and a
 *  0.5 m pit down from the floor. Every flag in here is reachable — the fixture
 *  is deliberately sensitive to a BFS that lost either sign of the climb. */
function stairHall(): FieldStore {
  const s = hall();
  airBox(s, -3, -1, -1, 0, -3, -1); // a 2-cell (0.5 m) pit: surface at y = -1
  spanHall(s, 4, 5, AIR_LO, 2); // step 1 → surface y = 3
  spanHall(s, 6, 7, AIR_LO, 4); // step 2 → surface y = 5
  spanHall(s, 8, HALL_MAX, AIR_LO, 6); // the shelf → surface y = 7
  solidBox(s, 12, 14, 7, 10, 0, 4); // 1.0 m block on the shelf
  return s;
}

/** World position of the floor surface at cell (x, z), one cell up — a spawn
 *  point as an author would write it (standing ON the floor, not inside it). */
const standingAt = (
  x: number,
  y: number,
  z: number,
): [number, number, number] => [
  (x + 0.5) * DEFAULT_CELL_SIZE,
  (y + 0.5) * DEFAULT_CELL_SIZE,
  (z + 0.5) * DEFAULT_CELL_SIZE,
];

const flatten = (flags: ReadonlyMap<ChunkKey, FieldFlag[]>): FieldFlag[] =>
  [...flags.values()].flat();

const identity = (f: FieldFlag): string =>
  `${f.kind}/${f.severity}/${f.cell.join(",")}/${f.world.join(",")}/${f.chunk}`;

describe("markUnreachable", () => {
  test("demotes flags on a shelf no climb can reach", () => {
    const s = floatingShelfHall();
    const flags = analyzeWorld(s, AGENT);
    markUnreachable(s, AGENT, flags, [standingAt(0, FLOOR, 0)]);
    const all = flatten(flags);
    const shelf = all.filter((f) => f.cell[1] === SHELF);
    const ground = all.filter((f) => f.cell[1] === FLOOR);
    expect(shelf.length).toBeGreaterThan(0);
    expect(ground.length).toBeGreaterThan(0);
    for (const f of shelf) expect(f.unreachable).toBe(true);
    for (const f of ground) expect(f.unreachable).toBe(false);
    // The demoted set is EXACTLY the shelf — nothing else drifted out of reach.
    expect(all.filter((f) => f.unreachable === true).length).toBe(shelf.length);
  });

  test("a shelf reached by 0.5 m climbs — and a 0.5 m drop — stays reachable", () => {
    // Sensitive by construction to a BFS that lost the climb: an up-only flood
    // strands the pit, a down-only flood strands the stairs, and a flood pinned
    // to Δy = 0 strands both.
    const s = stairHall();
    const flags = analyzeWorld(s, AGENT);
    markUnreachable(s, AGENT, flags, [standingAt(0, FLOOR, 0)]);
    const all = flatten(flags);
    expect(all.length).toBeGreaterThan(0);
    const levels = new Set(all.map((f) => f.cell[1]));
    for (const y of [-1, FLOOR, 3, 5, 7]) expect(levels.has(y)).toBe(true);
    for (const f of all) expect(f.unreachable).toBe(false);
  });

  test("demotes, never deletes: the flag set is identical either side of the pass", () => {
    const s = floatingShelfHall();
    const flags = analyzeWorld(s, AGENT);
    const before = flatten(flags).map(identity);
    markUnreachable(s, AGENT, flags, [standingAt(0, FLOOR, 0)]);
    const after = flatten(flags).map(identity);
    expect(after).toEqual(before);
    expect([...flags.keys()]).toEqual([...analyzeWorld(s, AGENT).keys()]);
  });

  test("no seeds means no pass at all — every flag keeps an unset verdict", () => {
    const s = floatingShelfHall();
    const flags = analyzeWorld(s, AGENT);
    markUnreachable(s, AGENT, flags, []);
    for (const f of flatten(flags)) expect(f.unreachable).toBeUndefined();
  });

  test("a seed in mid-air falls to the floor below it", () => {
    const s = floatingShelfHall();
    const airborne = analyzeWorld(s, AGENT);
    markUnreachable(s, AGENT, airborne, [standingAt(0, 8, 0)]);
    const grounded = analyzeWorld(s, AGENT);
    markUnreachable(s, AGENT, grounded, [standingAt(0, FLOOR, 0)]);
    expect(flatten(airborne).map((f) => f.unreachable)).toEqual(
      flatten(grounded).map((f) => f.unreachable),
    );
    expect(flatten(airborne).some((f) => f.unreachable === true)).toBe(true);
  });

  test("a buried seed is unusable, and no usable seed means no demotions", () => {
    const s = floatingShelfHall();
    const flags = analyzeWorld(s, AGENT);
    // Deep under the hall's rock floor: solid, so nothing can stand there.
    expect(() =>
      markUnreachable(s, AGENT, flags, [[0.125, -5, 0.125]]),
    ).not.toThrow();
    for (const f of flatten(flags)) expect(f.unreachable).toBeUndefined();
  });

  test("ONE buried seed among usable ones is dropped, not a veto", () => {
    // The skip is for a seed list with NOTHING usable in it. Making it
    // all-or-nothing instead would be a trap of the worst kind: a single stale
    // spawn point would demote the entire world, and the demotions would look
    // like real findings.
    const s = floatingShelfHall();
    const ground = standingAt(0, FLOOR, 0);
    const mixed = analyzeWorld(s, AGENT);
    markUnreachable(s, AGENT, mixed, [[0.125, -5, 0.125], ground]);
    const clean = analyzeWorld(s, AGENT);
    markUnreachable(s, AGENT, clean, [ground]);
    // The pass ran, demoted, and the dead seed contributed exactly nothing.
    expect(flatten(mixed).some((f) => f.unreachable === true)).toBe(true);
    expect(flatten(mixed).map((f) => f.unreachable)).toEqual(
      flatten(clean).map((f) => f.unreachable),
    );
  });

  test("extraSolid participates: a prop sealing the seed cell unseats the seed", () => {
    const s = floatingShelfHall();
    const flags = analyzeWorld(s, AGENT);
    const bits = new Uint8Array(CHUNK_SAMPLES);
    // Fill the whole column above the seed cell, so falling finds no surface.
    for (let y = 0; y < CHUNK_DIM; y++) bits[CHUNK_DIM * y] = 1;
    markUnreachable(s, AGENT, flags, [standingAt(0, FLOOR, 0)], {
      extraSolid: new Map([[CENTER, bits]]),
    });
    for (const f of flatten(flags)) expect(f.unreachable).toBeUndefined();
  });

  test("a second seed ON the shelf clears the demotion (the pass is re-runnable)", () => {
    const s = floatingShelfHall();
    const flags = analyzeWorld(s, AGENT);
    const ground = standingAt(0, FLOOR, 0);
    markUnreachable(s, AGENT, flags, [ground]);
    expect(flatten(flags).some((f) => f.unreachable === true)).toBe(true);
    markUnreachable(s, AGENT, flags, [ground, standingAt(5, SHELF, 0)]);
    for (const f of flatten(flags)) expect(f.unreachable).toBe(false);
  });

  test("rejects an invalid agent profile and a wrongly-encoded extraSolid", () => {
    const s = floatingShelfHall();
    const flags = analyzeWorld(s, AGENT);
    const seeds: [number, number, number][] = [standingAt(0, FLOOR, 0)];
    expect(() =>
      markUnreachable(s, { ...AGENT, clearance: 1.0 }, flags, seeds),
    ).toThrow(/clearance/);
    expect(() =>
      markUnreachable(s, AGENT, flags, seeds, {
        extraSolid: new Map([[CENTER, new Uint8Array(CHUNK_SAMPLES / 8)]]),
      }),
    ).toThrow(/one BYTE per sample/);
  });
});
