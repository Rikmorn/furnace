import { describe, expect, test } from "bun:test";
import type {
  BrushMask,
  BrushOp,
  EntityOp,
  FieldOp,
  FieldStore,
  MaterialTable,
  OpInverse,
  OpLog,
} from "@furnace/core/field";
import {
  applyOp,
  assertOpValid,
  BUILTIN_TABLE,
  createFieldStore,
  createOpLog,
  encodeChunkFile,
  getDensity,
  getMaterial,
  logApply,
  logApplyGroup,
  MAT_ROCK,
  MAX_SELECTION_BUDGET,
  opBounds,
  parseOps,
  redo,
  SOLID,
  serializeOps,
  undo,
} from "@furnace/core/field";
import { snapshotAll } from "../../tests/_helpers/field-store.ts";
// Deliberately NOT on the public index (reconfigure imports them in-core):
// spliceOps, whose rejected cases are unreachable through undo/redo and so are
// tested against the source module directly, and imagesOf — the ONE place the
// chunk-image clone/null rules live (a test-local copy would be a third).
import { imagesOf, spliceOps } from "./ops.ts";

const sphere = (id: number): BrushOp => ({
  id,
  kind: "brush",
  effect: "dig",
  shape: { kind: "sphere", center: [2, 2, 2], radius: 1.5 },
});

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

describe("field ops", () => {
  test("dig sphere opens air at the center, leaves rock outside", () => {
    const s = createFieldStore();
    applyOp(s, sphere(1), BUILTIN_TABLE);
    expect(getDensity(s, 8, 8, 8)).toBeGreaterThan(0); // center (2m/0.25)
    expect(getDensity(s, 50, 8, 8)).toBe(SOLID);
  });

  test("apply -> undo restores byte-identical chunks (identity property)", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, sphere(0), BUILTIN_TABLE);
    const before = new Map(
      [...s.chunks].map(([k, v]) => [k, Int8Array.from(v)]),
    );
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "dig",
        shape: { kind: "box", center: [2.5, 2, 2], halfExtents: [1, 0.5, 0.5] },
      },
      BUILTIN_TABLE,
    );
    undo(s, log);
    expect(s.chunks.size).toBe(before.size);
    for (const [k, v] of before) {
      expect(s.chunks.get(k)).toEqual(v);
    }
  });

  test("undo -> redo restores the post-op state (determinism)", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, sphere(0), BUILTIN_TABLE);
    const after = new Map(
      [...s.chunks].map(([k, v]) => [k, Int8Array.from(v)]),
    );
    undo(s, log);
    redo(s, log, BUILTIN_TABLE);
    for (const [k, v] of after) expect(s.chunks.get(k)).toEqual(v);
  });

  test("same op sequence twice on fresh stores -> byte-identical fields", () => {
    const run = () => {
      const s = createFieldStore();
      const log = createOpLog();
      logApply(s, log, sphere(0), BUILTIN_TABLE);
      logApply(
        s,
        log,
        {
          id: 0,
          kind: "brush",
          effect: "dig",
          shape: { kind: "sphere", center: [3.1, 2.2, 2.7], radius: 0.9 },
        },
        BUILTIN_TABLE,
      );
      return s;
    };
    const a = run();
    const b = run();
    expect([...a.chunks.keys()].sort()).toEqual([...b.chunks.keys()].sort());
    for (const [k, v] of a.chunks) expect(b.chunks.get(k)).toEqual(v);
  });

  // Mutation-proof: undo must byte-restore a REAL second op (non-empty
  // inverse), and the identity comparison must be able to flag a single
  // corrupted byte. The second op is a genuine mutation (the box opens air
  // the sphere didn't), so a no-op or broken undo leaves its changes behind
  // and the restoration check below bites — verified by stubbing undo to a
  // no-op, which makes this test fail. (An identical second sphere would be
  // a no-op dig with an empty inverse: undo would restore nothing and the
  // test would pass regardless of whether undo works.)
  test("MUTATION GUARD: undo restores a real op; a tampered byte is caught", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, sphere(0), BUILTIN_TABLE);
    const snapshot = new Map(
      [...s.chunks].map(([k, v]) => [k, Int8Array.from(v)]),
    );
    // A REAL second op: overlaps the sphere but opens new air at its corners,
    // so its inverse is non-empty and undo genuinely has to restore bytes.
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "dig",
        shape: { kind: "box", center: [2.5, 2, 2], halfExtents: [1, 0.5, 0.5] },
      },
      BUILTIN_TABLE,
    );
    undo(s, log);

    // Guard the UNDO PATH: after undo the field must byte-equal the snapshot
    // (no extra chunks, every byte restored). With a broken/no-op undo the
    // box's mutations survive and this fails.
    expect(s.chunks.size).toBe(snapshot.size);
    let restored = true;
    for (const [k, v] of snapshot) {
      const cur = s.chunks.get(k) as Int8Array;
      for (let i = 0; i < v.length; i++)
        if (cur[i] !== v[i]) {
          restored = false;
          break;
        }
      if (!restored) break;
    }
    expect(restored).toBe(true);

    // Guard the COMPARISON METHODOLOGY: corrupt one byte and confirm the
    // byte-wise comparison the other tests rely on actually detects it.
    const firstKey = [...s.chunks.keys()][0] as string;
    (s.chunks.get(firstKey) as Int8Array)[0] =
      ((s.chunks.get(firstKey) as Int8Array)[0] as number) === 5 ? 6 : 5;
    let mismatch = false;
    for (const [k, v] of snapshot) {
      const cur = s.chunks.get(k) as Int8Array;
      for (let i = 0; i < v.length; i++)
        if (cur[i] !== v[i]) {
          mismatch = true;
          break;
        }
      if (mismatch) break;
    }
    expect(mismatch).toBe(true);
  });
});

