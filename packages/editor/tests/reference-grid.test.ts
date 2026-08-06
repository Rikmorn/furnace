import { expect, test } from "bun:test";
import {
  buildGridLines,
  segmentsToBatch,
} from "../src/field-host/reference-grid.ts";

// The constant coordinate a grid segment sits on: a Z-aligned line has a constant x
// (endpoints share x, z spans ±extent); an X-aligned line has a constant z.
function constantCoord([a, b]: [
  [number, number, number],
  [number, number, number],
]): number {
  return a[0] === b[0] ? a[0] : a[2];
}

test("buildGridLines: 2×(2·extent/minor + 1) lines, split minor/major", () => {
  const { minorSegments, majorSegments } = buildGridLines(50, 1, 10);
  // 101 grid coordinates (-50..50 step 1), two lines each = 202 total.
  const total = minorSegments.length + majorSegments.length;
  expect(total).toBe(2 * (2 * 50 + 1));
  // 11 coordinates divisible by 10 (-50..50) → 22 major lines; the rest minor.
  expect(majorSegments.length).toBe(22);
  expect(minorSegments.length).toBe(180);
});

test("buildGridLines: every vertex sits on y=0", () => {
  const { minorSegments, majorSegments } = buildGridLines(50, 1, 10);
  for (const [a, b] of [...minorSegments, ...majorSegments]) {
    expect(a[1]).toBe(0);
    expect(b[1]).toBe(0);
  }
});

test("buildGridLines: majors are every 10th line, minors never divisible by 10", () => {
  const { minorSegments, majorSegments } = buildGridLines(50, 1, 10);
  // `===` (not toBe → Object.is) so a negative multiple's `-0` remainder counts as 0.
  for (const seg of majorSegments) {
    expect(constantCoord(seg) % 10 === 0).toBe(true);
  }
  for (const seg of minorSegments) {
    expect(constantCoord(seg) % 10 === 0).toBe(false);
  }
});

test("buildGridLines: endpoints span the full extent along the free axis", () => {
  const { majorSegments } = buildGridLines(50, 1, 10);
  // The k=0 pair: a Z-aligned line at x=0 and an X-aligned line at z=0.
  const zLine = majorSegments.find(([a, b]) => a[0] === 0 && b[0] === 0);
  const xLine = majorSegments.find(([a, b]) => a[2] === 0 && b[2] === 0);
  expect(zLine).toEqual([
    [0, 0, -50],
    [0, 0, 50],
  ]);
  expect(xLine).toEqual([
    [-50, 0, 0],
    [50, 0, 0],
  ]);
});

test("segmentsToBatch: flattens to 2 pts × 3 floats + solid rgba per vertex", () => {
  const segments: [[number, number, number], [number, number, number]][] = [
    [
      [1, 0, 2],
      [3, 0, 4],
    ],
    [
      [-1, 0, -2],
      [-3, 0, -4],
    ],
  ];
  // Exactly-representable float32 values so the readback compares without rounding.
  const rgba: [number, number, number, number] = [0.5, 0.25, 0.75, 1];
  const { vertices, colors } = segmentsToBatch(segments, rgba);
  expect(Array.from(vertices)).toEqual([
    1, 0, 2, 3, 0, 4, -1, 0, -2, -3, 0, -4,
  ]);
  // 2 segments × 2 vertices × 4 colour floats = 16, all the same rgba.
  expect(colors.length).toBe(16);
  expect(Array.from(colors.subarray(0, 4))).toEqual(rgba);
  expect(Array.from(colors.subarray(12, 16))).toEqual(rgba);
});
