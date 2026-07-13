import { expect, test } from "bun:test";
import { aabbOfBoxes, aabbUnion, transformAabb } from "../src/aabb.ts";

test("aabbOfBoxes envelopes unrotated boxes", () => {
  const b = aabbOfBoxes([
    { center: [0, 0, 0], size: [2, 2, 2] },
    { center: [3, 1, 0], size: [2, 2, 2] },
  ]);
  expect(b.min).toEqual([-1, -1, -1]);
  expect(b.max).toEqual([4, 2, 1]);
});

test("aabbOfBoxes accounts for a rotated box (pitch about X widens Y/Z)", () => {
  const q: [number, number, number, number] = [
    Math.sin(Math.PI / 8),
    0,
    0,
    Math.cos(Math.PI / 8),
  ];
  const b = aabbOfBoxes([
    { center: [0, 0, 0], size: [1, 0.2, 4], rotation: q },
  ]);
  expect(b.max[1]).toBeGreaterThan(1.0); // 0.1 unrotated; ~1.48 at 45°
  expect(b.max[2]).toBeGreaterThan(1.2);
  expect(b.max[0]).toBeCloseTo(0.5, 5); // X untouched by X-pitch
});

test("aabbUnion covers both inputs", () => {
  // Six distinct components, and each row draws from BOTH inputs (min: x from b,
  // y+z from a; max: x from a, y+z from b) — so a min/max flip OR an axis swap fails.
  const u = aabbUnion(
    { min: [0, -2, -5], max: [2, 2, 2] },
    { min: [-1, 1, 3], max: [1, 4, 5] },
  );
  expect(u.min).toEqual([-1, -2, -5]);
  expect(u.max).toEqual([2, 4, 5]);
});

test("transformAabb rotates about Y then translates (conservative)", () => {
  const b = {
    min: [0, 0, 0] as [number, number, number],
    max: [4, 1, 2] as [number, number, number],
  };
  const t = transformAabb(b, Math.PI / 2, [10, 0, 0]);
  expect(t.min[0]).toBeCloseTo(10, 5);
  expect(t.max[0]).toBeCloseTo(12, 5);
  expect(t.min[2]).toBeCloseTo(-4, 5);
  expect(t.max[2]).toBeCloseTo(0, 5);
  expect(t.min[1]).toBeCloseTo(0, 5);
});