describe("brush ops", () => {
  test("fill solidifies and writes material; paint retints solid only", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "dig",
        shape: { kind: "box", center: [2, 2, 2], halfExtents: [2, 2, 2] },
      },
      TABLE,
    );
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "fill",
        material: 1,
        shape: { kind: "sphere", center: [2, 2, 2], radius: 0.8 },
      },
      TABLE,
    );
    expect(getDensity(s, 8, 8, 8)).toBeLessThan(0);
    expect(getMaterial(s, 8, 8, 8)).toBe(1);
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "paint",
        material: 0,
        shape: { kind: "sphere", center: [2, 2, 2], radius: 0.8 },
      },
      TABLE,
    );
    expect(getMaterial(s, 8, 8, 8)).toBe(MAT_ROCK);
    expect(getDensity(s, 2, 8, 8)).toBeGreaterThanOrEqual(0);
    expect(getMaterial(s, 2, 8, 8)).toBe(MAT_ROCK);
  });

  test("kit lattice discipline: sphere/kit rejected, unsnapped box rejected, snapped box accepted", () => {
    const kitSphere: BrushOp = {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: 2,
      shape: { kind: "sphere", center: [1, 1, 1], radius: 1 },
    };
    expect(() => assertOpValid(kitSphere, TABLE)).toThrow(/kit/);
    const unsnapped: BrushOp = {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: 2,
      shape: {
        kind: "box",
        center: [1.13, 1, 1],
        halfExtents: [0.5, 0.5, 0.5],
      },
    };
    expect(() => assertOpValid(unsnapped, TABLE)).toThrow(/lattice/);
    const snapped: BrushOp = {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: 2,
      shape: {
        kind: "box",
        center: [1.25, 1, 0.75],
        halfExtents: [0.25, 0.5, 0.75],
      },
    };
    expect(() => assertOpValid(snapped, TABLE)).not.toThrow();
    expect(() => assertOpValid({ ...snapped, material: 99 }, TABLE)).toThrow(
      /unknown/,
    );
  });

  test("undo then redo restore BOTH channels byte-identically", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "dig",
        shape: { kind: "sphere", center: [1, 1, 1], radius: 1.2 },
      },
      TABLE,
    );
    const dBefore = encodeChunkFile(s.chunks.get("0,0,0") as Int8Array);
    const mBefore = getMaterial(s, 4, 4, 4);
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "fill",
        material: 1,
        shape: { kind: "sphere", center: [1, 1, 1], radius: 0.6 },
      },
      TABLE,
    );
    const dAfterFill = encodeChunkFile(s.chunks.get("0,0,0") as Int8Array);
    const mAfterFill = getMaterial(s, 4, 4, 4);
    expect(mAfterFill).toBe(1); // fill claimed the interior cell for class 1

    undo(s, log);
    expect(encodeChunkFile(s.chunks.get("0,0,0") as Int8Array)).toEqual(
      dBefore,
    );
    expect(getMaterial(s, 4, 4, 4)).toBe(mBefore);

    // redo replays the fill deterministically — BOTH channels back to post-fill.
    redo(s, log, TABLE);
    expect(encodeChunkFile(s.chunks.get("0,0,0") as Int8Array)).toEqual(
      dAfterFill,
    );
    expect(getMaterial(s, 4, 4, 4)).toBe(mAfterFill);
  });

  test("determinism: same ops on a fresh store → byte-identical chunks", () => {
    const run = () => {
      const s = createFieldStore();
      const log = createOpLog();
      logApply(
        s,
        log,
        {
          id: 0,
          kind: "brush",
          effect: "dig",
          shape: { kind: "box", center: [1, 1, 1], halfExtents: [1.5, 1, 1.5] },
        },
        TABLE,
      );
      logApply(
        s,
        log,
        {
          id: 0,
          kind: "brush",
          effect: "fill",
          material: 2,
          shape: {
            kind: "box",
            center: [1, 1, 1],
            halfExtents: [0.5, 0.5, 0.5],
          },
        },
        TABLE,
      );
      return s;
    };
    const a = run();
    const b = run();
    expect([...a.chunks.keys()].sort()).toEqual([...b.chunks.keys()].sort());
    for (const k of a.chunks.keys())
      expect(encodeChunkFile(a.chunks.get(k) as Int8Array)).toEqual(
        encodeChunkFile(b.chunks.get(k) as Int8Array),
      );
  });

  test("parseOps maps F1 legacy dig ops", () => {
    const ops = parseOps(
      '[{"id":1,"kind":"dig","shape":{"kind":"sphere","center":[1,2,3],"radius":0.75}}]',
    );
    expect(ops[0]).toEqual({
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [1, 2, 3], radius: 0.75 },
    });
  });
});

describe("capsule shape — the segment brush (F3b: D-F3-14)", () => {
  // A 2 m sweep along +x at y=z=1 m, radius 0.5 m. At the default 0.25 m cell
  // the endpoints land on samples (4,4,4) and (12,4,4), so every probe below
  // is an exact world position, not a rounding.
  const digCapsule = (
    a: [number, number, number],
    b: [number, number, number],
    radius: number,
  ): BrushOp => ({
    id: 0,
    kind: "brush",
    effect: "dig",
    shape: { kind: "capsule", a, b, radius },
  });

  test("carves the whole TUBE, not two endpoint spheres", () => {
    const s = createFieldStore();
    applyOp(s, digCapsule([1, 1, 1], [3, 1, 1], 0.5), TABLE);
    // The midpoint is 1 m from BOTH endpoints — twice the radius. A union of
    // two spheres leaves it solid; the swept capsule opens it.
    expect(getDensity(s, 8, 4, 4)).toBeGreaterThan(0);
    // …and so is every sample along the axis between them.
    for (let x = 4; x <= 12; x++)
      expect(getDensity(s, x, 4, 4)).toBeGreaterThan(0);
  });

  test("the radius bounds the tube perpendicular to the axis", () => {
    const s = createFieldStore();
    applyOp(s, digCapsule([1, 1, 1], [3, 1, 1], 0.5), TABLE);
    // Mid-sweep, 0.25 m off the axis: inside. 0.75 m off: outside.
    expect(getDensity(s, 8, 5, 4)).toBeGreaterThan(0);
    expect(getDensity(s, 8, 7, 4)).toBeLessThan(0);
    expect(getDensity(s, 8, 4, 5)).toBeGreaterThan(0);
    expect(getDensity(s, 8, 4, 7)).toBeLessThan(0);
  });

  test("the endcaps are ROUND and the sweep does not run past them", () => {
    const s = createFieldStore();
    applyOp(s, digCapsule([1, 1, 1], [3, 1, 1], 0.5), TABLE);
    // 0.25 m beyond each endpoint, on the axis: inside the hemisphere.
    expect(getDensity(s, 13, 4, 4)).toBeGreaterThan(0);
    expect(getDensity(s, 3, 4, 4)).toBeGreaterThan(0);
    // 0.75 m beyond: outside. This is the projection CLAMP's teeth — without
    // it the shape is an infinite cylinder and both of these open too.
    expect(getDensity(s, 15, 4, 4)).toBeLessThan(0);
    expect(getDensity(s, 1, 4, 4)).toBeLessThan(0);
    // The cap's reach SHRINKS off-axis — a hemisphere, not a flat extension:
    // the same 0.25 m past `b`, but 0.5 m off the axis, is outside
    // (√(0.25² + 0.5²) ≈ 0.56 > 0.5).
    expect(getDensity(s, 13, 6, 4)).toBeLessThan(0);
  });

  test("a DEGENERATE capsule (a === b) is exactly the sphere at that point", () => {
    const capsule = createFieldStore();
    const sphere = createFieldStore();
    applyOp(capsule, digCapsule([2, 2, 2], [2, 2, 2], 1.2), TABLE);
    applyOp(sphere, digSphere([2, 2, 2], 1.2), TABLE);
    // Byte-for-byte across every chunk either one allocated.
    expect(snapshotAll(capsule)).toEqual(snapshotAll(sphere));
    expect(capsule.chunks.size).toBeGreaterThan(0); // …and it did allocate
  });

  test("opBounds is the AABB of both endpoints grown by the radius", () => {
    expect(opBounds(digCapsule([1, 2, 3], [4, 0, 3], 0.5))).toEqual({
      min: [0.5, -0.5, 2.5],
      max: [4.5, 2.5, 3.5],
    });
    // Order-independent: swapping the endpoints is the same op.
    expect(opBounds(digCapsule([4, 0, 3], [1, 2, 3], 0.5))).toEqual({
      min: [0.5, -0.5, 2.5],
      max: [4.5, 2.5, 3.5],
    });
  });

  test("a kit class rejects a capsule, like every other non-box shape", () => {
    // No new clause in assertOpValid — the existing "kit writes require a box"
    // rule already covers it. This test is what keeps that true.
    expect(() =>
      assertOpValid(
        {
          id: 0,
          kind: "brush",
          effect: "fill",
          material: 2, // masonry, the kit class
          shape: { kind: "capsule", a: [1, 1, 1], b: [2, 1, 1], radius: 0.5 },
        },
        TABLE,
      ),
    ).toThrow(/kit-class writes require a box shape/);
  });

  test("assertOpValid rejects non-finite endpoints and a non-positive radius", () => {
    const bad = (shape: BrushOp["shape"]): BrushOp => ({
      id: 0,
      kind: "brush",
      effect: "dig", // material-free: proves the leg runs BEFORE the material early-return
      shape,
    });
    for (const a of [
      [Number.NaN, 1, 1],
      [Number.POSITIVE_INFINITY, 1, 1],
    ] as [number, number, number][])
      expect(() =>
        assertOpValid(
          bad({ kind: "capsule", a, b: [2, 1, 1], radius: 1 }),
          TABLE,
        ),
      ).toThrow(/capsule endpoints must be three finite numbers/);
    expect(() =>
      assertOpValid(
        bad({
          kind: "capsule",
          a: [1, 1, 1],
          b: [1, 2, Number.NaN],
          radius: 1,
        }),
        TABLE,
      ),
    ).toThrow(/capsule endpoints must be three finite numbers/);
    for (const radius of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() =>
        assertOpValid(
          bad({ kind: "capsule", a: [1, 1, 1], b: [2, 1, 1], radius }),
          TABLE,
        ),
      ).toThrow(/capsule radius must be a finite positive length/);
    // The good one still passes, under every effect that carries a shape.
    expect(() =>
      assertOpValid(
        bad({ kind: "capsule", a: [1, 1, 1], b: [2, 1, 1], radius: 0.5 }),
        TABLE,
      ),
    ).not.toThrow();
  });

  test("a capsule op survives the oplog round-trip", () => {
    // The wire guard is a CLOSED union (artifact.ts SHAPE_KINDS): a shape kind
    // the engine can emit but its own parser refuses would only surface at load.
    const op = { ...digCapsule([1, 2, 3], [4, 5, 6], 0.75), id: 1 };
    expect(parseOps(serializeOps([op]))).toEqual([op]);
  });

  test("a capsule dig undoes byte-identically", () => {
    const s = createFieldStore();
    const log = createOpLog();
    const before = snapshotAll(s);
    logApply(s, log, digCapsule([1, 1, 1], [3, 1, 1], 0.5), TABLE);
    expect(s.chunks.size).toBeGreaterThan(0);
    undo(s, log);
    expect(snapshotAll(s)).toEqual(before);
  });

  test("smooth falls off by the capsule's RADIUS, never its sweep length", () => {
    // applySmooth caps each sample's delta by `strength · min(1, sdf/sdfRef)`.
    // For a capsule, sdfRef is the radius — the distance from the axis to the
    // boundary, exactly as it is for a sphere. Anything length-derived would
    // make the SAME cell at the SAME wall distance smooth harder in a short
    // tunnel than in a long one, which is what this pins.
    const roughened = (): FieldStore => {
      const s = createFieldStore();
      // A sphere carved ON the shared axis: its surface crosses the smoothed
      // region at every distance from the axis, so the probe set below spans
      // the whole falloff range instead of one point on it.
      applyOp(s, digSphere([2, 2, 0.5], 1), TABLE);
      return s;
    };
    type Pt = [number, number, number];
    const smoothCapsule = (a: Pt, b: Pt): BrushOp => ({
      id: 0,
      kind: "brush",
      effect: "smooth",
      shape: { kind: "capsule", a, b, radius: 2 },
      smooth: { strength: 64, iterations: 1, mode: "both" },
    });
    const before = roughened();
    const short = roughened();
    const long = roughened();
    const A: Pt = [2, 2, 0.5];
    applyOp(short, smoothCapsule(A, [2.5, 2, 0.5]), TABLE);
    applyOp(long, smoothCapsule(A, [8, 2, 0.5]), TABLE);

    // Compare only where the two shapes are the SAME shape: a sample whose
    // projection lands at or before the short capsule's far endpoint has the
    // same closest point — and so the same sdf — on both segments.
    const h = short.cellSize;
    let compared = 0;
    let changed = 0;
    for (let z = 0; z <= 10; z++)
      for (let y = 0; y <= 16; y++)
        for (let x = 0; x <= 10; x++) {
          if (x * h > 2.5) continue;
          const s0 = getDensity(before, x, y, z);
          const sShort = getDensity(short, x, y, z);
          expect(getDensity(long, x, y, z)).toBe(sShort);
          compared++;
          if (sShort !== s0) changed++;
        }
    // Non-vacuity: the equality above is worthless if the smooth wrote
    // nothing in the compared window — an unwritten cell trivially matches an
    // unwritten cell. Measured: 948 of 2057 compared samples changed.
    expect(compared).toBeGreaterThan(1000);
    expect(changed).toBeGreaterThan(500);
  });
});

