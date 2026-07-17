import { describe, expect, test } from "bun:test";
import type {
  FieldStore,
  GeneratorDef,
  MaterialTable,
} from "@furnace/core/field";
import {
  applyOp,
  assertOpValid,
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
    const ops = hall.evaluate(HALL_PARAMS, 7, REGION, TABLE, "replace");
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
    const ops = hall.evaluate(
      HALL_PARAMS,
      7,
      REGION,
      TABLE,
      "keep-existing-air",
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
    const ops = hall.evaluate(
      { ...HALL_PARAMS, pillars: "grid", pillarSpacing: 3 },
      7,
      REGION,
      TABLE,
      "replace",
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
    const ops = hall.evaluate(
      { ...HALL_PARAMS, pillars: "colonnade", pillarSpacing: 3 },
      7,
      REGION,
      TABLE,
      "replace",
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
    const ops = hall.evaluate(
      { ...HALL_PARAMS, doorNorth: false, doorWest: true },
      7,
      REGION,
      TABLE,
      "replace",
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
    expect(FIELD_GENERATORS.map((g) => g.id)).toEqual(["hall", "maze"]);
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
    const ops = mz.evaluate(MAZE_PARAMS, 11, REGION_MAZE, TABLE, "replace");
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
    const ops = mz.evaluate(MAZE_PARAMS, 11, REGION_MAZE, TABLE, "replace");
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
      evaluate: () => [
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
