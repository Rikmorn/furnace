import { expect, test } from "bun:test";
import { aabbIntersects } from "../src/aabb.ts";
import { layoutWorld } from "../src/layout.ts";
import { buildWorldGraph, WORLD_SEED } from "../src/world.ts";

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
