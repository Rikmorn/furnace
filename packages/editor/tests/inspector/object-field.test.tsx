// Task 8 sub-change 2: nested ObjectFields lose the bordered/rounded <fieldset> box
// (the critique's named-ban "nested-cards" structure) — they now render as an indented
// labeled group. Harness import MUST be first.
import { cleanup, render, screen } from "./_harness.tsx";
import { afterEach, expect, test } from "bun:test";
import { SchemaForm } from "../../src/frontend/inspector/SchemaForm.tsx";
import type { JsonSchemaNode } from "../../src/frontend/inspector/types.ts";

afterEach(cleanup);

const NESTED_SCHEMA: JsonSchemaNode = {
  type: "object",
  properties: {
    bounds: {
      type: "object",
      properties: { min: { type: "number" } },
    },
  },
};

test("a nested object renders WITHOUT a <fieldset> card", () => {
  const { container } = render(
    <SchemaForm
      schema={NESTED_SCHEMA}
      values={[{ bounds: { min: 1 } }]}
      onPreview={() => {}}
      onCommit={() => {}}
      onCancel={() => {}}
    />,
  );
  // The old flatten target: no <fieldset>/<legend> chrome anywhere in the tree.
  expect(container.querySelector("fieldset")).toBeNull();
  expect(container.querySelector("legend")).toBeNull();
});

test("the nested group still shows its label and inner field", () => {
  render(
    <SchemaForm
      schema={NESTED_SCHEMA}
      values={[{ bounds: { min: 1 } }]}
      onPreview={() => {}}
      onCommit={() => {}}
      onCancel={() => {}}
    />,
  );
  // Group label ("bounds") + the inner numeric field are both still present.
  expect(screen.getByText("bounds")).toBeTruthy();
  expect(screen.getByRole("textbox")).toBeTruthy();
});
