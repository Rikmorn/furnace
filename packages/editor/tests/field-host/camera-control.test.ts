// The pure orbit-state math behind the field host's camera.
//
// F4.5b Task 6 closed this module's orphan register, and Task 14 retired the backlog
// entry that had opened it: `pan`, `zoom`, `orbit` and
// `fromEyeTarget` are GONE — their cases went with them — and everything left
// here has a live caller in `field-host.ts`. `orbitAbout` subsumes the old
// `orbit` (pass the state's own target as the pivot and it reduces to exactly
// that, which the first case below pins).
import { expect, test } from "bun:test";
import {
  dolly,
  flyLook,
  flyMove,
  frameBox,
  type OrbitState,
  orbitAbout,
  snapToAxis,
  toEyeTarget,
} from "../../src/field-host/camera-control.ts";

type V3 = [number, number, number];

const base: OrbitState = { target: [0, 0, 0], distance: 10, yaw: 0, pitch: 0 };

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v: V3): number => Math.hypot(v[0], v[1], v[2]);
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The angle between "eye → pivot" and the view direction, read only through
 *  {@link toEyeTarget}. Together with |eye − pivot| this is what "the pivot stays
 *  where it is on screen" means, stated without re-deriving orbitAbout's own
 *  basis (which would agree with a broken implementation as readily as a
 *  correct one). */
function pivotAngle(s: OrbitState, pivot: V3): number {
  const { eye, target } = toEyeTarget(s);
  const toPivot = sub(pivot, eye);
  const forward = sub(target, eye);
  return Math.acos(dot(toPivot, forward) / (len(toPivot) * len(forward)));
}

test("orbitAbout the state's OWN target is a plain yaw/pitch turn — the target never moves", () => {
  const s = orbitAbout(base, base.target, Math.PI / 4, 0.2);
  expect(s.target).toEqual([0, 0, 0]);
  expect(s.yaw).toBeCloseTo(Math.PI / 4, 6);
  expect(s.pitch).toBeCloseTo(0.2, 6);
  expect(s.distance).toBeCloseTo(base.distance, 6);
});

test("orbitAbout clamps pitch below ±90°", () => {
  expect(Math.abs(orbitAbout(base, [1, 0, 0], 0, Math.PI).pitch)).toBeLessThan(
    Math.PI / 2,
  );
});

test("orbitAbout holds the PIVOT fixed on screen: same eye distance, same view angle", () => {
  const pivot: V3 = [3, 1, -2]; // off the view axis, so a naive re-aim would show
  const before = pivotAngle(base, pivot);
  const beforeRange = len(sub(pivot, toEyeTarget(base).eye));

  const s = orbitAbout(base, pivot, 0.7, 0.25);
  expect(len(sub(pivot, toEyeTarget(s).eye))).toBeCloseTo(beforeRange, 5);
  expect(pivotAngle(s, pivot)).toBeCloseTo(before, 5);
  // The eye really moved — otherwise the two invariants above are satisfied by
  // doing nothing at all.
  expect(len(sub(toEyeTarget(s).eye, toEyeTarget(base).eye))).toBeGreaterThan(
    1,
  );
  expect(s.distance).toBeCloseTo(base.distance, 6);
});

test("orbitAbout is reversible: turn out and back and the state returns", () => {
  const pivot: V3 = [3, 1, -2];
  const there = orbitAbout(base, pivot, 0.7, 0.25);
  const back = orbitAbout(there, pivot, -0.7, -0.25);
  expect(back.yaw).toBeCloseTo(base.yaw, 6);
  expect(back.pitch).toBeCloseTo(base.pitch, 6);
  expect(back.distance).toBeCloseTo(base.distance, 6);
  for (let i = 0; i < 3; i++)
    expect(back.target[i] as number).toBeCloseTo(base.target[i] as number, 5);
});

test("frameBox centres the target and fits the distance to the longest edge", () => {
  const s = frameBox(base, { min: [2, 0, 0], max: [6, 2, 1] });
  expect(s.target).toEqual([4, 1, 0.5]);
  // Longest edge is x (4 m) → 4 × 1.8. The factor is the module's, restated here
  // so a silent change to it fails rather than re-deriving itself.
  expect(s.distance).toBeCloseTo(4 * 1.8, 6);
  // A fit, not a flight: the angles are the user's and stay theirs.
  expect(s.yaw).toBe(base.yaw);
  expect(s.pitch).toBe(base.pitch);
});

test("frameBox floors the distance so a one-voxel box does not put the eye inside it", () => {
  const s = frameBox(base, { min: [0, 0, 0], max: [0.25, 0.25, 0.25] });
  expect(s.distance).toBeCloseTo(2, 6); // 0.25 × 1.8 = 0.45, floored
  expect(s.target).toEqual([0.125, 0.125, 0.125]);
});

