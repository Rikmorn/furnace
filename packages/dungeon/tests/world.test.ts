import { describe, expect, test } from "bun:test";
import { aabbIntersects } from "../src/aabb.ts";
import { layoutWorld } from "../src/layout.ts";
import {
  buildWorldGraph,
  COCKPIT_BUDGET,
  COCKPIT_CONFIG,
  COCKPIT_ENVELOPE,
  WORLD_SEED,
  type WorldAttempt,
  worldAttempts,
} from "../src/world.ts";

test("the proof world lays out: zero envelope overlaps, all nodes placed", () => {
  const g = buildWorldGraph(WORLD_SEED);
  const r = layoutWorld(g, WORLD_SEED);
  expect(r.placements.size).toBe(g.nodes.length);
  expect(r.connectors.length).toBe(g.edges.length);
  // Regression anchor: the hand world's cycle closes STRAIGHT — no dogleg expansion (one
  // connector per edge). A dogleg here would push connectors.length past edges.length.
  expect(r.expansions.size).toBe(0);
  for (let i = 0; i < r.regions.length; i++) {
    for (let j = i + 1; j < r.regions.length; j++) {
      expect(aabbIntersects(r.regions[i]!.bounds, r.regions[j]!.bounds)).toBe(
        false,
      );
    }
  }
});

test("deterministic: same seed, identical placements", () => {
  const a = layoutWorld(buildWorldGraph(WORLD_SEED), WORLD_SEED);
  const b = layoutWorld(buildWorldGraph(WORLD_SEED), WORLD_SEED);
  for (const [id, p] of a.placements) expect(b.placements.get(id)).toEqual(p);
});

test("the authored phantom is pinned at identity and marked authored", () => {
  const g = buildWorldGraph(WORLD_SEED);
  const authored = g.nodes.find((n) => n.id === "authored");
  expect(authored?.pinned).toEqual({ yaw: 0, translation: [0, 0, 0] });
  expect(authored?.region.provenance.theme).toBe("authored");
  expect(authored?.region.meshes.length).toBe(0); // phantom — main.ts realizes the level
  expect(authored?.region.colliders.length).toBeGreaterThan(20); // but its solids are real
});

describe("COCKPIT_ENVELOPE", () => {
  test("covers a contiguous knob range with sane, finite, provenance-consistent rows", () => {
    expect(COCKPIT_ENVELOPE.length).toBeGreaterThan(0);
    for (let i = 0; i < COCKPIT_ENVELOPE.length; i++) {
      // Boundary-safe: i is loop-bounded.
      const r = COCKPIT_ENVELOPE[i] as (typeof COCKPIT_ENVELOPE)[number];
      if (i > 0) {
        const prev = COCKPIT_ENVELOPE[
          i - 1
        ] as (typeof COCKPIT_ENVELOPE)[number];
        expect(r.rooms).toBe(prev.rooms + 1);
      }
      expect(r.singleShot).toBeGreaterThanOrEqual(0);
      expect(r.singleShot).toBeLessThanOrEqual(1);
      expect(Number.isInteger(r.attempts)).toBe(true);
      expect(r.attempts).toBeGreaterThanOrEqual(1);
      // PRECISION 2 (not 5): the committed `projected` is the probe script's
      // 3-decimal rounding (measure-b2c.ts `projected.toFixed(3)`), so this asserts
      // the row is internally consistent at the stored precision — a re-probe that
      // re-pastes 3-decimal output stays green. (Precision 5 would spuriously fail:
      // e.g. rooms 2 stores 0.996 vs recomputed 0.99609375.)
      expect(r.projected).toBeCloseTo(1 - (1 - r.singleShot) ** r.attempts, 2);
    }
  });

  test("COCKPIT_BUDGET carries a finite deadline (the search tier is fail-fast)", () => {
    expect(Number.isFinite(COCKPIT_BUDGET.deadlineMs)).toBe(true);
  });
});

describe("worker boundary contract", () => {
  test("a successful WorldAttempt structured-clones (spec premise #3)", () => {
    // The bake.test.ts fixture seed — known to place on attempt 0 at this config.
    let success: WorldAttempt | undefined;
    for (const a of worldAttempts(
      "bake-31-1",
      {
        ...COCKPIT_CONFIG,
        sectors: [1, 1],
        targetRooms: 4,
        loopChance: 0,
        attempts: 1,
      },
      COCKPIT_BUDGET,
    )) {
      if (a.ok) success = a;
    }
    expect(success).toBeDefined();
    const clone = structuredClone(success);
    expect(clone?.ok).toBe(true);
    expect(clone && "layout" in clone && clone.layout.regions.length).toBe(
      success?.ok ? success.layout.regions.length : -1,
    );
  });
});
