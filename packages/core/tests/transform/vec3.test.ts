import { expect, test } from "bun:test";
import { mat4 } from "../../src/transform/mat4.ts";
import { vec3 } from "../../src/transform/vec3.ts";

const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const approxArr = (a: Float32Array, b: number[], eps = 1e-6) =>
  a.length === b.length && a.every((v, i) => approx(v, b[i] as number, eps));

test("create returns (0,0,0)", () => {
  expect(approxArr(vec3.create(), [0, 0, 0])).toBe(true);
});

test("fromValues sets components", () => {
  expect(approxArr(vec3.fromValues(1, 2, 3), [1, 2, 3])).toBe(true);
});

test("set overwrites in place and returns out", () => {
  const v = vec3.create();
  const r = vec3.set(v, 4, 5, 6);
  expect(r).toBe(v);
  expect(approxArr(v, [4, 5, 6])).toBe(true);
});

test("copy duplicates", () => {
  const a = vec3.fromValues(1, 2, 3);
  const out = vec3.create();
  vec3.copy(out, a);
  expect(approxArr(out, [1, 2, 3])).toBe(true);
});

test("add component-wise", () => {
  const out = vec3.create();
  vec3.add(out, vec3.fromValues(1, 2, 3), vec3.fromValues(10, 20, 30));
  expect(approxArr(out, [11, 22, 33])).toBe(true);
});

test("sub component-wise", () => {
  const out = vec3.create();
  vec3.sub(out, vec3.fromValues(10, 20, 30), vec3.fromValues(1, 2, 3));
  expect(approxArr(out, [9, 18, 27])).toBe(true);
});

test("scale by scalar", () => {
  const out = vec3.create();
  vec3.scale(out, vec3.fromValues(1, 2, 3), 2);
  expect(approxArr(out, [2, 4, 6])).toBe(true);
});

test("dot product", () => {
  expect(vec3.dot(vec3.fromValues(1, 2, 3), vec3.fromValues(4, 5, 6))).toBe(32);
});

test("cross product (right-handed: i × j = k)", () => {
  const out = vec3.create();
  vec3.cross(out, vec3.fromValues(1, 0, 0), vec3.fromValues(0, 1, 0));
  expect(approxArr(out, [0, 0, 1])).toBe(true);
});

test("length", () => {
  expect(approx(vec3.length(vec3.fromValues(3, 4, 0)), 5)).toBe(true);
});

test("normalize produces unit vector", () => {
  const out = vec3.create();
  vec3.normalize(out, vec3.fromValues(3, 0, 4));
  expect(approx(vec3.length(out), 1)).toBe(true);
  expect(approxArr(out, [0.6, 0, 0.8])).toBe(true);
});

test("normalize of zero vector returns zero", () => {
  const out = vec3.create();
  vec3.normalize(out, vec3.fromValues(0, 0, 0));
  expect(approxArr(out, [0, 0, 0])).toBe(true);
});

test("transformMat4 with identity returns input", () => {
  const out = vec3.create();
  vec3.transformMat4(out, vec3.fromValues(1, 2, 3), mat4.create());
  expect(approxArr(out, [1, 2, 3])).toBe(true);
});

test("transformMat4 with translation matrix applies the translation", () => {
  const m = mat4.create();
  mat4.translate(m, m, vec3.fromValues(10, 20, 30));
  const out = vec3.create();
  vec3.transformMat4(out, vec3.fromValues(1, 2, 3), m);
  expect(approxArr(out, [11, 22, 33])).toBe(true);
});
