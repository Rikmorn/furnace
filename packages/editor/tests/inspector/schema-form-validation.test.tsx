// D-25's refusal contract: validation AT the field, with the commit verb explaining it.
//
// The shape matters more than the copy. A form that collects its refusals into a bag and
// prints them under the submit button makes the user scroll to find out which of nine
// numbers is wrong — so the bag does not exist here. `SchemaForm` holds ONE offending
// field at a time, which is not a simplification but a consequence: a refused draft is not
// written, so the only field that can be in error is the one under the cursor. There is no
// list to dump, by construction.
//
// The other half is the REFUSAL ITSELF: an out-of-bounds value must not reach `onPreview`.
// The card previews into a live worker ghost, so a value the generator will throw on is a
// round-trip and an error toast to say what the schema already knew.
//
// Harness import MUST be first (happy-dom globals before any DOM-touching module).

import { afterEach, expect, mock, test } from "bun:test";
import { SchemaForm } from "../../src/frontend/inspector/index.tsx";
import { cleanup, fireEvent, render, screen } from "./_harness.tsx";

afterEach(cleanup);

/** A hall-shaped bounded integer param, wide enough to render as a slider. */
const WIDTH = {
	type: "object",
	properties: {
		width: { type: "number", minimum: 3, maximum: 24, multipleOf: 1 },
	},
};

function renderForm(value: Record<string, unknown> = { width: 8 }) {
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onPreview = mock((_next: unknown[]) => {});
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onCommit = mock((_next: unknown[]) => {});
	const onInvalid = mock(
		// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
		(_bad: { path: string; message: string } | null) => {},
	);
	render(
		<SchemaForm
			schema={WIDTH}
			values={[value]}
			onPreview={onPreview}
			onCommit={onCommit}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onCancel={() => {}}
			onInvalid={onInvalid}
		/>,
	);
	const exact = screen.getByRole("textbox", {
		name: "Width exact",
	}) as HTMLInputElement;
	return { exact, onPreview, onCommit, onInvalid };
}

test("an out-of-bounds value refuses AT the field and never previews", () => {
	const { exact, onPreview, onCommit } = renderForm();
	exact.focus();
	fireEvent.change(exact, { target: { value: "2" } });
	// The reason renders in the row, in the schema's own numbers.
	expect(screen.getByRole("alert").textContent).toContain("must be at least 3");
	// …and the host never sees it. A preview would spend a worker round trip to be told
	// what `minimum: 3` already says.
	expect(onPreview).not.toHaveBeenCalled();
	fireEvent.blur(exact);
	expect(onCommit).not.toHaveBeenCalled();
});

test("the offending FIELD is named upward, so the verb can explain its own refusal", () => {
	const { exact, onInvalid } = renderForm();
	exact.focus();
	fireEvent.change(exact, { target: { value: "2" } });
	expect(onInvalid).toHaveBeenLastCalledWith({
		path: "width",
		message: "must be at least 3",
	});
});

test("correcting the value clears the refusal on both channels", () => {
	const { exact, onPreview, onInvalid } = renderForm();
	exact.focus();
	fireEvent.change(exact, { target: { value: "2" } });
	fireEvent.change(exact, { target: { value: "9" } });
	// `queryByRole` returns null when absent; compare to null FIRST (a failing
	// `toBeNull()` on a happy-dom element serialises React's fiber graph and hangs).
	expect(screen.queryByRole("alert") === null).toBe(true);
	expect(onInvalid).toHaveBeenLastCalledWith(null);
	expect(onPreview).toHaveBeenLastCalledWith([{ width: 9 }]);
});

test("a fractional value on a whole-number param refuses too", () => {
	// The live defect at HEAD: a hall width of 8.5 is accepted by the field, previewed,
	// and thrown back by `intParam` from inside the worker — "hall: width must be an
	// integer in [4, 24], got 8.5" — with the field still showing 8.5 as if it took.
	const { exact, onPreview } = renderForm();
	exact.focus();
	fireEvent.change(exact, { target: { value: "8.5" } });
	expect(screen.getByRole("alert").textContent).toContain(
		"must be a whole number",
	);
	expect(onPreview).not.toHaveBeenCalled();
});

test("a valid value still previews per keystroke and commits on blur", () => {
	// The guard must not be a brake: this is the case that fails if the refusal path
	// swallowed everything rather than only the invalid drafts.
	const { exact, onPreview, onCommit } = renderForm();
	exact.focus();
	fireEvent.change(exact, { target: { value: "12" } });
	expect(onPreview).toHaveBeenLastCalledWith([{ width: 12 }]);
	fireEvent.blur(exact);
	expect(onCommit).toHaveBeenLastCalledWith([{ width: 12 }]);
});

test("unmounting the form retracts its refusal", () => {
	// The card unmounts the form whenever its palette closes or the record turns
	// read-only. A refusal that outlived the form would leave the commit verb disabled
	// with a reason naming a field nothing is rendering.
	const { exact, onInvalid } = renderForm();
	exact.focus();
	fireEvent.change(exact, { target: { value: "2" } });
	expect(onInvalid.mock.calls.at(-1)?.[0]).not.toBe(null);
	cleanup();
	expect(onInvalid.mock.calls.at(-1)?.[0]).toBe(null);
});
