import { expect, test } from "bun:test";
import {
  REF_NONE,
  refCommitValue,
  refOptions,
  refSelectValue,
} from "../../src/frontend/inspector/lib/ref-options.ts";

test("refOptions prepends an explicit (none) option before the ids", () => {
  const opts = refOptions(["m_a", "m_b"]);
  expect(opts[0]).toEqual({ value: REF_NONE, label: "(none)" });
  expect(opts.slice(1)).toEqual([
    { value: "m_a", label: "m_a" },
    { value: "m_b", label: "m_b" },
  ]);
});

test("refSelectValue maps an unset ('') ref to the (none) sentinel", () => {
  expect(refSelectValue("")).toBe(REF_NONE);
  expect(refSelectValue("m_a")).toBe("m_a");
});

test("refCommitValue maps the (none) sentinel back to '' and passes real ids through", () => {
  expect(refCommitValue(REF_NONE)).toBe("");
  expect(refCommitValue("m_a")).toBe("m_a");
});
