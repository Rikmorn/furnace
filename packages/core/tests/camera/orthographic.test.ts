import { expect, test } from "bun:test";
import { getMatrices, setAspect, setNearFar } from "../../src/camera/common.ts";
import { policy } from "../../src/camera/fit-policy.ts";
import {
  getBounds,
  orthographic,
  setFitPolicy,
  setScale,
} from "../../src/camera/orthographic.ts";
import { perspective } from "../../src/camera/perspective.ts";
import { mat4 } from "../../src/transform/mat4.ts";
import { vec3 } from "../../src/transform/vec3.ts";

const approxArr = (a: Float32Array, b: Float32Array, eps = 1e-5) =>
  a.length === b.length &&
  a.every((v, i) => Math.abs(v - (b[i] as number)) < eps);

test("factory defaults produce a usable camera", () => {
  const cam = orthographic();
  const { view, projection, viewProjection } = getMatrices(cam);
  expect(view.length).toBe(16);
  expect(projection.length).toBe(16);
  expect(viewProjection.length).toBe(16);
});

test("default projection matches mat4.ortho with default options", () => {
  const cam = orthographic();
  const { projection } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.ortho(expected, -1, 1, -1, 1, -1, 1);
  expect(approxArr(projection, expected)).toBe(true);
});

test("default view matches mat4.lookAt with default position/target/up", () => {
  const cam = orthographic();
  const { view } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.lookAt(
    expected,
    vec3.fromValues(0, 0, 1),
    vec3.fromValues(0, 0, 0),
    vec3.fromValues(0, 1, 0),
  );
  expect(approxArr(view, expected)).toBe(true);
});

test("setFitPolicy with stretch updates the projection", () => {
  const cam = orthographic();
  setFitPolicy(cam, policy.stretch({ left: -2, right: 4, bottom: -3, top: 3 }));
  const { projection } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.ortho(expected, -2, 4, -3, 3, -1, 1);
  expect(approxArr(projection, expected)).toBe(true);
});

test("setAspect preserves vertical range, rescales horizontal symmetrically about 0", () => {
  const cam = orthographic();
  // Default bounds: left=-1, right=1, bottom=-1, top=1 → vertical range = 2.
  setAspect(cam, 2); // horizontal range should be 4 → left=-2, right=2.
  const { projection } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.ortho(expected, -2, 2, -1, 1, -1, 1);
  expect(approxArr(projection, expected)).toBe(true);
});

test("setNearFar allows negative near (orthographic)", () => {
  const cam = orthographic();
  setNearFar(cam, -5, 5);
  const { projection } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.ortho(expected, -1, 1, -1, 1, -5, 5);
  expect(approxArr(projection, expected)).toBe(true);
});

test("factory options are honored", () => {
  const cam = orthographic({
    left: -2,
    right: 2,
    bottom: -1,
    top: 1,
    near: 0,
    far: 100,
    position: vec3.fromValues(0, 5, 10),
    target: vec3.fromValues(0, 0, 0),
    up: vec3.fromValues(0, 1, 0),
  });
  const { view, projection } = getMatrices(cam);

  const expectedProj = new Float32Array(16);
  mat4.ortho(expectedProj, -2, 2, -1, 1, 0, 100);
  expect(approxArr(projection, expectedProj)).toBe(true);

  const expectedView = new Float32Array(16);
  mat4.lookAt(
    expectedView,
    vec3.fromValues(0, 5, 10),
    vec3.fromValues(0, 0, 0),
    vec3.fromValues(0, 1, 0),
  );
  expect(approxArr(view, expectedView)).toBe(true);
});

test("setFitPolicy updates the policy and re-derives bounds immediately", () => {
  const cam = orthographic({
    fitPolicy: policy.stretch({ left: -1, right: 1, bottom: -1, top: 1 }),
  });
  cam._lastSize = { width: 200, height: 100 }; // simulate post-bind state
  setFitPolicy(cam, policy.preserveHeight(2));
  // anchor centered, height 2, aspect 2 → bounds [-2, 2, -1, 1]
  const b = getBounds(cam);
  expect(b.left).toBeCloseTo(-2);
  expect(b.right).toBeCloseTo(2);
  expect(b.bottom).toBeCloseTo(-1);
  expect(b.top).toBeCloseTo(1);
  expect(cam.projDirty).toBe(true);
});

test("setFitPolicy throws on non-orthographic camera", () => {
  const cam = perspective({});
  expect(() => setFitPolicy(cam, policy.preserveHeight(2))).toThrow(
    /orthographic/,
  );
});

test("setFitPolicy throws on null camera", () => {
  // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
  expect(() => setFitPolicy(null as any, policy.preserveHeight(2))).toThrow(
    /cam/,
  );
});

test("setFitPolicy throws on null policy", () => {
  const cam = orthographic({});
  // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
  expect(() => setFitPolicy(cam, null as any)).toThrow(/policy/);
});

test("setScale multiplies derived bounds and flips projDirty", () => {
  const cam = orthographic({ fitPolicy: policy.preserveHeight(2) });
  cam._lastSize = { width: 100, height: 100 };
  cam.projDirty = false;
  setScale(cam, 3);
  // height=2*3=6, aspect 1 → bounds half=3 each axis
  const b = getBounds(cam);
  expect(b.top).toBeCloseTo(3);
  expect(b.bottom).toBeCloseTo(-3);
  expect(b.left).toBeCloseTo(-3);
  expect(b.right).toBeCloseTo(3);
  expect(cam.projDirty).toBe(true);
});

test("setScale throws on non-positive or non-finite scale", () => {
  const cam = orthographic({});
  expect(() => setScale(cam, 0)).toThrow(/positive/);
  expect(() => setScale(cam, -1)).toThrow(/positive/);
  expect(() => setScale(cam, Number.NaN)).toThrow(/finite/);
});

test("setScale throws on non-orthographic camera", () => {
  const cam = perspective({});
  expect(() => setScale(cam, 2)).toThrow(/orthographic/);
});

test("setScale throws on null camera", () => {
  // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
  expect(() => setScale(null as any, 2)).toThrow(/cam/);
});

test("getBounds returns a frozen copy", () => {
  const cam = orthographic({
    fitPolicy: policy.stretch({ left: -2, right: 2, bottom: -1, top: 1 }),
  });
  const b = getBounds(cam);
  expect(b).toEqual({ left: -2, right: 2, bottom: -1, top: 1 });
  expect(Object.isFrozen(b)).toBe(true);
  expect(() => {
    // biome-ignore lint/suspicious/noExplicitAny: testing frozen behaviour
    (b as any).left = 999;
  }).toThrow();
});

test("getBounds throws on non-orthographic camera", () => {
  const cam = perspective({});
  expect(() => getBounds(cam)).toThrow(/orthographic/);
});

test("getBounds throws on null camera", () => {
  // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
  expect(() => getBounds(null as any)).toThrow(/cam/);
});
