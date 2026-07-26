// Stage-1 walkability column pass (F4, D-F4-3/5/6/7). Ported from the F0
// throwaway probe `packages/dungeon/scripts/analyzer-probe/column-pass.ts` and
// its suite: every case there is rebuilt here on a `FieldStore` (global voxel
// coords, one lattice), plus the severity bands and the FieldStore-only
// semantics the probe's bounded grid had no equivalent for (unallocated =
// rock, per-chunk anchors, extra solidity).
import { describe, expect, test } from "bun:test";
import type { AgentProfile, ChunkKey, FieldFlag } from "@furnace/core/field";
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
  SOLID,
  setDensity,
} from "@furnace/core/field";
import { at, expectDefined } from "./_helpers/expect.ts";

/** The dungeon's capsule (`packages/dungeon/catalog/agent.json`), copied — core
 *  tests must not import a consumer package. At the 0.25 m default cell size
 *  this derives: clearCells 8, stepCells 1, climbCells 2, wallCellsXZ 2. */
const AGENT: AgentProfile = {
  capsule: { radius: 0.3, halfHeight: 0.6 },
  stepHeight: 0.4,
  climbCeiling: 0.7,
  clearance: 1.8,
  slopeLimitDeg: 55,
};

/** A deliberately fat capsule: wallCellsXZ = ceil(0.55 / 0.25) = 3, so a wall at
 *  offset 2 is INTERMEDIATE — the case the "probe every offset" rule exists for. */
const WIDE: AgentProfile = {
  capsule: { radius: 0.55, halfHeight: 0.6 },
  stepHeight: 0.4,
  climbCeiling: 0.7,
  clearance: 2.3,
  slopeLimitDeg: 55,
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

/** A feature spanning the room's full Z extent, as the donor's fixtures did. */
const spanZ = (
  s: FieldStore,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): void => solidBox(s, x0, x1, y0, y1, ROOM_MIN, ROOM_MAX - 1);

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

  test("a lane narrower than the capsule flags narrow", () => {
    const s = room();
    spanZ(s, 7, 7, AIR_LO, AIR_HI - 1);
    spanZ(s, 9, 9, AIR_LO, AIR_HI - 1); // one-cell lane at x = 8
    const flags = analyzeChunk(s, CENTER, AGENT);
    const narrow = only(flags, "narrow");
    expect(narrow.length).toBeGreaterThan(0);
    for (const f of narrow) {
      expect(f.cell[0]).toBe(8); // the lane, not the open floor beyond a wall
      expect(f.severity).toBe("candidate");
    }
    // Regression: wallCellsXZ is 2 here, so probing ONLY the far cell (offset 2)
    // would read air either side and miss both walls.
    expect(kindsOf(flags)).toContain("narrow");
  });

  test("narrow probes every offset out to the capsule radius, not just the far cell", () => {
    // WIDE's wallCellsXZ is 3; the walls sit at offset 2. A far-cell-only probe
    // reads air at offset 3 and under-flags — the one failure mode this rule
    // exists to rule out.
    const s = room();
    spanZ(s, 6, 6, AIR_LO, AIR_HI - 1);
    spanZ(s, 10, 10, AIR_LO, AIR_HI - 1);
    const narrow = only(analyzeChunk(s, CENTER, WIDE), "narrow");
    expect(narrow.length).toBeGreaterThan(0);
    expect(narrow.some((f) => f.cell[0] === 8)).toBe(true);
    for (const f of narrow) {
      expect(f.cell[0]).toBeGreaterThanOrEqual(7);
      expect(f.cell[0]).toBeLessThanOrEqual(9);
    }
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
    // runtime collider derives from — so a room carved exactly to a chunk border
    // is walled by rock, and its corners pinch the capsule.
    const s = createFieldStore(DEFAULT_CELL_SIZE);
    airBox(s, 0, CHUNK_DIM - 1, AIR_LO, AIR_HI - 1, 0, CHUNK_DIM - 1);
    const narrow = only(analyzeChunk(s, CENTER, AGENT), "narrow");
    expect(narrow.length).toBeGreaterThan(0);
    // Only the four corners pinch on two sides; a cell along one wall does not.
    const inCorner = (v: number): boolean => v <= 1 || v >= CHUNK_DIM - 2;
    for (const f of narrow) {
      expect(inCorner(at(f.cell, 0))).toBe(true);
      expect(inCorner(at(f.cell, 2))).toBe(true);
    }
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
