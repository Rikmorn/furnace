import { describe, expect, test } from "bun:test";
import type {
  BrushOp,
  FieldStore,
  GeneratorDef,
  GeneratorResult,
  MaterialTable,
  PlacementRecord,
} from "@furnace/core/field";
import {
  applyOp,
  assertOpValid,
  assertPlacementsValid,
  BUILTIN_TABLE,
  commitGenerator,
  createFieldStore,
  createOpLog,
  encodeChunkFile,
  encodeMaterialFile,
  FIELD_GENERATORS,
  generatorById,
  getDensity,
  getMaterial,
  logApply,
  redo,
  undo,
} from "@furnace/core/field";

const TABLE: MaterialTable = {
  classes: [
    { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
    { id: 1, name: "dirt", kind: "organic", color: [0.4, 0.3, 0.2, 1] },
    {
      id: 2,
      name: "masonry",
      kind: "kit",
      color: [0.5, 0.5, 0.5, 1],
      kit: {
        panelProud: 0.06,
        panelReveal: 0.02,
        collarSection: 0.14,
        backingColor: [0.4, 0.4, 0.4, 1],
        pieceColors: {
          panel: [0.55, 0.53, 0.5, 1],
          floor: [0.42, 0.4, 0.38, 1],
          trim: [0.35, 0.33, 0.3, 1],
          collar: [0.3, 0.28, 0.26, 1],
        },
      },
    },
  ],
};
const KIT_CLASS_ID = 2;
/** The generators' coarse cell size in metres (generators.ts CELL) — the unit
 *  every mini-grid index in these tests is expressed in. */
const CELL_M = 0.5;

/** Narrows a {@link GeneratorResult}'s widened `(BrushOp | PatchOp)[]` ops to
 *  the `BrushOp[]` these hall/maze assertions read. Both generators emit ONLY
 *  brush ops today; a patch op here is a real regression, so this THROWS rather
 *  than casts. */
function brushOps(result: GeneratorResult): BrushOp[] {
  return result.ops.map((op) => {
    if (op.kind !== "brush")
      throw new Error(`expected only brush ops, got "${op.kind}"`);
    return op;
  });
}

const REGION = {
  min: [2, 0, 2] as [number, number, number],
  max: [10, 6, 10] as [number, number, number],
};
const HALL_PARAMS = {
  width: 8,
  height: 6,
  depth: 8,
  pillars: "none",
  pillarSpacing: 3,
  doorNorth: true,
  doorSouth: false,
  doorEast: false,
  doorWest: false,
};

// Literal derivations at cellSize 0.25 (sample = metres × 4), CELL 0.5 m.
// Origin = snapDown(REGION.min) = [2,0,2]. Hall 8×6×8 → mini-grid dims
// [10,8,10] → stamp AABB [2,0,2]..[7,4,7] m (shell fill box center [4.5,2,4.5],
// halfExtents [2.5,2,2.5] — lattice-true). Interior air x,z ∈ (2.5,6.5) m,
// y ∈ (0.5,3.5) m. Row digs write air sdf·32; the +1-sample margin ring writes
// small NEGATIVE densities (sdf −0.25 m → −8) one ring beyond — still solid.
// Virgin rock is SOLID −127, so the shell fill's own nd (−8 near its faces)
// never lowers density; the shell's "solid" reading comes from rock + the dig
// margin (−8), and its MASONRY reading from fill's material write (sdf > 0).
// North door (auto-centred): interiorLen 8 → lo 3 → cells i ∈ [3,6] →
// x ∈ (3.5,5.5) m on shell row k=9 (z mid-sample 27 = 6.75 m).
describe("field generators — the hall", () => {
  test("registry: hall is registered; unknown ids throw setup-loud", () => {
    expect(FIELD_GENERATORS.some((g) => g.id === "hall")).toBe(true);
    expect(generatorById("hall").name).toBe("Hall");
    expect(() => generatorById("nope")).toThrow(/unknown field generator/);
  });

  test("hall evaluates to a fill shell + air digs + a doorway, all lattice-valid", () => {
    const hall = generatorById("hall");
    const ops = brushOps(
      hall.evaluate(HALL_PARAMS, 7, REGION, TABLE, "replace"),
    );
    expect(ops.length).toBeGreaterThan(2);
    for (const op of ops) expect(() => assertOpValid(op, TABLE)).not.toThrow();
    const fills = ops.filter((o) => o.effect === "fill");
    expect(fills.length).toBe(1);
    expect(ops[0]).toBe(fills[0]); // the masonry shell leads
    expect(fills[0]?.material).toBe(KIT_CLASS_ID);
    expect(fills[0]?.mask).toBeUndefined(); // replace policy: unmasked shell
    // applying the span produces a hall: interior air, shell solid, doorway air
    const s = createFieldStore();
    for (const op of ops) applyOp(s, { ...op, id: 1 }, TABLE);
    // interior centre (4.5, 2, 4.5) m sits on dig-box corners → sdf 0 → air-ish:
    expect(getDensity(s, 18, 8, 18)).toBeGreaterThanOrEqual(0);
    // strict interior (4.25, 2.25, 4.25) m: mid-cell of a dig row → sdf 0.25 → 8
    expect(getDensity(s, 17, 9, 17)).toBe(8);
    // shell wall (2.25, 1, 4.5) m: solid masonry (density −8 via dig margin)
    expect(getDensity(s, 9, 4, 18)).toBeLessThan(0);
    expect(getMaterial(s, 9, 4, 18)).toBe(KIT_CLASS_ID);
    // the north doorway is open through the shell — air across the door span
    // (samples 15/18/21 = 3.75/4.5/5.25 m at y 2.25 m, shell row z 6.75 m) …
    expect(getDensity(s, 15, 9, 27)).toBeGreaterThan(0);
    expect(getDensity(s, 18, 9, 27)).toBeGreaterThan(0);
    expect(getDensity(s, 21, 9, 27)).toBeGreaterThan(0);
    // … and the shell flanking the door span stays solid — pins the CENTRED
    // door (a ±1-cell shift turns sample 15 or 21 solid and fails above)
    expect(getDensity(s, 13, 9, 27)).toBeLessThan(0);
    expect(getDensity(s, 23, 9, 27)).toBeLessThan(0);
  });

  test("same params + same seed → identical op list (same-input-twice, charter §2.2)", () => {
    const hall = generatorById("hall");
    expect(hall.evaluate(HALL_PARAMS, 7, REGION, TABLE, "replace")).toEqual(
      hall.evaluate(HALL_PARAMS, 7, REGION, TABLE, "replace"),
    );
  });

  test("keep-existing-air masks the shell fill solid-only", () => {
    const hall = generatorById("hall");
    const ops = brushOps(
      hall.evaluate(HALL_PARAMS, 7, REGION, TABLE, "keep-existing-air"),
    );
    expect(ops[0]?.mask).toEqual({ kind: "solid-only" });
  });

  test("a blocked door lane throws setup-loud (validateDoorApproach ported)", () => {
    const hall = generatorById("hall");
    // Donor pillar math: grid pillars at spacing 2 for w=8, d=8 land at
    // i,k ∈ {2,4,6} (interior 1-based). The centred north door's checked lane
    // is the middle 2 lateral cells × 4 deep: i ∈ {4,5} × k ∈ {5,6,7,8} — the
    // pillar at (4, j, 6) sits in the lane, so evaluation must throw.
    const blocked = { ...HALL_PARAMS, pillars: "grid", pillarSpacing: 2 };
    expect(() => hall.evaluate(blocked, 7, REGION, TABLE, "replace")).toThrow(
      /door/,
    );
  });

  test("grid pillars at spacing 3 clear the door lane and stamp solid columns", () => {
    // Pillars at i,k ∈ {3,6} — outside the door lane i ∈ {4,5} × k ∈ {5..8}.
    // Pillar (3,j,3) occupies x,z ∈ (3.5,4) m: mid-sample (15, 9, 15) is solid
    // masonry after apply; the digs split around it.
    const hall = generatorById("hall");
    const ops = brushOps(
      hall.evaluate(
        { ...HALL_PARAMS, pillars: "grid", pillarSpacing: 3 },
        7,
        REGION,
        TABLE,
        "replace",
      ),
    );
    const s = createFieldStore();
    for (const op of ops) applyOp(s, { ...op, id: 1 }, TABLE);
    expect(getDensity(s, 15, 9, 15)).toBeLessThan(0);
    expect(getMaterial(s, 15, 9, 15)).toBe(KIT_CLASS_ID);
    // the interior beside the pillar is still open air
    expect(getDensity(s, 17, 9, 17)).toBeGreaterThan(0);
  });

  test("colonnade pillars flank the central aisle; the aisle stays open", () => {
    // Donor colonnade for w=8: centre = floor(8/2)+1 = 5, rows i ∈ {3,7};
    // spacing 3 → k ∈ {3,6}. Pillar (3,j,3) solid at mid-sample (15,9,15);
    // aisle cell i=5 at k=3 → x 4.75 m, z 3.75 m → samples (19,9,15) open.
    const hall = generatorById("hall");
    const ops = brushOps(
      hall.evaluate(
        { ...HALL_PARAMS, pillars: "colonnade", pillarSpacing: 3 },
        7,
        REGION,
        TABLE,
        "replace",
      ),
    );
    const s = createFieldStore();
    for (const op of ops) applyOp(s, { ...op, id: 1 }, TABLE);
    expect(getDensity(s, 15, 9, 15)).toBeLessThan(0);
    expect(getMaterial(s, 15, 9, 15)).toBe(KIT_CLASS_ID);
    expect(getDensity(s, 19, 9, 15)).toBeGreaterThan(0);
  });

  test("a blocked EAST door lane throws via the alongX=false path", () => {
    // Donor colonnade math for w=8: centre = floor(8/2)+1 = 5 → rows i ∈ {3,7};
    // spacing 2 → k ∈ {2,4,6}. The east door (alongX=false) sits on shell
    // i=9 at lo=3; its checked lane is depth i ∈ {8,7,6,5} × lat k ∈ {4,5} ×
    // j 1..6 — the colonnade pillar at (7, j, 4) is in the lane, so
    // evaluation must throw through the east/west branch of openDoor.
    const hall = generatorById("hall");
    const blocked = {
      ...HALL_PARAMS,
      doorNorth: false,
      doorEast: true,
      pillars: "colonnade",
      pillarSpacing: 2,
    };
    expect(() => hall.evaluate(blocked, 7, REGION, TABLE, "replace")).toThrow(
      /east door/,
    );
  });

  test("a WEST door opens through the west shell (alongX=false carve + lane)", () => {
    // West wall: shell cells i=0 → x ∈ [2, 2.5] m (mid-sample 9 = 2.25 m).
    // lo = 3 → door cells k ∈ [3,6] → z ∈ (3.5, 5.5) m, j 1..6 → y ∈ (0.5,3.5).
    // The door's lateral axis is z, where each dig row is its OWN box, so
    // probes use z CELL MIDS (z = 4.5 m sits on a box boundary → sdf 0):
    // samples 15/17/21 = 3.75/4.25/5.25 m. Each door row merges shell +
    // interior into box(0,j,k,9,1,1) (x ∈ [2, 6.5], center 4.25): sdf at
    // (2.25, 2.25, cell mid) = min(0.25, 0.25, 0.25) → density 8.
    const hall = generatorById("hall");
    const ops = brushOps(
      hall.evaluate(
        { ...HALL_PARAMS, doorNorth: false, doorWest: true },
        7,
        REGION,
        TABLE,
        "replace",
      ),
    );
    const s = createFieldStore();
    for (const op of ops) applyOp(s, { ...op, id: 1 }, TABLE);
    // air through the west shell across the door span …
    expect(getDensity(s, 9, 9, 15)).toBeGreaterThan(0);
    expect(getDensity(s, 9, 9, 17)).toBeGreaterThan(0);
    expect(getDensity(s, 9, 9, 21)).toBeGreaterThan(0);
    // … and the shell flanking the door span (k=2 mid z=3.25 m → sample 13,
    // k=7 mid z=5.75 m → sample 23) stays solid masonry — pins the centring
    expect(getDensity(s, 9, 9, 13)).toBeLessThan(0);
    expect(getDensity(s, 9, 9, 23)).toBeLessThan(0);
    expect(getMaterial(s, 9, 9, 13)).toBe(KIT_CLASS_ID);
    // the north shell has NO door in this config: its former door-centre
    // sample (18, 9, 27) stays solid
    expect(getDensity(s, 18, 9, 27)).toBeLessThan(0);
  });

  test("defaults are schema-derived and evaluate clean", () => {
    const hall = generatorById("hall");
    expect(() =>
      hall.evaluate(hall.defaults, 7, REGION, TABLE, "replace"),
    ).not.toThrow();
  });

  test("stamps require a kit class: the builtin rock-only table throws setup-loud", () => {
    const hall = generatorById("hall");
    expect(() =>
      hall.evaluate(HALL_PARAMS, 7, REGION, BUILTIN_TABLE, "replace"),
    ).toThrow(/kit/);
  });

  test("hallParams validates setup-loud: range, integer, and enum violations throw", () => {
    const hall = generatorById("hall");
    const run = (over: Record<string, unknown>) => () =>
      hall.evaluate({ ...HALL_PARAMS, ...over }, 7, REGION, TABLE, "replace");
    expect(run({ width: 2 })).toThrow(/width.*got 2/); // below minimum 4, value echoed
    expect(run({ width: 40 })).toThrow(/width/); // above schema maximum 24
    expect(run({ height: 4 })).toThrow(/height/); // below door height
    expect(run({ depth: 8.5 })).toThrow(/depth/); // non-integer
    expect(run({ pillars: "spiral" })).toThrow(/pillars/); // unknown enum
    expect(run({ pillarSpacing: 1 })).toThrow(/pillarSpacing/);
    expect(run({ doorNorth: 1 })).toThrow(/doorNorth/); // non-boolean
  });
});

// REGION_MAZE derivation: 3×3 maze cells at PITCH 5 (a 4-cell passage block +
// a 1-cell internal wall band, the donor maze.ts constants) → interior
// w = d = 5·3 − 1 = 14 coarse cells; grid dims = [w+2, 6+2, d+2] = [16,8,16]
// with the shell. At CELL 0.5 m the stamp AABB is 8 × 4 × 8 m from the
// snapped origin — REGION_MAZE spans exactly that.
const REGION_MAZE = {
  min: [0, 0, 0] as [number, number, number],
  max: [8, 4, 8] as [number, number, number],
};
const MAZE_PARAMS = {
  cellsX: 3,
  cellsZ: 3,
  braid: 0.3,
  doorNorth: true,
  doorSouth: false,
  doorEast: false,
  doorWest: false,
};

// Maze sample math at cellSize 0.25 (sample = metres × 4), origin [0,0,0]:
// maze cell (a,b) owns the passage block at coarse i ∈ [1+5a, 4+5a],
// k ∈ [1+5b, 4+5b], j ∈ [1,6]. The block-centre probe is the mid of its
// second coarse cell: x = (2+5a)·0.5 + 0.25 = 1.25 + 2.5a m → sample 5+10a
// (likewise z), y = 1.25 m (j=2 mid) → sample 5.
describe("field generators — the maze", () => {
  test("registry: the maze joins the hall", () => {
    expect(FIELD_GENERATORS.map((g) => g.id)).toEqual(["hall", "maze", "cave"]);
    expect(generatorById("maze").name).toBe("Maze");
  });

  test("maze: same seed → identical ops; different seed → different plan", () => {
    const mz = generatorById("maze");
    const a = mz.evaluate(MAZE_PARAMS, 11, REGION_MAZE, TABLE, "replace");
    expect(a).toEqual(
      mz.evaluate(MAZE_PARAMS, 11, REGION_MAZE, TABLE, "replace"),
    );
    expect(a).not.toEqual(
      mz.evaluate(MAZE_PARAMS, 12, REGION_MAZE, TABLE, "replace"),
    );
  });

  test("maze ops apply to a connected interior (BFS over air reaches every passage block)", () => {
    const mz = generatorById("maze");
    const ops = brushOps(
      mz.evaluate(MAZE_PARAMS, 11, REGION_MAZE, TABLE, "replace"),
    );
    for (const op of ops) expect(() => assertOpValid(op, TABLE)).not.toThrow();
    const s = createFieldStore();
    for (const op of ops) applyOp(s, { ...op, id: 1 }, TABLE);
    // BFS 6-connected air from cell (0,0)'s block centre, bounded to the
    // stamp's samples (x,z ∈ [0,32], y ∈ [0,16]). Air = density ≥ 0: each
    // (j,k) row is its OWN dig box, so shared box faces quantize to exactly 0
    // (the hall suite's "air-ish" convention) and a > 0 predicate would strand
    // the BFS inside one row. Solid stays strictly negative everywhere — a
    // closed wall band's mid samples read −8 via the dig margin — so ≥ 0
    // never leaks through a wall.
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    const start: [number, number, number] = [5, 5, 5];
    expect(getDensity(s, ...start)).toBeGreaterThan(0);
    const seen = new Set<string>([key(...start)]);
    const queue: [number, number, number][] = [start];
    const steps: [number, number, number][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    // for-of over the growing queue: JS array iterators visit pushed elements
    for (const [x, y, z] of queue) {
      for (const [dx, dy, dz] of steps) {
        const nx = x + dx;
        const ny = y + dy;
        const nz = z + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx > 32 || ny > 16 || nz > 32)
          continue;
        const k = key(nx, ny, nz);
        if (seen.has(k) || getDensity(s, nx, ny, nz) < 0) continue;
        seen.add(k);
        queue.push([nx, ny, nz]);
      }
    }
    // the growing tree SPANS — every maze cell's block centre is reached
    for (let b = 0; b < 3; b++)
      for (let a = 0; a < 3; a++)
        expect(seen.has(key(5 + 10 * a, 5, 5 + 10 * b))).toBe(true);
  });

  test("the north door opens on the centre passage column through the shell", () => {
    // Auto-centred door at maze cell floor(3/2)=1 → coarse offset 5 → door
    // cells i ∈ [6,9] → x ∈ (3,5) m on shell row k=15 (z mid-sample 31 =
    // 7.75 m). Mid-cell probes 15/17 (3.75/4.25 m) are air; the flanking
    // shell cells i=5 (sample 11) and i=10 (sample 21) stay solid masonry —
    // a ±1 maze-cell drift moves the door ±10 samples and fails the flanks.
    const mz = generatorById("maze");
    const ops = brushOps(
      mz.evaluate(MAZE_PARAMS, 11, REGION_MAZE, TABLE, "replace"),
    );
    const s = createFieldStore();
    for (const op of ops) applyOp(s, { ...op, id: 1 }, TABLE);
    expect(getDensity(s, 15, 5, 31)).toBeGreaterThan(0);
    expect(getDensity(s, 17, 5, 31)).toBeGreaterThan(0);
    expect(getDensity(s, 11, 5, 31)).toBeLessThan(0);
    expect(getDensity(s, 21, 5, 31)).toBeLessThan(0);
    expect(getMaterial(s, 11, 5, 31)).toBe(KIT_CLASS_ID);
  });

  test("braid opens loops: braid 1 differs from braid 0 at the same seed", () => {
    const mz = generatorById("maze");
    const perfect = mz.evaluate(
      { ...MAZE_PARAMS, braid: 0 },
      11,
      REGION_MAZE,
      TABLE,
      "replace",
    );
    const full = mz.evaluate(
      { ...MAZE_PARAMS, braid: 1 },
      11,
      REGION_MAZE,
      TABLE,
      "replace",
    );
    // a 3×3 spanning tree always has dead ends; braid 1 opens every one
    expect(perfect).not.toEqual(full);
  });

  test("keep-existing-air masks the maze shell fill solid-only", () => {
    const mz = generatorById("maze");
    const ops = brushOps(
      mz.evaluate(MAZE_PARAMS, 11, REGION_MAZE, TABLE, "keep-existing-air"),
    );
    expect(ops[0]?.mask).toEqual({ kind: "solid-only" });
  });

  test("maze defaults are schema-derived and evaluate clean", () => {
    const mz = generatorById("maze");
    expect(() =>
      mz.evaluate(mz.defaults, 7, REGION_MAZE, TABLE, "replace"),
    ).not.toThrow();
  });

  test("mazeParams validates setup-loud: range, integer, and number violations throw", () => {
    const mz = generatorById("maze");
    const run = (over: Record<string, unknown>) => () =>
      mz.evaluate(
        { ...MAZE_PARAMS, ...over },
        11,
        REGION_MAZE,
        TABLE,
        "replace",
      );
    expect(run({ cellsX: 1 })).toThrow(/cellsX/); // below minimum 2
    expect(run({ cellsZ: 9 })).toThrow(/cellsZ/); // above maximum 8
    expect(run({ cellsX: 2.5 })).toThrow(/cellsX/); // non-integer
    expect(run({ braid: -0.1 })).toThrow(/braid/); // below 0
    expect(run({ braid: 1.5 })).toThrow(/braid/); // above 1
    expect(run({ braid: Number.NaN })).toThrow(/braid/); // non-finite
    expect(run({ braid: "high" })).toThrow(/braid/); // non-number
    expect(run({ doorNorth: 1 })).toThrow(/doorNorth/); // non-boolean
  });
});

/** Byte-level store snapshot: every chunk through encodeChunkFile + every
 *  material entry through encodeMaterialFile, sorted by key. */
function snapshotBytes(s: FieldStore): [string, number[]][] {
  const rows: [string, number[]][] = [];
  for (const [k, chunk] of s.chunks)
    rows.push([`d:${k}`, Array.from(encodeChunkFile(chunk))]);
  for (const [k, m] of s.materials)
    rows.push([`m:${k}`, Array.from(encodeMaterialFile(m))]);
  return rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

describe("field generators — commitGenerator", () => {
  test("commitGenerator: one undo entry covers span + entity; undo/redo round-trips", () => {
    const s = createFieldStore();
    const log = createOpLog();
    const res = commitGenerator(s, log, generatorById("hall"), {
      params: HALL_PARAMS,
      seed: 7,
      region: REGION,
      policy: "replace",
      table: TABLE,
    });
    expect(res.dirty.size).toBeGreaterThan(0);
    const entity = log.ops[log.ops.length - 1];
    expect(entity?.kind).toBe("entity");
    if (entity?.kind !== "entity") return;
    expect(entity.entity.opSpan[1] - entity.entity.opSpan[0]).toBe(
      log.ops.length - 2,
    );
    expect(entity.entity.entityId).toBe(entity.id); // same log.nextId slot
    expect(log.undoStack.length).toBe(1); // ONE entry for the whole commit
    const opCount = log.ops.length;
    const bytesBefore = snapshotBytes(s);
    undo(s, log);
    expect(log.ops.length).toBe(0);
    // first-wins inverse merge: the hall's fill + digs touch the same chunks,
    // so a last-wins merge would restore MID-commit state here, not fresh rock
    expect(s.chunks.size).toBe(0); // fresh store fully restored
    expect(s.materials.size).toBe(0);
    redo(s, log, TABLE);
    expect(snapshotBytes(s)).toEqual(bytesBefore);
    expect(log.ops.length).toBe(opCount);
    expect(log.undoStack.length).toBe(1);
  });

  test("a new commit clears the redo stack", () => {
    const s = createFieldStore();
    const log = createOpLog();
    const opts = {
      params: HALL_PARAMS,
      seed: 7,
      region: REGION,
      policy: "replace" as const,
      table: TABLE,
    };
    commitGenerator(s, log, generatorById("hall"), opts);
    undo(s, log);
    expect(log.redoStack.length).toBe(1);
    commitGenerator(s, log, generatorById("hall"), opts);
    expect(log.redoStack.length).toBe(0);
  });

  test("commit provenance is CLONED: caller mutations never rewrite the logged entity", () => {
    // The log is append-only provenance (serialized ops file, F3 reconfigure):
    // a host reusing a live params/region object across commits must not
    // rewrite history through the alias.
    const s = createFieldStore();
    const log = createOpLog();
    const params: Record<string, unknown> = { ...HALL_PARAMS };
    const region = {
      min: [2, 0, 2] as [number, number, number],
      max: [10, 6, 10] as [number, number, number],
    };
    const res = commitGenerator(s, log, generatorById("hall"), {
      params,
      seed: 7,
      region,
      policy: "replace",
      table: TABLE,
    });
    params["width"] = 999;
    region.min[0] = 99;
    region.max[2] = -5;
    const entity = log.ops[log.ops.length - 1];
    expect(entity?.kind).toBe("entity");
    if (entity?.kind !== "entity") return;
    expect(entity.entity.params["width"]).toBe(8);
    expect(entity.entity.region.min[0]).toBe(2);
    expect(entity.entity.region.max[2]).toBe(10);
    expect(res.entity.params["width"]).toBe(8); // returned record too
  });

  test("a non-cloneable extra params value throws BEFORE any store write", () => {
    // Unknown keys survive param validation, so a function value reaches the
    // provenance structuredClone — which must run before pass 2's writes, or
    // the DataCloneError strands a mutated store with no undo entry (the exact
    // state two-pass validation exists to prevent).
    const s = createFieldStore();
    const log = createOpLog();
    expect(() =>
      commitGenerator(s, log, generatorById("hall"), {
        params: { ...HALL_PARAMS, onDone: () => undefined },
        seed: 7,
        region: REGION,
        policy: "replace",
        table: TABLE,
      }),
    ).toThrow();
    expect(s.chunks.size).toBe(0);
    expect(s.materials.size).toBe(0);
    expect(log.ops.length).toBe(0);
    expect(log.undoStack.length).toBe(0);
    expect(log.nextId).toBe(1);
  });

  test("an empty evaluated span throws setup-loud; store and log untouched", () => {
    const s = createFieldStore();
    const log = createOpLog();
    const emptyDef: GeneratorDef = {
      id: "empty",
      name: "Empty",
      paramSchema: {},
      defaults: {},
      contextFree: true,
      evaluate: () => ({ ops: [], placements: [] }),
    };
    expect(() =>
      commitGenerator(s, log, emptyDef, {
        params: {},
        seed: 1,
        region: REGION,
        policy: "replace",
        table: TABLE,
      }),
    ).toThrow(/empty/);
    expect(s.chunks.size).toBe(0);
    expect(log.ops.length).toBe(0);
    expect(log.undoStack.length).toBe(0);
    expect(log.nextId).toBe(1);
  });

  test("commit into a non-fresh log: ids continue; undo peels commit then brush", () => {
    // The mixed-entry tail invariant: a logApply brush entry followed by a
    // commit entry — ids continue contiguously from the non-1 nextId, and two
    // undos peel commit-then-brush back to a fresh store.
    const s = createFieldStore();
    const log = createOpLog();
    const dug = logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "dig",
        shape: { kind: "sphere", center: [4.5, 2, 4.5], radius: 1 },
      },
      TABLE,
    );
    expect(dug.size).toBeGreaterThan(0);
    expect(log.nextId).toBe(2);
    const afterBrush = snapshotBytes(s);
    commitGenerator(s, log, generatorById("hall"), {
      params: HALL_PARAMS,
      seed: 7,
      region: REGION,
      policy: "replace",
      table: TABLE,
    });
    const entity = log.ops[log.ops.length - 1];
    expect(entity?.kind).toBe("entity");
    if (entity?.kind !== "entity") return;
    // span ids 2..(ops.length−1), entity id = ops.length — contiguous from 1
    expect(entity.entity.opSpan[0]).toBe(2);
    expect(entity.entity.opSpan[1]).toBe(log.ops.length - 1);
    expect(entity.id).toBe(log.ops.length);
    expect(log.undoStack.length).toBe(2);
    undo(s, log);
    expect(log.ops.length).toBe(1); // the brush entry remains
    expect(snapshotBytes(s)).toEqual(afterBrush); // pre-commit state restored
    undo(s, log);
    expect(log.ops.length).toBe(0);
    expect(s.chunks.size).toBe(0);
    expect(s.materials.size).toBe(0);
  });

  test("an invalid evaluated span leaves store, log, and id counter untouched", () => {
    // Validate-all-then-apply: the SECOND op is invalid (unknown class id), so
    // a single-pass commit would have applied the first fill before throwing.
    const s = createFieldStore();
    const log = createOpLog();
    const badDef: GeneratorDef = {
      id: "bad",
      name: "Bad",
      paramSchema: {},
      defaults: {},
      contextFree: true,
      evaluate: () => ({
        ops: [
          {
            id: 0,
            kind: "brush",
            effect: "fill",
            material: KIT_CLASS_ID,
            shape: {
              kind: "box",
              center: [1, 1, 1],
              halfExtents: [0.5, 0.5, 0.5],
            },
          },
          {
            id: 0,
            kind: "brush",
            effect: "fill",
            material: 99,
            shape: {
              kind: "box",
              center: [1, 1, 1],
              halfExtents: [0.5, 0.5, 0.5],
            },
          },
        ],
        placements: [],
      }),
    };
    expect(() =>
      commitGenerator(s, log, badDef, {
        params: {},
        seed: 1,
        region: REGION,
        policy: "replace",
        table: TABLE,
      }),
    ).toThrow(/unknown class/);
    expect(s.chunks.size).toBe(0);
    expect(s.materials.size).toBe(0);
    expect(log.ops.length).toBe(0);
    expect(log.undoStack.length).toBe(0);
    expect(log.nextId).toBe(1);
  });
});

