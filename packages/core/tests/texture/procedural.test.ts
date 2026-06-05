import { expect, test } from "bun:test";
import { checkerboard, uvGrid } from "../../src/texture/procedural.ts";

test("checkerboard: correct dimensions, rgba length, and alternating cells", () => {
  const { data, width, height } = checkerboard({ size: 4, cells: 2 });
  expect(width).toBe(4);
  expect(height).toBe(4);
  expect(data.length).toBe(4 * 4 * 4);
  // x=0 (cell 0) vs x=2 (next cell over) at y=0 must differ
  const tl = [data[0], data[1], data[2]];
  const next = [data[2 * 4], data[2 * 4 + 1], data[2 * 4 + 2]];
  expect(tl).not.toEqual(next);
  // alpha is opaque
  expect(data[3]).toBe(255);
});

test("checkerboard: defaults produce a 256x256 rgba buffer", () => {
  const { data, width, height } = checkerboard();
  expect(width).toBe(256);
  expect(height).toBe(256);
  expect(data.length).toBe(256 * 256 * 4);
});

test("uvGrid: produces both line and background pixels (gridlines present)", () => {
  const { data, width, height } = uvGrid({ size: 8, cells: 4 });
  expect(width).toBe(8);
  expect(height).toBe(8);
  expect(data.length).toBe(8 * 8 * 4);
  // Pixel (0,0) sits on the top-left gridline; a pixel mid-cell does not.
  // Assert at least two distinct colors exist in the buffer.
  const first = `${data[0]},${data[1]},${data[2]}`;
  let foundDifferent = false;
  for (let i = 0; i < data.length; i += 4) {
    if (`${data[i]},${data[i + 1]},${data[i + 2]}` !== first) {
      foundDifferent = true;
      break;
    }
  }
  expect(foundDifferent).toBe(true);
});
