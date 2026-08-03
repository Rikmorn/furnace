import { expect, test } from "bun:test";
import { mat4 } from "../transform/mat4.ts";
import { vec3 } from "../transform/vec3.ts";
import { getMatrices, setAspect, setNearFar } from "./common.ts";
import { perspective, setFov } from "./perspective.ts";

const approxArr = (a: Float32Array, b: Float32Array, eps = 1e-5) =>
  a.length === b.length &&
  a.every((v, i) => Math.abs(v - (b[i] as number)) < eps);

test("factory defaults produce a usable camera", () => {
  const cam = perspective();
  const { view, projection, viewProjection } = getMatrices(cam);
  expect(view.length).toBe(16);
  expect(projection.length).toBe(16);
  expect(viewProjection.length).toBe(16);
});

test("default projection matches mat4.perspective with default options", () => {
  const cam = perspective();
  const { projection } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.perspective(expected, Math.PI / 4, 1, 0.1, 1000);
  expect(approxArr(projection, expected)).toBe(true);
});

test("default view matches mat4.lookAt with default position/target/up", () => {
  const cam = perspective();
  const { view } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.lookAt(
    expected,
    vec3.fromValues(0, 0, 3),
    vec3.fromValues(0, 0, 0),
    vec3.fromValues(0, 1, 0),
  );
  expect(approxArr(view, expected)).toBe(true);
});

test("setFov updates the projection", () => {
  const cam = perspective();
  setFov(cam, Math.PI / 2);
  const { projection } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.perspective(expected, Math.PI / 2, 1, 0.1, 1000);
  expect(approxArr(projection, expected)).toBe(true);
});

test("setAspect updates the projection", () => {
  const cam = perspective();
  setAspect(cam, 2);
  const { projection } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.perspective(expected, Math.PI / 4, 2, 0.1, 1000);
  expect(approxArr(projection, expected)).toBe(true);
});

test("setNearFar updates the projection", () => {
  const cam = perspective();
  setNearFar(cam, 1, 100);
  const { projection } = getMatrices(cam);
  const expected = new Float32Array(16);
  mat4.perspective(expected, Math.PI / 4, 1, 1, 100);
  expect(approxArr(projection, expected)).toBe(true);
});

test("factory options are honored", () => {
  const cam = perspective({
    fovYRad: Math.PI / 3,
    aspect: 16 / 9,
    near: 0.5,
    far: 500,
    position: vec3.fromValues(1, 2, 5),
    target: vec3.fromValues(0, 0, -1),
    up: vec3.fromValues(0, 1, 0),
  });
  const { view, projection } = getMatrices(cam);

  const expectedProj = new Float32Array(16);
  mat4.perspective(expectedProj, Math.PI / 3, 16 / 9, 0.5, 500);
  expect(approxArr(projection, expectedProj)).toBe(true);

  const expectedView = new Float32Array(16);
  mat4.lookAt(
    expectedView,
    vec3.fromValues(1, 2, 5),
    vec3.fromValues(0, 0, -1),
    vec3.fromValues(0, 1, 0),
  );
  expect(approxArr(view, expectedView)).toBe(true);
});