describe("op-list undo entries + the FieldOp union (F2b)", () => {
  test('undo entries carry kind "ops"; a single brush op round-trips as [op]', () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digSphere([1, 1, 1], 1), TABLE);
    const entry = log.undoStack[0];
    if (entry?.kind !== "ops")
      throw new Error(`expected an "ops" entry, got ${entry?.kind}`);
    expect(entry.ops.length).toBe(1);
    const dirty = undo(s, log);
    expect(dirty.size).toBeGreaterThan(0);
    expect(log.ops.length).toBe(0);
    expect(redo(s, log, TABLE).size).toBe(dirty.size);
    expect(log.ops.length).toBe(1);
  });

  test("serializeOps/parseOps round-trip the FieldOp union (entity ops included)", () => {
    const entity: EntityOp = {
      id: 3,
      kind: "entity",
      action: "place",
      entity: {
        entityId: 1,
        type: "generator",
        generator: "hall",
        params: { width: 8 },
        seed: 42,
        region: { min: [0, 0, 0], max: [4, 2, 4] },
        opSpan: [1, 2],
      },
    };
    // hollow rides the JSON pass-through — the shell-band fill replays intact
    const hollowFill: BrushOp = {
      id: 2,
      kind: "brush",
      effect: "fill",
      material: 1,
      hollow: 0.5,
      shape: { kind: "box", center: [1, 1, 1], halfExtents: [0.5, 0.5, 0.5] },
    };
    const ops: FieldOp[] = [digSphere([1, 1, 1], 1), hollowFill, entity];
    expect(parseOps(serializeOps(ops))).toEqual(ops);
  });

  // A hand-built two-op undo entry (the generator-commit shape Task 6 will
  // produce): undo must revert the WHOLE span, redo must re-apply it AND merge
  // the per-op inverses first-touch-wins so a second undo still reverts fully.
  test("multi-op undo entry reverts and redoes the whole span as one unit", () => {
    const s = createFieldStore();
    const log = createOpLog();
    const a: BrushOp = {
      id: 1,
      kind: "brush",
      effect: "dig",
      shape: { kind: "sphere", center: [1, 1, 1], radius: 1.2 },
    };
    const b: BrushOp = {
      id: 2,
      kind: "brush",
      effect: "fill",
      material: 1,
      shape: { kind: "sphere", center: [1, 1, 1], radius: 0.6 },
    };
    const e: EntityOp = {
      id: 3,
      kind: "entity",
      action: "place",
      entity: {
        entityId: 1,
        type: "generator",
        generator: "hall",
        params: {},
        seed: 7,
        region: { min: [0, 0, 0], max: [2, 2, 2] },
        opSpan: [1, 2],
      },
    };
    const ra = applyOp(s, a, TABLE);
    const rb = applyOp(s, b, TABLE);
    // Both ops touch chunk (0,0,0) — the overlap that makes first-touch-wins
    // observable (a's pre-image is virgin rock; b's already contains a's dig).
    expect([...ra.inverse.keys()].some((k) => rb.inverse.has(k))).toBe(true);
    const inverse = new Map(ra.inverse);
    for (const [k, pre] of rb.inverse) if (!inverse.has(k)) inverse.set(k, pre);
    log.ops.push(a, b, e);
    log.undoStack.push({ kind: "ops", ops: [a, b, e], inverse });
    log.nextId = 4;
    const dAfter = getDensity(s, 4, 4, 4);
    const mAfter = getMaterial(s, 4, 4, 4);
    expect(mAfter).toBe(1); // the fill actually claimed the probed cell

    undo(s, log);
    expect(log.ops.length).toBe(0);
    expect(s.chunks.size).toBe(0); // whole span reverted to virgin rock
    expect(s.materials.size).toBe(0);

    expect(redo(s, log, TABLE).size).toBeGreaterThan(0);
    expect(log.ops.length).toBe(3); // ALL ops re-appended, entity op included
    expect(log.ops[2]).toEqual(e);
    expect(getDensity(s, 4, 4, 4)).toBe(dAfter);
    expect(getMaterial(s, 4, 4, 4)).toBe(mAfter);

    // Undo AFTER redo exercises redo's merged inverse: last-touch-wins would
    // restore b's pre-image (which contains a's dig) and leave chunks behind.
    undo(s, log);
    expect(s.chunks.size).toBe(0);
    expect(s.materials.size).toBe(0);
  });
});

