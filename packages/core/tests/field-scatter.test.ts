import { describe, expect, test } from "bun:test";
import type {
  FieldStore,
  MaterialTable,
  PlacementRecord,
} from "@furnace/core/field";
import {
  AIR,
  BUILTIN_TABLE,
  commitGenerator,
  createFieldStore,
  createOpLog,
  DEFAULT_CELL_SIZE,
  generatorById,
  getDensity,
  setDensity,
  worldToVoxel,
} from "@furnace/core/field";
// evaluateGenerator is NOT on the public field index (the guard is in-core
// surface, shared by commitGenerator/reconfigureGenerator) — reach it by source
// path, the spliceOps/imagesOf precedent the reconfigure test already uses.
import { evaluateGenerator } from "../src/field/generators.ts";

const TABLE: MaterialTable = BUILTIN_TABLE; // scatter ignores the catalog
const SCATTER = generatorById("scatter");
const CELL = DEFAULT_CELL_SIZE; // 0.25 m

type Region = { min: [number, number, number]; max: [number, number, number] };
type Vec3 = [number, number, number];

const scatterParams = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...structuredClone(SCATTER.defaults),
  ...overrides,
});

/** Carves a flat-floored air box: every sample in the world region above
 *  `floorY` (metres) becomes AIR, below stays SOLID (the setDensity default) —
 *  so the column has ONE rock→air rising crossing at `floorY`. */
function carveFloor(region: Region, floorY: number): FieldStore {
  const store = createFieldStore();
  const sx0 = worldToVoxel(region.min[0], CELL);
  const sx1 = worldToVoxel(region.max[0], CELL);
  const sy0 = worldToVoxel(floorY, CELL);
  const sy1 = worldToVoxel(region.max[1], CELL);
  const sz0 = worldToVoxel(region.min[2], CELL);
  const sz1 = worldToVoxel(region.max[2], CELL);
  for (let sz = sz0; sz <= sz1; sz++)
    for (let sy = sy0; sy <= sy1; sy++)
      for (let sx = sx0; sx <= sx1; sx++) setDensity(store, sx, sy, sz, AIR);
  return store;
}

/** Carves a flat ceiling: AIR below `ceilY`, SOLID at/above it — one falling
 *  (air→rock) crossing per column, the ceiling mode's target. */
function carveCeiling(region: Region, ceilY: number): FieldStore {
  const store = createFieldStore();
  const sx0 = worldToVoxel(region.min[0], CELL);
  const sx1 = worldToVoxel(region.max[0], CELL);
  const sy0 = worldToVoxel(region.min[1], CELL);
  const syC = worldToVoxel(ceilY, CELL);
  const sz0 = worldToVoxel(region.min[2], CELL);
  const sz1 = worldToVoxel(region.max[2], CELL);
  for (let sz = sz0; sz <= sz1; sz++)
    for (let sy = sy0; sy < syC; sy++)
      for (let sx = sx0; sx <= sx1; sx++) setDensity(store, sx, sy, sz, AIR);
  return store;
}

const evalScatter = (
  store: FieldStore,
  params: Record<string, unknown>,
  region: Region,
  seed = 7,
): PlacementRecord[] =>
  evaluateGenerator(SCATTER, params, seed, region, TABLE, "replace", { store })
    .placements;

/** The world-Y of the rising (rock→air) crossing at column (x,z) nearest to
 *  `nearY`, or null — the "within one cell of a crossing" oracle, recomputed from
 *  the store independently of scatter's own scan. */
function nearestRisingCrossingY(
  store: FieldStore,
  x: number,
  z: number,
  region: Region,
  nearY: number,
): number | null {
  const sx = worldToVoxel(x, CELL);
  const sz = worldToVoxel(z, CELL);
  const sy0 = worldToVoxel(region.min[1], CELL);
  const sy1 = worldToVoxel(region.max[1], CELL);
  let best: number | null = null;
  for (let y = sy0; y < sy1; y++) {
    const d0 = getDensity(store, sx, y, sz);
    const d1 = getDensity(store, sx, y + 1, sz);
    if (d0 < 0 && d1 > 0) {
      const cw = (y + d0 / (d0 - d1)) * CELL;
      if (best === null || Math.abs(cw - nearY) < Math.abs(best - nearY))
        best = cw;
    }
  }
  return best;
}

