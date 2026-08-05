import { expect, test } from "bun:test";
import { quat } from "../../core/src/transform/quat.ts"; // tests MAY import core (not scanned)
import {
  eulerDegToQuat,
  quatToEulerDeg,
} from "../src/frontend/inspector/lib/euler.ts";
import { getAtPath, setAtPath } from "../src/frontend/inspector/lib/paths.ts";

test("getAtPath / setAtPath handle top-level and nested, immutably", () => {
  const o = { position: [1, 2, 3], params: { color: [1, 0, 0, 1] } };
  expect(getAtPath(o, "position")).toEqual([1, 2, 3]);
  expect(getAtPath(o, "params.color")).toEqual([1, 0, 0, 1]);
  const next = setAtPath(o, "params.color", [0, 1, 0, 1]) as typeof o;
  expect(next.params.color).toEqual([0, 1, 0, 1]);
  expect(o.params.color).toEqual([1, 0, 0, 1]); // original untouched
});

test("eulerDegToQuat matches core quat.fromEuler exactly (XYZ convention)", () => {
  for (const [dx, dy, dz] of [
    [30, 0, 0],
    [0, 45, 0],
    [10, 20, 30],
    [90, 0, 90],
  ] as [number, number, number][]) {
    const r = (v: number) => (v * Math.PI) / 180;
    const expected = quat.fromEuler(quat.create(), r(dx), r(dy), r(dz));
    const got = eulerDegToQuat([dx, dy, dz]);
    for (let i = 0; i < 4; i++)
      expect(got[i] as number).toBeCloseTo(expected[i] as number, 6);
  }
});

test("quatToEulerDeg ∘ eulerDegToQuat round-trips (no gimbal cases)", () => {
  for (const e of [
    [10, 20, 30],
    [-15, 5, 40],
  ] as [number, number, number][]) {
    const q = eulerDegToQuat(e);
    const back = quatToEulerDeg(q);
    const q2 = eulerDegToQuat(back);
    for (let i = 0; i < 4; i++)
      expect(q2[i] as number).toBeCloseTo(q[i] as number, 5);
  }
});
