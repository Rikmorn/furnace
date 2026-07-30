// Pins CURRENT multi-select fan-out semantics in SchemaForm: mixed values render the
// "—" placeholder, and editing one field fans the edit into ALL N drafts before calling
// the parent onCommit.
//
// This file used to carry a third case, at the InspectPanel level (the same edit fanning
// out to a mock EditorActions, one ComponentEdit per selected entity). It went with the
// scene-editing surface — SchemaForm is the survivor, and these two cases are the
// regression armour that matters for it. Harness import MUST be first.

import { afterEach, expect, mock, test } from "bun:test";
import { SchemaForm } from "../../src/frontend/inspector/SchemaForm.tsx";
import type { JsonSchemaNode } from "../../src/frontend/inspector/types.ts";
import { cleanup, fireEvent, render, screen } from "./_harness.tsx";

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
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onPreview={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onCommit={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onCancel={() => {}}
		/>,
	);
	const input = screen.getByRole("textbox") as HTMLInputElement;
	expect(input.placeholder).toBe("—");
	expect(input.value).toBe("");
});

test("editing one field fans the edit into ALL drafts on commit", () => {
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onCommit = mock((_next: unknown[]) => {});
	render(
		<SchemaForm
			schema={OBJECT_SCHEMA}
			values={[{ x: 1 }, { x: 2 }]}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onPreview={() => {}}
			onCommit={onCommit}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
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