// ——— F3b (D-F3-8): the evaluate widening — placements + the placement op ———

/** One valid placement record, reused across the widening tests. */
const RECORD: PlacementRecord = {
  archetypeId: "torch",
  position: [3, 1, 3],
  quat: [0, 0, 0, 1],
  scale: [1, 1, 1],
  variantIndex: 0,
};

/** A minimal generator whose evaluate returns exactly `result` — the seam for
 *  exercising the placement/ops-empty paths without a real generator. */
const placingDef = (result: Partial<GeneratorResult>): GeneratorDef => ({
  id: "placer",
  name: "Placer",
  paramSchema: {},
  defaults: {},
  contextFree: true,
  evaluate: () => ({ ops: [], placements: [], ...result }),
});

describe("field generators — evaluate widening (D-F3-8)", () => {
  test("hall and maze evaluate return { ops, placements: [] }", () => {
    for (const [id, params, region] of [
      ["hall", HALL_PARAMS, REGION],
      ["maze", MAZE_PARAMS, REGION_MAZE],
    ] as const) {
      const result = generatorById(id).evaluate(
        params,
        7,
        region,
        TABLE,
        "replace",
      );
      expect(result.ops.length).toBeGreaterThan(0);
      expect(result.placements).toEqual([]);
    }
  });

  test("commitGenerator wraps placements in ONE placement op inside the span; undo removes span + placement + entity", () => {
    const s = createFieldStore();
    const log = createOpLog();
    const fill: BrushOp = {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: KIT_CLASS_ID,
      shape: { kind: "box", center: [1, 1, 1], halfExtents: [0.5, 0.5, 0.5] },
    };
    const def = placingDef({ ops: [fill], placements: [RECORD] });
    const res = commitGenerator(s, log, def, {
      params: {},
      seed: 1,
      region: REGION,
      policy: "replace",
      table: TABLE,
    });
    // tail: fill (id 1), placement (id 2), entity (id 3)
    expect(log.ops.length).toBe(3);
    const placement = log.ops[1];
    expect(placement?.kind).toBe("placement");
    if (placement?.kind !== "placement") return;
    expect(placement.records).toEqual([RECORD]);
    const entity = log.ops[2];
    expect(entity?.kind).toBe("entity");
    if (entity?.kind !== "entity") return;
    // opSpan covers BOTH the field op AND the placement op
    expect(entity.entity.opSpan).toEqual([1, 2]);
    expect(entity.entity.entityId).toBe(entity.id);
    expect(entity.id).toBe(3);
    expect(log.undoStack.length).toBe(1); // ONE entry for the whole commit
    expect(res.dirty.size).toBeGreaterThan(0); // the fill; the placement none
    undo(s, log);
    expect(log.ops.length).toBe(0); // span + placement + entity all peeled
    expect(s.chunks.size).toBe(0);
    expect(s.materials.size).toBe(0);
  });

  test("commitGenerator accepts a pure scatter (ops EMPTY, placements present)", () => {
    // The widened empty check: ops.length + placements.length === 0 is the
    // rejection, so ops:[] with a placement is a legitimate commit.
    const s = createFieldStore();
    const log = createOpLog();
    const def = placingDef({
      ops: [],
      placements: [RECORD, { ...RECORD, position: [5, 1, 5] }],
    });
    const res = commitGenerator(s, log, def, {
      params: {},
      seed: 1,
      region: REGION,
      policy: "replace",
      table: TABLE,
    });
    // tail: placement (id 1), entity (id 2) — no field ops at all
    expect(log.ops.length).toBe(2);
    const placement = log.ops[0];
    expect(placement?.kind).toBe("placement");
    if (placement?.kind !== "placement") return;
    expect(placement.records.length).toBe(2);
    const entity = log.ops[1];
    expect(entity?.kind).toBe("entity");
    if (entity?.kind !== "entity") return;
    expect(entity.entity.opSpan).toEqual([1, 1]); // just the placement op
    expect(entity.entity.entityId).toBe(2);
    expect(res.dirty.size).toBe(0); // no field cells written
    expect(s.chunks.size).toBe(0);
    undo(s, log);
    expect(log.ops.length).toBe(0);
  });

  test("commitGenerator rejects invalid placements setup-loud, before any write", () => {
    const s = createFieldStore();
    const log = createOpLog();
    const def = placingDef({
      placements: [{ ...RECORD, quat: [0, 0, 0, 0] }], // not unit-length
    });
    expect(() =>
      commitGenerator(s, log, def, {
        params: {},
        seed: 1,
        region: REGION,
        policy: "replace",
        table: TABLE,
      }),
    ).toThrow(/unit-length/);
    expect(s.chunks.size).toBe(0);
    expect(log.ops.length).toBe(0);
    expect(log.undoStack.length).toBe(0);
    expect(log.nextId).toBe(1);
  });

  test("assertPlacementsValid: setup-loud on empty id, non-finite, non-unit quat, bad variant", () => {
    expect(() => assertPlacementsValid([RECORD])).not.toThrow();
    const bad = (over: Partial<PlacementRecord>): PlacementRecord[] => [
      { ...RECORD, ...over },
    ];
    expect(() => assertPlacementsValid(bad({ archetypeId: "" }))).toThrow(
      /archetypeId/,
    );
    expect(() =>
      assertPlacementsValid(bad({ position: [0, Number.NaN, 0] })),
    ).toThrow(/position/);
    expect(() =>
      assertPlacementsValid(bad({ scale: [1, Number.POSITIVE_INFINITY, 1] })),
    ).toThrow(/scale/);
    expect(() => assertPlacementsValid(bad({ quat: [0, 0, 0, 0.5] }))).toThrow(
      /unit-length/,
    );
    expect(() =>
      assertPlacementsValid(bad({ quat: [0, 0, 0, Number.NaN] })),
    ).toThrow(/unit-length/);
    expect(() => assertPlacementsValid(bad({ variantIndex: -1 }))).toThrow(
      /variantIndex/,
    );
    expect(() => assertPlacementsValid(bad({ variantIndex: 2.5 }))).toThrow(
      /variantIndex/,
    );
    // a real quarter-turn about +Y is unit-length and passes
    expect(() =>
      assertPlacementsValid(bad({ quat: [0, Math.SQRT1_2, 0, Math.SQRT1_2] })),
    ).not.toThrow();
  });
});

