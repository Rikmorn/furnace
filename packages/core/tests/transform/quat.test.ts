import { expect, test } from "bun:test";
import { quat } from "../../src/transform/quat.ts";
import { vec3 } from "../../src/transform/vec3.ts";

const approxArr = (a: Float32Array, b: number[], eps = 1e-5) =>
  a.length === b.length &&
  a.every((v, i) => Math.abs(v - (b[i] as number)) < eps);

test("create returns identity (0,0,0,1)", () => {
  expect(approxArr(quat.create(), [0, 0, 0, 1])).toBe(true);
});

test("identity overwrites to (0,0,0,1)", () => {
  const q = new Float32Array([0.5, 0.5, 0.5, 0.5]);
  quat.identity(q);
  expect(approxArr(q, [0, 0, 0, 1])).toBe(true);
});

test("copy duplicates", () => {
  const out = quat.create();
  quat.copy(out, new Float32Array([0.1, 0.2, 0.3, 0.4]));
  expect(approxArr(out, [0.1, 0.2, 0.3, 0.4])).toBe(true);
});

test("fromAxisAngle: 90° around Y produces known quaternion", () => {
  const q = quat.create();
  quat.fromAxisAngle(q, vec3.fromValues(0, 1, 0), Math.PI / 2);
  const s = Math.SQRT1_2;
  expect(approxArr(q, [0, s, 0, s])).toBe(true);
});

test("fromEuler XYZ order: rotation of 0 produces identity", () => {
  const q = quat.create();
  quat.fromEuler(q, 0, 0, 0);
  expect(approxArr(q, [0, 0, 0, 1])).toBe(true);
});

test("multiply identity gives same quaternion", () => {
  const q = quat.fromValues(0.1, 0.2, 0.3, 0.9);
  const id = quat.create();
  const out = quat.create();
  quat.multiply(out, q, id);
  expect(approxArr(out, [0.1, 0.2, 0.3, 0.9])).toBe(true);
});

test("normalize produces unit quaternion", () => {
  const q = quat.create();
  quat.normalize(q, new Float32Array([1, 1, 1, 1]));
  const len = Math.hypot(
    q[0] as number,
    q[1] as number,
    q[2] as number,
    q[3] as number,
  );
  expect(Math.abs(len - 1)).toBeLessThan(1e-6);
});

test("conjugate flips xyz signs", () => {
  const out = quat.create();
  quat.conjugate(out, new Float32Array([0.1, 0.2, 0.3, 0.9]));
  expect(approxArr(out, [-0.1, -0.2, -0.3, 0.9])).toBe(true);
});

test("slerp t=0 returns a", () => {
  const out = quat.create();
  const a = new Float32Array([0, 0, 0, 1]);
  const b = new Float32Array([1, 0, 0, 0]);
  quat.slerp(out, a, b, 0);
  expect(approxArr(out, [0, 0, 0, 1])).toBe(true);
});

test("slerp t=1 returns b", () => {
  const out = quat.create();
  const a = new Float32Array([0, 0, 0, 1]);
  const b = new Float32Array([1, 0, 0, 0]);
  quat.slerp(out, a, b, 1);
  expect(approxArr(out, [1, 0, 0, 0])).toBe(true);
});

test("normalize of zero quaternion writes identity (0,0,0,1)", () => {
  const out = quat.create();
  quat.normalize(out, new Float32Array([0, 0, 0, 0]));
  expect(approxArr(out, [0, 0, 0, 1])).toBe(true);
});
