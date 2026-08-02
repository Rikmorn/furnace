// Registered FIRST — the shell.test.tsx rule; see `boolean-field.test.tsx` for the mechanism
// and the measurement.
import "./_register.ts";

// Task 8 sub-change 2: nested ObjectFields lose the bordered/rounded <fieldset> box
// (the critique's named-ban "nested-cards" structure) — they now render as an indented
// labeled group.

import { afterEach, expect, test } from "bun:test";
import { SchemaForm } from "../../src/frontend/inspector/SchemaForm.tsx";
import type { JsonSchemaNode } from "../../src/frontend/inspector/types.ts";
import { cleanup, render, screen } from "./_harness.tsx";

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
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onPreview={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onCommit={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
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
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onPreview={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onCommit={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onCancel={() => {}}
		/>,
	);
	// Group label ("bounds" → humanized "Bounds") + the inner numeric field are both present.
	expect(screen.getByText("Bounds")).toBeTruthy();
	expect(screen.getByRole("textbox")).toBeTruthy();
});
