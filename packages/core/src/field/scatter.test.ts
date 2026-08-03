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
import { evaluateGenerator } from "./generators.ts";

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

// Carves a vertical wall: a rock half-space on one side of a sample plane along
// `axis` (0=x, 2=z), air the other side. `rockLow` = rock at sample ≤ boundary.
// Region samples run 0..24 (world [0,6] at cell 0.25).
const WALL_REGION: Region = { min: [0, 0, 0], max: [6, 6, 6] };
function carveWall(
  axis: 0 | 2,
  boundary: number,
  rockLow: boolean,
): FieldStore {
  const store = createFieldStore();
  const sMax = worldToVoxel(WALL_REGION.max[0], CELL);
  for (let sz = 0; sz <= sMax; sz++)
    for (let sy = 0; sy <= sMax; sy++)
      for (let sx = 0; sx <= sMax; sx++) {
        const along = axis === 0 ? sx : sz;
        const isAir = rockLow ? along > boundary : along < boundary;
        if (isAir) setDensity(store, sx, sy, sz, AIR);
      }
  return store;
}

describe("scatter — wall hemisphere (all four faces)", () => {
  // The crossing between the last air sample and the first rock sample lands at
  // (boundary ± 0.5)·cell for a hard AIR/SOLID wall. Props sit one tiny normal
  // offset onto the AIR side. −X/−Z scans exercise the signed-step interpolant:
  // SABOTAGE ANCHOR — drop the scan direction from `crossingWorld` (Fix 1) and
  // the −X/−Z props float a full cell into open air → their `|pos − crossing|`
  // blows past the half-cell bound below.
  const faces = [
    {
      name: "-X",
      axis: 0 as const,
      boundary: 8,
      rockLow: true,
      crossing: 2.125,
    },
    {
      name: "+X",
      axis: 0 as const,
      boundary: 16,
      rockLow: false,
      crossing: 3.875,
    },
    {
      name: "-Z",
      axis: 2 as const,
      boundary: 8,
      rockLow: true,
      crossing: 2.125,
    },
    {
      name: "+Z",
      axis: 2 as const,
      boundary: 16,
      rockLow: false,
      crossing: 3.875,
    },
  ];
  for (const f of faces)
    test(`${f.name} wall: every prop sits on the AIR side of the crossing, normal horizontal`, () => {
      const store = carveWall(f.axis, f.boundary, f.rockLow);
      const records = evalScatter(
        store,
        scatterParams({
          hemisphere: "wall",
          orientation: "normal",
          density: 2,
          minSpacing: 0.5,
        }),
        WALL_REGION,
      );
      expect(records.length).toBeGreaterThan(0);
      const boundaryWorld = f.boundary * CELL;
      for (const r of records) {
        // on the CORRECT side, within half a cell of the true vertical crossing
        // (the bug puts −X/−Z props a full cell out into the air)
        expect(Math.abs(r.position[f.axis] - f.crossing)).toBeLessThanOrEqual(
          0.5 * CELL,
        );
        // air side: rock-low walls put air ABOVE the plane, rock-high BELOW it
        if (f.rockLow)
          expect(r.position[f.axis]).toBeGreaterThan(boundaryWorld);
        else expect(r.position[f.axis]).toBeLessThan(boundaryWorld);
        // a wall normal is horizontal
        expect(Math.abs(rotatePlusY(r.quat)[1])).toBeLessThan(0.4);
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

  // Pins the empty-scatter contract, SETTLED at F3b Task 10: core stays strict
  // — a scatter that finds no surfaces evaluates to {ops:[], placements:[]},
  // which commitGenerator rejects setup-loud like any empty generator result,
  // and atomically (nothing mutated). Zero props is a legitimate outcome for a
  // READER generator, so the legibility fix lives in the EDITOR, which tests the
  // settled preview and refuses before calling core (FieldHost's
  // `reportEmptyPreview` / field-stamp's `previewIsEmpty`). Do not relax this.
  test("a scatter that finds no surfaces throws 'empty result' with nothing mutated", () => {
    const region: Region = { min: [0, 0, 0], max: [8, 4, 8] };
    const store = createFieldStore(); // all-solid: no rock→air crossings anywhere
    const log = createOpLog();
    expect(() =>
      commitGenerator(store, log, SCATTER, {
        params: scatterParams(),
        seed: 7,
        region,
        policy: "replace",
        table: TABLE,
      }),
    ).toThrow(/empty result/);
    expect(store.chunks.size).toBe(0);
    expect(log.ops.length).toBe(0);
    expect(log.nextId).toBe(1);
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

describe("scatter — sample-aligned crossings (F3b gate fix)", () => {
  /** Overwrites one horizontal sample layer with exact-zero density — the
   *  pattern a quantized cave floor/ceiling produces when its surface lands ON
   *  a sample plane (`clampInt8(sdf·SCALE)` = 0 there), which the strict
   *  `d0 < 0 && d1 > 0` crossing test is blind to. */
  const zeroLayer = (
    store: FieldStore,
    region: Region,
    worldY: number,
  ): void => {
    const sy = worldToVoxel(worldY, CELL);
    for (
      let sz = worldToVoxel(region.min[2], CELL);
      sz <= worldToVoxel(region.max[2], CELL);
      sz++
    )
      for (
        let sx = worldToVoxel(region.min[0], CELL);
        sx <= worldToVoxel(region.max[0], CELL);
        sx++
      )
        setDensity(store, sx, sy, sz, 0);
  };

  test("a floor whose boundary sample is exactly zero still receives placements", () => {
    const region: Region = { min: [0, 0, 0], max: [8, 4, 8] };
    const store = carveFloor(region, 2);
    zeroLayer(store, region, 2); // …rock, 0, air… — no strict sign flip left
    const records = evalScatter(store, scatterParams(), region);
    expect(records.length).toBeGreaterThan(0);
    // The crossing is exactly on the sample plane; records seat on it.
    for (const r of records)
      expect(Math.abs(r.position[1] - 2)).toBeLessThanOrEqual(CELL);
  });

  test("a zero membrane with NO rock beneath is not a floor (rock-evidence guard)", () => {
    const region: Region = { min: [0, 0, 0], max: [8, 4, 8] };
    const store = carveFloor(region, 1); // air everywhere above y=1
    zeroLayer(store, region, 2); // a floating zero layer inside open air
    const records = evalScatter(store, scatterParams(), region);
    // Placements may exist (the REAL floor at y=1 is intact), but none may
    // seat on the phantom membrane at y=2.
    for (const r of records)
      expect(Math.abs(r.position[1] - 2)).toBeGreaterThan(CELL / 2);
  });

  test("a ceiling whose boundary sample is exactly zero still receives placements", () => {
    const region: Region = { min: [0, 0, 0], max: [8, 4, 8] };
    const store = carveCeiling(region, 2);
    zeroLayer(store, region, 2); // …air, 0, rock… upward
    const records = evalScatter(
      store,
      scatterParams({ hemisphere: "ceiling", orientation: "normal" }),
      region,
    );
    expect(records.length).toBeGreaterThan(0);
  });

  test("a default cave's floors receive a real population (the gate repro)", () => {
    const store = createFieldStore();
    const log = createOpLog();
    const cave = generatorById("cave");
    const region: Region = { min: [0, 0, 0], max: [20, 10, 20] };
    commitGenerator(store, log, cave, {
      params: structuredClone(cave.defaults) as Record<string, unknown>,
      seed: 1,
      region,
      policy: "replace",
      table: TABLE,
    });
    const records = evalScatter(store, scatterParams(), region, 7);
    // Pre-fix this exact fixture yielded THREE records over a 20×20 m footprint
    // — the quantized floors were invisible to the strict test. Post-fix it
    // measures 11 against a 71 m² carved footprint (density 0.3/m² ⇒ ~21 before
    // jitter + hemisphere/spacing filters). The floor is deliberately loose so
    // cave tuning survives it.
    expect(records.length).toBeGreaterThanOrEqual(8);
  });
});
