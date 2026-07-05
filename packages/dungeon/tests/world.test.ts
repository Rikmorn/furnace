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

test("the descending hop drops: upperA→landing spans the height delta downward", () => {
  const g = buildWorldGraph(WORLD_SEED);
  const r = layoutWorld(g, WORLD_SEED);
  const upA = r.placements.get("upperA");
  expect(upA?.translation[1]).toBeGreaterThan(6); // elevated above the authored envelope
  const descentIndex = g.edges.findIndex(
    (e) =>
      (e.a === "upperA" && e.b === "landing") ||
      (e.a === "landing" && e.b === "upperA"),
  );
  expect(descentIndex).toBeGreaterThanOrEqual(0);
  const descent = r.connectors[descentIndex]!;
  const ys = descent.colliders.map((c) => c.position[1]);
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(4); // a real descent
});

test("the closing hop is flat: landing→hallA stays within a narrow height band", () => {
  const g = buildWorldGraph(WORLD_SEED);
  const r = layoutWorld(g, WORLD_SEED);
  const closeIndex = g.edges.findIndex(
    (e) =>
      (e.a === "landing" && e.b === "hallA") ||
      (e.a === "hallA" && e.b === "landing"),
  );
  expect(closeIndex).toBeGreaterThanOrEqual(0);
  const close = r.connectors[closeIndex]!;
  const landingReg = r.regions[g.nodes.findIndex((n) => n.id === "landing")]!;
  const hallAReg = r.regions[g.nodes.findIndex((n) => n.id === "hallA")]!;
  const landingLoopY = landingReg.connections[1]!.position[1];
  const hallALoopY = hallAReg.connections[1]!.position[1];
  // The connector's WALKING SURFACE stays flat: filter out the enclosure (walls/ceiling
  // sit above the walking plane) and span-check the floor boxes only.
  const floorYs = close.colliders
    .map((c) => c.position[1])
    .filter((y) => y < landingLoopY);
  expect(Math.max(...floorYs) - Math.min(...floorYs)).toBeLessThan(1.5);
  // Direct flatness proof off the joined PORTALS (a single-collider ramp would pass the
  // span check trivially): the landing↔hallA edge mates aPortal 1 / bPortal 1, so each
  // region's connections[1] is the loop door — assert they sit at (near-)equal world Y.
  expect(Math.abs(landingLoopY - hallALoopY)).toBeLessThan(0.5); // flat join, not a ramp
});

test("the authored phantom is pinned at identity and marked authored", () => {
  const g = buildWorldGraph(WORLD_SEED);
  const authored = g.nodes.find((n) => n.id === "authored");
  expect(authored?.pinned).toEqual({ yaw: 0, translation: [0, 0, 0] });
  expect(authored?.region.provenance.theme).toBe("authored");
  expect(authored?.region.meshes.length).toBe(0); // phantom — main.ts realizes the level
  expect(authored?.region.colliders.length).toBeGreaterThan(20); // but its solids are real
});