test("snapToAxis: sign +1 puts the EYE on the positive side of the named axis", () => {
  // The convention the triad's tips are labelled with: click the +X tip and the
  // camera goes to +X looking back at the pivot.
  const cases: ["x" | "y" | "z", 1 | -1, V3][] = [
    ["x", 1, [1, 0, 0]],
    ["x", -1, [-1, 0, 0]],
    ["y", 1, [0, 1, 0]],
    ["y", -1, [0, -1, 0]],
    ["z", 1, [0, 0, 1]],
    ["z", -1, [0, 0, -1]],
  ];
  for (const [axis, sign, expected] of cases) {
    const s = snapToAxis(base, axis, sign);
    const offset = sub(toEyeTarget(s).eye, base.target);
    const unit: V3 = [
      offset[0] / base.distance,
      offset[1] / base.distance,
      offset[2] / base.distance,
    ];
    // The two Y views sit exactly one hundredth of a radian off the pole (the
    // shared pitch clamp), so cos(pitch) ≈ 0.01 leaks into the horizontal
    // components. That is the WHOLE error budget — a bigger miss is a wrong
    // view, not a clamp. (Measured: the leak is 0.0099998 at yaw 0.)
    for (let i = 0; i < 3; i++)
      expect(
        Math.abs((unit[i] as number) - (expected[i] as number)),
      ).toBeLessThan(0.011);
    // Pivot and range are the user's framing and survive the snap.
    expect(s.target).toEqual(base.target);
    expect(s.distance).toBe(base.distance);
  }
});

test("snapToAxis: the Y views stay off the pole and keep the compass heading", () => {
  const turned: OrbitState = { ...base, yaw: 1.1, pitch: -0.3 };
  for (const sign of [1, -1] as const) {
    const s = snapToAxis(turned, "y", sign);
    expect(Math.abs(s.pitch)).toBeLessThan(Math.PI / 2);
    expect(Math.abs(s.pitch)).toBeGreaterThan(Math.PI / 2 - 0.02);
    // Yaw is undefined at the pole, so a top view keeps the heading the user had
    // rather than snapping the horizon to an arbitrary one.
    expect(s.yaw).toBe(turned.yaw);
  }
});

test("toEyeTarget: distance preserved from target", () => {
  const { eye, target } = toEyeTarget(base);
  expect(len(sub(eye, target))).toBeCloseTo(10, 5);
});

test("dolly forward translates the whole rig along view-forward; distance preserved", () => {
  const eyeBefore = toEyeTarget(base).eye;
  const fwd = dolly(base, 1); // +1 = forward; at yaw0/pitch0 view-forward is −z
  expect(fwd.target[2]).toBeLessThan(0);
  expect(fwd.distance).toBe(base.distance);
  const eyeAfter = toEyeTarget(fwd).eye;
  expect(eyeAfter[2]).toBeLessThan(eyeBefore[2]); // the eye travelled forward too
  expect(dolly(base, -1).target[2]).toBeGreaterThan(0); // back is the mirror
});

test("dolly step scales with distance but is floored so it never crawls to zero", () => {
  const farStep = Math.abs(dolly({ ...base, distance: 100 }, 1).target[2]);
  const nearStep = Math.abs(dolly({ ...base, distance: 0.1 }, 1).target[2]);
  expect(farStep).toBeGreaterThan(nearStep); // scale-aware
  expect(nearStep).toBeCloseTo(0.15, 6); // floored to DOLLY_MIN_STEP — never stops
});

test("flyLook rotates the view with the eye held fixed", () => {
  const before = toEyeTarget(base).eye;
  const looked = flyLook(base, Math.PI / 5, 0.1);
  const after = toEyeTarget(looked).eye;
  expect(after[0]).toBeCloseTo(before[0], 5);
  expect(after[1]).toBeCloseTo(before[1], 5);
  expect(after[2]).toBeCloseTo(before[2], 5);
  expect(looked.distance).toBeCloseTo(base.distance, 6);
  // the look target moved (view direction changed)
  expect(len(sub(looked.target, base.target))).toBeGreaterThan(0);
});

test("flyLook clamps pitch away from the pole", () => {
  const looked = flyLook(base, 0, Math.PI);
  expect(Math.abs(looked.pitch)).toBeLessThan(Math.PI / 2);
});

test("flyMove translates target+eye together from WASD/QE axes at speed", () => {
  const eyeBefore = toEyeTarget(base).eye;
  // W = forward (−z at yaw0/pitch0)
  const fwd = flyMove(base, { f: 1, r: 0, u: 0 }, 1);
  expect(fwd.target[2]).toBeCloseTo(-1, 6);
  expect(fwd.distance).toBe(base.distance);
  // the eye translated by the same delta — a rig move, not an orbit
  const eyeAfter = toEyeTarget(fwd).eye;
  expect(eyeAfter[2] - eyeBefore[2]).toBeCloseTo(-1, 6);
  // D = right (+x), E = up (+y)
  expect(flyMove(base, { f: 0, r: 1, u: 0 }, 1).target[0]).toBeCloseTo(1, 6);
  expect(flyMove(base, { f: 0, r: 0, u: 1 }, 1).target[1]).toBeCloseTo(1, 6);
  // speed scales the offset linearly
  expect(flyMove(base, { f: 1, r: 0, u: 0 }, 3).target[2]).toBeCloseTo(-3, 6);
});
