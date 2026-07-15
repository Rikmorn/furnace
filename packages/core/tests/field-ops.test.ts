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

  // Mutation-proof: a deliberately broken inverse must fail the identity test.
  test("MUTATION GUARD: tampering one byte after undo is detected", () => {
    const s = createFieldStore();
    const log = createOpLog();
    logApply(s, log, sphere(0));
    const snapshot = new Map(
      [...s.chunks].map(([k, v]) => [k, Int8Array.from(v)]),
    );
    logApply(s, log, sphere(0));
    undo(s, log);
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
    }
    expect(mismatch).toBe(true);
  });
});
