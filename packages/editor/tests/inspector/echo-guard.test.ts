import { expect, test } from "bun:test";
import { shouldReseed } from "../../src/frontend/inspector/lib/echo-guard.ts";

test("shouldReseed: returns false when focused, true when not", () => {
  expect(shouldReseed(true)).toBe(false); // focused → keep draft
  expect(shouldReseed(false)).toBe(true); // not focused → reseed
});
