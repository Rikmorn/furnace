import { describe, expect, test } from "bun:test";
import type {
  BrushOp,
  CaveChamber,
  CavePassage,
  CaveSkeleton,
  FieldOp,
  FieldStore,
  MergePolicy,
  PatchOp,
} from "@furnace/core/field";
import {
  applyOp,
  applyPatchOp,
  BUILTIN_TABLE,
  buildCaveSkeleton,
  commitGenerator,
  createFieldStore,
  createOpLog,
  DEFAULT_CELL_SIZE,
  DENSITY_SCALE,
  generatorById,
  getDensity,
  SOLID,
  serializeOps,
} from "@furnace/core/field";
import {
  BOUNDS_MARGIN,
  CHAMBER_NOISE_AMP,
  INFLUENCE_MARGIN,
  MAX_GRADE,
  MAX_SWITCHBACKS,
  MIN_TREAD,
  PASSAGE_NOISE_AMP,
  RISER,
} from "../src/field/cave.ts";

// Geometric assertions derived from the skeleton (the W2/W3 posture) — never
// lattice-aligned freebies. Each has teeth (sabotage-verified during dev).

const EPS = 1e-6;
type Extent = [number, number, number];
type Vec3 = [number, number, number];

const horiz = (a: Vec3, b: Vec3): number => {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dz * dz);
};

// ─── connectivity (inductive): union-find over passages ∪ mouths ───
/** True iff every chamber AND every mouth lands in ONE connected component —
 *  equivalent to "every chamber reachable from every mouth". */