// ——— Task 7 (D-F3-13): quarter-turn rotation + door-offset authoring ———
// One authoring convention across both generators. Rotation is a STRING enum
// (see the ROTATIONS TSDoc in generators.ts for why); the four per-wall
// `door<Wall>Offset` knobs take -1 = auto-centre. The new keys are OPTIONAL on
// input — recorded params written before F3a carry none of them and must keep
// evaluating exactly as they did.

/** The stamp's coarse dims, read back from the leading fill box: gridToOps
 *  emits ONE fill spanning the whole grid, so halfExtents = dims · CELL / 2. */
function stampDims(ops: BrushOp[]): [number, number, number] {
  const fill = ops[0];
  if (fill === undefined || fill.effect !== "fill")
    throw new Error("stampDims: op 0 is not the shell fill");
  const h = fill.shape.kind === "box" ? fill.shape.halfExtents : null;
  if (h === null) throw new Error("stampDims: the shell fill is not a box");
  return [(h[0] * 2) / CELL_M, (h[1] * 2) / CELL_M, (h[2] * 2) / CELL_M];
}

/** Metres → coarse-cell index, EXACT: origins and box corners are all dyadic
 *  rationals at CELL 0.5 m, so the division is lossless. A non-integral result
 *  means the op span drifted off the lattice — fail loudly rather than round. */
