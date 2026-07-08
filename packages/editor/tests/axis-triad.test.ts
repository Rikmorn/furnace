import { expect, test } from "bun:test";
import { projectAxisTriad } from "../src/frontend/lib/axis-triad.ts";

test("projectAxisTriad: returns X, Y, Z in order", () => {
  const axes = projectAxisTriad(0.3, 0.7);
  expect(axes.map((a) => a.axis)).toEqual(["x", "y", "z"]);
});

test("projectAxisTriad: looking down -Z (yaw=0, pitch=0) maps X→right, Y→up, Z→toward viewer", () => {
  const [x, y, z] = projectAxisTriad(0, 0);
  // World +X projects to screen-right.
  expect(x.x).toBeCloseTo(1, 6);
  expect(x.y).toBeCloseTo(0, 6);
  // World +Y projects to screen-up (SVG y is negated → -1).
  expect(y.x).toBeCloseTo(0, 6);
  expect(y.y).toBeCloseTo(-1, 6);
  // World +Z points straight at the viewer (out of screen, depth < 0, no 2D extent).
  expect(z.x).toBeCloseTo(0, 6);
  expect(z.y).toBeCloseTo(0, 6);
  expect(z.depth).toBeCloseTo(-1, 6);
});

test("projectAxisTriad: each projected axis stays unit length (x²+y²+depth²≈1)", () => {
  for (const [yaw, pitch] of [
    [0, 0],
    [Math.PI / 4, 0.5],
    [-1.2, 1.4],
    [2.7, -0.9],
  ] as const) {
    for (const a of projectAxisTriad(yaw, pitch)) {
      expect(a.x * a.x + a.y * a.y + a.depth * a.depth).toBeCloseTo(1, 5);
    }
  }
});

test("projectAxisTriad: yaw=π/2 rotates the horizontal frame (X toward viewer, Z to screen-left)", () => {
  const [x, , z] = projectAxisTriad(Math.PI / 2, 0);
  expect(x.depth).toBeCloseTo(-1, 6); // +X now behind the look direction
  expect(z.x).toBeCloseTo(-1, 6); // +Z projects to screen-left
});
