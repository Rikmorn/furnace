import { expect, test } from "bun:test";
import {
  expectOutwardWinding,
  expectUnitNormals,
} from "../../tests/_helpers/geometry-asserts.ts";
import type { Context } from "../gpu/index.ts";
import { sphere, sphereGeometryData } from "./factories/sphere.ts";

const noCtx = null as unknown as Context;

// (LATITUDE_RINGS + 1) * (LONGITUDE_SEGMENTS + 1) = 17 * 33
const EXPECTED_VERTS = 561;
// LATITUDE_RINGS * LONGITUDE_SEGMENTS * 6 = 16 * 32 * 6
const EXPECTED_INDICES = 3072;

test("sphereGeometryData has the expected vertex/index counts", () => {
  const data = sphereGeometryData(0.5);
  expect(data.positions.length).toBe(EXPECTED_VERTS * 3);
  expect(data.normals.length).toBe(EXPECTED_VERTS * 3);
  expect(data.uvs.length).toBe(EXPECTED_VERTS * 2);
  expect(data.indices?.length).toBe(EXPECTED_INDICES);
});

test("sphere normals are unit length and winding is outward", () => {
  const data = sphereGeometryData(0.5);
  expectUnitNormals(data);
  expectOutwardWinding(data);
});

test("sphere positions lie on the radius", () => {
  for (const radius of [0.5, 2]) {
    const data = sphereGeometryData(radius);
    for (let i = 0; i < data.positions.length; i += 3) {
      const d = Math.hypot(
        data.positions[i] ?? 0,
        data.positions[i + 1] ?? 0,
        data.positions[i + 2] ?? 0,
      );
      expect(Math.abs(d - radius)).toBeLessThan(1e-4);
    }
  }
});

test("sphere throws on non-positive/non-finite radius", () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => sphere(noCtx, { radius: bad })).toThrow();
  }
});