// Literal derivations at cellSize 0.25 (sample = metres × 4). Box dig SDF is
// min-per-axis of halfExtent − |w − center|: strictly-inside samples go
// positive (air), exact-boundary samples land at density 0, and the op's
// +1-sample margin loop writes small NEGATIVE densities one ring beyond the
// shape (e.g. sdf −0.25 m → −8) — still solid. Paint retints SOLID cells only,
// so painted fixtures put their bands in the rock BELOW a dug room's floor
// (the Task 2 lesson: a band inside the room is all air and paints nothing).
describe("brush masks (F2b)", () => {
  test("the replace idiom: mask class-1 + paint retints exactly the dirt band", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digBox([2, 2, 2], [2, 2, 2]), TABLE); // room: air samples 0..16
    // dirt band: x,z ∈ (1,3)m → samples 5..11; y ∈ (−0.8,−0.2)m → −3..−1 (147 cells)
    logApply(s, log, paintBox([2, -0.5, 2], [1, 0.3, 1], 1), TABLE);
    // moss band: same x,z; y ∈ (−1.8,−1.2)m → samples −7..−5 (147 cells)
    logApply(s, log, paintBox([2, -1.5, 2], [1, 0.3, 1], 3), TABLE);
    expect(getMaterial(s, 8, -2, 8)).toBe(1); // a dirt cell
    expect(getMaterial(s, 8, -6, 8)).toBe(3); // a moss cell
    // replace: only-dirt → rock, over a box covering BOTH bands + ambient rock
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "paint",
        material: 0,
        mask: { kind: "class", classId: 1 },
        shape: { kind: "box", center: [2, -1, 2], halfExtents: [2, 2, 2] },
      },
      TABLE,
    );
    // every former dirt cell is rock now; every moss cell is untouched — the
    // mask restricted the repaint to class 1 exactly
    for (let z = 5; z <= 11; z++)
      for (let x = 5; x <= 11; x++) {
        for (let y = -3; y <= -1; y++) expect(getMaterial(s, x, y, z)).toBe(0);
        for (let y = -7; y <= -5; y++) expect(getMaterial(s, x, y, z)).toBe(3);
      }
  });

  test("solid-only mask makes fill respect existing air", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digBox([2, 2, 2], [1, 1, 1]), TABLE); // room: air samples 4..12
    // masonry (kit) fill: box faces at 0.5/3.5 m sit on the 0.5 m lattice
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "fill",
        material: 2,
        mask: { kind: "solid-only" },
        shape: { kind: "box", center: [2, 2, 2], halfExtents: [1.5, 1.5, 1.5] },
      },
      TABLE,
    );
    // room centre (sample 8 = 2 m, density 32 after the dig): the mask made
    // fill keep the existing air (an unmasked fill writes −48 here)
    expect(getDensity(s, 8, 8, 8)).toBeGreaterThanOrEqual(0);
    // beyond the fill shape's boundary: virgin rock, untouched
    expect(getDensity(s, 2, 8, 8)).toBeLessThan(0);
    // the already-solid shell INSIDE the shape (sample 3 = 0.75 m, dig margin
    // −8) passes the mask, so fill still claims it for masonry
    expect(getMaterial(s, 3, 8, 8)).toBe(2);
  });

  test("selection mask (flood-void) + paint composes to a no-op", () => {
    // paint's own domain is SOLID cells; a flood-void selection is AIR cells —
    // the intersection is empty, and that IS the correct composition semantics.
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digBox([2, 2, 2], [1, 1, 1]), TABLE);
    const before = encodeChunkFile(s.chunks.get("0,0,0") as Int8Array);
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "paint",
        material: 1,
        mask: {
          kind: "selection",
          selection: { kind: "flood-void", seed: [8, 8, 8], budget: 10000 },
        },
        shape: { kind: "box", center: [2, 2, 2], halfExtents: [3, 3, 3] },
      },
      TABLE,
    );
    // no cell painted (an unmasked paint claims the room's solid shell), and
    // the density channel is untouched
    expect(s.materials.size).toBe(0);
    expect(encodeChunkFile(s.chunks.get("0,0,0") as Int8Array)).toEqual(before);
  });

  test("selection mask replays identically; dig + flood-void changes cells", () => {
    const build = () => {
      const s = createFieldStore();
      const log = createOpLog();
      logApply(s, log, digBox([2, 2, 2], [1, 1, 1]), TABLE);
      // a wider dig masked to the room's void flood: only cells the flood
      // selected (density ≥ 0) may open further — rock outside stays rock
      logApply(
        s,
        log,
        {
          id: 0,
          kind: "brush",
          effect: "dig",
          mask: {
            kind: "selection",
            selection: { kind: "flood-void", seed: [8, 8, 8], budget: 10000 },
          },
          shape: {
            kind: "box",
            center: [2, 2, 2],
            halfExtents: [1.5, 1.5, 1.5],
          },
        },
        TABLE,
      );
      return s;
    };
    const a = build();
    // the masked dig DID change cells: the room-boundary sample (4 = 1 m,
    // density 0 after the room dig, IN the flood) opened to sdf 0.5 m → 16
    expect(getDensity(a, 4, 8, 8)).toBe(16);
    // …but the solid sample one ring out (3 = 0.75 m, density −8, NOT in the
    // flood) stayed put — an unmasked dig would write sdf 0.25 m → 8 there
    expect(getDensity(a, 3, 8, 8)).toBe(-8);
    // replay determinism: the op RECORD embeds the spec; a fresh replay
    // re-evaluates the flood against the same pre-op state → identical bytes
    const b = build();
    expect([...a.chunks.keys()].sort()).toEqual([...b.chunks.keys()].sort());
    for (const k of a.chunks.keys())
      expect(encodeChunkFile(a.chunks.get(k) as Int8Array)).toEqual(
        encodeChunkFile(b.chunks.get(k) as Int8Array),
      );
  });

  test("a selection mask materializes ONCE, against pre-op state", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digBox([2, 2, 2], [2, 2, 2]), TABLE);
    // dirt band, x/z-ASYMMETRIC (x 5..11 × z 7..9 — a transposed x↔z at the
    // selectionHas call site selects a different cell set and fails below):
    // x ∈ (1,3)m → 5..11; y ∈ (−0.8,−0.2)m → −3..−1; z ∈ (1.5,2.5)m → 7..9.
    logApply(s, log, paintBox([2, -0.5, 2], [1, 0.3, 0.5], 1), TABLE); // 63 dirt cells
    // retint the dirt flood to moss. A mid-loop re-materialization repaints
    // the seed cell, breaks the flood (seed is no longer class 1), and strands
    // the band's tail as dirt — materialize-once retints ALL 63 cells.
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "paint",
        material: 3,
        mask: {
          kind: "selection",
          selection: {
            kind: "flood-material",
            seed: [8, -2, 8],
            classId: 1,
            budget: 10000,
          },
        },
        shape: { kind: "box", center: [2, -0.5, 2], halfExtents: [2, 1, 2] },
      },
      TABLE,
    );
    for (let z = 7; z <= 9; z++)
      for (let y = -3; y <= -1; y++)
        for (let x = 5; x <= 11; x++) expect(getMaterial(s, x, y, z)).toBe(3);
    // solid rock inside the shape but OUTSIDE the flood stays rock
    expect(getMaterial(s, 8, -5, 8)).toBe(0);
  });

  test("assertOpValid rejects bad masks setup-loud; a bad op never enters the log", () => {
    const base: BrushOp = {
      id: 0,
      kind: "brush",
      effect: "paint",
      material: 0,
      shape: { kind: "box", center: [1, 1, 1], halfExtents: [1, 1, 1] },
    };
    expect(() =>
      assertOpValid({ ...base, mask: { kind: "class", classId: 99 } }, TABLE),
    ).toThrow(/unknown/);
    expect(() =>
      assertOpValid(
        {
          ...base,
          mask: {
            kind: "selection",
            selection: { kind: "flood-void", seed: [0.5, 0, 0], budget: 10 },
          },
        },
        TABLE,
      ),
    ).toThrow(/seed/);
    expect(() =>
      assertOpValid(
        {
          ...base,
          mask: {
            kind: "selection",
            selection: { kind: "flood-void", seed: [0, 0, 0], budget: 0 },
          },
        },
        TABLE,
      ),
    ).toThrow(/budget/);
    expect(() =>
      assertOpValid(
        {
          ...base,
          mask: {
            kind: "selection",
            selection: {
              kind: "flood-void",
              seed: [0, 0, 0],
              budget: MAX_SELECTION_BUDGET + 1,
            },
          },
        },
        TABLE,
      ),
    ).toThrow(/budget/);
    // an op-embedded flood-material spec validates its class id too
    expect(() =>
      assertOpValid(
        {
          ...base,
          mask: {
            kind: "selection",
            selection: {
              kind: "flood-material",
              seed: [0, 0, 0],
              classId: 99,
              budget: 10,
            },
          },
        },
        TABLE,
      ),
    ).toThrow(/unknown/);
    expect(() =>
      assertOpValid({ ...base, mask: { kind: "solid-only" } }, TABLE),
    ).not.toThrow();
    // the validation path throws BEFORE any store mutation: a bad masked op
    // via logApply leaves the log and the store untouched
    const s = createFieldStore();
    const log = createOpLog();
    expect(() =>
      logApply(
        s,
        log,
        { ...base, mask: { kind: "class", classId: 99 } },
        TABLE,
      ),
    ).toThrow(/unknown/);
    expect(log.ops.length).toBe(0);
    expect(log.undoStack.length).toBe(0);
    expect(s.chunks.size).toBe(0);
    expect(s.materials.size).toBe(0);
  });

  test("class-kind masks fail CLOSED on a cell material missing from the table", () => {
    // A store painted under a 4-class table, then edited under a 2-class one
    // (the setMaterialTable catalog-swap path): cells holding the now-unknown
    // class must be SKIPPED — never a mid-application throw, which would leave
    // a partial mutation untracked by undo (the local inverse is discarded).
    const SMALL: MaterialTable = {
      classes: [
        { id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
        { id: 1, name: "dirt", kind: "organic", color: [0.4, 0.3, 0.2, 1] },
      ],
    };
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digBox([2, 2, 2], [2, 2, 2]), TABLE);
    // moss (class 3, unknown to SMALL) band in the rock below the floor
    logApply(s, log, paintBox([2, -0.5, 2], [1, 0.3, 0.5], 3), TABLE);
    expect(getMaterial(s, 8, -2, 8)).toBe(3);
    // organic-only repaint under the SMALL table, covering the moss band
    expect(() =>
      logApply(
        s,
        log,
        {
          id: 0,
          kind: "brush",
          effect: "paint",
          material: 1,
          mask: { kind: "organic-only" },
          shape: { kind: "box", center: [2, -1, 2], halfExtents: [2, 2, 2] },
        },
        SMALL,
      ),
    ).not.toThrow();
    // the unknown-class cell was skipped (mask failed closed)…
    expect(getMaterial(s, 8, -2, 8)).toBe(3);
    // …while the REST of the op applied: rock cells processed BEFORE and
    // AFTER the moss band in loop order (z outer, then y, then x) retinted
    expect(getMaterial(s, 8, -5, 8)).toBe(1); // y −5 < band rows (−3..−1)
    expect(getMaterial(s, 8, -2, 10)).toBe(1); // z 10 > band planes (7..9)
  });

  // Shared fixture for the organic-only / kit-only tests: two x/z-ASYMMETRIC
  // bands in the rock below a dug room (a transposed x↔z at the mask's
  // getMaterial call site reads a different cell's class and fails these).
  // masonry (kit, 2): x 5..7 × y −5..−3 × z 5..11 — painted via a
  // lattice-snapped box (faces at 1/2, −1.5/−0.5, 1/3 m), kit discipline.
  // dirt (organic, 1): x 9..11 × y −5..−3 × z 5..11.
  const kindMaskFixture = (): {
    s: ReturnType<typeof createFieldStore>;
    log: ReturnType<typeof createOpLog>;
  } => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digBox([2, 2, 2], [2, 2, 2]), TABLE);
    logApply(s, log, paintBox([1.5, -1, 2], [0.5, 0.5, 1], 2), TABLE);
    logApply(s, log, paintBox([2.5, -1, 2], [0.5, 0.5, 1], 1), TABLE);
    return { s, log };
  };
  const kindMaskPaint = (mask: BrushMask): BrushOp => ({
    id: 0,
    kind: "brush",
    effect: "paint",
    material: 3,
    mask,
    shape: { kind: "box", center: [2, -1, 2], halfExtents: [2, 1, 2] },
  });

  test("kit-only mask retints kit cells only", () => {
    const { s, log } = kindMaskFixture();
    logApply(s, log, kindMaskPaint({ kind: "kit-only" }), TABLE);
    for (let z = 5; z <= 11; z++)
      for (let y = -5; y <= -3; y++) {
        for (let x = 5; x <= 7; x++) expect(getMaterial(s, x, y, z)).toBe(3); // masonry → moss
        for (let x = 9; x <= 11; x++) expect(getMaterial(s, x, y, z)).toBe(1); // dirt kept
      }
    expect(getMaterial(s, 2, -4, 8)).toBe(0); // ambient rock kept
  });

  test("organic-only mask retints organic cells only", () => {
    const { s, log } = kindMaskFixture();
    logApply(s, log, kindMaskPaint({ kind: "organic-only" }), TABLE);
    for (let z = 5; z <= 11; z++)
      for (let y = -5; y <= -3; y++) {
        for (let x = 5; x <= 7; x++) expect(getMaterial(s, x, y, z)).toBe(2); // masonry kept
        for (let x = 9; x <= 11; x++) expect(getMaterial(s, x, y, z)).toBe(3); // dirt → moss
      }
    expect(getMaterial(s, 2, -4, 8)).toBe(3); // ambient rock (organic) → moss
  });

  test("fill + flood-void mask solidifies the cavity; the solid shell keeps its material", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digBox([2, 2, 2], [1, 1, 1]), TABLE); // room: air 4..12, −8 ring at 3/13
    // a dirt patch ON the solid shell, inside the fill shape but outside the
    // flood: x = 3 only (0.75 m), y,z 7..9
    logApply(s, log, paintBox([0.75, 2, 2], [0.2, 0.5, 0.5], 1), TABLE);
    expect(getMaterial(s, 3, 8, 8)).toBe(1);
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "fill",
        material: 3,
        mask: {
          kind: "selection",
          selection: { kind: "flood-void", seed: [8, 8, 8], budget: 10000 },
        },
        shape: { kind: "box", center: [2, 2, 2], halfExtents: [1.5, 1.5, 1.5] },
      },
      TABLE,
    );
    // formerly-air flood cells solidified AND took the fill material
    expect(getDensity(s, 8, 8, 8)).toBe(-48); // centre: −sdf(1.5 m)·32
    expect(getMaterial(s, 8, 8, 8)).toBe(3);
    expect(getDensity(s, 4, 8, 8)).toBe(-16); // room boundary (was 0, in the flood)
    expect(getMaterial(s, 4, 8, 8)).toBe(3);
    // the pre-existing solid shell inside the shape kept density AND material
    expect(getDensity(s, 3, 8, 8)).toBe(-8);
    expect(getMaterial(s, 3, 8, 8)).toBe(1);
  });
});

