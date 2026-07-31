// The DOM half of the key gate: `isTextInputTarget` needs a real HTMLElement to narrow
// against, so it cannot live beside the pure matcher/gate cases in tests/keybindings.ts.
//
// Lives under tests/chrome/ ON PURPOSE, and this is load-bearing rather than tidiness:
// registering happy-dom from a test file directly in tests/ replaces the global `fetch`
// with happy-dom's same-origin-policy one BEFORE the daemon HTTP, bundle, and GPU suites
// run, and 29 of them fail (measured this session, moving this case up from the deleted
// tests/chrome/menubar.test.tsx). Every DOM test in this package sits under a subdir for
// exactly that reason.
//
// Only `_register.ts` is imported, not `_harness.tsx`: this case touches
// `document.createElement` and nothing else, so it needs neither testing-library nor its
// module-evaluation ordering dance.
import { expect, test } from "bun:test";
import { isTextInputTarget } from "../../src/frontend/lib/keybindings.ts";
import "../inspector/_register.ts";

test("isTextInputTarget recognises inputs, textareas and contentEditable", () => {
  const input = document.createElement("input");
  const textarea = document.createElement("textarea");
  const div = document.createElement("div");
  const editable = document.createElement("div");
  editable.contentEditable = "true";
  expect(isTextInputTarget(input)).toBe(true);
  expect(isTextInputTarget(textarea)).toBe(true);
  expect(isTextInputTarget(editable)).toBe(true);
  expect(isTextInputTarget(div)).toBe(false);
  expect(isTextInputTarget(null)).toBe(false);
});
