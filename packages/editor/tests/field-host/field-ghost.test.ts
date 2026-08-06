import { expect, test } from "bun:test";
import { boxEdges } from "../../src/field-host/box-edges.ts";
import {
  boxCorners,
  crossSegments,
  GHOST_COLOR,
  sphereGhostSegments,
} from "../../src/field-host/field-ghost.ts";

const CENTER: [number, number, number] = [1, 2, 3];

// --- sphereGhostSegments ---------------------------------------------------

test("sphereGhostSegments: 32 segments (two 16-segment great-circle rings)", () => {
  expect(sphereGhostSegments(CENTER, 1.5).length).toBe(32);
});

test("sphereGhostSegments: every endpoint at distance radius from center", () => {
  const radius = 2.5;
  for (const [a, b] of sphereGhostSegments(CENTER, radius)) {
    const da = Math.hypot(a[0] - CENTER[0], a[1] - CENTER[1], a[2] - CENTER[2]);
    const db = Math.hypot(b[0] - CENTER[0], b[1] - CENTER[1], b[2] - CENTER[2]);
    expect(da).toBeCloseTo(radius, 6);
    expect(db).toBeCloseTo(radius, 6);
  }
});

test("sphereGhostSegments: first ring lies in XZ, second in XY", () => {
  const segments = sphereGhostSegments(CENTER, 1);
  for (const [a, b] of segments.slice(0, 16)) {
    expect(a[1]).toBeCloseTo(CENTER[1], 6); // XZ ring: constant y
    expect(b[1]).toBeCloseTo(CENTER[1], 6);
  }
  for (const [a, b] of segments.slice(16)) {
    expect(a[2]).toBeCloseTo(CENTER[2], 6); // XY ring: constant z
    expect(b[2]).toBeCloseTo(CENTER[2], 6);
  }
});

test("sphereGhostSegments: segments chain into closed rings", () => {
  const segments = sphereGhostSegments(CENTER, 1);
  for (const ring of [segments.slice(0, 16), segments.slice(16)]) {
    ring.forEach(([, end], i) => {
      const next = ring[(i + 1) % ring.length] as [
        [number, number, number],
        [number, number, number],
      ];
      expect(end[0]).toBeCloseTo(next[0][0], 6);
      expect(end[1]).toBeCloseTo(next[0][1], 6);
      expect(end[2]).toBeCloseTo(next[0][2], 6);
    });
  }
});

// --- boxCorners ------------------------------------------------------------

test("boxCorners: bit layout — bit0=x, bit1=y, bit2=z; corner 0 min, 7 max", () => {
  const out = boxCorners([1, 2, 3], [0.5, 1, 2]);
  expect(out.length).toBe(24);
  // biome-ignore format: one corner per row aids visual scanning
  expect([...out]).toEqual([
    0.5, 1, 1, // corner 0 = min
    1.5, 1, 1, // corner 1 = +x
    0.5, 3, 1, // corner 2 = +y
    1.5, 3, 1, // corner 3
    0.5, 1, 5, // corner 4 = +z
    1.5, 1, 5, // corner 5
    0.5, 3, 5, // corner 6
    1.5, 3, 5, // corner 7 = max
  ]);
});

test("boxCorners: feeds boxEdges — all 12 edges are axis-aligned", () => {
  const { vertices } = boxEdges(
    boxCorners([1, 2, 3], [0.5, 1, 2]),
    GHOST_COLOR,
  );
  expect(vertices.length).toBe(12 * 2 * 3);
  for (let e = 0; e < 12; e++) {
    const differing = [0, 1, 2].filter(
      (axis) => vertices[e * 6 + axis] !== vertices[e * 6 + 3 + axis],
    );
    expect(differing.length).toBe(1); // each edge varies along exactly one axis
  }
});

// --- GHOST_COLOR -----------------------------------------------------------

test("GHOST_COLOR: hologram-blue RGBA", () => {
  expect(GHOST_COLOR).toEqual([0.4, 0.8, 1, 1]);
});

// --- crossSegments ---------------------------------------------------------

test("crossSegments: three axis strokes, each 2×half long and centred on the point", () => {
  // Stated as literals rather than derived from CENTER: an expectation computed by
  // the same arithmetic the code uses agrees with it whatever that arithmetic is.
  expect(crossSegments(CENTER, 0.25)).toEqual([
    [
      [0.75, 2, 3],
      [1.25, 2, 3],
    ],
    [
      [1, 1.75, 3],
      [1, 2.25, 3],
    ],
    [
      [1, 2, 2.75],
      [1, 2, 3.25],
    ],
  ]);
});
