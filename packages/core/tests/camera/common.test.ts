import { expect, test } from "bun:test";
import {
  getMatrices,
  setAspect,
  setNearFar,
  setPosition,
  setTarget,
  setUp,
} from "../../src/camera/common.ts";
import { perspective } from "../../src/camera/perspective.ts";
import { mat4 } from "../../src/transform/mat4.ts";
import { vec3 } from "../../src/transform/vec3.ts";

const approxArr = (a: Float32Array, b: Float32Array, eps = 1e-5) =>
  a.length === b.length &&
  a.every((v, i) => Math.abs(v - (b[i] as number)) < eps);

test("setPosition updates the view matrix", () => {
  const cam = perspective();
  setPosition(cam, vec3.fromValues(0, 0, 5));
  const { view } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.lookAt(
    expected,
    vec3.fromValues(0, 0, 5),
    vec3.fromValues(0, 0, 0),
    vec3.fromValues(0, 1, 0),
  );
  expect(approxArr(view, expected)).toBe(true);
});

test("setTarget updates the view matrix", () => {
  const cam = perspective();
  setTarget(cam, vec3.fromValues(1, 0, 0));
  const { view } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.lookAt(
    expected,
    vec3.fromValues(0, 0, 3),
    vec3.fromValues(1, 0, 0),
    vec3.fromValues(0, 1, 0),
  );
  expect(approxArr(view, expected)).toBe(true);
});

test("setUp updates the view matrix", () => {
  const cam = perspective();
  setUp(cam, vec3.fromValues(1, 0, 0));
  const { view } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.lookAt(
    expected,
    vec3.fromValues(0, 0, 3),
    vec3.fromValues(0, 0, 0),
    vec3.fromValues(1, 0, 0),
  );
  expect(approxArr(view, expected)).toBe(true);
});

test("setAspect on perspective updates projection", () => {
  const cam = perspective();
  setAspect(cam, 16 / 9);
  const { projection } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.perspective(expected, Math.PI / 4, 16 / 9, 0.1, 1000);
  expect(approxArr(projection, expected)).toBe(true);
});

test("setNearFar updates the projection on perspective", () => {
  const cam = perspective();
  setNearFar(cam, 0.5, 50);
  const { projection } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.perspective(expected, Math.PI / 4, 1, 0.5, 50);
  expect(approxArr(projection, expected)).toBe(true);
});

test("viewProjection equals projection * view", () => {
  const cam = perspective({
    fovYRad: Math.PI / 3,
    aspect: 2,
    near: 0.5,
    far: 100,
    position: vec3.fromValues(3, 4, 5),
    target: vec3.fromValues(0, 0, 0),
  });
  const { view, projection, viewProjection } = getMatrices(cam);

  const expected = new Float32Array(16);
  mat4.multiply(expected, projection, view);
  expect(approxArr(viewProjection, expected)).toBe(true);
});
