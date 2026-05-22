import { expect, test } from "bun:test";
import { getMatrices, setAspect, setNearFar } from "../../src/camera/common.ts";
import { orthographic, setBounds } from "../../src/camera/orthographic.ts";
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

test("setBounds updates the projection", () => {
  const cam = orthographic();
  setBounds(cam, { left: -2, right: 4, bottom: -3, top: 3 });
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