// Literal derivations at cellSize 0.25 (sample = metres × 4, DENSITY_SCALE 32).
// Room dig digBox([2,2,2],[2,2,2]) leaves air density sdf·32: sample (5,8,8) =
// (1.25,2,2) m → sdf 1.25 → 40; (6,8,8) → 48; (7,8,8) → 56; centre (8,8,8) →
// 64. The hollow-fill box he [1,1,1] (faces 1..3 m) has box sdf 0.25 at sample
// 5 (nd −8), 0.5 at sample 6 (nd −16), 0.75 at sample 7 — beyond hollow 0.5,
// so the non-destructive skip leaves it untouched.
describe("hollow fill (F2b)", () => {
  test("hollow fill in open air builds a shell; the interior stays air", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digBox([2, 2, 2], [2, 2, 2]), TABLE); // room: air 0..16
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "fill",
        material: 1,
        hollow: 0.5,
        shape: { kind: "box", center: [2, 2, 2], halfExtents: [1, 1, 1] },
      },
      TABLE,
    );
    // shell band (0 < sdf ≤ 0.5): solidified with the op's material
    expect(getDensity(s, 5, 8, 8)).toBe(-8); // sdf 0.25 (was air 40)
    expect(getDensity(s, 6, 8, 8)).toBe(-16); // sdf 0.5 (was air 48)
    expect(getMaterial(s, 5, 8, 8)).toBe(1);
    expect(getMaterial(s, 6, 8, 8)).toBe(1);
    // interior (sdf > hollow): SKIPPED — the room's air survives untouched
    expect(getDensity(s, 7, 8, 8)).toBe(56); // first interior sample
    expect(getDensity(s, 8, 8, 8)).toBe(64); // box centre still air
    expect(getMaterial(s, 8, 8, 8)).toBe(MAT_ROCK);
  });

  test("hollow fill over existing solid: interior bytes unchanged (non-destructive)", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digBox([2, 2, 2], [2, 2, 2]), TABLE); // room: air 0..16
    // re-solidify a dirt block (faces 0.5..3.5 m — samples 2..14) so the
    // hollow op below runs entirely inside EXISTING solid
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "fill",
        material: 1,
        shape: { kind: "box", center: [2, 2, 2], halfExtents: [1.5, 1.5, 1.5] },
      },
      TABLE,
    );
    const before = new Map(
      [...s.chunks].map(([k, v]) => [k, Int8Array.from(v)]),
    );
    logApply(
      s,
      log,
      {
        id: 0,
        kind: "brush",
        effect: "fill",
        material: 3,
        hollow: 0.25,
        shape: { kind: "box", center: [2, 2, 2], halfExtents: [1, 1, 1] },
      },
      TABLE,
    );
    // the op DID apply: the shell band (sdf 0.25) retinted to moss…
    expect(getMaterial(s, 5, 8, 8)).toBe(3);
    // …but the deep interior was never dug OR retinted (skipped, not filled)…
    expect(getMaterial(s, 8, 8, 8)).toBe(1);
    // …and the density channel is byte-unchanged store-wide: every shell
    // sample sits > 0.5 m inside the dirt block (d ≤ −24), deeper than the
    // shell band's own −8, so a non-destructive hollow fill writes no density
    expect(s.chunks.size).toBe(before.size);
    for (const [k, v] of before) expect(s.chunks.get(k)).toEqual(v);
  });

  test("assertOpValid: hollow is fill-only, positive, and lattice-true for kit fills", () => {
    const fillBoxOp = (material: number, hollow: number): BrushOp => ({
      id: 0,
      kind: "brush",
      effect: "fill",
      material,
      hollow,
      shape: { kind: "box", center: [1, 1, 1], halfExtents: [0.5, 0.5, 0.5] },
    });
    // hollow on a non-fill effect is rejected for EVERY effect — dig, paint,
    // AND smooth (whose validation leg returns early; the hollow check must
    // run before it)
    expect(() =>
      assertOpValid({ ...digBox([1, 1, 1], [1, 1, 1]), hollow: 0.5 }, TABLE),
    ).toThrow(/hollow/);
    expect(() =>
      assertOpValid(
        { ...paintBox([1, 1, 1], [1, 1, 1], 1), hollow: 0.5 },
        TABLE,
      ),
    ).toThrow(/hollow/);
    expect(() =>
      assertOpValid(
        {
          id: 0,
          kind: "brush",
          effect: "smooth",
          hollow: 0.5,
          smooth: { strength: 16, iterations: 1, mode: "both" },
          shape: { kind: "sphere", center: [1, 1, 1], radius: 1 },
        },
        TABLE,
      ),
    ).toThrow(/hollow/);
    // non-positive thickness rejected (fill effect, organic material)
    expect(() => assertOpValid(fillBoxOp(1, 0), TABLE)).toThrow(/hollow/);
    expect(() => assertOpValid(fillBoxOp(1, -0.5), TABLE)).toThrow(/hollow/);
    // kit-class fills: the shell's INNER faces must land on lattice planes,
    // so the thickness must be a positive multiple of 0.5 m
    expect(() => assertOpValid(fillBoxOp(2, 0.25), TABLE)).toThrow(/lattice/);
    expect(() => assertOpValid(fillBoxOp(2, 0.3), TABLE)).toThrow(/lattice/);
    expect(() => assertOpValid(fillBoxOp(2, 0.5), TABLE)).not.toThrow();
    expect(() => assertOpValid(fillBoxOp(2, 1), TABLE)).not.toThrow();
    // organic fills take any positive thickness
    expect(() => assertOpValid(fillBoxOp(1, 0.3), TABLE)).not.toThrow();
    expect(() => assertOpValid(fillBoxOp(3, 0.5), TABLE)).not.toThrow();
  });
});

