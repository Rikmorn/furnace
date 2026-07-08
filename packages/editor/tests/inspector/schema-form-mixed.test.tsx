// Pins CURRENT multi-select fan-out semantics (regression armor for the shadcn
// control swap in Task 4). Two levels:
//   1. SchemaForm directly — mixed values render the "—" placeholder, and editing
//      one field fans the edit into ALL N drafts before calling the parent onCommit.
//   2. InspectPanel wired to a mock EditorActions — the same edit fans out to the
//      real commit action, one ComponentEdit per selected entity.
//
// Behavior verified by reading SchemaForm.tsx + InspectPanel.tsx + fields/*.tsx and
// by these tests passing against current code. Harness import MUST be first.
import {
  cleanup,
  fireEvent,
  makeEditorContext,
  render,
  renderWithEditor,
  screen,
} from "./_harness.tsx";
import { afterEach, expect, mock, test } from "bun:test";
import { SchemaForm } from "../../src/frontend/inspector/SchemaForm.tsx";
import { InspectPanel } from "../../src/frontend/components/InspectPanel.tsx";
import type { EditorContextValue } from "../../src/frontend/components/editor-context.ts";
import type { JsonSchemaNode } from "../../src/frontend/inspector/types.ts";

afterEach(cleanup);

const OBJECT_SCHEMA: JsonSchemaNode = {
  type: "object",
  properties: { x: { type: "number" } },
};

test("mixed values render the '—' placeholder and an empty field", () => {
  render(
    <SchemaForm
      schema={OBJECT_SCHEMA}
      values={[{ x: 1 }, { x: 2 }]}
      onPreview={() => {}}
      onCommit={() => {}}
      onCancel={() => {}}
    />,
  );
  const input = screen.getByRole("textbox") as HTMLInputElement;
  expect(input.placeholder).toBe("—");
  expect(input.value).toBe("");
});

test("editing one field fans the edit into ALL drafts on commit", () => {
  const onCommit = mock((_next: unknown[]) => {});
  render(
    <SchemaForm
      schema={OBJECT_SCHEMA}
      values={[{ x: 1 }, { x: 2 }]}
      onPreview={() => {}}
      onCommit={onCommit}
      onCancel={() => {}}
    />,
  );
  const input = screen.getByRole("textbox") as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: "5" } });
  fireEvent.blur(input);
  // One commit carrying BOTH drafts, each with x set to the edited value.
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenLastCalledWith([{ x: 5 }, { x: 5 }]);
});

test("InspectPanel fans a component edit to EditorActions.commitComponents per selected entity", () => {
  const commitComponents = mock(async (_edits: unknown[]) => {});
  const reflection = {
    components: { transform: OBJECT_SCHEMA },
    resources: {},
    settings: {},
  };
  // Boundary cast: hostRef mock stands in for the full ViewportHost surface; only the
  // members these tests exercise (introspect) are populated.
  const hostRef = {
    current: { introspect: () => reflection },
  } as unknown as EditorContextValue["hostRef"];

  const ctx = makeEditorContext({
    state: {
      doc: {
        version: 1,
        resources: {},
        entities: [
          { id: "a", components: { transform: { x: 1 } } },
          { id: "b", components: { transform: { x: 2 } } },
        ],
      },
      selectedEntities: ["a", "b"],
    },
    hostRef,
    actions: { commitComponents },
  });

  renderWithEditor(<InspectPanel />, ctx);

  const input = screen.getByRole("textbox") as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: "5" } });
  fireEvent.blur(input);

  // ACTUAL current behavior: commitComponents is called ONCE with an array holding
  // one ComponentEdit per selected entity (NOT one call per entity — see report).
  expect(commitComponents).toHaveBeenCalledTimes(1);
  expect(commitComponents).toHaveBeenLastCalledWith([
    { entity: "a", component: "transform", params: { x: 5 } },
    { entity: "b", component: "transform", params: { x: 5 } },
  ]);
});
