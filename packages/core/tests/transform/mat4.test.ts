import { expect, test } from "bun:test";
import { mat4 } from "../../src/transform/mat4.ts";
import { quat } from "../../src/transform/quat.ts";
import { vec3 } from "../../src/transform/vec3.ts";

const approxArr = (a: Float32Array, b: number[], eps = 1e-5) =>
  a.length === b.length &&
  a.every((v, i) => Math.abs(v - (b[i] as number)) < eps);

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

test("create returns identity", () => {
  expect(approxArr(mat4.create(), IDENTITY)).toBe(true);
});

test("identity overwrites to identity", () => {
  const m = new Float32Array(16).fill(7);
  mat4.identity(m);
  expect(approxArr(m, IDENTITY)).toBe(true);
});

test("copy duplicates", () => {
  const a = mat4.create();
  a[12] = 10;
  const out = new Float32Array(16);
  mat4.copy(out, a);
  expect(out[12]).toBe(10);
});

test("multiply identity × identity = identity", () => {
  const out = new Float32Array(16);
  mat4.multiply(out, mat4.create(), mat4.create());
  expect(approxArr(out, IDENTITY)).toBe(true);
});

test("translate offsets the translation column", () => {
  const m = mat4.create();
  mat4.translate(m, m, vec3.fromValues(2, 3, 4));
  expect(m[12]).toBe(2);
  expect(m[13]).toBe(3);
  expect(m[14]).toBe(4);
});

test("scale modifies diagonal", () => {
  const m = mat4.create();
  mat4.scale(m, m, vec3.fromValues(2, 3, 4));
  expect(m[0]).toBe(2);
  expect(m[5]).toBe(3);
  expect(m[10]).toBe(4);
});

test("rotate around Y by 90° rotates (1,0,0) to (0,0,-1)", () => {
  const m = mat4.create();
  mat4.rotate(m, m, Math.PI / 2, vec3.fromValues(0, 1, 0));
  const v = vec3.fromValues(1, 0, 0);
  const out = vec3.create();
  vec3.transformMat4(out, v, m);
  expect(approxArr(out, [0, 0, -1])).toBe(true);
});

test("invert of identity is identity", () => {
  const out = new Float32Array(16);
  expect(mat4.invert(out, mat4.create())).not.toBeNull();
  expect(approxArr(out, IDENTITY)).toBe(true);
});

test("invert of translation undoes the translation", () => {
  const m = mat4.create();
  mat4.translate(m, m, vec3.fromValues(5, 0, 0));
  const inv = new Float32Array(16);
  mat4.invert(inv, m);
  const composed = new Float32Array(16);
  mat4.multiply(composed, m, inv);
  expect(approxArr(composed, IDENTITY)).toBe(true);
});

test("transpose swaps rows/columns", () => {
  const m = new Float32Array([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  ]);
  const out = new Float32Array(16);
  mat4.transpose(out, m);
  expect(
    approxArr(out, [1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15, 4, 8, 12, 16]),
  ).toBe(true);
});

test("perspective produces a column-major projection matrix", () => {
  const out = new Float32Array(16);
  mat4.perspective(out, Math.PI / 2, 1, 0.1, 100);
  expect(Math.abs((out[0] as number) - 1)).toBeLessThan(1e-5);
  expect(Math.abs((out[5] as number) - 1)).toBeLessThan(1e-5);
  expect(Math.abs((out[11] as number) - -1)).toBeLessThan(1e-5);
});

test("ortho with symmetric bounds produces identity-ish projection in X/Y", () => {
  const out = new Float32Array(16);
  mat4.ortho(out, -1, 1, -1, 1, 0, 1);
  expect(out[0]).toBe(1);
  expect(out[5]).toBe(1);
});

test("lookAt from origin toward -Z with Y up has identity rotation", () => {
  const out = new Float32Array(16);
  mat4.lookAt(
    out,
    vec3.fromValues(0, 0, 0),
    vec3.fromValues(0, 0, -1),
    vec3.fromValues(0, 1, 0),
  );
  expect(approxArr(out, IDENTITY)).toBe(true);
});

test("fromQuat with identity quaternion produces identity matrix", () => {
  const out = new Float32Array(16);
  mat4.fromQuat(out, quat.create());
  expect(approxArr(out, IDENTITY)).toBe(true);
});

test("fromRotationTranslationScale composes a TRS matrix", () => {
  const out = new Float32Array(16);
  const q = quat.create();
  const t = vec3.fromValues(1, 2, 3);
  const s = vec3.fromValues(1, 1, 1);
  mat4.fromRotationTranslationScale(out, q, t, s);
  expect(out[12]).toBe(1);
  expect(out[13]).toBe(2);
  expect(out[14]).toBe(3);
  expect(out[0]).toBe(1);
  expect(out[5]).toBe(1);
  expect(out[10]).toBe(1);
});