function cellIndex(metres: number, origin: number): number {
  const n = (metres - origin) / CELL_M;
  if (!Number.isInteger(n))
    throw new Error(`cellIndex: ${metres} is not a lattice cell (got ${n})`);
  return n;
}

/** Every AIR cell of a stamp, reconstructed exactly from its dig boxes.
 *  gridToOps emits one dig box per x-run of air at wj = wk = 1, so each box
 *  maps back to a unique cell run with no ambiguity. Keys are "i,j,k" in grid
 *  space relative to the snapped origin. */
function airCells(
  ops: BrushOp[],
  origin: [number, number, number],
): Set<string> {
  const out = new Set<string>();
  for (const op of ops) {
    if (op.effect !== "dig") continue;
    if (op.shape.kind !== "box") throw new Error("airCells: non-box dig");
    const { center: c, halfExtents: h } = op.shape;
    const i0 = cellIndex(c[0] - h[0], origin[0]);
    const j0 = cellIndex(c[1] - h[1], origin[1]);
    const k0 = cellIndex(c[2] - h[2], origin[2]);
    const wi = (h[0] * 2) / CELL_M;
    for (let t = 0; t < wi; t++) out.add(`${i0 + t},${j0},${k0}`);
  }
  return out;
}

/** rotateGrid's cell map for a source grid of dims [nx, _, nz].
 *
 *  This is a TEXTUAL COPY of the implementation's formulas, not an independent
 *  derivation: a sign error made identically in both would cancel here. It
 *  earns its place by checking STRUCTURE the implementation does not restate —
 *  that the mapping is a bijection over the full volume and that dims swap —
 *  while the real independent anchor is the hand-computed wall-and-span table
 *  in "each rotation carries the north door to the hand-computed wall", which
 *  touches neither this helper nor the implementation's formulas. */
