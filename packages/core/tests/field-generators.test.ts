import { describe, expect, test } from "bun:test";
import type { MaterialTable } from "@furnace/core/field";
import {
  applyOp,
  assertOpValid,
  BUILTIN_TABLE,
  createFieldStore,
  FIELD_GENERATORS,
  generatorById,
  getDensity,
  getMaterial,
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
    expect(run({ width: 2 })).toThrow(/width/); // below schema minimum 4
    expect(run({ width: 40 })).toThrow(/width/); // above schema maximum 24
    expect(run({ height: 4 })).toThrow(/height/); // below door height
    expect(run({ depth: 8.5 })).toThrow(/depth/); // non-integer
    expect(run({ pillars: "spiral" })).toThrow(/pillars/); // unknown enum
    expect(run({ pillarSpacing: 1 })).toThrow(/pillarSpacing/);
    expect(run({ doorNorth: 1 })).toThrow(/doorNorth/); // non-boolean
  });
});
