import { expect, test } from "bun:test";
import { quat } from "../../core/src/transform/quat.ts"; // tests MAY import core (not scanned)
import {
  eulerDegToQuat,
  quatToEulerDeg,
} from "../src/frontend/inspector/lib/euler.ts";
import { isMixed } from "../src/frontend/inspector/lib/mixed.ts";
import { getAtPath, setAtPath } from "../src/frontend/inspector/lib/paths.ts";

test("getAtPath / setAtPath handle top-level and nested, immutably", () => {
  const o = { position: [1, 2, 3], params: { color: [1, 0, 0, 1] } };
  expect(getAtPath(o, "position")).toEqual([1, 2, 3]);
  expect(getAtPath(o, "params.color")).toEqual([1, 0, 0, 1]);
  const next = setAtPath(o, "params.color", [0, 1, 0, 1]) as typeof o;
  expect(next.params.color).toEqual([0, 1, 0, 1]);
  expect(o.params.color).toEqual([1, 0, 0, 1]); // original untouched
});

test("isMixed detects differing values across targets (deep)", () => {
  expect(
    isMixed([
      [1, 2, 3],
      [1, 2, 3],
    ]),
  ).toBe(false);
  expect(
    isMixed([
      [1, 2, 3],
      [1, 2, 4],
    ]),
  ).toBe(true);
  expect(isMixed([5])).toBe(false);
  expect(isMixed([])).toBe(false);
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

import { commonComponents } from "../src/frontend/inspector/lib/common-components.ts";

test("commonComponents returns the intersection of component names across entities", () => {
  const entityA = { id: "a", components: { transform: {}, meshRenderer: {} } };
  const entityB = { id: "b", components: { transform: {}, camera: {} } };
  const entities = [entityA, entityB];
  expect(commonComponents(entities)).toEqual(["transform"]);
  expect(commonComponents([entityA])).toEqual(["transform", "meshRenderer"]);
  expect(commonComponents([])).toEqual([]);
});

import { splitResourceEntry } from "../src/frontend/inspector/lib/resource-kind.ts";

test("splitResourceEntry resolves kind (materials default 'standard') and strips it from params", () => {
  expect(
    splitResourceEntry("materials", {
      shader: "s",
      params: { color: [1, 0, 0, 1] },
    }),
  ).toEqual({
    kind: "standard",
    params: { shader: "s", params: { color: [1, 0, 0, 1] } },
  });
  expect(splitResourceEntry("geometries", { kind: "cube" })).toEqual({
    kind: "cube",
    params: {},
  });
});