describe("spliceOps (F3a)", () => {
  const ids = (ops: FieldOp[]): number[] => ops.map((o) => o.id);
  const four = (): FieldOp[] => [1, 2, 3, 4].map((id) => sphere(id));

  test("replaces a mid-array span and keeps the tail in order", () => {
    const ops = four();
    const tail = ops[3];
    spliceOps(ops, 1, 2, [sphere(9), sphere(10)]);
    expect(ids(ops)).toEqual([1, 9, 10, 4]);
    expect(ops[3]).toBe(tail); // the tail is re-pushed, not rebuilt
    // insert and delete counts need not match — that is the whole point
    spliceOps(ops, 1, 2, []);
    expect(ids(ops)).toEqual([1, 4]);
    spliceOps(ops, 2, 0, [sphere(5)]);
    expect(ids(ops)).toEqual([1, 4, 5]);
  });

  // Native splice CLAMPS these (and reads a negative `at` from the end);
  // spliceOps refuses instead. A negative deleteCount is the dangerous one: it
  // re-pushes ops it never removed, so the SAME op object lands in the log
  // twice under one id and survives into replay, serialization and bake.
  test("throws on an invalid span instead of mangling the log", () => {
    for (const [at, deleteCount] of [
      [-2, 1],
      [1.5, 1],
      [1, -1],
      [1, 0.5],
      [5, 0],
      [2, 3],
    ] as const) {
      const ops = four();
      expect(() => spliceOps(ops, at, deleteCount, [sphere(9)])).toThrow(
        /invalid span/,
      );
      expect(ids(ops)).toEqual([1, 2, 3, 4]); // rejected BEFORE any mutation
    }
    // the exact boundary is allowed: a span ending at the last op
    const ops = four();
    spliceOps(ops, 2, 2, [sphere(9)]);
    expect(ids(ops)).toEqual([1, 2, 9]);
  });
});

