import { expect, test } from "bun:test";
import { setComponent } from "../../src/frontend/inspector/lib/vec-component.ts";

test("setComponent: sets one index, preserving the vector's others", () => {
  expect(setComponent([1, 2, 3], 1, 9, 3)).toEqual([1, 9, 3]);
});

test("setComponent: a missing target falls back to zeros then sets the component", () => {
  expect(setComponent(undefined, 0, 7, 3)).toEqual([7, 0, 0]);
});

test("setComponent: a non-numeric slot reads as 0 rather than leaking through", () => {
  expect(setComponent([1, "x", 3], 0, 7, 3)).toEqual([7, 0, 3]);
});
