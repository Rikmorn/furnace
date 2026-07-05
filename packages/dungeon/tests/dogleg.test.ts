import { describe, expect, test } from "bun:test";
import { create as makeRng } from "@furnace/core/rng";
import { buildDogleg, cornerCandidates } from "../src/dogleg.ts";
import { pairFeasible } from "../src/locus.ts";
import type { Connection } from "../src/region.ts";

const portal = (
  x: number,
  y: number,
  z: number,
  fx: number,
  fz: number,
): Connection => ({
  position: [x, y, z],
  facing: [fx, 0, fz],
  width: 2,
  height: 2.8,
  kind: "door",
});

describe("dogleg", () => {
  // Right-angle case: a faces +Z, b sits off to the +X side facing -X — straight
  // routing is facing-infeasible (cones can never meet), the canonical dogleg client.
  // (b's Z is 3, not the plan draft's 10: at z=10 the a→b line is a 45°/45° diagonal that
  // sits INSIDE both 60° cones, so straight would be FEASIBLE — verified empirically —
  // contradicting this fixture's own `.toBe(false)` sanity assertion and its stated intent;
  // z=3 puts a's cone >60° off the line, the genuinely infeasible right-angle client.)
  const a = portal(0, 0, 0, 0, 1);
  const b = portal(10, -3, 3, -1, 0);
  test("straight is infeasible (sanity)", () => {
    expect(pairFeasible(a, b, [2, 20])).toBe(false);
  });
  test("cornerCandidates: every candidate yields cone+range-feasible segments and a walkable descent", () => {
    const cands = cornerCandidates(
      a,
      b,
      [2, 14],
      makeRng("dog").derive("c"),
      24,
    );
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(pairFeasible(a, c.door1, [1, 14])).toBe(true);
      expect(pairFeasible(c.door2, b, [c.minRunB, 14])).toBe(true);
      expect(c.door1.position[1]).toBe(0); // corner flat at the HIGH end's level
      expect(c.door2.position[1]).toBe(0);
    }
  });
  test("buildDogleg: corner room + two straight connectors, descent (with landing) in segment B", () => {
    const cands = cornerCandidates(
      a,
      b,
      [2, 14],
      makeRng("dog").derive("c"),
      24,
    );
    const dog = buildDogleg(a, b, cands[0]!, {});
    expect(dog.corner.connections.length).toBe(2);
    for (const cn of dog.corner.connections) expect(cn.kind).toBe("door");
    // segB spans the full height delta; its arrival landing is route's own descent rule
    expect(dog.segB.bounds.min[1]).toBeLessThan(-2.5);
    expect(dog.segA.bounds.min[1]).toBeGreaterThan(-1); // segment A is flat
  });
  test("predicted door1/door2 match the realized corner portals (position + facing)", () => {
    const cands = cornerCandidates(
      a,
      b,
      [2, 14],
      makeRng("dog").derive("c"),
      24,
    );
    const cand = cands[0]!;
    const dog = buildDogleg(a, b, cand, {});
    const real1 = dog.corner.connections[0]!;
    const real2 = dog.corner.connections[1]!;
    for (let i = 0; i < 3; i++) {
      expect(real1.position[i]).toBeCloseTo(cand.door1.position[i]!, 6);
      expect(real1.facing[i]).toBeCloseTo(cand.door1.facing[i]!, 6);
      expect(real2.position[i]).toBeCloseTo(cand.door2.position[i]!, 6);
      expect(real2.facing[i]).toBeCloseTo(cand.door2.facing[i]!, 6);
    }
  });
  test("deterministic candidates", () => {
    const x = cornerCandidates(a, b, [2, 14], makeRng("s").derive("c"), 16);
    const y = cornerCandidates(a, b, [2, 14], makeRng("s").derive("c"), 16);
    expect(x).toEqual(y);
  });
});