function rotCell(
  i: number,
  k: number,
  turns: number,
  nx: number,
  nz: number,
): [number, number] {
  if (turns === 1) return [k, nx - 1 - i];
  if (turns === 2) return [nx - 1 - i, nz - 1 - k];
  if (turns === 3) return [nz - 1 - k, i];
  return [i, k];
}

/** FULL-VOLUME rotated equivalence — every air cell, not a sample. Proves the
 *  dims transform, and that mapping the unrotated air set through rotCell
 *  yields the rotated air set EXACTLY (equal sets ⇒ a bijection, so neither
 *  lost nor invented cells). */
function expectRotatedEquivalence(
  ops0: BrushOp[],
  opsR: BrushOp[],
  origin: [number, number, number],
  turns: number,
): void {
  const [nx, ny, nz] = stampDims(ops0);
  expect(stampDims(opsR)).toEqual(
    turns === 1 || turns === 3 ? [nz, ny, nx] : [nx, ny, nz],
  );
  const a0 = airCells(ops0, origin);
  expect(a0.size).toBeGreaterThan(0); // vacuity floor
  const mapped = new Set<string>();
  for (const key of a0) {
    const [i = 0, j = 0, k = 0] = key.split(",").map(Number);
    const [ri, rk] = rotCell(i, k, turns, nx, nz);
    mapped.add(`${ri},${j},${rk}`);
  }
  expect([...mapped].sort()).toEqual([...airCells(opsR, origin)].sort());
}

