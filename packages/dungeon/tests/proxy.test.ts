import { expect, test } from "bun:test";
import type { Field } from "../src/field.ts";
import { voxelProxyPosition, voxelsFromField } from "../src/proxy.ts";
import type { GridConfig } from "../src/surface-nets.ts";

const GRID: GridConfig = { min: [-1, -1, -1], cellSize: 1, dims: [3, 3, 3] };

test("emits one int-triple per solid cell (rock = f<0), 3 ints each", () => {
  const field: Field = (_x, y, _z) => y; // air y>0, rock y<0 → bottom layer solid
  const vox = voxelsFromField(field, GRID, undefined, false);
  expect(vox.size).toEqual([1, 1, 1]);
  expect(vox.coords.length % 3).toBe(0);
  expect(vox.coords.length / 3).toBe(9); // 3x3 bottom layer
});

test("shell-only drops the fully-enclosed centre cell", () => {
  const allRock: Field = () => -1;
  const full = voxelsFromField(allRock, GRID, undefined, false);
  const shell = voxelsFromField(allRock, GRID, undefined, true);
  expect(full.coords.length / 3).toBe(27);
  expect(shell.coords.length / 3).toBe(26);
});

test("deterministic + honours an anisotropic voxelSize override", () => {
  const field: Field = (_x, y, _z) => y;
  const a = voxelsFromField(field, GRID, [1, 0.25, 1], true);
  const b = voxelsFromField(field, GRID, [1, 0.25, 1], true);
  expect(a.size).toEqual([1, 0.25, 1]);
  expect(Array.from(a.coords)).toEqual(Array.from(b.coords));
});

test("voxelProxyPosition anchors cell (0,0,0)'s corner at the grid's min corner", () => {
  const p = voxelProxyPosition(GRID, [10, 0, -5]);
  // corner-anchored (HALF_VOXEL=0): origin + grid.min →
  // x: 10 + (-1) = 9, y: 0 + (-1) = -1, z: -5 + (-1) = -6
  expect(p).toEqual([9, -1, -6]);
});