function allConnected(sk: CaveSkeleton): boolean {
  const N = sk.chambers.length;
  const M = sk.mouths.length;
  if (N === 0) return M === 0;
  const parent = Array.from({ length: N + M }, (_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) {
      parent[r] = parent[parent[r]!]!;
      r = parent[r]!;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  const mouthNodeAt = (p: Vec3): number => {
    for (let m = 0; m < M; m++) {
      const at = sk.mouths[m]!.at;
      const d =
        Math.abs(at[0] - p[0]) +
        Math.abs(at[1] - p[1]) +
        Math.abs(at[2] - p[2]);
      if (d < EPS) return N + m;
    }
    return -1;
  };
  for (const pass of sk.passages) {
    const nFrom = pass.from >= 0 ? pass.from : mouthNodeAt(pass.waypoints[0]!);
    const nTo =
      pass.to >= 0
        ? pass.to
        : mouthNodeAt(pass.waypoints[pass.waypoints.length - 1]!);
    if (nFrom < 0 || nTo < 0) return false; // an unresolved terminal
    union(nFrom, nTo);
  }
  const root = find(0);
  for (let i = 1; i < N; i++) if (find(i) !== root) return false;
  for (let m = 0; m < M; m++) if (find(N + m) !== root) return false;
  return true;
}

// ─── grade budget ───
function assertGradeBudget(sk: CaveSkeleton): void {
  for (const pass of sk.passages) {
    expect(pass.waypoints.length).toBe(pass.floorY.length);
    for (let k = 0; k < pass.waypoints.length; k++) {
      // floorY is the waypoint's own Y (parallel, consistent).
      expect(pass.floorY[k]!).toBeCloseTo(pass.waypoints[k]![1], 6);
      // every floor is a RISER multiple.
      const q = pass.floorY[k]! / RISER;
      expect(Math.abs(q - Math.round(q))).toBeLessThan(EPS);
    }
    for (let k = 0; k + 1 < pass.waypoints.length; k++) {
      const dY = pass.floorY[k + 1]! - pass.floorY[k]!;
      const run = horiz(pass.waypoints[k]!, pass.waypoints[k + 1]!);
      // the riser is a RISER multiple.
      const q = dY / RISER;
      expect(Math.abs(q - Math.round(q))).toBeLessThan(EPS);
      if (Math.abs(dY) > EPS) {
        // between risers: run >= MIN_TREAD and grade <= MAX_GRADE.
        expect(run).toBeGreaterThanOrEqual(MIN_TREAD - EPS);
        expect(Math.abs(dY) / run).toBeLessThanOrEqual(MAX_GRADE + EPS);
      }
    }
    if (pass.kind === "switchback") {
      let reversals = 0;
      for (let k = 0; k + 2 < pass.waypoints.length; k++) {
        const a = pass.waypoints[k]!;
        const b = pass.waypoints[k + 1]!;
        const c = pass.waypoints[k + 2]!;
        const d0x = b[0] - a[0];
        const d0z = b[2] - a[2];
        const d1x = c[0] - b[0];
        const d1z = c[2] - b[2];
        if (d0x * d1x + d0z * d1z < -EPS) reversals++;
      }
      expect(reversals).toBeGreaterThanOrEqual(1);
    }
  }
}

// ─── bounds ───
const MARGIN = BOUNDS_MARGIN; // derived, not hardcoded — the 1-cell inset

function assertInBounds(sk: CaveSkeleton, extent: Extent): void {
  const within = (v: Vec3, r: number): void => {
    for (const ax of [0, 1, 2] as const) {
      expect(v[ax] - r).toBeGreaterThanOrEqual(MARGIN - EPS);
      expect(v[ax] + r).toBeLessThanOrEqual(extent[ax] - MARGIN + EPS);
    }
  };
  for (const c of sk.chambers) {
    for (const b of c.blobs) {
      within(
        [
          c.center[0] + b.offset[0],
          c.center[1] + b.offset[1],
          c.center[2] + b.offset[2],
        ],
        b.radius,
      );
    }
  }
  for (const pass of sk.passages) for (const w of pass.waypoints) within(w, 0);
  for (const m of sk.mouths) within(m.at, 0);
}

// ─── configs ───
const DEFAULT_EXTENT: Extent = [20, 10, 20];
const CONFIGS: {
  params: Record<string, unknown>;
  extent: Extent;
  seed: number;
}[] = [
  { params: {}, extent: DEFAULT_EXTENT, seed: 1 },
  { params: {}, extent: DEFAULT_EXTENT, seed: 2 },
  {
    params: { chambers: 6, verticality: 1, extraLoops: 3 },
    extent: [30, 14, 24],
    seed: 7,
  },
  { params: { chambers: 4, verticality: 0.9 }, extent: [24, 12, 24], seed: 11 },
  {
    params: { chambers: 2, verticality: 1, chamberRadius: 3 },
    extent: [6, 20, 6],
    seed: 3,
  },
  {
    params: { chambers: 2, verticality: 1, chamberRadius: 3 },
    extent: [12, 12, 12],
    seed: 5,
  },
];

describe("cave skeleton — determinism", () => {
  test("same (params, seed, extent) → deep-equal", () => {
    for (const c of CONFIGS) {
      const a = buildCaveSkeleton(c.params, c.seed, c.extent);
      const b = buildCaveSkeleton(c.params, c.seed, c.extent);
      expect(a).toEqual(b);
    }
  });
  test("seed + 1 → different skeleton", () => {
    const c = CONFIGS[0]!;
    const a = buildCaveSkeleton(c.params, c.seed, c.extent);
    const b = buildCaveSkeleton(c.params, c.seed + 1, c.extent);
    expect(a).not.toEqual(b);
  });
});

describe("cave skeleton — connectivity (inductive)", () => {
  test("every chamber reachable from every mouth", () => {
    for (const c of CONFIGS)
      expect(allConnected(buildCaveSkeleton(c.params, c.seed, c.extent))).toBe(
        true,
      );
  });

  test("checker has teeth: dropping any tree passage disconnects", () => {
    // extraLoops: 0 ⇒ a pure spanning tree, so dropping ANY passage between two
    // chambers splits the graph. (Mouth passages are leaves; dropping one
    // isolates that mouth.)
    const sk = buildCaveSkeleton(
      { chambers: 5, extraLoops: 0, verticality: 0.6 },
      42,
      [26, 12, 26],
    );
    expect(allConnected(sk)).toBe(true);
    expect(sk.passages.length).toBeGreaterThan(0);
    for (let i = 0; i < sk.passages.length; i++) {
      const dropped: CaveSkeleton = {
        ...sk,
        passages: sk.passages.filter((_, idx) => idx !== i),
      };
      expect(allConnected(dropped)).toBe(false);
    }
  });
});

describe("cave skeleton — grade budget", () => {
  test("every passage honors risers, tread, grade", () => {
    for (const c of CONFIGS)
      assertGradeBudget(buildCaveSkeleton(c.params, c.seed, c.extent));
  });

  test("a tall, narrow region produces a switchback (≥1 reversal)", () => {
    // Vertically-separated chambers with little horizontal room ⇒ the straight
    // grade budget is blown ⇒ switchback edge types.
    const sk = buildCaveSkeleton(
      { chambers: 2, verticality: 1, chamberRadius: 3, extraLoops: 0 },
      3,
      [6, 20, 6],
    );
    const kinds = sk.passages.map((p) => p.kind);
    expect(kinds).toContain("switchback");
    assertGradeBudget(sk); // reversal assertion runs inside for switchbacks
  });

  test("MAX_SWITCHBACKS caps reversals", () => {
    for (const c of CONFIGS) {
      const sk = buildCaveSkeleton(c.params, c.seed, c.extent);
      for (const pass of sk.passages) {
        if (pass.kind !== "switchback") continue;
        let reversals = 0;
        for (let k = 0; k + 2 < pass.waypoints.length; k++) {
          const a = pass.waypoints[k]!;
          const b = pass.waypoints[k + 1]!;
          const d = pass.waypoints[k + 2]!;
          if (
            (b[0] - a[0]) * (d[0] - b[0]) + (b[2] - a[2]) * (d[2] - b[2]) <
            -EPS
          )
            reversals++;
        }
        expect(reversals).toBeLessThanOrEqual(MAX_SWITCHBACKS);
      }
    }
  });
});

// ─── endpoint delivery (Δy): the residual switchback/clamp gap is bounded and
//     visible, so Task 4 gets a clean signal instead of a silent disconnect ───
describe("cave skeleton — endpoint delivery (Δy)", () => {
  const chamberFloorY = (c: CaveSkeleton["chambers"][number]): number =>
    c.center[1] - c.radii[1];

  // How far a passage's last floorY lands from the floor it should reach.
  // Straight passages and fully-fitted switchbacks land EXACTLY; only an
  // over-budget switchback/clamp (extreme aspect ratio) lands short.
  const endpointGap = (
    sk: CaveSkeleton,
    pass: CaveSkeleton["passages"][number],
  ): number => {
    const endY = pass.floorY[pass.floorY.length - 1]!;
    if (pass.to >= 0)
      return Math.abs(endY - chamberFloorY(sk.chambers[pass.to]!));
    return Math.abs(endY - pass.floorY[0]!); // mouth passages are level
  };

  // The full climb the passage was asked to deliver (from-floor → to-floor).
  const intendedDy = (
    sk: CaveSkeleton,
    pass: CaveSkeleton["passages"][number],
  ): number => {
    const fromFloor = chamberFloorY(sk.chambers[pass.from]!); // from is always ≥ 0
    if (pass.to < 0) return 0; // mouth passages are level
    return Math.abs(chamberFloorY(sk.chambers[pass.to]!) - fromFloor);
  };

  test("start waypoint always sits on the from-chamber floor", () => {
    for (const c of CONFIGS) {
      const sk = buildCaveSkeleton(c.params, c.seed, c.extent);
      for (const pass of sk.passages)
        expect(pass.floorY[0]!).toBeCloseTo(
          chamberFloorY(sk.chambers[pass.from]!),
          6,
        );
    }
  });

  test("realistic (roomy) regions deliver the FULL climb (endpoint on the far floor)", () => {
    for (const c of CONFIGS) {
      const roomy = c.extent[0] >= 10 && c.extent[2] >= 10;
      if (!roomy) continue;
      const sk = buildCaveSkeleton(c.params, c.seed, c.extent);
      for (const pass of sk.passages)
        expect(endpointGap(sk, pass)).toBeLessThan(EPS);
    }
  });

  test("over-budget regions under-deliver by a BOUNDED amount (no overshoot, gap ≤ intended Δy)", () => {
    // A clamped passage delivers a PREFIX of the climb: it never climbs MORE
    // than intended (no overshoot), so its shortfall is at most the whole
    // intended Δy. The residual is explicit and tested — the visible D-F3-11
    // limitation, not a silent disconnect. See
    // docs/backlog/dungeon/cave-chamber-floor-reconciliation.md.
    for (const c of CONFIGS) {
      const sk = buildCaveSkeleton(c.params, c.seed, c.extent);
      for (const pass of sk.passages) {
        const deliveredDy = Math.abs(
          pass.floorY[pass.floorY.length - 1]! - pass.floorY[0]!,
        );
        const intended = intendedDy(sk, pass);
        expect(deliveredDy).toBeLessThanOrEqual(intended + EPS); // never overshoots
        expect(endpointGap(sk, pass)).toBeLessThanOrEqual(intended + EPS);
      }
    }
  });

  test("the tall-narrow region is the one that clamps (the bound isn't vacuous)", () => {
    const sk = buildCaveSkeleton(
      { chambers: 2, verticality: 1, chamberRadius: 3, extraLoops: 0 },
      3,
      [6, 20, 6],
    );
    const maxGap = Math.max(...sk.passages.map((p) => endpointGap(sk, p)));
    expect(maxGap).toBeGreaterThan(EPS); // ≥ 1 passage genuinely lands short
  });
});

describe("cave skeleton — bounds", () => {
  test("every chamber blob and waypoint stays inside extent − 1 cell", () => {
    for (const c of CONFIGS)
      assertInBounds(buildCaveSkeleton(c.params, c.seed, c.extent), c.extent);
  });

  test("holds unconditionally, even for a sub-margin extent", () => {
    // The carver relies on "never writes outside the region", so radii shrink
    // to fit ANY extent. This bites only when extent/2 − margin < the radius
    // floor: a [1,1,1] m box (half-extent 0.5, in-bounds room 0.25) is the
    // smallest that must still not overhang — [2,2,2] leaves 0.75 m and would
    // pass even unfixed (sabotage-verified: [1,1,1] is the one with teeth).
    for (const tiny of [
      [1, 1, 1],
      [1.4, 1.4, 1.4],
    ] as Extent[])
      assertInBounds(buildCaveSkeleton({ chambers: 3 }, 9, tiny), tiny);
  });
});

describe("cave skeleton — mouths honor the door convention", () => {
  const EXT: Extent = [20, 10, 20];

  test("doorNorth: true yields a north-face mouth", () => {
    const sk = buildCaveSkeleton({ doorNorth: true }, 1, EXT);
    expect(sk.mouths.filter((m) => m.face === "north").length).toBe(1);
  });

  test("default enables north only", () => {
    const sk = buildCaveSkeleton({}, 1, EXT);
    expect(sk.mouths.map((m) => m.face)).toEqual(["north"]);
  });

  test("all four faces enable four mouths", () => {
    const sk = buildCaveSkeleton(
      { doorNorth: true, doorSouth: true, doorEast: true, doorWest: true },
      1,
      EXT,
    );
    expect(sk.mouths.map((m) => m.face).sort()).toEqual([
      "east",
      "north",
      "south",
      "west",
    ]);
  });

  test("doorNorthOffset moves the mouth laterally", () => {
    const lo = buildCaveSkeleton(
      { doorNorth: true, doorNorthOffset: 3 },
      1,
      EXT,
    );
    const hi = buildCaveSkeleton(
      { doorNorth: true, doorNorthOffset: 15 },
      1,
      EXT,
    );
    const nLo = lo.mouths.find((m) => m.face === "north")!;
    const nHi = hi.mouths.find((m) => m.face === "north")!;
    // north face runs along X — the lateral coord is X, and it tracks the offset.
    expect(nLo.at[0]).toBeCloseTo(3, 6);
    expect(nHi.at[0]).toBeCloseTo(15, 6);
  });

  test("offset −1 auto-centres (mirrors the hall/maze sentinel)", () => {
    const sentinel = buildCaveSkeleton(
      { doorNorth: true, doorNorthOffset: -1 },
      1,
      EXT,
    );
    const absent = buildCaveSkeleton({ doorNorth: true }, 1, EXT);
    const nS = sentinel.mouths.find((m) => m.face === "north")!;
    const nA = absent.mouths.find((m) => m.face === "north")!;
    expect(nS.at[0]).toBeCloseTo(EXT[0] / 2, 6); // centred on X
    expect(nA.at).toEqual(nS.at); // absent key ≡ the −1 sentinel
  });

  test("east/west mouths track the offset along Z", () => {
    const sk = buildCaveSkeleton({ doorEast: true, doorEastOffset: 4 }, 1, EXT);
    const e = sk.mouths.find((m) => m.face === "east")!;
    expect(e.at[2]).toBeCloseTo(4, 6);
    expect(e.at[0]).toBeCloseTo(EXT[0] - MARGIN, 6); // on the +X face
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CARVE (Task 3): the caveGenerator compiles the skeleton into patch ops. These
// evaluate a cave into a fresh store (apply its patch ops) and read the DENSITY
// field back — never lattice freebies; each assertion samples the carved field.
// ─────────────────────────────────────────────────────────────────────────────

const H = DEFAULT_CELL_SIZE; // 0.25 m sample spacing
type Region = { min: Vec3; max: Vec3 };
const CAVE_REGION: Region = { min: [0, 0, 0], max: [20, 10, 20] };
const CAVE = generatorById("cave");

/** Full params from the schema defaults (the editor form seeds evaluate from
 *  these) merged with overrides — evaluate is strict, like hall/maze. */
const withDefaults = (
  params: Record<string, unknown>,
): Record<string, unknown> => ({
  ...CAVE.defaults,
  ...params,
});

/** Evaluate a cave and apply its patch ops into a fresh (or supplied) store. */
function carve(
  params: Record<string, unknown>,
  seed: number,
  policy: MergePolicy,
  region: Region = CAVE_REGION,
  store: FieldStore = createFieldStore(),
): FieldStore {
  const { ops } = CAVE.evaluate(
    withDefaults(params),
    seed,
    region,
    BUILTIN_TABLE,
    policy,
  );
  for (const op of ops)
    if (op.kind === "patch") applyPatchOp(store, op as PatchOp);
  return store;
}

/** Density at a WORLD point (nearest sample). Region min is [0,0,0] in every
 *  carve test so world == region-local. */
const dAt = (s: FieldStore, wx: number, wy: number, wz: number): number =>
  getDensity(s, Math.round(wx / H), Math.round(wy / H), Math.round(wz / H));

const chamberFloorY = (c: CaveChamber): number => c.center[1] - c.radii[1];

/** Population variance of a sample set. */
function variance(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length;
}

/** March a ray from `o` along unit `(ux,uy,uz)` and return the distance to the
 *  first air→rock surface crossing (linearly interpolated), or null. `o` must
 *  start in air. A surface-ROUGHNESS probe: the variance of crossing distances
 *  over a fan of rays measures how bumpy that surface is. Uses cos/sin/hypot
 *  freely (a test, not the Pr-2-constrained carver). */
function rayHitDist(
  s: FieldStore,
  o: Vec3,
  ux: number,
  uy: number,
  uz: number,
  rMax: number,
): number | null {
  let prev = dAt(s, o[0], o[1], o[2]);
  for (let step = 1; step * H <= rMax; step++) {
    const r = step * H;
    const cur = dAt(s, o[0] + ux * r, o[1] + uy * r, o[2] + uz * r);
    if (prev >= 0 && cur < 0) return r - H + (H * prev) / (prev - cur);
    prev = cur;
  }
  return null;
}

/** Surface-crossing radii from a chamber's centre, on a fixed-elevation fan
 *  (45° above centre — the wall/ceiling band, clear of floor-anchored passages).
 *  Fixed elevation holds the ellipsoid cross-section constant, so the variance
 *  isolates AZIMUTHAL surface roughness (the noise dial), not the chamber's
 *  base shape. */
function chamberSurfaceRadii(s: FieldStore, c: CaveChamber): number[] {
  const rMax = Math.max(c.radii[0], c.radii[1], c.radii[2]) + 3;
  const el = Math.PI / 4;
  const out: number[] = [];
  for (let i = 0; i < 48; i++) {
    const az = (i / 48) * 2 * Math.PI;
    const r = rayHitDist(
      s,
      c.center,
      Math.cos(el) * Math.cos(az),
      Math.sin(el),
      Math.cos(el) * Math.sin(az),
      rMax,
    );
    if (r !== null) out.push(r);
  }
  return out;
}

/** Perpendicular wall-crossing distances along a passage at walk height — the
 *  passage-profile ROUGHNESS probe. Mined (square) walls sit at a constant
 *  half-width (low variance); organic (round + noise) walls wobble. */
function passageWallDists(s: FieldStore, p: CavePassage): number[] {
  const out: number[] = [];
  for (let i = 1; i + 1 < p.waypoints.length; i++) {
    const a = p.waypoints[i - 1]!;
    const b = p.waypoints[i + 1]!;
    const w = p.waypoints[i]!;
    const tx = b[0] - a[0];
    const tz = b[2] - a[2];
    const tl = Math.hypot(tx, tz) || 1;
    const px = -tz / tl;
    const pz = tx / tl;
    const o: Vec3 = [w[0], w[1] + 1.5, w[2]]; // walk-height centre of the tube
    // Cap at 2 m: a true passage wall sits ~1 m out; a ray that finds no wall
    // within 2 m has run into a merged chamber (no crisp wall there) and is
    // excluded, so this measures ONLY the passage's own profile.
    for (const sgn of [-1, 1] as const) {
      const r = rayHitDist(s, o, sgn * px, 0, sgn * pz, 2);
      if (r !== null) out.push(r);
    }
  }
  return out;
}

/** The solid→air crossing height in a vertical column at (wx,wz), scanning
 *  [yLo,yHi] and linearly interpolating the first sign change (Surface-Nets
 *  style). null if the column never crosses. */
function columnCrossing(
  s: FieldStore,
  wx: number,
  wz: number,
  yLo: number,
  yHi: number,
): number | null {
  const sx = Math.round(wx / H);
  const sz = Math.round(wz / H);
  const yi0 = Math.round(yLo / H);
  const yi1 = Math.round(yHi / H);
  let prev = getDensity(s, sx, yi0, sz);
  for (let yi = yi0 + 1; yi <= yi1; yi++) {
    const cur = getDensity(s, sx, yi, sz);
    if (prev < 0 && cur >= 0) {
      const t = (0 - prev) / (cur - prev);
      return (yi - 1 + t) * H;
    }
    prev = cur;
  }
  return null;
}

describe("cave carve — walk-height clearance (default cave)", () => {
  const WALK_HEIGHTS = [0.5, 1.0, 1.5, 2.0, 2.5];

  test("air at every chamber centre and passage waypoint, floorY+0.5..+2.5", () => {
    const store = carve({}, 1, "replace");
    const sk = buildCaveSkeleton({}, 1, CAVE_REGION.max);
    for (const c of sk.chambers) {
      const fy = chamberFloorY(c);
      for (const h of WALK_HEIGHTS)
        expect(dAt(store, c.center[0], fy + h, c.center[2])).toBeGreaterThan(0);
    }
    for (const p of sk.passages)
      for (const w of p.waypoints)
        for (const h of WALK_HEIGHTS)
          expect(dAt(store, w[0], w[1] + h, w[2])).toBeGreaterThan(0);
  });
});

describe("cave carve — replace fills rock outside carved space", () => {
  test("pre-existing air outside the carve becomes rock under replace", () => {
    // Teeth: pre-fill the whole region with air, then a replace cave must
    // overwrite the uncarved cells with rock (not leave them air).
    const store = createFieldStore();
    applyOp(
      store,
      {
        id: 0,
        kind: "brush",
        effect: "dig",
        shape: { kind: "box", center: [10, 5, 10], halfExtents: [10, 5, 10] },
      } satisfies BrushOp,
      BUILTIN_TABLE,
    );
    carve({}, 1, "replace", CAVE_REGION, store);
    // Count rock vs air over the region interior.
    let rock = 0;
    let total = 0;
    for (let sx = 1; sx < 80; sx += 2)
      for (let sy = 1; sy < 40; sy += 2)
        for (let sz = 1; sz < 80; sz += 2) {
          total++;
          if (getDensity(store, sx, sy, sz) < 0) rock++;
        }
    // A cave carves a minority of its bounding volume; most of the region is
    // rock after replace. Sabotage (skip solid emission) → rock ≈ 0 → fails.
    expect(rock / total).toBeGreaterThan(0.4);
  });
});

describe("cave carve — keep-existing-air masks only carved cells", () => {
  test("pre-existing air survives where the cave did not carve", () => {
    const store = createFieldStore();
    applyOp(
      store,
      {
        id: 0,
        kind: "brush",
        effect: "dig",
        shape: { kind: "box", center: [10, 5, 10], halfExtents: [10, 5, 10] },
      } satisfies BrushOp,
      BUILTIN_TABLE,
    );
    carve({}, 1, "keep-existing-air", CAVE_REGION, store);
    // Under keep-existing-air the patch masks ONLY carved (air) cells, so it can
    // never turn a cell to rock. The pre-filled region stays entirely air.
    let rock = 0;
    for (let sx = 1; sx < 80; sx += 2)
      for (let sy = 1; sy < 40; sy += 2)
        for (let sz = 1; sz < 80; sz += 2)
          if (getDensity(store, sx, sy, sz) < 0) rock++;
    expect(rock).toBe(0);
  });

  test("contrast: the SAME cave under replace does turn cells to rock", () => {
    const air = createFieldStore();
    const box: BrushOp = {
      id: 0,
      kind: "brush",
      effect: "dig",
      shape: { kind: "box", center: [10, 5, 10], halfExtents: [10, 5, 10] },
    };
    applyOp(air, box, BUILTIN_TABLE);
    carve({}, 1, "replace", CAVE_REGION, air);
    let rock = 0;
    for (let sx = 1; sx < 80; sx += 4)
      for (let sy = 1; sy < 40; sy += 4)
        for (let sz = 1; sz < 80; sz += 4)
          if (getDensity(air, sx, sy, sz) < 0) rock++;
    expect(rock).toBeGreaterThan(0);
  });
});

describe("cave carve — protected stepped floors (0.25 m quanta)", () => {
  // A vertical, roomy config that produces genuinely STEPPED passages so the
  // floor quantization is exercised (a level passage would be vacuous).
  const STEP_PARAMS = {
    theme: "mined",
    chambers: 4,
    verticality: 1,
    chamberRadius: 5,
    extraLoops: 0,
  };
  const STEP_SEED = 7;

  test("passage floor crossings quantize to 0.25 m at waypoints AND midpoints", () => {
    const store = carve(STEP_PARAMS, STEP_SEED, "replace");
    const sk = buildCaveSkeleton(STEP_PARAMS, STEP_SEED, CAVE_REGION.max);
    const stepped = sk.passages.filter((p: CavePassage) =>
      p.floorY.some((y, i) => i > 0 && Math.abs(y - p.floorY[i - 1]!) > EPS),
    );
    expect(stepped.length).toBeGreaterThan(0); // the config really does step
    let checked = 0;
    for (const p of stepped) {
      for (let i = 0; i + 1 < p.waypoints.length; i++) {
        const a = p.waypoints[i]!;
        const b = p.waypoints[i + 1]!;
        // Sample the waypoint and the segment midpoint — the midpoint is where
        // an un-quantized (raw-lerp) floor would land off the 0.25 grid.
        for (const [wx, wz] of [
          [a[0], a[2]],
          [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2],
        ] as const) {
          const fy = Math.max(a[1], b[1]);
          const cross = columnCrossing(store, wx, wz, fy - 2, fy + 3);
          if (cross === null) continue;
          const q = cross / RISER;
          expect(Math.abs(q - Math.round(q))).toBeLessThan(0.06); // within 0.06·0.25
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("cave carve — themes (noise dial)", () => {
  const THEME_PARAMS = {
    chambers: 3,
    chamberRadius: 6,
    verticality: 0.4,
    roughness: 1,
    extraLoops: 1,
  };
  const THEME_SEED = 4;

  /** Variance of chamber 0's surface-crossing radii (its wall roughness). */
  function chamberWallVar(theme: string): number {
    const store = carve({ ...THEME_PARAMS, theme }, THEME_SEED, "replace");
    const sk = buildCaveSkeleton(THEME_PARAMS, THEME_SEED, CAVE_REGION.max);
    return variance(chamberSurfaceRadii(store, sk.chambers[0]!));
  }

  test("organic chamber walls are rougher (higher radius variance) than mined", () => {
    const mined = chamberWallVar("mined");
    const organic = chamberWallVar("organic");
    expect(organic).toBeGreaterThan(mined);
  });

  test("mixed: chambers get organic noise, passages stay mined-crisp", () => {
    const mixed = carve(
      { ...THEME_PARAMS, theme: "mixed" },
      THEME_SEED,
      "replace",
    );
    const minedAll = carve(
      { ...THEME_PARAMS, theme: "mined" },
      THEME_SEED,
      "replace",
    );
    const sk = buildCaveSkeleton(THEME_PARAMS, THEME_SEED, CAVE_REGION.max);
    const c = sk.chambers[0]!;
    const mixedChamberVar = variance(chamberSurfaceRadii(mixed, c));
    // (a) mixed chambers ARE displaced — rougher than the all-mined cave's SAME
    // chamber (isolates the organic noise the mixed theme routes to chambers).
    expect(mixedChamberVar).toBeGreaterThan(
      variance(chamberSurfaceRadii(minedAll, c)),
    );
    // (b) mixed passages stay crisp — their wall roughness sits well below the
    // (organic) chamber's.
    const p = sk.passages.find((q: CavePassage) => q.waypoints.length >= 3)!;
    expect(variance(passageWallDists(mixed, p))).toBeLessThan(mixedChamberVar);
  });
});

describe("cave carve — determinism (byte-exact patch)", () => {
  test("same (params, seed, region, policy) → identical serialized ops", () => {
    for (const policy of ["replace", "keep-existing-air"] as MergePolicy[]) {
      const a = CAVE.evaluate(
        withDefaults({}),
        3,
        CAVE_REGION,
        BUILTIN_TABLE,
        policy,
      );
      const b = CAVE.evaluate(
        withDefaults({}),
        3,
        CAVE_REGION,
        BUILTIN_TABLE,
        policy,
      );
      expect(serializeOps(a.ops as FieldOp[])).toBe(
        serializeOps(b.ops as FieldOp[]),
      );
    }
  });

  test("a different theme changes the bytes (the theme dial reaches emission)", () => {
    const mined = CAVE.evaluate(
      withDefaults({ theme: "mined" }),
      3,
      CAVE_REGION,
      BUILTIN_TABLE,
      "replace",
    );
    const organic = CAVE.evaluate(
      withDefaults({ theme: "organic" }),
      3,
      CAVE_REGION,
      BUILTIN_TABLE,
      "replace",
    );
    expect(serializeOps(mined.ops as FieldOp[])).not.toBe(
      serializeOps(organic.ops as FieldOp[]),
    );
  });
});

describe("cave carve — non-zero region origin", () => {
  test("air lands at the offset chamber centres (region.min applied)", () => {
    const region: Region = { min: [10, 2, 6], max: [30, 12, 26] };
    const store = carve({}, 5, "replace", region);
    const sk = buildCaveSkeleton({}, 5, [20, 10, 20]); // extent = max − min
    for (const c of sk.chambers) {
      const wx = c.center[0] + region.min[0];
      const wy = chamberFloorY(c) + 1.0 + region.min[1];
      const wz = c.center[2] + region.min[2];
      expect(dAt(store, wx, wy, wz)).toBeGreaterThan(0);
    }
  });
});

describe("cave carve — registry & result shape", () => {
  test("evaluate returns exactly one patch op and no placements", () => {
    const { ops, placements } = CAVE.evaluate(
      withDefaults({}),
      1,
      CAVE_REGION,
      BUILTIN_TABLE,
      "replace",
    );
    expect(placements).toEqual([]);
    const patches = ops.filter((o) => o.kind === "patch");
    expect(patches.length).toBe(1);
    expect(ops.length).toBe(1);
  });

  test("the cave has no rotation param (isotropic seeding — a decision)", () => {
    const schema = CAVE.paramSchema as { properties: Record<string, unknown> };
    expect(schema.properties["rotation"]).toBeUndefined();
  });

  test("commits through commitGenerator: patch validates, one undo entry, provenance", () => {
    // The real editor path (assertPatchValid + entity provenance), not just a
    // bare applyPatchOp — a malformed slice would throw setup-loud here.
    const store = createFieldStore();
    const log = createOpLog();
    const { dirty, entity } = commitGenerator(store, log, CAVE, {
      params: CAVE.defaults,
      seed: 1,
      region: CAVE_REGION,
      policy: "replace",
      table: BUILTIN_TABLE,
    });
    expect(dirty.size).toBeGreaterThan(0);
    expect(entity.generator).toBe("cave");
    expect(log.undoStack).toHaveLength(1); // one commit = one undo entry
    // The span is [patch op, entity op] — the emitter contributes ONE field op.
    expect(log.ops.map((o) => o.kind)).toEqual(["patch", "entity"]);
  });
});

describe("cave carve — all-solid fast-path safety (INFLUENCE_MARGIN invariant)", () => {
  test("INFLUENCE_MARGIN covers SOLID-saturation + peak noise displacement + a cell", () => {
    // The emitter writes SOLID for every cell in a chunk no feature's influence
    // box reaches. That is byte-exact ONLY if such cells are far enough to
    // saturate: at least (the SOLID-saturation distance + the peak the noise can
    // push a wall/ceiling OUTWARD) from any feature surface, plus a cell of
    // discretization slack. INFLUENCE_MARGIN is DERIVED from exactly these
    // constants, so a future noise-amp bump can never blow the margin silently;
    // this pins that it is not de-derived back to a too-small literal (raising
    // an amp past a hardcoded margin would clip displaced walls to rock at chunk
    // seams — corruption no interior-sampling test would catch).
    const saturationDist = -SOLID / DENSITY_SCALE;
    const required =
      saturationDist +
      Math.max(CHAMBER_NOISE_AMP, PASSAGE_NOISE_AMP) +
      DEFAULT_CELL_SIZE;
    expect(INFLUENCE_MARGIN).toBeGreaterThanOrEqual(required);
  });
});