/** The lateral cell span [lo, hi] of a wall's doorway, read back from the air
 *  cells sitting on that wall's shell row — null when the wall is closed. */
function doorSpan(
  ops: BrushOp[],
  origin: [number, number, number],
  wall: "north" | "south" | "east" | "west",
): [number, number] | null {
  const [nx, , nz] = stampDims(ops);
  const alongX = wall === "north" || wall === "south";
  const shellIdx =
    wall === "north"
      ? nz - 1
      : wall === "south"
        ? 0
        : wall === "east"
          ? nx - 1
          : 0;
  const lats: number[] = [];
  for (const key of airCells(ops, origin)) {
    const [i = 0, , k = 0] = key.split(",").map(Number);
    if (alongX && k === shellIdx) lats.push(i);
    if (!alongX && i === shellIdx) lats.push(k);
  }
  if (lats.length === 0) return null;
  return [Math.min(...lats), Math.max(...lats)];
}

const ORIGIN_REGION: [number, number, number] = [2, 0, 2];
const ORIGIN_MAZE: [number, number, number] = [0, 0, 0];
/** A region whose min is negative and OFF the 0.5 m lattice, so snapDown of a
 *  negative metre is genuinely exercised (floor, not trunc: −6.25 → −6.5). */
const REGION_NEG = {
  min: [-6.25, -3.75, -8.5] as [number, number, number],
  max: [8, 6, 8] as [number, number, number],
};
const ORIGIN_NEG: [number, number, number] = [-6.5, -4, -8.5];

/** [wall, enable key, offset key] per wall — spelled out, mirroring the source's
 *  WALLS table. Never re-derive these from the wall name. */
const DOOR_KEYS = [
  ["north", "doorNorth", "doorNorthOffset"],
  ["south", "doorSouth", "doorSouthOffset"],
  ["east", "doorEast", "doorEastOffset"],
  ["west", "doorWest", "doorWestOffset"],
] as const satisfies readonly [
  "north" | "south" | "east" | "west",
  string,
  string,
][];

/** The five params that postdate persisted data and are OPTIONAL on input. */
const OPTIONAL_KEYS = [
  "rotation",
  ...DOOR_KEYS.map(([, , offsetKey]) => offsetKey),
];

/** A curried `() => evaluate(...)` thunk for setup-loud assertions: the shape
 *  every `expect(...).toThrow(...)` in this block needs, spelled once. */
const evalWith =
  (
    def: GeneratorDef,
    base: Record<string, unknown>,
    region: typeof REGION,
    seed = 7,
  ) =>
  (over: Record<string, unknown>) =>
  () =>
    def.evaluate({ ...base, ...over }, seed, region, TABLE, "replace");

