import { expect, test } from "bun:test";
import {
  getMatrices,
  setAspect,
  setPosition,
} from "../../src/camera/common.ts";
import { perspective } from "../../src/camera/perspective.ts";
import { vec3 } from "../../src/transform/vec3.ts";

test("getMatrices returns the same wrapper across calls", () => {
  const cam = perspective();
  const m1 = getMatrices(cam);
  const m2 = getMatrices(cam);
  expect(m1).toBe(m2);
});

test("matrix Float32Array references are stable across calls", () => {
  const cam = perspective();
  const m1 = getMatrices(cam);
  const m2 = getMatrices(cam);
  expect(m1.view).toBe(m2.view);
  expect(m1.projection).toBe(m2.projection);
  expect(m1.viewProjection).toBe(m2.viewProjection);
});

test("matrix references stay stable after setAspect (buffer reused, contents updated)", () => {
  const cam = perspective();
  const m1 = getMatrices(cam);
  const originalProjection = m1.projection;
  const valueBeforeAtZero = originalProjection[0] as number;
  setAspect(cam, 2);
  const m2 = getMatrices(cam);
  expect(m2).toBe(m1);
  expect(m2.projection).toBe(originalProjection);
  // Contents must have changed (different aspect → different value at out[0]).
  expect(m2.projection[0] as number).not.toBe(valueBeforeAtZero);
});

test("setPosition does not change the projection buffer contents", () => {
  const cam = perspective();
  const { projection } = getMatrices(cam);
  const snapshot = new Float32Array(projection);
  setPosition(cam, vec3.fromValues(0, 0, 10));
  const after = getMatrices(cam).projection;
  expect(after).toBe(projection); // same buffer
  for (let i = 0; i < 16; i++) {
    expect(after[i]).toBe(snapshot[i] as number);
  }
});

test("setAspect does not change the view buffer contents", () => {
  const cam = perspective();
  const { view } = getMatrices(cam);
  const snapshot = new Float32Array(view);
  setAspect(cam, 2);
  const after = getMatrices(cam).view;
  expect(after).toBe(view); // same buffer
  for (let i = 0; i < 16; i++) {
    expect(after[i]).toBe(snapshot[i] as number);
  }
});

test("matricesWrapper is frozen — cannot reassign fields", () => {
  const cam = perspective();
  const m = getMatrices(cam);
  expect(() => {
    // @ts-expect-error — wrapper is Readonly, runtime freeze confirms it
    m.view = new Float32Array(16);
  }).toThrow();
});
