// Registered FIRST — the shell.test.tsx rule; see `boolean-field.test.tsx` for the mechanism
// and the measurement.
import "./_register.ts";

// Pins CURRENT NumberField edit semantics (regression armor for the shadcn control
// swap in Task 4). These assert what the code does TODAY — verified by reading
// src/frontend/inspector/fields/NumberField.tsx and by these tests passing against
// current code. They are NOT TDD for new behavior.

import { afterEach, expect, mock, test } from "bun:test";
import { NumberField } from "../../src/frontend/inspector/fields/NumberField.tsx";
import { cleanup, fireEvent, render, screen } from "./_harness.tsx";

afterEach(cleanup);

/** Render a single-target NumberField seeded to `3` and return the input + spies. */
function renderNumberField(value = 3) {
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onPreview = mock((_next: unknown[]) => {});
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onCommit = mock((_next: unknown[]) => {});
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onCancel = mock(() => {});
	render(
		<NumberField
			schema={{ type: "number" }}
			values={[value]}
			onPreview={onPreview}
			onCommit={onCommit}
			onCancel={onCancel}
			path="x"
		/>,
	);
	const input = screen.getByRole("textbox") as HTMLInputElement;
	return { input, onPreview, onCommit, onCancel };
}

test("typing then blur commits exactly once with the fanned value", () => {
	const { input, onPreview, onCommit } = renderNumberField();
	input.focus();
	fireEvent.change(input, { target: { value: "5" } });
	// onChange previews live while typing (value is finite + non-empty).
	expect(onPreview).toHaveBeenLastCalledWith([5]);
	fireEvent.blur(input);
	// onBlur is the SOLE committer; commits once.
	expect(onCommit).toHaveBeenCalledTimes(1);
	expect(onCommit).toHaveBeenLastCalledWith([5]);
});

test("typing then Enter commits (Enter blurs; blur is the committer)", () => {
	const { input, onCommit, onCancel } = renderNumberField();
	input.focus();
	fireEvent.change(input, { target: { value: "7" } });
	// Enter does NOT call onCommit itself — it blur()s the input, and onBlur commits.
	fireEvent.keyDown(input, { key: "Enter" });
	expect(onCommit).toHaveBeenCalledTimes(1);
	expect(onCommit).toHaveBeenLastCalledWith([7]);
	expect(onCancel).not.toHaveBeenCalled();
});

test("Escape reverts to the seeded text and does NOT commit", () => {
	const { input, onCommit, onCancel } = renderNumberField();
	input.focus();
	fireEvent.change(input, { target: { value: "9" } });
	fireEvent.keyDown(input, { key: "Escape" });
	expect(onCancel).toHaveBeenCalledTimes(1);
	expect(onCommit).not.toHaveBeenCalled();
	// Escape restores the input to the committed value ("3"); no blur/commit follows.
	expect(input.value).toBe("3");
});

test("an unchanged blur does NOT commit (dirty check — Task 8 fix)", () => {
	const { input, onCommit } = renderNumberField();
	input.focus();
	// No edit — just focus then blur. The onBlur guard compares the parsed value to the
	// committed value and skips the commit when they match (Task 8 flipped the old
	// KNOWN-ISSUE where a focus+blur committed a spurious no-op edit / revision bump).
	fireEvent.blur(input);
	expect(onCommit).not.toHaveBeenCalled();
});

test("typing the SAME value then blur does NOT commit (dirty check)", () => {
	const { input, onCommit } = renderNumberField();
	input.focus();
	// Re-typing the committed value "3" leaves the field clean → no commit on blur.
	fireEvent.change(input, { target: { value: "3" } });
	fireEvent.blur(input);
	expect(onCommit).not.toHaveBeenCalled();
});

test("blurring an empty/invalid value reverts and does NOT commit", () => {
	const { input, onCommit } = renderNumberField();
	input.focus();
	fireEvent.change(input, { target: { value: "" } });
	fireEvent.blur(input);
	expect(onCommit).not.toHaveBeenCalled();
	// Empty text is rejected on blur and the field snaps back to the seeded value.
	expect(input.value).toBe("3");
});