describe("field generators — rotation + door-offset authoring (D-F3-13)", () => {
  test("both schemas expose rotation + the four wall offsets, with identity defaults and EXACT suprema", () => {
    // `maximum` is pinned, not just `minimum`/`default`: the deviation from the
    // plan's shared 30 is licensed ONLY by these being exact suprema over each
    // generator's admissible geometries (hall: depth max 32 − DOOR_W_CELLS 4;
    // maze: cells max 8 − 1). Without pinning them, 28→30 and 7→28 both pass.
    for (const [id, maximum] of [
      ["hall", 28],
      ["maze", 7],
    ] as const) {
      const def = generatorById(id);
      const props = (def.paramSchema as { properties: Record<string, unknown> })
        .properties;
      expect(props["rotation"]).toMatchObject({
        enum: ["0", "90", "180", "270"],
        default: "0",
      });
      expect(def.defaults["rotation"]).toBe("0");
      for (const [, , offsetKey] of DOOR_KEYS) {
        expect(props[offsetKey]).toMatchObject({
          minimum: -1,
          maximum,
          default: -1,
        });
        expect(def.defaults[offsetKey]).toBe(-1);
      }
    }
  });

  test("each schema maximum is ATTAINABLE — the largest legal geometry reaches it, one past throws", () => {
    // Pins the suprema as exact rather than arbitrary: the bound is reachable
    // (so it is not too small) and one past it is rejected (so it is not too
    // large). A bound nobody can reach would satisfy the toMatchObject above.
    const hall = generatorById("hall");
    const bigHall = {
      ...HALL_PARAMS,
      depth: 32,
      doorNorth: false,
      doorEast: true,
    };
    const hallRun = evalWith(hall, bigHall, REGION);
    expect(hallRun({ doorEastOffset: 28 })).not.toThrow(); // depth 32 − 4 = 28
    expect(hallRun({ doorEastOffset: 29 })).toThrow(/doorEastOffset/);

    const mz = generatorById("maze");
    const bigMaze = { ...MAZE_PARAMS, cellsX: 8, cellsZ: 2 };
    const mazeRun = evalWith(mz, bigMaze, REGION_MAZE, 3);
    expect(mazeRun({ doorNorthOffset: 7 })).not.toThrow(); // cellsX 8 − 1 = 7
    expect(mazeRun({ doorNorthOffset: 8 })).toThrow(/doorNorthOffset/);
  });

  test("every param is either REQUIRED or a declared post-F3a optional — no third bucket", () => {
    // Binds the next contributor: adding a property fails here until it is
    // consciously placed in one bucket. `required` is DERIVED in the source as
    // "properties minus the optional list", so this also pins that derivation.
    for (const id of ["hall", "maze"]) {
      const schema = generatorById(id).paramSchema as {
        properties: Record<string, unknown>;
        required: string[];
      };
      expect(schema.required).toBeDefined();
      expect([...schema.required, ...OPTIONAL_KEYS].sort()).toEqual(
        Object.keys(schema.properties).sort(),
      );
      for (const k of OPTIONAL_KEYS) expect(schema.required).not.toContain(k);
    }
  });

  test("`required` is load-bearing: dropping a required key throws, dropping an optional one does not", () => {
    for (const [id, base, region, seed] of [
      ["hall", HALL_PARAMS, REGION, 7],
      ["maze", MAZE_PARAMS, REGION_MAZE, 11],
    ] as const) {
      const def = generatorById(id);
      const schema = def.paramSchema as { required: string[] };
      const full: Record<string, unknown> = {
        ...structuredClone(def.defaults),
        ...base,
      };
      const dropping = (key: string): Record<string, unknown> => {
        const without = { ...full };
        delete without[key];
        return without;
      };
      expect(schema.required.length).toBeGreaterThan(0); // vacuity floor
      for (const key of schema.required)
        expect(() =>
          def.evaluate(dropping(key), seed, region, TABLE, "replace"),
        ).toThrow(new RegExp(key));
      for (const key of OPTIONAL_KEYS)
        expect(() =>
          def.evaluate(dropping(key), seed, region, TABLE, "replace"),
        ).not.toThrow();
    }
  });

  test("a DISABLED door's malformed offset is still rejected (no garbage into persisted params)", () => {
    // GeneratorEntity.params is persisted and reconfigureGenerator re-evaluates
    // it as a COMPLETE replacement set, so an unvalidated value on a switched-off
    // door survives round-trips and detonates when the user later toggles that
    // door on — an error about a value they never touched. Every sibling knob
    // validates unconditionally; doors are not an exception.
    for (const [id, base, region] of [
      ["hall", HALL_PARAMS, REGION],
      ["maze", MAZE_PARAMS, REGION_MAZE],
    ] as const) {
      const run = evalWith(generatorById(id), base, region, 3);
      expect(run({ doorSouth: false, doorSouthOffset: "banana" })).toThrow(
        /doorSouthOffset/,
      );
      expect(run({ doorWest: false, doorWestOffset: 1.5 })).toThrow(
        /doorWestOffset/,
      );
      // an ENABLED door with a good offset is of course still fine
      expect(run({ doorSouth: false, doorSouthOffset: 1 })).not.toThrow();
    }
  });

  // ——— backward compatibility: the reason the new keys are optional ———

  test("params with NONE of the new keys evaluate byte-identically to the defaults spelled out", () => {
    // GeneratorEntity.params is PERSISTED and reconfigureGenerator re-evaluates
    // from the recorded set, so params written before F3a carry none of these
    // keys. Absent MUST mean rotation 0 + auto-centred doors, exactly.
    const cases: [string, Record<string, unknown>, typeof REGION, number][] = [
      ["hall", HALL_PARAMS, REGION, 7],
      ["maze", MAZE_PARAMS, REGION_MAZE, 11],
    ];
    for (const [id, legacy, region, seed] of cases) {
      const def = generatorById(id);
      expect(legacy["rotation"]).toBeUndefined(); // the fixture really is legacy
      const spelled = {
        ...legacy,
        rotation: "0",
        doorNorthOffset: -1,
        doorSouthOffset: -1,
        doorEastOffset: -1,
        doorWestOffset: -1,
      };
      const a = def.evaluate(legacy, seed, region, TABLE, "replace");
      const b = def.evaluate(spelled, seed, region, TABLE, "replace");
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test("the -1 sentinel, an absent key, and today's centring are the SAME door", () => {
    // Three routes to auto-centre must not drift — they share one branch.
    const hall = generatorById("hall");
    const legacy = brushOps(
      hall.evaluate(HALL_PARAMS, 7, REGION, TABLE, "replace"),
    );
    const sentinel = hall.evaluate(
      { ...HALL_PARAMS, doorNorthOffset: -1 },
      7,
      REGION,
      TABLE,
      "replace",
    ).ops;
    expect(JSON.stringify(sentinel)).toBe(JSON.stringify(legacy));
    // and it is the CENTRED span the pre-F3a hall produced: interiorLen 8,
    // DOOR_W_CELLS 4 → lo = 1 + floor((8−4)/2) = 3 → cells [3,6]
    expect(doorSpan(legacy, ORIGIN_REGION, "north")).toEqual([3, 6]);
  });

  // ——— rotation ———

  test("rotation 90 maps the hall's north door to the east wall, cell-exact", () => {
    // The door is deliberately OFF-CENTRE. A centred door on the square default
    // footprint makes the whole grid mirror-symmetric in x, under which
    // (i,k) → (k, nx−1−i) and the sign-flipped (i,k) → (k, i) agree — so a
    // centred fixture cannot tell a correct 90° from a mirrored one. Verified:
    // with the centred door this test passes under the rotateGrid sign
    // sabotage; with offset 0 it fails, which is the point.
    const hall = generatorById("hall");
    const base = { ...HALL_PARAMS, doorNorthOffset: 0 };
    const ops0 = brushOps(hall.evaluate(base, 1, REGION, TABLE, "replace"));
    const ops90 = brushOps(
      hall.evaluate({ ...base, rotation: "90" }, 1, REGION, TABLE, "replace"),
    );
    expectRotatedEquivalence(ops0, ops90, ORIGIN_REGION, 1);
    // North door at offset 0 → cells i ∈ [1,4] on the shell row k = nz−1 = 9.
    expect(doorSpan(ops0, ORIGIN_REGION, "north")).toEqual([1, 4]);
    // Under (i,k) → (k, nx−1−i) with nx = 10 those cells land at i = 9 —
    // the EAST shell — spanning k = 9−4 … 9−1 = [5, 8]. A mirrored rotation
    // would put them at [1, 4] instead, which this pins.
    expect(doorSpan(ops90, ORIGIN_REGION, "east")).toEqual([5, 8]);
    // … and the north wall of the rotated stamp is now CLOSED
    expect(doorSpan(ops90, ORIGIN_REGION, "north")).toBeNull();
  });

  test("each rotation carries the north door to the hand-computed wall and span", () => {
    // The independent anchor for the whole rotation block: every number below
    // is derived BY HAND from the cell map, and the check reads only door
    // positions — it never calls rotCell and never restates the implementation's
    // formulas, so a sign error shared by helper and implementation cannot hide.
    // Square 10×10 default footprint, north door at offset 0 → cells i ∈ [1,4]
    // on shell row k = 9:
    //   90°  (i,k) → (k, 9−i)  ⇒ i' = 9 (EAST),  k' ∈ [5,8]
    //   180° (i,k) → (9−i, 9−k) ⇒ k' = 0 (SOUTH), i' ∈ [5,8]
    //   270° (i,k) → (9−k, i)  ⇒ i' = 0 (WEST),  k' ∈ [1,4]
    const hall = generatorById("hall");
    const base = { ...HALL_PARAMS, doorNorthOffset: 0 };
    const expected = [
      ["0", "north", [1, 4]],
      ["90", "east", [5, 8]],
      ["180", "south", [5, 8]],
      ["270", "west", [1, 4]],
    ] as const;
    for (const [rotation, wall, span] of expected) {
      const ops = brushOps(
        hall.evaluate({ ...base, rotation }, 1, REGION, TABLE, "replace"),
      );
      expect(doorSpan(ops, ORIGIN_REGION, wall)).toEqual([...span]);
      // exactly ONE wall carries a door in every rotation
      const open = (["north", "south", "east", "west"] as const).filter(
        (w) => doorSpan(ops, ORIGIN_REGION, w) !== null,
      );
      expect(open).toEqual([wall]);
    }
  });

  test("all four rotations are full-volume equivalent, for BOTH generators", () => {
    const cases: [
      string,
      Record<string, unknown>,
      typeof REGION,
      [number, number, number],
      number,
    ][] = [
      ["hall", { ...HALL_PARAMS, depth: 12 }, REGION, ORIGIN_REGION, 3],
      [
        "maze",
        { ...MAZE_PARAMS, cellsX: 4, cellsZ: 2 },
        REGION_MAZE,
        ORIGIN_MAZE,
        5,
      ],
    ];
    for (const [id, base, region, origin, seed] of cases) {
      const def = generatorById(id);
      const ops0 = brushOps(def.evaluate(base, seed, region, TABLE, "replace"));
      // a NON-square footprint, so a dims swap cannot hide
      const [nx, , nz] = stampDims(ops0);
      expect(nx).not.toBe(nz);
      for (const [rot, turns] of [
        ["90", 1],
        ["180", 2],
        ["270", 3],
      ] as const) {
        const opsR = brushOps(
          def.evaluate(
            { ...base, rotation: rot },
            seed,
            region,
            TABLE,
            "replace",
          ),
        );
        expectRotatedEquivalence(ops0, opsR, origin, turns);
        for (const op of opsR)
          expect(() => assertOpValid(op, TABLE)).not.toThrow();
      }
    }
  });

  test('rotation "0" is the identity — byte-identical to omitting it', () => {
    for (const [id, base, region, seed] of [
      ["hall", HALL_PARAMS, REGION, 7],
      ["maze", MAZE_PARAMS, REGION_MAZE, 11],
    ] as const) {
      const def = generatorById(id);
      expect(
        JSON.stringify(
          def.evaluate(
            { ...base, rotation: "0" },
            seed,
            region,
            TABLE,
            "replace",
          ),
        ),
      ).toBe(
        JSON.stringify(def.evaluate(base, seed, region, TABLE, "replace")),
      );
    }
  });

  test("rotation validates setup-loud — including the NUMBER 90 (the enum is strings)", () => {
    const hall = generatorById("hall");
    const run = (rotation: unknown) => () =>
      hall.evaluate({ ...HALL_PARAMS, rotation }, 7, REGION, TABLE, "replace");
    expect(run(90)).toThrow(/rotation/); // number, not the string "90"
    expect(run("45")).toThrow(/rotation/); // not a quarter turn
    expect(run("")).toThrow(/rotation/);
    expect(run(null)).toThrow(/rotation/);
    expect(run("0")).not.toThrow();
  });

  test("a rotated stamp with a blocked door lane STILL throws (the lane invariant survives rotation)", () => {
    // Doors are carved and validated in the UNROTATED frame, so rotation must
    // not launder a blocked lane into a passing one.
    const hall = generatorById("hall");
    const blocked = { ...HALL_PARAMS, pillars: "grid", pillarSpacing: 2 };
    for (const rotation of ["0", "90", "180", "270"])
      expect(() =>
        hall.evaluate({ ...blocked, rotation }, 7, REGION, TABLE, "replace"),
      ).toThrow(/blocked walk lane/);
  });

  // ——— door offsets ———

  test("hall door offsets count COARSE CELLS and move the door, cell-exact, on every wall", () => {
    const hall = generatorById("hall");
    // width 8 / depth 8 → both interiorLens are 8 → legal offsets 0..4.
    // Enable + offset keys are spelled out per row, never re-derived from the
    // wall name by string surgery — that is the drift the source's WALLS table
    // exists to prevent, and a test that re-derives them defeats the point.
    for (const [wall, enable, key] of DOOR_KEYS) {
      for (const offset of [0, 1, 4]) {
        const ops = brushOps(
          hall.evaluate(
            { ...HALL_PARAMS, doorNorth: false, [enable]: true, [key]: offset },
            7,
            REGION,
            TABLE,
            "replace",
          ),
        );
        // lo = 1 + offset; the door is DOOR_W_CELLS = 4 wide
        expect(doorSpan(ops, ORIGIN_REGION, wall)).toEqual([
          1 + offset,
          4 + offset,
        ]);
      }
    }
  });

  test("maze door offsets count MAZE CELLS — a door never lands on a wall band", () => {
    const mz = generatorById("maze");
    // cellsX 4 → PITCH 5 → interior 19 cells; passage columns at [1+5o, 4+5o],
    // internal wall bands at i ∈ {5, 10, 15}. Offsets are MAZE cells 0..3.
    const params = { ...MAZE_PARAMS, cellsX: 4, cellsZ: 3 };
    const region = {
      min: [0, 0, 0] as [number, number, number],
      max: [24, 4, 24] as [number, number, number],
    };
    for (const offset of [0, 1, 2, 3]) {
      const ops = brushOps(
        mz.evaluate(
          { ...params, doorNorthOffset: offset },
          3,
          region,
          TABLE,
          "replace",
        ),
      );
      expect(ops.length).toBeGreaterThan(0);
      const span = doorSpan(ops, ORIGIN_MAZE, "north");
      if (span === null) throw new Error("the north wall should carry a door");
      // the PITCH mapping: maze cell o ⇒ coarse [1+5o, 4+5o]
      expect(span).toEqual([1 + 5 * offset, 4 + 5 * offset]);
      // and never overlaps an internal wall band
      const [lo, hi] = span;
      for (const band of [5, 10, 15]) expect(band < lo || band > hi).toBe(true);
    }
  });

  test("an AUTO-CENTRED maze door uses the maze's own centring, at EVEN cell counts too", () => {
    // Found by sabotage: the maze centres on maze cell floor(cells/2) —
    // coarse PITCH·cell — which is NOT openDoor's coarse centring
    // floor((interiorLen − DOOR_W_CELLS) / 2). The two COINCIDE at odd cell
    // counts (c=3 → 5, c=5 → 10) and diverge at every even one (c=2 → 5 vs 2,
    // c=4 → 10 vs 7), so a fixture at cellsX 3 alone cannot tell them apart.
    // At c=4 openDoor's centring would put the door at coarse [8,11] — astride
    // the internal wall band at 10 — which is exactly what PITCH prevents.
    const mz = generatorById("maze");
    const region = {
      min: [0, 0, 0] as [number, number, number],
      max: [24, 4, 24] as [number, number, number],
    };
    for (const cellsX of [2, 4, 6]) {
      const ops = brushOps(
        mz.evaluate(
          { ...MAZE_PARAMS, cellsX, cellsZ: 2 },
          3,
          region,
          TABLE,
          "replace",
        ),
      );
      const centreCell = Math.floor(cellsX / 2);
      expect(doorSpan(ops, ORIGIN_MAZE, "north")).toEqual([
        1 + 5 * centreCell,
        4 + 5 * centreCell,
      ]);
    }
  });

  test("an out-of-range door offset THROWS with the wall's legal range (never silently clamps)", () => {
    const hall = generatorById("hall");
    // interiorLen 8, door 4 wide → legal 0..4
    expect(() =>
      hall.evaluate(
        { ...HALL_PARAMS, doorNorthOffset: 5 },
        7,
        REGION,
        TABLE,
        "replace",
      ),
    ).toThrow(/doorNorthOffset.*0\.\.4/s);
    expect(() =>
      hall.evaluate(
        { ...HALL_PARAMS, doorNorthOffset: -2 },
        7,
        REGION,
        TABLE,
        "replace",
      ),
    ).toThrow(/doorNorthOffset/);
    expect(() =>
      hall.evaluate(
        { ...HALL_PARAMS, doorNorthOffset: 1.5 },
        7,
        REGION,
        TABLE,
        "replace",
      ),
    ).toThrow(/doorNorthOffset/);
    const mz = generatorById("maze");
    // cellsX 3 → maze-cell offsets 0..2
    expect(() =>
      mz.evaluate(
        { ...MAZE_PARAMS, doorNorthOffset: 3 },
        3,
        REGION_MAZE,
        TABLE,
        "replace",
      ),
    ).toThrow(/doorNorthOffset.*0\.\.2/s);
    // the boundary value is LEGAL — the range is inclusive, not off-by-one
    expect(() =>
      mz.evaluate(
        { ...MAZE_PARAMS, doorNorthOffset: 2 },
        3,
        REGION_MAZE,
        TABLE,
        "replace",
      ),
    ).not.toThrow();
    expect(() =>
      hall.evaluate(
        { ...HALL_PARAMS, doorNorthOffset: 4 },
        7,
        REGION,
        TABLE,
        "replace",
      ),
    ).not.toThrow();
  });

  test("an offset that walks a door onto a pillar throws /blocked walk lane/ — offset is the CAUSE", () => {
    // Teeth-verified pair on the SAME pillar config: grid pillars at spacing 3
    // sit at i,k ∈ {3,6}. The centred north door (offset 2 → lat cells {4,5})
    // clears them; offset 3 (lat {5,6}) puts lane cell (6, j, 6) on a pillar.
    const hall = generatorById("hall");
    const pillared = { ...HALL_PARAMS, pillars: "grid", pillarSpacing: 3 };
    expect(() =>
      hall.evaluate(
        { ...pillared, doorNorthOffset: 2 },
        7,
        REGION,
        TABLE,
        "replace",
      ),
    ).not.toThrow(); // CONTROL: the config alone is fine
    expect(() =>
      hall.evaluate(
        { ...pillared, doorNorthOffset: 3 },
        7,
        REGION,
        TABLE,
        "replace",
      ),
    ).toThrow(/blocked walk lane/); // only the offset changed
  });

  // ——— determinism + negative coordinates ———

  test("rotation and offsets are deterministic (same-input-twice), both generators", () => {
    for (const [id, base, region, seed] of [
      ["hall", HALL_PARAMS, REGION, 5],
      ["maze", MAZE_PARAMS, REGION_MAZE, 5],
    ] as const) {
      const def = generatorById(id);
      const p = { ...base, rotation: "270", doorNorthOffset: 1 };
      const a = def.evaluate(p, seed, region, TABLE, "replace");
      const b = def.evaluate(p, seed, region, TABLE, "replace");
      expect(a).toEqual(b);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test("rotation + offsets hold on a NEGATIVE, off-lattice region (snapDown floors)", () => {
    const hall = generatorById("hall");
    const base = { ...HALL_PARAMS, depth: 12, doorNorthOffset: 1 };
    const ops0 = brushOps(hall.evaluate(base, 7, REGION_NEG, TABLE, "replace"));
    // the stamp really is anchored at the FLOORED origin, not the raw min
    const fill0 = ops0[0];
    if (fill0?.shape.kind !== "box") throw new Error("expected a box fill");
    expect(fill0.shape.center[0] - fill0.shape.halfExtents[0]).toBe(
      ORIGIN_NEG[0],
    );
    expect(fill0.shape.center[1] - fill0.shape.halfExtents[1]).toBe(
      ORIGIN_NEG[1],
    );
    for (const [rot, turns] of [
      ["90", 1],
      ["180", 2],
      ["270", 3],
    ] as const) {
      const opsR = brushOps(
        hall.evaluate(
          { ...base, rotation: rot },
          7,
          REGION_NEG,
          TABLE,
          "replace",
        ),
      );
      expectRotatedEquivalence(ops0, opsR, ORIGIN_NEG, turns);
      for (const op of opsR)
        expect(() => assertOpValid(op, TABLE)).not.toThrow();
    }
  });
});
