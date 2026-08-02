// Registered FIRST — the shell.test.tsx rule; see `boolean-field.test.tsx` for the mechanism
// and the measurement.
import "./_register.ts";

// Task 8 sub-change 4: the drag-scrub already exists on scrubbable field labels —
// make it DISCOVERABLE with an ew-resize cursor + a subtle hover underline. This pins
// that a scrubbable label (NumberField) carries the affordance classes and a plain
// label (StringField) does not.

import { afterEach, expect, test } from "bun:test";
import { NumberField } from "../../src/frontend/inspector/fields/NumberField.tsx";
import { StringField } from "../../src/frontend/inspector/fields/StringField.tsx";
import { cleanup, render, screen } from "./_harness.tsx";

afterEach(cleanup);

// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
const noop = () => {};

test("a scrubbable NumberField label shows the ew-resize + hover-underline affordance", () => {
	render(
		<NumberField
			schema={{ type: "number" }}
			values={[3]}
			onPreview={noop}
			onCommit={noop}
			onCancel={noop}
			path="intensity"
		/>,
	);
	const label = screen.getByText("Intensity");
	expect(label.className).toContain("cursor-ew-resize");
	expect(label.className).toContain("hover:underline");
});

test("a non-scrubbable StringField label has no scrub affordance", () => {
	render(
		<StringField
			schema={{ type: "string" }}
			values={["hi"]}
			onPreview={noop}
			onCommit={noop}
			onCancel={noop}
			path="note"
		/>,
	);
	const label = screen.getByText("Note");
	expect(label.className).not.toContain("cursor-ew-resize");
});
