// PARKED (B2c Task 0): blocked on the B2 placement wall — see docs/learnings/2026-07-04-dungeon-2.2.5b-b2-placement-wall.md. Reactivated as the seed-scan bars in B2c Task 9.
// Generated-world invariants + the multi-seed placement success-rate probe. Pure — the
// generator and the placer are both GPU/Rapier-free. Replaces tests/world.test.ts's
// hand-graph anchors in Task 9 (authorized rewrite).
import { expect, test } from "bun:test";
import { aabbIntersects } from "../src/aabb.ts";
import type { Aabb, Connection } from "../src/region.ts";
// GENERATED_SEED until Task 9 collapses it into WORLD_SEED (this file's rename updates
// the import then).
import { buildWorld, GENERATED_SEED } from "../src/world.ts";

// Success-rate: a fixed seed list must place within the per-seed retry budget. Tune N
// down (min 10) ONLY if the suite exceeds ~120 s, with a comment noting the measured
// time — never silently.
const N = 25;
const SEEDS = Array.from({ length: N }, (_, i) => `b2-seed-${i}`);
const SUCCESS_MIN = Math.floor(N * 0.96); // ≥ 24/25

test("multi-seed placement success rate", () => {
  let ok = 0;
  const failures: string[] = [];
  for (const s of SEEDS) {
    try {
      buildWorld(s);
      ok++;
    } catch (err) {
      failures.push(
        `${s}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
      );
    }
  }
  if (ok < SUCCESS_MIN) console.error(failures.join("\n"));
  expect(ok).toBeGreaterThanOrEqual(SUCCESS_MIN);
});

test("the shipped seed places, deterministically", () => {
  const a = buildWorld(GENERATED_SEED);
  const b = buildWorld(GENERATED_SEED);
  expect(a.attempt).toBe(b.attempt);
  for (const [id, p] of a.layout.placements) {
    expect(b.layout.placements.get(id)).toEqual(p);
  }
  expect(a.layout.placements.size).toBe(a.graph.nodes.length);
  expect(a.layout.connectors.length).toBe(a.graph.edges.length);
});

test("zero claim-box interpenetration across placed pieces (coarse bounds MAY overlap)", () => {
  // BLOCK 2 (2026-07-04): a cave's `bounds` is its whole-grid AABB (93–96% air), so two
  // pieces' coarse `bounds` may now legally overlap — Rule 1 checks `envelopes` (a
  // piece's honest claim boxes; absent = `[bounds]`), so THAT'S the pairwise invariant.
  const { layout } = buildWorld(GENERATED_SEED);
  const claims = layout.regions.map((r) => r.envelopes ?? [r.bounds]);
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      for (const a of claims[i] as Aabb[]) {
        for (const b of claims[j] as Aabb[]) {
          expect(aabbIntersects(a, b)).toBe(false);
        }
      }
    }
  }
});

test("every edge's heightDelta is realized by the placed portals", () => {
  const { graph, layout } = buildWorld(GENERATED_SEED);
  const regionOf = (id: string) =>
    layout.regions[graph.nodes.findIndex((n) => n.id === id)]!;
  for (const e of graph.edges) {
    const pa = regionOf(e.a).connections[e.aPortal] as Connection;
    const pb = regionOf(e.b).connections[e.bPortal] as Connection;
    expect(pb.position[1] - pa.position[1]).toBeCloseTo(e.heightDelta ?? 0, 3);
    expect(e.heightDelta ?? 0).toBeLessThanOrEqual(0); // universal descent, placed
  }
});

test("gate content: the shipped seed has a real descent, a capped bore, and an open connector", () => {
  const { graph } = buildWorld(GENERATED_SEED);
  expect(graph.edges.some((e) => (e.heightDelta ?? 0) <= -3)).toBe(true);
  expect(graph.edges.some((e) => e.enclosure === "open")).toBe(true);
  // a capped cave shows as a cave region carrying MORE collar geometry than doors need:
  // meshes = 1 rock + 4·(doors + caps) collar boxes + caps plugs → strictly more than
  // 1 + 4·connections when capped.
  const caves = graph.nodes.filter((n) => n.theme === "cave");
  expect(
    caves.some(
      (n) => n.region.meshes.length > 1 + 4 * n.region.connections.length,
    ),
  ).toBe(true);
});
