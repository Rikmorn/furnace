import { describe, expect, test } from "bun:test";
import type { DigOp } from "@furnace/core/field";
import {
  applyOp,
  createFieldStore,
  createOpLog,
  getDensity,
  logApply,
  redo,
  SOLID,
  undo,
} from "@furnace/core/field";

const sphere = (id: number): DigOp => ({
  id,
  kind: "dig",
  shape: { kind: "sphere", center: [2, 2, 2], radius: 1.5 },
});

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
    logApply(s, log, sphere(0));
    const before = new Map(
      [...s.chunks].map(([k, v]) => [k, Int8Array.from(v)]),
    );
    logApply(s, log, {
      id: 0,
      kind: "dig",
      shape: { kind: "box", center: [2.5, 2, 2], halfExtents: [1, 0.5, 0.5] },
    });
    undo(s, log);
    expect(s.chunks.size).toBe(before.size);
    for (const [k, v] of before) {
      expect(s.chunks.get(k)).toEqual(v);
    }
  });

  test("undo -> redo restores the post-op state (determinism)", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, sphere(0));
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
      logApply(s, log, sphere(0));
      logApply(s, log, {
        id: 0,
        kind: "dig",
        shape: { kind: "sphere", center: [3.1, 2.2, 2.7], radius: 0.9 },
      });
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
    logApply(s, log, sphere(0));
    const snapshot = new Map(
      [...s.chunks].map(([k, v]) => [k, Int8Array.from(v)]),
    );
    // A REAL second op: overlaps the sphere but opens new air at its corners,
    // so its inverse is non-empty and undo genuinely has to restore bytes.
    logApply(s, log, {
      id: 0,
      kind: "dig",
      shape: { kind: "box", center: [2.5, 2, 2], halfExtents: [1, 0.5, 0.5] },
    });
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
