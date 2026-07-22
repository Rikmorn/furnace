import { describe, expect, test } from "bun:test";
import type {
  BrushMask,
  BrushOp,
  MaterialTable,
  SmoothParams,
} from "@furnace/core/field";
import {
  assertOpValid,
  cloneChunkMaterials,
  createFieldStore,
  createOpLog,
  encodeChunkFile,
  getDensity,
  getMaterial,
  logApply,
  redo,
  SMOOTH_DEFAULTS,
  SOLID,
  undo,
} from "@furnace/core/field";

const digSphere = (
  center: [number, number, number],
  radius: number,
): BrushOp => ({
  id: 0,
  kind: "brush",
  effect: "dig",
  shape: { kind: "sphere", center, radius },
});

const digBox = (
  center: [number, number, number],
  halfExtents: [number, number, number],
): BrushOp => ({
  id: 0,
  kind: "brush",
  effect: "dig",
  shape: { kind: "box", center, halfExtents },
});

const paintBox = (
  center: [number, number, number],
  halfExtents: [number, number, number],
  material: number,
): BrushOp => ({
  id: 0,
  kind: "brush",
  effect: "paint",
  material,
  shape: { kind: "box", center, halfExtents },
});

const smoothSphere = (
  center: [number, number, number],
  radius: number,
  smooth: SmoothParams,
  mask?: BrushMask,
): BrushOp => ({
  id: 0,
  kind: "brush",
  effect: "smooth",
  smooth,
  ...(mask === undefined ? {} : { mask }),
  shape: { kind: "sphere", center, radius },
});

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
    { id: 3, name: "moss", kind: "organic", color: [0.3, 0.5, 0.3, 1] },
  ],
};

// Literal derivations at cellSize 0.25 (sample = metres × 4). The pocked-wall
// fixture: a room sphere at [2,2,2] r 1.4 (wall surface at x = 3.4 m), then a
// pock sphere r 0.5 centred ON that wall at [3.4,2,2] so it straddles the
// surface and genuinely roughens it. (The plan's literal [2.9,2,2] r 0.5 is
// INTERNALLY TANGENT to the room sphere — 0.9 + 0.5 = 1.4 — and a dig is an
// sdf-max union, so by the triangle inequality that pock never exceeds the
// room's sdf anywhere: a no-op op. Recomputed per the fixture's intent.)
// The smooth brush at [2.9,2,2] r 1 covers x ∈ (1.9,3.9) m → writable samples
// (sdf > 0) x 8..15, y,z 5..11 — all inside chunk (0,0,0), so smoothing must
// not allocate chunks the digs didn't. The pock's own +1-margin loop reaches
// sample x 16 (writes −3 over virgin −127), allocating chunk (1,0,0) in every
// build, smoothed or not.
const pockedWall = (): {
  s: ReturnType<typeof createFieldStore>;
  log: ReturnType<typeof createOpLog>;
} => {
  const s = createFieldStore();
  const log = createOpLog();
  logApply(s, log, digSphere([2, 2, 2], 1.4), TABLE);
  logApply(s, log, digSphere([3.4, 2, 2], 0.5), TABLE);
  return { s, log };
};

// Scan window covering the smooth brush's sample loop (+ margin on every
// side): x0−1..x1+1 of the [2.9,2,2] r 1 brush is 5..17, y/z 2..14.
const SCAN = { x0: 4, x1: 18, y0: 2, y1: 14, z0: 2, z1: 14 };

