import { describe, expect, test } from "bun:test";
import type { CaveSkeleton } from "@furnace/core/field";
import { buildCaveSkeleton } from "@furnace/core/field";
import {
  BOUNDS_MARGIN,
  MAX_GRADE,
  MAX_SWITCHBACKS,
  MIN_TREAD,
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

  test("over-budget regions under-deliver by a BOUNDED amount (0 ≤ gap ≤ intended Δy)", () => {
    // A clamped passage delivers a PREFIX of the climb: its shortfall is at most
    // the whole intended Δy and never negative (never overshoots). The residual
    // is explicit and tested — the visible D-F3-11 limitation, not a silent
    // disconnect. See docs/backlog/dungeon/cave-chamber-floor-reconciliation.md.
    for (const c of CONFIGS) {
      const sk = buildCaveSkeleton(c.params, c.seed, c.extent);
      for (const pass of sk.passages) {
        const gap = endpointGap(sk, pass);
        expect(gap).toBeGreaterThanOrEqual(-EPS);
        expect(gap).toBeLessThanOrEqual(intendedDy(sk, pass) + EPS);
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
