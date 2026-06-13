import { expect, test } from "bun:test";
import { fanComponent } from "../../src/frontend/inspector/lib/vec-fan.ts";

test("fanComponent: sets one index per target, preserving each target's others", () => {
  const targets = [
    [1, 2, 3],
    [4, 5, 6],
  ];
  const out = fanComponent(targets, 1, 9, 3); // set y (index 1) = 9 on all
  expect(out).toEqual([
    [1, 9, 3],
    [4, 9, 6],
  ]);
});

test("fanComponent: missing target value falls back to zeros then sets the component", () => {
  const out = fanComponent([undefined], 0, 7, 3);
  expect(out).toEqual([[7, 0, 0]]);
});
