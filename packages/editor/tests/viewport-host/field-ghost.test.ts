import { expect, test } from "bun:test";
import { boxEdges } from "../../src/viewport-host/box-edges.ts";
import {
  boxCorners,
  crossSegments,
  cursorAffordance,
  GHOST_COLOR,
  sphereGhostSegments,
  viewportCursor,
} from "../../src/viewport-host/field-ghost.ts";

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

// --- cursorAffordance (f2b item 10 / D-F4.5-7) -----------------------------

test("cursorAffordance: an unanchored SEGMENT draws the radius ring", () => {
  expect(
    cursorAffordance({
      gesture: "segment",
      pendingStamp: false,
      anchored: false,
    }),
  ).toBe("ring");
});

test("cursorAffordance: an unanchored BOX corner draws a cross, NOT the radius ring", () => {
  // The discriminating claim: a box corner has no radius, so the two two-click
  // gestures must NOT share one affordance. A `ring` here would promise a brush
  // width that decides nothing about what the click does.
  expect(
    cursorAffordance({ gesture: "box", pendingStamp: false, anchored: false }),
  ).toBe("cross");
});

test("cursorAffordance: a pending STAMP draws the corner cross whatever else is armed", () => {
  // The pending stamp SHADOWS the background arm, so the affordance must follow the
  // pending arm and not the gesture underneath it — including when that gesture is
  // `segment`, whose own affordance is the ring.
  for (const gesture of ["pointer", "segment", null] as const)
    expect(
      cursorAffordance({ gesture, pendingStamp: true, anchored: false }),
    ).toBe("cross");
});

test("cursorAffordance: an ANCHORED gesture draws nothing — its own preview has taken over", () => {
  for (const gesture of ["box", "segment"] as const)
    expect(
      cursorAffordance({ gesture, pendingStamp: false, anchored: true }),
    ).toBeNull();
  expect(
    cursorAffordance({ gesture: "box", pendingStamp: true, anchored: true }),
  ).toBeNull();
});

test("cursorAffordance: pointer, the brush and the flood modes draw nothing", () => {
  // The brush has the sphere ghost and `pointer` has the pick; a one-click flood has
  // no pending state to preview, so a cursor mark there would say nothing true.
  for (const gesture of ["pointer", "material", "void", null] as const)
    expect(
      cursorAffordance({ gesture, pendingStamp: false, anchored: false }),
    ).toBeNull();
});

// --- viewportCursor (D-F4.5-8's per-family glyph) --------------------------

test("viewportCursor: a live move wins over every arm — grab free-hand, grabbing on a drag", () => {
  expect(
    viewportCursor({ move: "grab", pendingStamp: true, gesture: "box" }),
  ).toBe("grab");
  expect(
    viewportCursor({ move: "drag", pendingStamp: true, gesture: "box" }),
  ).toBe("grabbing");
});

test("viewportCursor: pointer is the ONLY arm that keeps the plain cursor", () => {
  expect(
    viewportCursor({ move: null, pendingStamp: false, gesture: "pointer" }),
  ).toBe("default");
  for (const gesture of ["box", "material", "void", "segment", null] as const)
    expect(viewportCursor({ move: null, pendingStamp: false, gesture })).toBe(
      "crosshair",
    );
});

test("viewportCursor: a pending stamp crosshairs even over the pointer arm", () => {
  // The shadow again: `pointer` is the background arm a stamp is most often armed
  // from, and it is the one gesture whose own cursor is `default`.
  expect(
    viewportCursor({ move: null, pendingStamp: true, gesture: "pointer" }),
  ).toBe("crosshair");
});