/** Rotate the +Y axis by a unit quaternion — used to read back the baked
 *  orientation (v = q · [0,1,0] · q⁻¹). */
function rotatePlusY(q: PlacementRecord["quat"]): Vec3 {
  const [x, y, z, w] = q;
  // Standard quaternion-vector rotation of (0,1,0).
  return [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
}

const horiz = (a: PlacementRecord, b: PlacementRecord): number => {
  const dx = a.position[0] - b.position[0];
  const dz = a.position[2] - b.position[2];
  return Math.sqrt(dx * dx + dz * dz);
};

describe("scatter — determinism (P-F3-4)", () => {
  test("same carved field + params + seed → deep-equal placement records", () => {
    const region: Region = { min: [0, 0, 0], max: [8, 4, 8] };
    const store = carveFloor(region, 2);
    const p = scatterParams();
    const a = evalScatter(store, p, region, 13);
    const b = evalScatter(store, p, region, 13);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    // …and a different seed re-rolls to a different set
    const c = evalScatter(store, p, region, 14);
    expect(a).not.toEqual(c);
  });
});

describe("scatter — floor hemisphere", () => {
  test("every record sits on a rock→air crossing with an identity-yaw-only quat", () => {
    const region: Region = { min: [0, 0, 0], max: [8, 4, 8] };
    const store = carveFloor(region, 2);
    const records = evalScatter(store, scatterParams(), region);
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      const crossingY = nearestRisingCrossingY(
        store,
        r.position[0],
        r.position[2],
        region,
        r.position[1],
      );
      expect(crossingY).not.toBeNull();
      expect(Math.abs(r.position[1] - (crossingY ?? 0))).toBeLessThanOrEqual(
        CELL,
      );
      // gravity orientation is yaw-ONLY: the quaternion is a pure +Y rotation,
      // so its x and z components are zero.
      expect(r.quat[0]).toBeCloseTo(0, 6);
      expect(r.quat[2]).toBeCloseTo(0, 6);
      const norm2 =
        r.quat[0] ** 2 + r.quat[1] ** 2 + r.quat[2] ** 2 + r.quat[3] ** 2;
      expect(norm2).toBeCloseTo(1, 6);
    }
  });
});

describe("scatter — spacing", () => {
  test("accepted props stay >= minSpacing apart, and some candidates are rejected", () => {
    const region: Region = { min: [0, 0, 0], max: [10, 4, 10] };
    const store = carveFloor(region, 2);
    // density 2 → pitch = minSpacing = 1.0 m; jitter then brings adjacent sites
    // within 1 m, which the greedy filter must reject.
    const records = evalScatter(
      store,
      scatterParams({ density: 2, minSpacing: 1.0 }),
      region,
      3,
    );
    expect(records.length).toBeGreaterThan(0);
    for (let i = 0; i < records.length; i++) {
      const a = records[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < records.length; j++) {
        const b = records[j];
        if (b === undefined) continue;
        expect(horiz(a, b)).toBeGreaterThanOrEqual(1.0 - 1e-9);
      }
    }
  });
});

describe("scatter — ceiling hemisphere", () => {
  test("records hang under rock with normal-aligned quats pointing down", () => {
    const region: Region = { min: [0, 0, 0], max: [8, 4, 8] };
    const store = carveCeiling(region, 2); // air below y=2, rock above
    const records = evalScatter(
      store,
      scatterParams({ hemisphere: "ceiling", orientation: "normal" }),
      region,
    );
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      // the prop hangs at/below the ceiling surface (~2 m)
      expect(r.position[1]).toBeLessThanOrEqual(2 + CELL);
      // orientation:"normal" aligns +Y to the (downward) ceiling normal
      const up = rotatePlusY(r.quat);
      expect(up[1]).toBeLessThan(-0.6);
    }
  });
});

describe("scatter — region bound", () => {
  test("no record lands outside the region AABB", () => {
    const region: Region = { min: [1, 0, 1], max: [7, 4, 7] };
    const store = carveFloor(region, 2);
    const records = evalScatter(
      store,
      scatterParams({ density: 1.5 }),
      region,
      5,
    );
    expect(records.length).toBeGreaterThan(0);
    for (const r of records)
      for (const a of [0, 1, 2] as const) {
        expect(r.position[a]).toBeGreaterThanOrEqual(region.min[a]);
        expect(r.position[a]).toBeLessThanOrEqual(region.max[a]);
      }
  });
});

