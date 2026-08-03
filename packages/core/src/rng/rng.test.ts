import { expect, test } from "bun:test";
import * as rng from "./index.ts";

test("same seed yields an identical float sequence", () => {
  const a = rng.create("dungeon-001");
  const b = rng.create("dungeon-001");
  const seqA = Array.from({ length: 8 }, () => a.float());
  const seqB = Array.from({ length: 8 }, () => b.float());
  expect(seqA).toEqual(seqB);
});

test("different seeds diverge", () => {
  expect(rng.create("a").float()).not.toEqual(rng.create("b").float());
});

test("float() is in [0,1)", () => {
  const r = rng.create(42);
  for (let i = 0; i < 2000; i++) {
    const v = r.float();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  }
});

test("int(min,max) is an integer in [min,max)", () => {
  const r = rng.create(7);
  for (let i = 0; i < 2000; i++) {
    const v = r.int(3, 9);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(3);
    expect(v).toBeLessThan(9);
  }
});

test("derive() is deterministic per label and distinct across labels", () => {
  const geomA = rng.create("region-1").derive("geometry").float();
  const geomB = rng.create("region-1").derive("geometry").float();
  const props = rng.create("region-1").derive("props").float();
  expect(geomA).toEqual(geomB);
  expect(geomA).not.toEqual(props);
});

test("int() throws when maxExclusive <= minInclusive", () => {
  expect(() => rng.create(1).int(9, 3)).toThrow();
  expect(() => rng.create(1).int(5, 5)).toThrow();
});

test("pick() throws on an empty array", () => {
  expect(() => rng.create(1).pick([])).toThrow();
});
