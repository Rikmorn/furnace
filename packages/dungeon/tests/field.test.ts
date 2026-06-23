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

test("rectWeight is 1 in the core and 0 at the footprint edges", () => {
  const w = field.rectWeight(6, 3, 1.5);
  expect(w(0, 0)).toBeCloseTo(1, 5); // center → full weight
  expect(w(6, 0)).toBeCloseTo(0, 5); // x edge → zero
  expect(w(0, 3)).toBeCloseTo(0, 5); // z edge → zero
  expect(w(6, 3)).toBeCloseTo(0, 5); // corner → zero
});

test("taperedNoiseDisplace leaves the base unchanged at the footprint edge but perturbs the interior", () => {
  const base = field.boxCavern(0, 10, 0, 10, 10, 10); // flat floor at y=0
  const f = field.taperedNoiseDisplace(
    base,
    rng.create("c1"),
    0.6,
    0.55,
    field.rectWeight(6, 3, 1.5),
  );
  // At the x edge (x=6), weight=0 → displacement 0 → equals base exactly.
  expect(f(6, 0, 0)).toBeCloseTo(base(6, 0, 0), 5);
  // Deterministic per seed.
  const g = field.taperedNoiseDisplace(
    base,
    rng.create("c1"),
    0.6,
    0.55,
    field.rectWeight(6, 3, 1.5),
  );
  expect(f(1, 0, 1)).toEqual(g(1, 0, 1));
  // Interior displacement is bounded by amplitude.
  const delta = f(1, 0, 1) - base(1, 0, 1);
  expect(Math.abs(delta)).toBeLessThanOrEqual(0.6 + 1e-6);
});

test("capsuleCavern is air-positive inside the tube, negative outside", () => {
  const tube = field.capsuleCavern(0, 0, 0, 0, 0, 4, 1); // segment (0,0,0)->(0,0,4), radius 1
  expect(tube(0, 0, 2)).toBeGreaterThan(0); // on the axis, mid-segment → inside
  expect(tube(0, 0, 2)).toBeCloseTo(1, 5); // distance 0 → radius - 0 = 1
  expect(tube(3, 0, 2)).toBeLessThan(0); // 3m off-axis, radius 1 → outside
  expect(tube(0, 0, -2)).toBeLessThan(0); // before the segment start, > radius away
});

test("smax is a smooth maximum: >= hard max, within k of it", () => {
  expect(field.smax(5, -5, 1)).toBeCloseTo(5, 5); // far apart → equals max
  expect(field.smax(0, 0, 1)).toBeGreaterThan(0); // equal inputs → inflated above max
  expect(field.smax(0, 0, 1)).toBeLessThan(1); // but bounded by ~k
});

test("smoothUnion of two spheres has no negative crease between them", () => {
  // Two air spheres whose hard union would dip to ~0 at the midpoint; smooth must lift it.
  const a = (x: number, _y: number, _z: number) => 1 - Math.abs(x - 0); // air near x=0
  const b = (x: number, _y: number, _z: number) => 1 - Math.abs(x - 1.5); // air near x=1.5
  const hard = Math.max(a(0.75, 0, 0), b(0.75, 0, 0));
  const soft = field.smoothUnion(1, a, b)(0.75, 0, 0);
  expect(soft).toBeGreaterThanOrEqual(hard); // fillet lifts the seam
});

test("yTaperedNoiseDisplace leaves the field near floorY undisplaced, rough above", () => {
  const base = field.boxCavern(0, 5, 0, 5, 5, 5); // air box centred high; floor crossing near y=0
  const rough = field.yTaperedNoiseDisplace(
    base,
    rng.create("s"),
    1.0,
    0.6,
    0,
    1.5,
  ); // floorY=0, fade 1.5m
  // At the floor band the displacement weight ~0 → equals base; well above, it differs.
  expect(rough(1, 0, 1)).toBeCloseTo(base(1, 0, 1), 5);
  expect(rough(1, 4, 1)).not.toBeCloseTo(base(1, 4, 1), 5);
});