describe("smooth effect (F2b)", () => {
  test("smooth relaxes a carved surface toward the local mean, deterministically", () => {
    const build = (smoothed: boolean) => {
      const { s, log } = pockedWall();
      if (smoothed)
        logApply(
          s,
          log,
          smoothSphere([2.9, 2, 2], 1, {
            strength: 24,
            iterations: 2,
            mode: "both",
          }),
          TABLE,
        );
      return s;
    };
    const rough = build(false);
    const a = build(true);
    const b = build(true);
    // determinism: byte-identical across runs
    for (const k of a.chunks.keys())
      expect(encodeChunkFile(a.chunks.get(k) as Int8Array)).toEqual(
        encodeChunkFile(b.chunks.get(k) as Int8Array),
      );
    // it changed SOMETHING inside the brush, nothing outside its bounds+margin
    expect([...a.chunks.keys()].sort()).toEqual(
      [...rough.chunks.keys()].sort(),
    );
    let changed = 0;
    for (const k of a.chunks.keys()) {
      const av = a.chunks.get(k) as Int8Array;
      const rv = rough.chunks.get(k) as Int8Array;
      for (let i = 0; i < av.length; i++) if (av[i] !== rv[i]) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  test("strength clamps the per-application delta (thin-wall guard)", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digBox([2, 2, 2], [2, 2, 2]), TABLE);
    // Sample (8,−1,8) = (2,−0.25,2) m — the dig's −8 margin ring one sample
    // BELOW the floor surface (the plan's literal (8,3,8) = (2,0.75,2) m is
    // INSIDE the dig, density +24 air; recomputed to a genuinely solid sample
    // inside the smooth sphere).
    const before = getDensity(s, 8, -1, 8);
    expect(before).toBe(-8); // box sdf −0.25 m × 32
    logApply(
      s,
      log,
      smoothSphere([2, 0.6, 2], 1.5, {
        strength: 4,
        iterations: 1,
        mode: "both",
      }),
      TABLE,
    );
    const after = getDensity(s, 8, -1, 8);
    expect(after).not.toBe(before); // the clamp assertion below is not vacuous
    expect(Math.abs(after - before)).toBeLessThanOrEqual(4);
    // Exact value pins kernel + falloff + rounding: neighborhood is 9×(−127)
    // at y=−2 (virgin), 9×(−8) at y=−1 (margin ring), 9×0 at y=0 (surface) →
    // mean −45, raw delta −37; sphere sdf at (2,−0.25,2) is 1.5 − 0.85 = 0.65,
    // falloff 0.65/1.5, cap 4 × 0.4333 = 1.7333; round(−8 − 1.7333) = −10.
    expect(after).toBe(-10);
  });

  test("erode mode never lowers density; fill mode never raises it", () => {
    const build = (mode?: SmoothParams["mode"]) => {
      const { s, log } = pockedWall();
      if (mode !== undefined)
        logApply(
          s,
          log,
          smoothSphere([2.9, 2, 2], 1, { strength: 24, iterations: 1, mode }),
          TABLE,
        );
      return s;
    };
    const rough = build();
    for (const mode of ["erode", "fill"] as const) {
      const sm = build(mode);
      let raised = 0;
      let lowered = 0;
      for (let z = SCAN.z0; z <= SCAN.z1; z++)
        for (let y = SCAN.y0; y <= SCAN.y1; y++)
          for (let x = SCAN.x0; x <= SCAN.x1; x++) {
            const d = getDensity(sm, x, y, z) - getDensity(rough, x, y, z);
            if (d > 0) raised++;
            if (d < 0) lowered++;
          }
      if (mode === "erode") {
        expect(lowered).toBe(0); // density may only rise toward air
        expect(raised).toBeGreaterThan(0); // and it did smooth something
      } else {
        expect(raised).toBe(0); // density may only fall toward solid
        expect(lowered).toBeGreaterThan(0);
      }
      // outside the shape: untouched (sample (4,8,8) = (1,2,2) m is 1.9 m from
      // the smooth centre, outside its r 1 sphere)
      expect(getDensity(sm, 4, 8, 8)).toBe(getDensity(rough, 4, 8, 8));
    }
  });

  test("iterations re-run the blur: two passes move further than one", () => {
    const build = (iterations: number) => {
      const { s, log } = pockedWall();
      logApply(
        s,
        log,
        smoothSphere([2.9, 2, 2], 1, {
          strength: 24,
          iterations,
          mode: "both",
        }),
        TABLE,
      );
      return s;
    };
    const one = build(1);
    const two = build(2);
    // same chunk footprint (writes stay inside the sdf > 0 region either way)…
    expect([...one.chunks.keys()].sort()).toEqual(
      [...two.chunks.keys()].sort(),
    );
    // …but the second pass keeps relaxing: at least one byte must differ
    // (near the pock's density cliffs the capped delta re-applies each pass)
    let differs = 0;
    for (const k of one.chunks.keys()) {
      const a = one.chunks.get(k) as Int8Array;
      const b = two.chunks.get(k) as Int8Array;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });

  test("box-shaped smooth: deterministic, capped, uses the halfExtents falloff", () => {
    const build = () => {
      const s = createFieldStore();
      const log = createOpLog();
      logApply(s, log, digBox([2, 2, 2], [2, 2, 2]), TABLE); // floor at y = 0 m
      logApply(
        s,
        log,
        {
          id: 0,
          kind: "brush",
          effect: "smooth",
          smooth: { strength: 6, iterations: 1, mode: "both" },
          shape: {
            kind: "box",
            center: [2, 0, 2],
            halfExtents: [1, 0.75, 1],
          },
        },
        TABLE,
      );
      return s;
    };
    const a = build();
    const b = build();
    for (const k of a.chunks.keys())
      expect(encodeChunkFile(a.chunks.get(k) as Int8Array)).toEqual(
        encodeChunkFile(b.chunks.get(k) as Int8Array),
      );
    // Sample (8,−1,8) = (2,−0.25,2) m, the −8 margin ring below the floor:
    // neighborhood 9×(−127) at y=−2, 9×(−8), 9×0 → mean −45, raw delta −37.
    // Box smooth sdf = min(1−0, 0.75−0.25, 1−0) = 0.5; sdfRef = min halfExtent
    // = 0.75 (the box branch), falloff 0.5/0.75; cap 6 × 0.6667 = 4 →
    // round(−8 − 4) = −12. (A max-halfExtent sdfRef would give −11.)
    expect(getDensity(a, 8, -1, 8)).toBe(-12);
    expect(Math.abs(getDensity(a, 8, -1, 8) - -8)).toBeLessThanOrEqual(6); // the strength cap held
  });

  test("smooth over uniform rock is a true no-op: no writes, no allocation", () => {
    const s = createFieldStore();
    const log = createOpLog();
    const dirty = logApply(
      s,
      log,
      smoothSphere([2, 2, 2], 1.5, {
        strength: 64,
        iterations: 4,
        mode: "both",
      }),
      TABLE,
    );
    // every neighborhood mean equals the uniform density → delta 0 everywhere:
    // the nd === cur continue path must avoid ALL writes (empty dirty set → no
    // spurious remesh; empty inverse → an empty undo entry; getDensity reads
    // never allocate chunks)
    expect(dirty.size).toBe(0);
    expect(s.chunks.size).toBe(0);
    expect(s.materials.size).toBe(0);
    const entry = log.undoStack[0];
    if (entry?.kind !== "ops")
      throw new Error(`expected an "ops" entry, got ${entry?.kind}`);
    expect(entry.inverse.size).toBe(0);
  });

  test("smooth requires params and validates ranges", () => {
    const bare: BrushOp = {
      id: 0,
      kind: "brush",
      effect: "smooth",
      shape: { kind: "sphere", center: [0, 0, 0], radius: 1 },
    };
    const withSmooth = (smooth: SmoothParams): BrushOp => ({
      ...bare,
      smooth,
    });
    expect(() => assertOpValid(bare, TABLE)).toThrow(/smooth/);
    expect(() =>
      assertOpValid(
        withSmooth({ strength: 200, iterations: 1, mode: "both" }),
        TABLE,
      ),
    ).toThrow(/strength/);
    expect(() =>
      assertOpValid(
        withSmooth({ strength: 0, iterations: 1, mode: "both" }),
        TABLE,
      ),
    ).toThrow(/strength/);
    expect(() =>
      assertOpValid(
        withSmooth({ strength: 2.5, iterations: 1, mode: "both" }),
        TABLE,
      ),
    ).toThrow(/strength/);
    expect(() =>
      assertOpValid(
        withSmooth({ strength: 16, iterations: 0, mode: "both" }),
        TABLE,
      ),
    ).toThrow(/iterations/);
    expect(() =>
      assertOpValid(
        withSmooth({ strength: 16, iterations: 5, mode: "both" }),
        TABLE,
      ),
    ).toThrow(/iterations/);
    expect(() =>
      assertOpValid(
        withSmooth({
          strength: 16,
          iterations: 1,
          mode: "melt" as SmoothParams["mode"],
        }),
        TABLE,
      ),
    ).toThrow(/mode/);
    // the shipped defaults themselves validate, and are the documented values
    expect(SMOOTH_DEFAULTS).toEqual({
      strength: 16,
      iterations: 1,
      mode: "both",
    });
    expect(() =>
      assertOpValid(withSmooth(SMOOTH_DEFAULTS), TABLE),
    ).not.toThrow();
    // smooth ignores `material`: no kit-lattice demand on a kit-class id with
    // a sphere shape (smooth never writes the material channel)
    expect(() =>
      assertOpValid({ ...withSmooth(SMOOTH_DEFAULTS), material: 2 }, TABLE),
    ).not.toThrow();
    // setup-loud through logApply: a bad smooth op never mutates log or store
    const s = createFieldStore();
    const log = createOpLog();
    expect(() => logApply(s, log, bare, TABLE)).toThrow(/smooth/);
    expect(log.ops.length).toBe(0);
    expect(log.undoStack.length).toBe(0);
    expect(s.chunks.size).toBe(0);
  });

  test("smooth never touches the material channel", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digBox([2, 2, 2], [2, 2, 2]), TABLE); // room, floor at y = 0 m
    // dirt band in the rock below the floor: x,z ∈ (1,3) m → samples 5..11;
    // y ∈ (−0.8,−0.2) m → samples −3..−1 (all in materials chunk "0,−1,0")
    logApply(s, log, paintBox([2, -0.5, 2], [1, 0.3, 1], 1), TABLE);
    expect(getMaterial(s, 8, -2, 8)).toBe(1);
    const matsBefore = new Map(
      [...s.materials].map(([k, v]) => [k, cloneChunkMaterials(v)]),
    );
    const densityBefore = new Map(
      [...s.chunks].map(([k, v]) => [k, Int8Array.from(v)]),
    );
    // smooth across the floor AND the painted band (sphere reaches y ∈
    // (−1.1, 1.3) m → samples −4..5)
    logApply(
      s,
      log,
      smoothSphere([2, 0.1, 2], 1.2, {
        strength: 24,
        iterations: 2,
        mode: "both",
      }),
      TABLE,
    );
    // it DID smooth the density channel…
    let changed = 0;
    for (const [k, v] of densityBefore) {
      const cur = s.chunks.get(k) as Int8Array;
      for (let i = 0; i < v.length; i++) if (cur[i] !== v[i]) changed++;
    }
    expect(changed).toBeGreaterThan(0);
    // …while the material channel is byte-identical (no entry added/removed)
    expect(s.materials.size).toBe(matsBefore.size);
    for (const [k, v] of matsBefore) expect(s.materials.get(k)).toEqual(v);
    expect(getMaterial(s, 8, -2, 8)).toBe(1);
  });

  test("solid-only mask gates smooth: air cells never change", () => {
    const rough = pockedWall().s;
    const { s, log } = pockedWall();
    logApply(
      s,
      log,
      smoothSphere(
        [2.9, 2, 2],
        1,
        { strength: 24, iterations: 1, mode: "both" },
        { kind: "solid-only" },
      ),
      TABLE,
    );
    let changedSolid = 0;
    for (let z = SCAN.z0; z <= SCAN.z1; z++)
      for (let y = SCAN.y0; y <= SCAN.y1; y++)
        for (let x = SCAN.x0; x <= SCAN.x1; x++) {
          const before = getDensity(rough, x, y, z);
          const after = getDensity(s, x, y, z);
          if (before >= 0)
            expect(after).toBe(before); // air gated out
          else if (after !== before) changedSolid++;
        }
    expect(changedSolid).toBeGreaterThan(0); // solid cells still smoothed
  });

  // Guards the DOUBLE BUFFER (order-independence within an iteration): a
  // y/z-mirror-symmetric fixture must smooth symmetrically — a live-read sweep
  // (z→y→x ascending) feeds already-written neighbors into later sums and
  // breaks the mirror. Symmetric loop ranges need bounds on exact sample
  // boundaries, hence r 1.5 at [2,2,2] (dig range 1..15, mirror of sample y is
  // 16−y), pock r 0.5 ON the wall at [3.5,2,2] (range y/z 5..11), smooth r 1
  // at [3,2,2] (range y/z 3..13) — all symmetric about sample 8.
  test("smooth is order-independent within an iteration (mirror symmetry)", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digSphere([2, 2, 2], 1.5), TABLE);
    logApply(s, log, digSphere([3.5, 2, 2], 0.5), TABLE);
    logApply(
      s,
      log,
      smoothSphere([3, 2, 2], 1, { strength: 24, iterations: 2, mode: "both" }),
      TABLE,
    );
    let changed = 0;
    for (let z = 2; z <= 14; z++)
      for (let y = 2; y <= 14; y++)
        for (let x = 8; x <= 16; x++) {
          const d = getDensity(s, x, y, z);
          expect(getDensity(s, x, 16 - y, z)).toBe(d);
          expect(getDensity(s, x, y, 16 - z)).toBe(d);
          if (d !== SOLID) changed++;
        }
    expect(changed).toBeGreaterThan(0); // the scan window saw real writes
  });

  test("undo then redo restore a smoothed field byte-identically", () => {
    const { s, log } = pockedWall();
    const before = new Map(
      [...s.chunks].map(([k, v]) => [k, Int8Array.from(v)]),
    );
    const dirty = logApply(
      s,
      log,
      smoothSphere([2.9, 2, 2], 1, {
        strength: 24,
        iterations: 2,
        mode: "both",
      }),
      TABLE,
    );
    expect(dirty.size).toBeGreaterThan(0);
    const after = new Map(
      [...s.chunks].map(([k, v]) => [k, Int8Array.from(v)]),
    );
    undo(s, log);
    expect(s.chunks.size).toBe(before.size);
    for (const [k, v] of before) expect(s.chunks.get(k)).toEqual(v);
    expect(s.materials.size).toBe(0); // smooth allocated no material entries
    // redo replays the smooth deterministically through the generic op path
    expect(redo(s, log, TABLE).size).toBeGreaterThan(0);
    expect(s.chunks.size).toBe(after.size);
    for (const [k, v] of after) expect(s.chunks.get(k)).toEqual(v);
  });
});
