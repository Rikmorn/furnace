// Registered FIRST — the shell.test.tsx rule, and uniform across this directory as of the
// F4.5c Task 12 review. This file's own graph does not reach Radix, so its late
// registration was harmless rather than wrong; it is hoisted anyway because "every chrome
// test opens with this line" is a rule a scan can hold
// (`tests/register-first.test.ts`), and "every chrome test except the one that
// happens not to need it" is not.
import "../inspector/_register.ts";

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
// `document.createElement` and nothing else, so it needs testing-library not at all.
import { expect, test } from "bun:test";
import { isTextInputTarget } from "../../src/frontend/lib/keybindings.ts";

/** An `<input>` of `type`. Built through the attribute rather than the property so the
 *  fixture goes through the same normalisation the DOM applies to real markup. */
const inputOf = (type: string): HTMLInputElement => {
  const el = document.createElement("input");
  if (type !== "") el.setAttribute("type", type);
  return el;
};

test("isTextInputTarget: typed text ENTRY — a textarea, a select, a text field", () => {
  const textarea = document.createElement("textarea");
  const editable = document.createElement("div");
  editable.contentEditable = "true";
  expect(isTextInputTarget(textarea)).toBe(true);
  expect(isTextInputTarget(editable)).toBe(true);
  // An <input> with no type attribute IS a text field — the empty-string case.
  expect(isTextInputTarget(inputOf(""))).toBe(true);
  for (const type of [
    "text",
    "search",
    "url",
    "tel",
    "email",
    "password",
    "number",
  ])
    expect({ type, matched: isTextInputTarget(inputOf(type)) }).toEqual({
      type,
      matched: true,
    });
});

test("isTextInputTarget: a <select> counts — Esc and ⏎ belong to its popup", () => {
  // The direction that loses WORK. These panels use native selects (form-bits.tsx says
  // why), one of them the merge-policy select rendered DURING a live stamp session:
  // Esc there is the conventional dismiss for the dropdown, and an unclaimed Esc runs
  // the cancel ladder and discards the session being configured.
  expect(isTextInputTarget(document.createElement("select"))).toBe(true);
});

test("isTextInputTarget: a control you OPERATE is not typed text", () => {
  // The direction that loses BINDINGS. `range` is the sharp one — the brush-radius
  // slider is dragged while looking at the field, so matching it would make V/B/F dead
  // exactly there (the "touch a panel and the keys stop working" defect, relocated).
  for (const type of ["range", "checkbox", "radio", "color", "file", "button"])
    expect({ type, matched: isTextInputTarget(inputOf(type)) }).toEqual({
      type,
      matched: false,
    });
  expect(isTextInputTarget(document.createElement("div"))).toBe(false);
  expect(isTextInputTarget(document.createElement("canvas"))).toBe(false);
  expect(isTextInputTarget(document.createElement("button"))).toBe(false);
  expect(isTextInputTarget(null)).toBe(false);
});
