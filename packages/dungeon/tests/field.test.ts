import { expect, test } from "bun:test";
import * as rng from "@furnace/core/rng";
import * as field from "../src/field.ts";

test("sphereCavern: air at the center, rock far outside", () => {
  const f = field.sphereCavern(0, 0, 0, 4);
  expect(f(0, 0, 0)).toBeGreaterThan(0); // center is air
  expect(f(10, 0, 0)).toBeLessThan(0); // far outside is rock
});

test("union widens air; intersect narrows it", () => {
  const a = field.sphereCavern(-3, 0, 0, 2);
  const b = field.sphereCavern(3, 0, 0, 2);
  const u = field.union(a, b);
  expect(u(-3, 0, 0)).toBeGreaterThan(0);
  expect(u(3, 0, 0)).toBeGreaterThan(0);

  // intersect keeps only the overlap: a point in both spheres stays air,
  // a point in only one sphere becomes rock.
  const i = field.intersect(
    field.sphereCavern(-1, 0, 0, 2),
    field.sphereCavern(1, 0, 0, 2),
  );
  expect(i(0, 0, 0)).toBeGreaterThan(0); // inside both → air
  expect(i(-2.5, 0, 0)).toBeLessThan(0); // inside only the left sphere → rock
});

test("noiseDisplace is deterministic for a given seed and stays bounded", () => {
  const base = field.sphereCavern(0, 0, 0, 4);
  const f1 = field.noiseDisplace(base, rng.create("r1"), 0.5, 0.3);
  const f2 = field.noiseDisplace(base, rng.create("r1"), 0.5, 0.3);
  expect(f1(1, 1, 1)).toEqual(f2(1, 1, 1)); // deterministic
  const delta = f1(1, 1, 1) - base(1, 1, 1);
  expect(Math.abs(delta)).toBeLessThanOrEqual(0.5 + 1e-6); // within amplitude
});