describe("scatter — variants + scale", () => {
  test("variantIndex stays in [0, variants) and scale in [scaleMin, scaleMax]", () => {
    const region: Region = { min: [0, 0, 0], max: [8, 4, 8] };
    const store = carveFloor(region, 2);
    const records = evalScatter(
      store,
      scatterParams({ variants: 4, scaleMin: 0.5, scaleMax: 1.5 }),
      region,
      9,
    );
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(Number.isInteger(r.variantIndex)).toBe(true);
      expect(r.variantIndex).toBeGreaterThanOrEqual(0);
      expect(r.variantIndex).toBeLessThan(4);
      for (const s of r.scale) {
        expect(s).toBeGreaterThanOrEqual(0.5);
        expect(s).toBeLessThanOrEqual(1.5);
      }
    }
    // variants: 1 pins every record to index 0
    const one = evalScatter(store, scatterParams({ variants: 1 }), region, 9);
    for (const r of one) expect(r.variantIndex).toBe(0);
  });
});

describe("scatter — search budget (setup-loud)", () => {
  test("a lattice past the 4096-candidate cap throws before scanning", () => {
    // 50×50 m footprint at pitch ~0.75 m → ~67² = 4489 sites > 4096.
    const region: Region = { min: [0, 0, 0], max: [50, 4, 50] };
    const store = createFieldStore(); // never read — the cap fires first
    expect(() =>
      evalScatter(
        store,
        scatterParams({ density: 2, minSpacing: 0.25 }),
        region,
      ),
    ).toThrow(/candidate lattice|cap|shrink the region/);
  });
});

describe("scatter — commit path (contextFree:false)", () => {
  test("commitGenerator reads the carved store via ctx and appends a placement op", () => {
    const region: Region = { min: [0, 0, 0], max: [8, 4, 8] };
    const store = carveFloor(region, 2);
    const log = createOpLog();
    const res = commitGenerator(store, log, SCATTER, {
      params: scatterParams(),
      seed: 7,
      region,
      policy: "replace",
      table: TABLE,
    });
    // no field cells written; the span is a single placement op + entity op
    expect(res.dirty.size).toBe(0);
    const placement = log.ops.find((o) => o.kind === "placement");
    expect(placement?.kind).toBe("placement");
    if (placement?.kind !== "placement") return;
    expect(placement.records.length).toBeGreaterThan(0);
    // commit validated every quat as unit-length (assertPlacementsValid), so a
    // non-unit orientation would have thrown before this line.
  });
});

describe("scatter — the contextFree:false ctx guard (carry-forward B)", () => {
  // The setup-loud guard Task 1 added: a contextFree:false def called WITHOUT a
  // ctx is a caller bug. Scatter is the first such def, so this is the first
  // committed exercise of the throw. SABOTAGE: delete the guard in
  // evaluateGenerator and this goes green-then-TypeError / wrong-message → red.
  test("evaluateGenerator throws when scatter is evaluated without an EvaluateContext", () => {
    const region: Region = { min: [0, 0, 0], max: [8, 4, 8] };
    expect(() =>
      evaluateGenerator(
        SCATTER,
        scatterParams(),
        7,
        region,
        TABLE,
        "replace",
        undefined,
      ),
    ).toThrow(/contextFree is false but evaluate was called without an/);
  });
});

describe("scatter — param validation (setup-loud)", () => {
  const region: Region = { min: [0, 0, 0], max: [8, 4, 8] };
  const store = carveFloor(region, 2);
  const cases: { name: string; over: Record<string, unknown>; msg: RegExp }[] =
    [
      {
        name: "empty archetypeId",
        over: { archetypeId: "" },
        msg: /archetypeId/,
      },
      {
        name: "density out of range",
        over: { density: 999 },
        msg: /density must be a number/,
      },
      {
        name: "scaleMax < scaleMin",
        over: { scaleMin: 2, scaleMax: 1 },
        msg: /scaleMax .* must be >= scaleMin/,
      },
      {
        name: "unknown orientation",
        over: { orientation: "sideways" },
        msg: /orientation must be one of/,
      },
      {
        name: "non-integer variants",
        over: { variants: 2.5 },
        msg: /variants must be an integer/,
      },
    ];
  for (const c of cases)
    test(`${c.name} throws`, () => {
      expect(() => evalScatter(store, scatterParams(c.over), region)).toThrow(
        c.msg,
      );
    });
});
