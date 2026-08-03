import { expect, test } from "bun:test";
import { forwardVector, moveDelta } from "./fp-controller.ts";

test("forwardVector: yaw=0 pitch=0 looks down -Z", () => {
  const f = forwardVector(0, 0);
  expect(f[0]).toBeCloseTo(0, 5);
  expect(f[1]).toBeCloseTo(0, 5);
  expect(f[2]).toBeCloseTo(-1, 5);
});

test("forwardVector: yaw=+90deg turns to -X (left, right-handed Y-up)", () => {
  const f = forwardVector(Math.PI / 2, 0);
  expect(f[0]).toBeCloseTo(-1, 5);
  expect(f[2]).toBeCloseTo(0, 5);
});

test("moveDelta: pressing forward moves along the yaw forward on the XZ plane", () => {
  // yaw=0 → forward is -Z; forward key → delta -Z, no Y.
  const d = moveDelta(
    { forward: true, back: false, left: false, right: false },
    0,
    2,
  );
  expect(d[0]).toBeCloseTo(0, 5);
  expect(d[1]).toBeCloseTo(0, 5);
  expect(d[2]).toBeCloseTo(-2, 5);
});

test("moveDelta: forward at yaw=+90deg moves along world -X (basis rotation)", () => {
  // yaw=π/2 turns to face -X (see forwardVector convention test); forward → -X.
  const d = moveDelta(
    { forward: true, back: false, left: false, right: false },
    Math.PI / 2,
    1,
  );
  expect(d[0]).toBeCloseTo(-1, 5);
  expect(d[1]).toBeCloseTo(0, 5);
  expect(d[2]).toBeCloseTo(0, 5);
});

test("moveDelta: strafe right at yaw=0 moves along world +X", () => {
  const d = moveDelta(
    { forward: false, back: false, left: false, right: true },
    0,
    1,
  );
  expect(d[0]).toBeCloseTo(1, 5);
  expect(d[1]).toBeCloseTo(0, 5);
  expect(d[2]).toBeCloseTo(0, 5);
});

test("moveDelta: back at yaw=0 moves along world +Z", () => {
  const d = moveDelta(
    { forward: false, back: true, left: false, right: false },
    0,
    1,
  );
  expect(d[0]).toBeCloseTo(0, 5);
  expect(d[1]).toBeCloseTo(0, 5);
  expect(d[2]).toBeCloseTo(1, 5);
});

test("moveDelta: diagonal is normalized (no faster-on-diagonal)", () => {
  const d = moveDelta(
    { forward: true, back: false, left: false, right: true },
    0,
    1,
  );
  const len = Math.hypot(d[0], d[1], d[2]);
  expect(len).toBeCloseTo(1, 5);
});
