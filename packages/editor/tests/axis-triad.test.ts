import { expect, test } from "bun:test";
import {
  axisViewLabel,
  projectAxisTriad,
} from "../src/frontend/lib/axis-triad.ts";

test("axisViewLabel: every axis and sign, spelled with the SIGN AS A WORD", () => {
  // This is the single point every accessible name for a snap view flows through — each
  // triad tip's `aria-label`/`title` and each of the burger's six View rows — so it is
  // pinned here directly rather than only through the two surfaces that render it.
  //
  // "positive"/"negative" is the accessibility requirement, not a style choice: `+X` and
  // `-X` differ by one punctuation mark, and at default punctuation verbosity a screen
  // reader commonly speaks neither — which would collapse six adjacent menu rows to three
  // announced pairs, in the group that exists as the reachable stand-in for a control
  // under the WCAG 2.2 SC 2.5.8 target-size minimum. Asserted as the full six, so a
  // regression to a symbol cannot pass by matching on the prefix.
  const all = (["x", "y", "z"] as const).flatMap((axis) =>
    ([1, -1] as const).map((sign) => axisViewLabel(axis, sign)),
  );
  expect(all).toEqual([
    "View from positive X",
    "View from negative X",
    "View from positive Y",
    "View from negative Y",
    "View from positive Z",
    "View from negative Z",
  ]);
  // No label may be a prefix of another, which is the property the punctuation spelling
  // lost: it is what stops two rows from being ambiguous when announced.
  for (const a of all)
    for (const b of all)
      if (a !== b)
        expect({ a, prefix: b.startsWith(a) }).toEqual({
          a,
          prefix: false,
        });
});

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
