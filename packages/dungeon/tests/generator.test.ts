import { expect, test } from "bun:test";
import { generateRegion } from "../src/generator.ts";

test("a region carries provenance, an origin, and a non-empty mesh", () => {
  const region = generateRegion({
    seed: "cavern-1",
    kind: "cavern",
    origin: [0, 0, -40],
  });
  expect(region.provenance.seed).toBe("cavern-1");
  expect(region.provenance.generatorId).toBe("dungeon");
  expect(region.origin).toEqual([0, 0, -40]);
  expect(region.mesh.positions.length).toBeGreaterThan(0);
  expect(region.mesh.indices.length % 3).toBe(0);
});

test("same seed → identical mesh (deterministic)", () => {
  const a = generateRegion({ seed: "s", kind: "cavern", origin: [0, 0, 0] });
  const b = generateRegion({ seed: "s", kind: "cavern", origin: [0, 0, 0] });
  expect(Array.from(a.mesh.positions)).toEqual(Array.from(b.mesh.positions));
});

test("kind selects a different field (shaft vs cavern differ)", () => {
  const cavern = generateRegion({
    seed: "s",
    kind: "cavern",
    origin: [0, 0, 0],
  });
  const shaft = generateRegion({ seed: "s", kind: "shaft", origin: [0, 0, 0] });
  expect(cavern.mesh.positions.length).not.toBe(shaft.mesh.positions.length);
});
