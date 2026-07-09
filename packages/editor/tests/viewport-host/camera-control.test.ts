import { expect, test } from "bun:test";
import {
  dolly,
  flyLook,
  flyMove,
  fromEyeTarget,
  type OrbitState,
  orbit,
  pan,
  toEyeTarget,
  zoom,
} from "../../src/viewport-host/camera-control.ts";

const base: OrbitState = { target: [0, 0, 0], distance: 10, yaw: 0, pitch: 0 };

test("orbit changes yaw/pitch; pitch clamps below ±90°", () => {
  const s = orbit(base, Math.PI / 4, Math.PI);
  expect(s.yaw).toBeCloseTo(Math.PI / 4, 6);
  expect(Math.abs(s.pitch)).toBeLessThan(Math.PI / 2);
});

test("zoom scales distance, clamped to a positive minimum", () => {
  expect(zoom(base, -100).distance).toBeGreaterThan(0);
  expect(zoom(base, 1).distance).toBeGreaterThan(base.distance);
});

test("toEyeTarget: distance preserved from target", () => {
  const { eye, target } = toEyeTarget(base);
  const dx = eye[0] - target[0];
  const dy = eye[1] - target[1];
  const dz = eye[2] - target[2];
  expect(Math.hypot(dx, dy, dz)).toBeCloseTo(10, 5);
});

test("pan moves the target in screen-right/up plane", () => {
  const s = pan(base, 1, 0, [1, 0, 0], [0, 1, 0], 0.01);
  expect(s.target[0]).not.toBe(0);
});

test("fromEyeTarget → toEyeTarget round-trips eye position", () => {
  const s = fromEyeTarget([3, 4, 5], [0, 0, 0]);
  const { eye } = toEyeTarget(s);
  expect(eye[0]).toBeCloseTo(3, 5);
  expect(eye[1]).toBeCloseTo(4, 5);
  expect(eye[2]).toBeCloseTo(5, 5);
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
  const moved = Math.hypot(
    looked.target[0] - base.target[0],
    looked.target[1] - base.target[1],
    looked.target[2] - base.target[2],
  );
  expect(moved).toBeGreaterThan(0);
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
