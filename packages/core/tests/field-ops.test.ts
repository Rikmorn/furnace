import { describe, expect, test } from "bun:test";
import type { BrushOp, MaterialTable } from "@furnace/core/field";
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
  MAT_ROCK,
  parseOps,
  redo,
  SOLID,
  undo,
} from "@furnace/core/field";

const sphere = (id: number): BrushOp => ({
  id,
  kind: "brush",
  effect: "dig",
  shape: { kind: "sphere", center: [2, 2, 2], radius: 1.5 },
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
  ],
};

describe("field ops", () => {
  test("dig sphere opens air at the center, leaves rock outside", () => {
    const s = createFieldStore();
    applyOp(s, sphere(1));
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
    redo(s, log);
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
    redo(s, log);
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
