// The move's pure arithmetic (F4.5b Task 5), with no camera and no GPU — which
// is the point of the module existing. The host's own tests can only observe
// these rules INDIRECTLY, through a drag on a live context whose screen→world
// mapping nothing in the test can predict; here the world points are given and
// the step counts are exact, so "anchored, not incremental" is an assertion
// rather than an inference from a round trip.
import { expect, test } from "bun:test";
import { LATTICE } from "../../src/frontend/lib/field-brush.ts";
import {
  advanceMove,
  type MoveDrag,
  moveIsIdle,
  movePoint,
  reanchored,
  resolveMapping,
  startMove,
  unanchored,
} from "../../src/viewport-host/field-move.ts";

type V3 = [number, number, number];

/** A 4×2×4 footprint whose floor is at y = 1 and whose centre is the origin in
 *  X/Z — so the ground plane and the axis origin are both easy to name. */
const BOX = { min: [-2, 1, -2] as V3, max: [2, 3, 2] as V3 };

const drag = (
  axis: Parameters<typeof startMove>[0]["axis"] = null,
  press: { x: number; y: number } | null = null,
): MoveDrag => startMove({ box: BOX, axis, grabbed: true, press });

/** A ray from `origin` toward `target`, unit-normalized — `movePoint` requires a
 *  unit direction (it reads a dot product as a cosine). */
function rayTo(origin: V3, target: V3): { origin: V3; dir: V3 } {
  const d: V3 = [
    target[0] - origin[0],
    target[1] - origin[1],
    target[2] - origin[2],
  ];
  const len = Math.hypot(d[0], d[1], d[2]);
  return { origin, dir: [d[0] / len, d[1] / len, d[2] / len] };
}

// --- startMove ---------------------------------------------------------------

test("startMove reads the plane off the box FLOOR and the axis origin off its centre", () => {
  const d = drag();
  // The ground plane is the footprint's floor, not its centre: a drag slides the
  // thing along the surface it stands on.
  expect(d.planeY).toBe(BOX.min[1]);
  expect(d.origin).toEqual([0, 2, 0]);
  expect(d.mapping).toBe("plane");
  expect(d.fixedAxis).toBe(false);
  expect(d.anchorPoint).toBeNull();
  expect(moveIsIdle(d)).toBe(true);
});

test("a gizmo drag opens FIXED on its axis", () => {
  const d = drag("z");
  expect(d.mapping).toBe("z");
  expect(d.fixedAxis).toBe(true);
});

// --- resolveMapping ----------------------------------------------------------

test("⇧ promotes a FREE drag to Y and leaves a gizmo drag alone", () => {
  expect(resolveMapping(drag(), false)).toBe("plane");
  expect(resolveMapping(drag(), true)).toBe("y");
  // The handle already named the axis — the modifier must not override a choice
  // the user made explicitly.
  expect(resolveMapping(drag("x"), true)).toBe("x");
  expect(resolveMapping(drag("y"), false)).toBe("y");
});

// --- movePoint ---------------------------------------------------------------

test("the plane mapping intersects the FLOOR plane, and refuses a view that cannot", () => {
  const d = drag();
  // Straight down from above onto (3, ·, -4): the answer is that point at the
  // plane's own height.
  expect(
    movePoint(d, "plane", { origin: [3, 9, -4], dir: [0, -1, 0] }),
  ).toEqual([3, 1, -4]);
  // A slant, solved on paper: from (0, 5, 0) toward (4, 1, 0) the ray meets
  // y = 1 exactly at the target.
  const slant = movePoint(d, "plane", rayTo([0, 5, 0], [4, 1, 0]));
  expect(slant?.[0]).toBeCloseTo(4, 10);
  expect(slant?.[2]).toBeCloseTo(0, 10);

  // Edge-on to the plane: no intersection worth having.
  expect(
    movePoint(d, "plane", { origin: [0, 5, 0], dir: [1, 0, 0] }),
  ).toBeNull();
  // The plane is BEHIND the eye — looking up from below it. A `t <= 0` answered
  // instead of refused would put the region wherever the back of the ray points.
  expect(
    movePoint(d, "plane", { origin: [0, 5, 0], dir: [0, 1, 0] }),
  ).toBeNull();
});

test("an axis mapping returns the closest point ON that axis, and refuses an edge-on view", () => {
  const d = drag("y");
  // The Y axis through the box centre (0, 2, 0). A ray crossing it at height 7
  // resolves there — the X and Z components are the axis origin's, not the ray's.
  expect(movePoint(d, "y", { origin: [3, 7, 0], dir: [-1, 0, 0] })).toEqual([
    0, 7, 0,
  ]);
  // Looking straight DOWN the Y axis: it projects to a point on screen and every
  // reading along it is meaningless. Refused rather than answered with a zero
  // that would snap the region back to its anchor.
  expect(movePoint(d, "y", { origin: [0, 9, 0], dir: [0, -1, 0] })).toBeNull();
});

// --- the anchored arithmetic -------------------------------------------------

test("advanceMove before any anchor moves NOTHING", () => {
  // A drag opens unanchored on purpose: the first reading establishes the zero.
  const { drag: after, step } = advanceMove(drag(), [10, 1, 10]);
  expect(step).toEqual([0, 0, 0]);
  expect(after.applied).toEqual([0, 0, 0]);
});

