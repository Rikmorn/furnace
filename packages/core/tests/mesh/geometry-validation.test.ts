import { expect, test } from "bun:test";
import { validateGeometryData } from "../../src/geometry/geometry-validation.ts";
import type { GeometryData } from "../../src/geometry/types.ts";

const VALID: GeometryData = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), // 3 vertices
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
};

test("validateGeometryData passes for well-formed data", () => {
  expect(() => validateGeometryData(VALID)).not.toThrow();
});

test("positions length must be a multiple of 3", () => {
  const data = { ...VALID, positions: new Float32Array([0, 0, 0, 1]) };
  expect(() => validateGeometryData(data)).toThrow(/multiple of 3/);
});

test("normals must have one vec3 per position", () => {
  const data = { ...VALID, normals: new Float32Array([0, 0, 1]) };
  expect(() => validateGeometryData(data)).toThrow(/normals/);
});

test("uvs must have one vec2 per position", () => {
  const data = { ...VALID, uvs: new Float32Array([0, 0, 1, 0]) };
  expect(() => validateGeometryData(data)).toThrow(/uvs/);
});

test("indices presence is allowed", () => {
  const data = { ...VALID, indices: new Uint16Array([0, 1, 2]) };
  expect(() => validateGeometryData(data)).not.toThrow();
});
