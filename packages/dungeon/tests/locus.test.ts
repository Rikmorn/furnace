import { describe, expect, test } from "bun:test";
import { create as makeRng } from "@furnace/core/rng";
import { pairFeasible, sampleSeatLoci } from "../src/locus.ts";
import type { Connection } from "../src/region.ts";

const portal = (x: number, z: number, fx: number, fz: number): Connection => ({
  position: [x, 0, z],
  facing: [fx, 0, fz],
  width: 2,
  height: 2.8,
  kind: "door",
});

describe("sampleSeatLoci", () => {
  const parent = portal(0, 0, 0, 1); // facing +Z
  test("deterministic for a given stream", () => {
    const a = sampleSeatLoci(parent, [4, 10], 0, makeRng("s").derive("n"), 24);
    const b = sampleSeatLoci(parent, [4, 10], 0, makeRng("s").derive("n"), 24);
    expect(a).toEqual(b);
  });
  test("canonical candidate first: shortest length, dead ahead", () => {
    const cands = sampleSeatLoci(
      parent,
      [4, 10],
      2,
      makeRng("s").derive("n"),
      24,
    );
    expect(cands[0]?.target.position).toEqual([0, 2, 4]);
    expect(cands[0]?.target.facing).toEqual([0, 0, 1]);
  });
  test("every sample lies in the annular cone and at exact dh", () => {
    const cands = sampleSeatLoci(
      parent,
      [4, 10],
      -3,
      makeRng("s").derive("n"),
      48,
    );
    for (const c of cands) {
      const dx = c.target.position[0];
      const dz = c.target.position[2];
      const run = Math.hypot(dx, dz);
      expect(run).toBeGreaterThanOrEqual(4 - 1e-9);
      expect(run).toBeLessThanOrEqual(10 + 1e-9);
      expect(c.target.position[1]).toBe(-3);
      // bearing within the sampling window of the parent facing (+Z)
      expect(dz / run).toBeGreaterThanOrEqual(Math.cos(Math.PI / 4) - 1e-9);
      // target facing = outward bearing (join seats the node portal exactly opposite)
      expect(c.target.facing[0]).toBeCloseTo(dx / run, 9);
      expect(c.target.facing[2]).toBeCloseTo(dz / run, 9);
    }
  });
});

describe("pairFeasible", () => {
  test("accepts facing pairs within cones and length range", () => {
    expect(pairFeasible(portal(0, 0, 0, 1), portal(0, 6, 0, -1), [4, 10])).toBe(
      true,
    );
  });
  test("rejects out-of-range and out-of-cone", () => {
    expect(
      pairFeasible(portal(0, 0, 0, 1), portal(0, 20, 0, -1), [4, 10]),
    ).toBe(false);
    expect(pairFeasible(portal(0, 0, 0, 1), portal(0, 6, 0, 1), [4, 10])).toBe(
      false,
    ); // both face +Z
    expect(pairFeasible(portal(0, 0, 0, 1), portal(6, 0, -1, 0), [4, 10])).toBe(
      false,
    ); // 90° off the parent cone... (perpendicular offset)
  });
});
