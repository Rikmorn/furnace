import { expect, test } from "bun:test";
import * as field from "../src/field/field.ts";
import { surfaceNets } from "../src/field/surface-nets.ts";

const grid = {
  min: [-6, -6, -6] as [number, number, number],
  cellSize: 0.5,
  dims: [24, 24, 24] as [number, number, number],
};

test("a sphere field meshes to a non-empty, finite, indexed surface", () => {
  const mesh = surfaceNets(field.sphereCavern(0, 0, 0, 4), grid);
  expect(mesh.positions.length).toBeGreaterThan(0);
  expect(mesh.indices.length % 3).toBe(0);
  expect(mesh.positions.length).toBe(mesh.normals.length);
  expect(mesh.positions.every((v) => Number.isFinite(v))).toBe(true);
  expect(mesh.normals.every((v) => Number.isFinite(v))).toBe(true);
});

test("every index is within the vertex range", () => {
  const mesh = surfaceNets(field.sphereCavern(0, 0, 0, 4), grid);
  const vertexCount = mesh.positions.length / 3;
  expect(mesh.indices.every((i) => i < vertexCount)).toBe(true);
});

test("normals are unit length", () => {
  const mesh = surfaceNets(field.sphereCavern(0, 0, 0, 4), grid);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const len = Math.hypot(
      mesh.normals[i] as number,
      mesh.normals[i + 1] as number,
      mesh.normals[i + 2] as number,
    );
    expect(len).toBeGreaterThan(0.99);
    expect(len).toBeLessThan(1.01);
  }
});
