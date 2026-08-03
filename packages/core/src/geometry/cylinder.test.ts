import { expect, test } from "bun:test";
import {
  expectOutwardWinding,
  expectUnitNormals,
} from "../../tests/_helpers/geometry-asserts.ts";
import type { Context } from "../gpu/index.ts";
import { cylinder, cylinderGeometryData } from "./factories/cylinder.ts";

const noCtx = null as unknown as Context;

// barrel 2*(RADIAL+1)=66, top cap 1+RADIAL=33, bottom cap 1+RADIAL=33
const EXPECTED_VERTS = 132;
// barrel RADIAL*6=192, caps RADIAL*3*2=192
const EXPECTED_INDICES = 384;

test("cylinderGeometryData has the expected vertex/index counts", () => {
  const data = cylinderGeometryData(0.5, 1);
  expect(data.positions.length).toBe(EXPECTED_VERTS * 3);
  expect(data.indices?.length).toBe(EXPECTED_INDICES);
});

test("cylinder normals are unit length and winding is outward", () => {
  const data = cylinderGeometryData(0.5, 1);
  expectUnitNormals(data);
  expectOutwardWinding(data);
});

test("cylinder positions respect radius and height bounds", () => {
  const radius = 0.5;
  const height = 2;
  const data = cylinderGeometryData(radius, height);
  for (let i = 0; i < data.positions.length; i += 3) {
    const x = data.positions[i] ?? 0;
    const y = data.positions[i + 1] ?? 0;
    const z = data.positions[i + 2] ?? 0;
    expect(Math.hypot(x, z)).toBeLessThanOrEqual(radius + 1e-4);
    expect(Math.abs(y)).toBeLessThanOrEqual(height / 2 + 1e-4);
  }
});

test("cylinder caps point along ±Y, barrel normals are horizontal", () => {
  const data = cylinderGeometryData(0.5, 1);
  let sawUp = false;
  let sawDown = false;
  let sawHorizontal = false;
  for (let i = 0; i < data.normals.length; i += 3) {
    const ny = data.normals[i + 1] ?? 0;
    if (ny > 0.99) sawUp = true;
    else if (ny < -0.99) sawDown = true;
    else if (Math.abs(ny) < 1e-4) sawHorizontal = true;
  }
  expect(sawUp && sawDown && sawHorizontal).toBe(true);
});

test("cylinder throws on non-positive radius or height", () => {
  expect(() => cylinder(noCtx, { radius: -1 })).toThrow();
  expect(() => cylinder(noCtx, { height: 0 })).toThrow();
  expect(() => cylinder(noCtx, { radius: Number.NaN })).toThrow();
});