// F3a reconfigure replaces a span in the MIDDLE of the log, which a
// tail-peeling entry cannot represent. Both entries are hand-built here — Task
// 3 (reconfigureGenerator) ships the verb that produces splice entries, Task 4
// the one that produces entity-update entries.
describe("splice + entity-update log entries (F3a)", () => {
  /** A hall entity op at log id 7, distinguishable by `width` — so a swap to
   *  the wrong slot is detectable by VALUE and not only by the array's shape. */
  const hallOf = (width: number): EntityOp => ({
    id: 7,
    kind: "entity",
    action: "place",
    entity: {
      entityId: 7,
      type: "generator",
      generator: "hall",
      params: { width },
      seed: 1,
      region: { min: [0, 0, 0], max: [4, 2, 4] },
      opSpan: [1, 1],
    },
  });

  test("a splice entry restores the ops array positionally and the store byte-exactly", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digSphere([1, 1, 1], 1), TABLE);
    // a DOWNSTREAM op: the span is spliced out of the middle, so the tail must
    // survive both directions with its order and identity intact
    logApply(s, log, digSphere([20, 1, 1], 1), TABLE);
    const removed = log.ops.slice(0, 1);
    const tail = log.ops.slice(1);
    const beforeStore = snapshotAll(s);

    // The replacement span: a dig that reaches chunks the removed op never
    // touched (undo must DELETE those) plus a fill that claims the material
    // channel (undo must drop that entry too).
    const inserted: BrushOp[] = [
      { ...digSphere([3, 1, 1], 1), id: log.nextId++ },
      {
        id: log.nextId++,
        kind: "brush",
        effect: "fill",
        material: 1,
        shape: { kind: "sphere", center: [3, 1, 1], radius: 0.6 },
      },
    ];
    const before: OpInverse = new Map();
    for (const op of inserted) {
      const r = applyOp(s, op, TABLE);
      for (const [k, pre] of r.inverse) if (!before.has(k)) before.set(k, pre);
    }
    // the span really did allocate fresh chunks and fresh material entries —
    // otherwise "undo deletes what the span created" would be vacuous
    expect([...before.values()].some((img) => img.density === null)).toBe(true);
    expect([...before.values()].some((img) => img.materials === null)).toBe(
      true,
    );
    expect(s.materials.size).toBeGreaterThan(0);

    // An edit that is NOT in `inserted`, folded into the affected images the
    // way reconfigure folds a whole replayed downstream: redo restores BYTES,
    // so this must reappear even though no logged op can explain it.
    const rw = applyOp(s, { ...digSphere([9, 9, 9], 1), id: 99 }, TABLE);
    for (const [k, pre] of rw.inverse) if (!before.has(k)) before.set(k, pre);
    const after = imagesOf(s, before.keys());

    log.ops.splice(0, removed.length, ...inserted);
    log.undoStack.push({
      kind: "splice",
      at: 0,
      removed,
      inserted,
      before,
      after,
    });

    expect(undo(s, log).size).toBe(before.size);
    expect(log.ops).toEqual([...removed, ...tail]); // positional restore
    expect(log.ops[0]).toBe(removed[0]); // …of the same op objects
    expect(log.ops[1]).toBe(tail[0]);
    expect(snapshotAll(s)).toEqual(beforeStore);

    expect(redo(s, log, TABLE).size).toBe(after.size);
    expect(log.ops).toEqual([...inserted, ...tail]);
    expect(log.ops[2]).toBe(tail[0]);
    expect(imagesOf(s, after.keys())).toEqual(after);
    // …including the out-of-span edit: nothing in `log.ops` opens air at
    // (9,9,9), so redo replayed bytes rather than re-executing the span
    expect(getDensity(s, 36, 36, 36)).toBeGreaterThan(0);
  });

  test("an entity-update entry swaps one entity op in place and touches no chunks", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, digSphere([1, 1, 1], 1), TABLE);
    const before = hallOf(4);
    const after = hallOf(8);
    log.ops.push(after);
    const opIndex = log.ops.length - 1;
    const store = snapshotAll(s);
    log.undoStack.push({ kind: "entity-update", opIndex, before, after });

    expect(undo(s, log).size).toBe(0);
    expect(log.ops.length).toBe(2); // an in-place swap, never a pop
    expect(log.ops[opIndex]).toBe(before);
    expect(snapshotAll(s)).toEqual(store);

    expect(redo(s, log, TABLE).size).toBe(0);
    expect(log.ops.length).toBe(2);
    expect(log.ops[opIndex]).toBe(after);
    expect(snapshotAll(s)).toEqual(store);
  });

  // `opIndex` is a STORED value, and the swap used to be a bare
  // `log.ops[opIndex] = …`. Measured before the guard: index 5000 on a 1-op log
  // GREW the array to 5001 with 4999 holes and returned an empty dirty set, and
  // index -1 installed a non-index string property nothing reads back — silent
  // log corruption in both directions, either side of the spliceOps guard that
  // sits three lines away.
  describe("entity-update index guard", () => {
    // `message` pins the KIND the guard reports finding — the fact that says
    // whether the index missed the array or hit the wrong op.
    type IndexCase = { name: string; opIndex: number; message: RegExp };
    const CASES: IndexCase[] = [
      { name: "past the end", opIndex: 5000, message: /found "nothing"/ },
      {
        name: "exactly one past the end",
        opIndex: 2,
        message: /found "nothing"/,
      },
      { name: "negative", opIndex: -1, message: /found "nothing"/ },
      { name: "not an integer", opIndex: 1.5, message: /found "nothing"/ },
      { name: "addressing a BRUSH op", opIndex: 0, message: /found "brush"/ },
    ];

    /** A log of [brush, entity] plus the entry under test on `stack`, over the
     *  same distinguishable {@link hallOf} pair the swap test uses. */
    const withEntry = (
      stack: "undoStack" | "redoStack",
      opIndex: number,
    ): { s: FieldStore; log: OpLog; before: EntityOp; after: EntityOp } => {
      const s = createFieldStore();
      const log = createOpLog();
      logApply(s, log, digSphere([1, 1, 1], 1), TABLE);
      const before = hallOf(4);
      const after = hallOf(8);
      log.ops.push(after);
      log[stack].push({ kind: "entity-update", opIndex, before, after });
      return { s, log, before, after };
    };

    /** The ops array seen as a plain object — the view a negative or fractional
     *  index writes THROUGH, and which array indexing never reads back. */
    const asRecord = (log: OpLog): Record<string, unknown> =>
      log.ops as unknown as Record<string, unknown>;

    /** Depths + ops + store, so "mutating nothing" covers every stack too. */
    const stateOf = (s: FieldStore, log: OpLog) => ({
      ops: [...log.ops],
      store: snapshotAll(s),
      undoDepth: log.undoStack.length,
      redoDepth: log.redoStack.length,
    });

    for (const c of CASES) {
      test(`undo rejects an index ${c.name}, mutating nothing`, () => {
        const { s, log } = withEntry("undoStack", c.opIndex);
        const state = stateOf(s, log);

        expect(() => undo(s, log)).toThrow(/entity-update/);
        expect(() => undo(s, log)).toThrow(c.message);

        // the entry stays put — never stranded on the far stack
        expect(stateOf(s, log)).toEqual(state);
      });

      test(`redo rejects an index ${c.name}, mutating nothing`, () => {
        const { s, log } = withEntry("redoStack", c.opIndex);
        const state = stateOf(s, log);

        expect(() => redo(s, log, TABLE)).toThrow(/entity-update/);
        expect(() => redo(s, log, TABLE)).toThrow(c.message);

        expect(stateOf(s, log)).toEqual(state);
      });
    }

    // The integer and lower-bound clauses are NOT subsumed by the kind clause,
    // though on a clean array they look it: `ops[1.5]` and `ops[-1]` read
    // undefined there, so kind alone rejects both. But `log.ops` is public and
    // mutable, and a non-index property is exactly what an unguarded write of
    // this shape installs — measured before the guard: index −1 put a "-1"
    // property on the array. Given one, the kind clause ACCEPTS the index and
    // writes a second.
    const STRAY_CASES: { name: string; opIndex: number; key: string }[] = [
      { name: "fractional", opIndex: 1.5, key: "1.5" },
      { name: "negative", opIndex: -1, key: "-1" },
    ];

    for (const c of STRAY_CASES) {
      test(`a ${c.name} index is rejected even when a matching property exists`, () => {
        const { s, log, after } = withEntry("undoStack", c.opIndex);
        asRecord(log)[c.key] = after;
        const state = stateOf(s, log);

        expect(() => undo(s, log)).toThrow(/entity-update/);

        expect(stateOf(s, log)).toEqual(state);
        // …and nothing was written THROUGH the stray slot either: undo would
        // have put `before` there, which is a DIFFERENT record
        expect(asRecord(log)[c.key]).toBe(after);
      });
    }

    test("the in-range entity-op index the guard must ACCEPT", () => {
      const { s, log, before } = withEntry("undoStack", 1);
      expect(undo(s, log).size).toBe(0);
      expect(log.ops[1]).toBe(before);
      expect(log.ops.length).toBe(2);
    });
  });
});

