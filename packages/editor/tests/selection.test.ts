import { expect, test } from "bun:test";
import { clickMode } from "../src/frontend/lib/selection.ts";

test("plain click → replace", () => {
  expect(clickMode({ metaKey: false, ctrlKey: false, shiftKey: false })).toBe(
    "replace",
  );
});
test("cmd/ctrl click → toggle", () => {
  expect(clickMode({ metaKey: true, ctrlKey: false, shiftKey: false })).toBe(
    "toggle",
  );
  expect(clickMode({ metaKey: false, ctrlKey: true, shiftKey: false })).toBe(
    "toggle",
  );
});
test("shift click → range (shift wins over toggle)", () => {
  expect(clickMode({ metaKey: true, ctrlKey: false, shiftKey: true })).toBe(
    "range",
  );
});
