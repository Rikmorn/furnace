import { expect, test } from "bun:test";
import {
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