// One GESTURE, one undo entry. The op list was always plural (`LogEntry.ops`,
// `revertEntry` peeling `entry.ops.length` off the tail); what was missing was a
// managed way to fill it. These pin the four contract clauses that separate
// `logApplyGroup` from a loop over `logApply`: one entry, a first-image inverse,
// all-validation-before-any-apply, and an empty list that costs no history step.
describe("logApplyGroup (one gesture, one undo entry)", () => {
  /** Everything a group must leave alone when it rejects or no-ops: the op
   *  array, both channels of the store, both stack depths, and the id counter. */
  const logState = (s: FieldStore, log: OpLog) => ({
    ops: [...log.ops],
    store: snapshotAll(s),
    undoDepth: log.undoStack.length,
    redoDepth: log.redoStack.length,
    nextId: log.nextId,
  });

  /** The room the painted fixtures need: paint retints SOLID cells only, so the
   *  bands below sit in the rock UNDER this dug room's floor. */
  const room = (): BrushOp => digBox([2, 2, 2], [2, 2, 2]);
  const dirtBand = (): BrushOp => paintBox([2, -0.5, 2], [1, 0.3, 1], 1);
  const mossBand = (): BrushOp => paintBox([2, -1.5, 2], [1, 0.3, 1], 3);

  test("a two-op group is ONE undo entry: one undo reverts both, one redo replays both", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, room(), TABLE);
    const before = snapshotAll(s);

    const dirty = logApplyGroup(s, log, [dirtBand(), mossBand()], TABLE);

    expect(dirty.size).toBeGreaterThan(0);
    expect(getMaterial(s, 8, -2, 8)).toBe(1); // both ops landed
    expect(getMaterial(s, 8, -6, 8)).toBe(3);
    expect(log.ops.length).toBe(3);
    // the room's entry plus ONE for the whole group — not one entry per op
    expect(log.undoStack.length).toBe(2);
    const entry = log.undoStack[1];
    if (entry?.kind !== "ops")
      throw new Error(`expected an "ops" entry, got ${entry?.kind}`);
    expect(entry.ops.length).toBe(2);

    undo(s, log);
    expect(log.ops.length).toBe(1); // shrank by the whole group
    expect(log.undoStack.length).toBe(1); // ONE pop took both ops
    expect(snapshotAll(s)).toEqual(before); // BOTH bands gone

    redo(s, log, TABLE);
    expect(log.ops.length).toBe(3);
    expect(getMaterial(s, 8, -2, 8)).toBe(1);
    expect(getMaterial(s, 8, -6, 8)).toBe(3);
  });

  test("overlapping ops: the inverse keeps the FIRST pre-image, so undo restores pre-GROUP bytes", () => {
    const a = digSphere([1, 1, 1], 1.2);
    const b: BrushOp = {
      id: 0,
      kind: "brush",
      effect: "fill",
      material: 1,
      shape: { kind: "sphere", center: [1, 1, 1], radius: 0.6 },
    };
    // Non-vacuity: the two ops must genuinely write a SHARED chunk, or
    // first-vs-last image is an unobservable distinction.
    const scratch = createFieldStore();
    const ra = applyOp(scratch, a, TABLE);
    const rb = applyOp(scratch, b, TABLE);
    expect([...ra.inverse.keys()].some((k) => rb.inverse.has(k))).toBe(true);

    const s = createFieldStore();
    const log = createOpLog();
    logApplyGroup(s, log, [a, b], TABLE);
    expect(getMaterial(s, 4, 4, 4)).toBe(1); // the fill claimed the probed cell

    undo(s, log);
    // Last-touch-wins would restore b's pre-image — which already contains a's
    // dig — and leave the chunk (and its material record) behind.
    expect(s.chunks.size).toBe(0);
    expect(s.materials.size).toBe(0);
  });

  test("ids stamp sequentially in list order; the caller's records are not mutated", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, room(), TABLE);
    expect(log.nextId).toBe(2);

    const ops = [
      dirtBand(),
      mossBand(),
      paintBox([2, -2.5, 2], [1, 0.3, 1], 1),
    ];
    logApplyGroup(s, log, ops, TABLE);

    expect(log.nextId).toBe(5); // advanced by ops.length, not by 1
    expect(log.ops.map((o) => o.id)).toEqual([1, 2, 3, 4]);
    const entry = log.undoStack[1];
    if (entry?.kind !== "ops")
      throw new Error(`expected an "ops" entry, got ${entry?.kind}`);
    expect(entry.ops.map((o) => o.id)).toEqual([2, 3, 4]);
    // The log stamps a COPY: a caller reusing its op records across gestures
    // never finds them rewritten (the logApply provenance posture).
    expect(ops.map((o) => o.id)).toEqual([0, 0, 0]);
  });

  test("validation is all-before-any: a bad SECOND op mutates nothing", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, room(), TABLE);
    logApply(s, log, dirtBand(), TABLE);
    undo(s, log); // a real redo step to protect as well

    const good = digBox([6, 2, 2], [1, 1, 1]); // virgin rock: a REAL mutation
    // Non-vacuity: op 1 of the group would have written, so "nothing changed"
    // means the validation pass genuinely ran before the first apply.
    expect(applyOp(createFieldStore(), good, TABLE).dirty.size).toBeGreaterThan(
      0,
    );
    const bad: BrushOp = {
      ...mossBand(),
      mask: { kind: "class", classId: 99 },
    };
    const state = logState(s, log);

    expect(() => logApplyGroup(s, log, [good, bad], TABLE)).toThrow(/unknown/);

    expect(logState(s, log)).toEqual(state);
  });

  test("an empty group is free: no entry, no dirty chunks, and the redo step survives", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, room(), TABLE);
    undo(s, log);
    expect(log.redoStack.length).toBe(1);
    const state = logState(s, log);

    expect(logApplyGroup(s, log, [], TABLE).size).toBe(0);

    expect(logState(s, log)).toEqual(state); // no entry, no phantom ⌘Z step
    expect(redo(s, log, TABLE).size).toBeGreaterThan(0); // still takeable
  });

  test("a non-empty group clears the redo stack, like any other mutation", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, room(), TABLE);
    undo(s, log);
    expect(log.redoStack.length).toBe(1);

    logApplyGroup(s, log, [digBox([6, 2, 2], [1, 1, 1])], TABLE);

    expect(log.redoStack.length).toBe(0);
  });
});