test("advanceMove quantizes to whole lattice steps, rounding at the half", () => {
  const d = reanchored(drag(), "plane", [0, 1, 0]);
  // Just under half a step: nothing yet.
  const a = advanceMove(d, [LATTICE * 0.49, 1, 0]);
  expect(a.step).toEqual([0, 0, 0]);
  // The drag is returned UNCHANGED when nothing moved, so the two halves cannot
  // disagree about what has been applied.
  expect(a.drag).toBe(d);
  // Just over: one step.
  expect(advanceMove(d, [LATTICE * 0.51, 1, 0]).step).toEqual([1, 0, 0]);
  // Three and a bit steps out and two back on Z.
  const c = advanceMove(d, [LATTICE * 3.2, 1, -LATTICE * 2.1]);
  expect(c.step).toEqual([3, 0, -2]);
  expect(c.drag.applied).toEqual([3, 0, -2]);
});

test("ANCHORED, not incremental: a walk out and back lands exactly where it started", () => {
  // The rule the host can only observe through a round-trip drag. Each reading is
  // measured from the ANCHOR, so the intermediate readings — including ones that
  // round the 'wrong' way — cannot accumulate error.
  let d = reanchored(drag(), "plane", [0, 1, 0]);
  const walk: V3[] = [
    [0.3, 1, 0.7],
    [1.1, 1, -0.2],
    [2.9, 1, 1.4],
    [0.24, 1, -0.24],
    [0, 1, 0],
  ];
  for (const p of walk) d = advanceMove(d, p).drag;
  expect(d.applied).toEqual([0, 0, 0]);

  // The same walk read INCREMENTALLY (each step measured from the previous point)
  // would not: this is the arithmetic the module refuses, spelled out so the
  // assertion above is visibly non-trivial rather than tautological.
  let incremental = 0;
  let prev = 0;
  for (const p of walk) {
    incremental += Math.round((p[0] - prev) / LATTICE);
    prev = p[0];
  }
  expect(incremental).not.toBe(0);
});

test("a re-anchor carries `applied` forward, so switching mapping moves nothing", () => {
  let d = reanchored(drag(), "plane", [0, 1, 0]);
  d = advanceMove(d, [LATTICE * 2, 1, 0]).drag;
  expect(d.applied).toEqual([2, 0, 0]);

  // ⇧ mid-drag: re-anchor onto Y at wherever the cursor currently reads.
  const promoted = reanchored(d, "y", [0, 4.7, 0]);
  expect(promoted.mapping).toBe("y");
  expect(promoted.anchorSteps).toEqual([2, 0, 0]);
  // Re-reading the SAME point immediately after is a no-op — the switch itself
  // must not shift the region.
  expect(advanceMove(promoted, [0, 4.7, 0]).step).toEqual([0, 0, 0]);
  // …and the X the ground drag already applied survives the promotion.
  const lifted = advanceMove(promoted, [0, 4.7 + LATTICE * 3, 0]);
  expect(lifted.drag.applied).toEqual([2, 3, 0]);
});

test("unanchored retires the anchor AND the press pixel", () => {
  // The camera-change fix. The anchor is a world point read under the old view
  // and the press is the pixel that produced it — after the camera turns, that
  // pixel means somewhere else, so keeping it would re-anchor onto a stale
  // reading rather than a fresh one.
  let d = drag(null, { x: 40, y: 30 });
  d = reanchored(d, "plane", [0, 1, 0]);
  d = advanceMove(d, [LATTICE * 4, 1, 0]).drag;

  const reaimed = unanchored(d);
  expect(reaimed.anchorPoint).toBeNull();
  expect(reaimed.press).toBeNull();
  // Everything the move has already done survives, so re-anchoring costs zero.
  expect(reaimed.applied).toEqual([4, 0, 0]);
  const fresh = reanchored(reaimed, "plane", [99, 1, -99]);
  expect(advanceMove(fresh, [99, 1, -99]).step).toEqual([0, 0, 0]);
  expect(fresh.applied).toEqual([4, 0, 0]);
});

test("moveIsIdle is about what reached the REGION, not about cursor travel", () => {
  let d = reanchored(drag(), "plane", [0, 1, 0]);
  // A wander that never crosses half a step.
  d = advanceMove(d, [LATTICE * 0.4, 1, LATTICE * 0.3]).drag;
  expect(moveIsIdle(d)).toBe(true);
  d = advanceMove(d, [LATTICE * 0.6, 1, 0]).drag;
  expect(moveIsIdle(d)).toBe(false);
  // …and back to the anchor makes it idle again: the drop reads the NET result,
  // which is what stops an out-and-back drag from spending a history entry.
  d = advanceMove(d, [0, 1, 0]).drag;
  expect(moveIsIdle(d)).toBe(true);
});

test("no transition writes to its argument", () => {
  // The module's stated contract, asserted rather than trusted: the host holds
  // one `MoveDrag | null` and replaces it wholesale, so a transition that
  // mutated in place would half-apply for any caller that ignored the return.
  const d = reanchored(drag(null, { x: 1, y: 2 }), "plane", [0, 1, 0]);
  const snapshot = structuredClone(d);
  advanceMove(d, [LATTICE * 5, 1, LATTICE * 5]);
  reanchored(d, "y", [0, 9, 0]);
  unanchored(d);
  expect(d).toEqual(snapshot);
});
