// The D-25 bounded-numeric vocabulary: SLIDER (drag, scrub, or type an exact value) and
// STEPPER (± over a short integer range). Harness import MUST be first so happy-dom's
// globals register before any DOM-touching module.
//
// THREE affordances over ONE value is the whole point, and each has a way to be silently
// wrong on its own:
//   - the RANGE is the coarse gesture, and it must be quantized by the SCHEMA's step or it
//     emits values the generator rejects setup-loud one worker round-trip later;
//   - the LABEL scrubs, the house gesture every numeric field already carries — and it must
//     capture the pointer, or a drag that leaves the palette reaches the canvas underneath
//     and orbits the camera while the user thinks they are dragging a number;
//   - the TEXT input is the exact one, and it is the only one that can be out of bounds, so
//     it is the one the field-level refusal is about.
//
// HOUSE RULE (this suite learned it twice): every "absent" assertion compares to null
// BEFORE the expect. A happy-dom element carries React's fiber graph, so a failing
// `toBeNull()`/`not.toBe()` serialises tens of megabytes and reads as a hung run.

import { afterEach, expect, mock, test } from "bun:test";
import { SliderField } from "../../src/frontend/inspector/fields/SliderField.tsx";
import { StepperField } from "../../src/frontend/inspector/fields/StepperField.tsx";
import type { JsonSchemaNode } from "../../src/frontend/inspector/types.ts";
import { cleanup, fireEvent, render, screen } from "./_harness.tsx";

afterEach(cleanup);

/** A bounded integer schema in the shape core's hall/maze params carry. */
const INT_SCHEMA: JsonSchemaNode = {
	type: "number",
	minimum: 4,
	maximum: 24,
	multipleOf: 1,
	default: 8,
};

/** A bounded continuous schema carrying a unit — cave.chamberRadius's shape. */
const METRES_SCHEMA: JsonSchemaNode = {
	type: "number",
	minimum: 3,
	maximum: 8,
	default: 5,
	furnace: { unit: "m" },
};

function renderSlider(schema: JsonSchemaNode, value: number, path = "width") {
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onPreview = mock((_next: unknown[]) => {});
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onCommit = mock((_next: unknown[]) => {});
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onCancel = mock(() => {});
	render(
		<SliderField
			schema={schema}
			values={[value]}
			onPreview={onPreview}
			onCommit={onCommit}
			onCancel={onCancel}
			path={path}
		/>,
	);
	return { onPreview, onCommit, onCancel };
}

// --- the range half ----------------------------------------------------------

test("the slider carries the schema's bounds and step onto the range control", () => {
	renderSlider(INT_SCHEMA, 8);
	const range = screen.getByRole("slider", {
		name: "Width",
	}) as HTMLInputElement;
	expect(range.min).toBe("4");
	expect(range.max).toBe("24");
	// The step is the SCHEMA's, not the control's default of 1-by-accident: an HTML range
	// defaults to step 1, so a continuous [0,1] param would offer exactly two values if
	// this were left unset. The integer case is pinned here and the continuous one below.
	expect(range.step).toBe("1");
});

test("a continuous param gets the span-derived step, not the range default", () => {
	renderSlider(METRES_SCHEMA, 5, "chamberRadius");
	const range = screen.getByRole("slider", {
		name: "Chamber Radius",
	}) as HTMLInputElement;
	expect(range.step).toBe("0.05");
});

test("dragging the range PREVIEWS per move and COMMITS on release", () => {
	const { onPreview, onCommit } = renderSlider(INT_SCHEMA, 8);
	const range = screen.getByRole("slider", { name: "Width" });
	fireEvent.change(range, { target: { value: "12" } });
	// A live ghost is the whole reason this is a preview: the user is watching the field
	// change under the drag, not reading a number.
	expect(onPreview).toHaveBeenLastCalledWith([12]);
	expect(onCommit).not.toHaveBeenCalled();
	// Release is the committer — one undo entry per drag, not one per pixel.
	fireEvent.pointerUp(range);
	expect(onCommit).toHaveBeenCalledTimes(1);
	expect(onCommit).toHaveBeenLastCalledWith([12]);
});

// --- the scrubby label -------------------------------------------------------

test("the label scrubs the value and CAPTURES the pointer for the whole drag", () => {
	const { onPreview, onCommit } = renderSlider(INT_SCHEMA, 8);
	const label = screen.getByText("Width");
	const captured: number[] = [];
	// happy-dom does not implement pointer capture; record the call instead. Without a
	// capture the drag's later events retarget by hit-test, and this palette floats over
	// a canvas that orbits on pointermove — so the user would spin the camera mid-scrub.
	label.setPointerCapture = (id: number) => {
		captured.push(id);
	};
	// biome-ignore lint/suspicious/noEmptyBlockStatements: release is asserted by absence of a throw
	label.releasePointerCapture = () => {};

	fireEvent.pointerDown(label, { clientX: 100, pointerId: 7 });
	expect(captured).toEqual([7]);
	fireEvent.pointerMove(label, { clientX: 200, pointerId: 7 });
	// 100 px at the slider's own sensitivity, SNAPPED to the schema's step — a scrub that
	// ignored the step is the live defect this field exists to close (a hall width of 8.35
	// is refused by `intParam`, from the worker, one round trip after the drag).
	const previewed = onPreview.mock.calls.at(-1)?.[0] as number[];
	expect(Number.isInteger(previewed[0])).toBe(true);
	expect(previewed[0]).toBeGreaterThan(8);

	fireEvent.pointerUp(label, { clientX: 200, pointerId: 7 });
	expect(onCommit).toHaveBeenCalledTimes(1);
});

test("a CLICK on the label commits nothing — a press-release with no drag is not an edit", () => {
	// The label is a 40 px target sitting in a params column, so it gets clicked by
	// accident. A commit here costs an `updateStamp`, a worker preview round trip and an
	// undo entry, all for the value that was already there — the same no-op commit the
	// numeric blur path routes through `commitIfChanged` to avoid.
	const { onCommit, onPreview } = renderSlider(INT_SCHEMA, 8);
	const label = screen.getByText("Width");
	// biome-ignore lint/suspicious/noEmptyBlockStatements: capture is asserted in its own case
	label.setPointerCapture = () => {};
	// biome-ignore lint/suspicious/noEmptyBlockStatements: release is asserted by absence of a throw
	label.releasePointerCapture = () => {};
	fireEvent.pointerDown(label, { clientX: 120, pointerId: 3 });
	fireEvent.pointerUp(label, { clientX: 120, pointerId: 3 });
	expect(onCommit).not.toHaveBeenCalled();
	expect(onPreview).not.toHaveBeenCalled();
});

test("a scrub CLAMPS to the schema's bounds rather than running past them", () => {
	const { onPreview } = renderSlider(INT_SCHEMA, 8);
	const label = screen.getByText("Width");
	// biome-ignore lint/suspicious/noEmptyBlockStatements: capture is asserted in its own case
	label.setPointerCapture = () => {};
	fireEvent.pointerDown(label, { clientX: 0, pointerId: 1 });
	// Far past the top end. The bound is the schema's, so a clamp that used the control's
	// own idea of a maximum would drift the moment a generator widened its range.
	fireEvent.pointerMove(label, { clientX: 100_000, pointerId: 1 });
	expect(onPreview).toHaveBeenLastCalledWith([24]);
});

test("the label carries the scrub affordance classes", () => {
	renderSlider(INT_SCHEMA, 8);
	expect(screen.getByText("Width").className).toContain("cursor-ew-resize");
});

// --- the exact text half -----------------------------------------------------

test("the exact input takes a typed value and commits it on blur", () => {
	const { onCommit } = renderSlider(INT_SCHEMA, 8);
	const exact = screen.getByRole("textbox", {
		name: "Width exact",
	}) as HTMLInputElement;
	exact.focus();
	fireEvent.change(exact, { target: { value: "17" } });
	fireEvent.blur(exact);
	expect(onCommit).toHaveBeenLastCalledWith([17]);
});

test("clearing the exact input never snaps the value to 0", () => {
	// `Number("") === 0` and 0 is finite — the trap that made the hollow-thickness field
	// push a 0 per keystroke. A bounded field snapping to 0 is worse still: 0 is out of
	// range for most of them, so the ghost would error rather than merely look wrong.
	const { onPreview, onCommit } = renderSlider(INT_SCHEMA, 8);
	const exact = screen.getByRole("textbox", { name: "Width exact" });
	exact.focus();
	fireEvent.change(exact, { target: { value: "" } });
	expect(onPreview).not.toHaveBeenCalled();
	fireEvent.blur(exact);
	expect(onCommit).not.toHaveBeenCalled();
});

test("the unit rides the row when the schema declares one, and nothing when it does not", () => {
	renderSlider(METRES_SCHEMA, 5, "chamberRadius");
	// D-25: units always. A bare 5 beside a bare 0.3 reads as the same kind of quantity.
	expect(screen.getByText("m")).toBeTruthy();
	cleanup();
	renderSlider(INT_SCHEMA, 8);
	// …and a unitless param must not invent one. `queryByText` returns null when absent;
	// compare to null FIRST (the house rule at the top of this file).
	expect(screen.queryByText("m") === null).toBe(true);
});

// --- the stepper -------------------------------------------------------------

const SMALL_INT: JsonSchemaNode = {
	type: "number",
	minimum: 2,
	maximum: 6,
	multipleOf: 1,
	default: 3,
};

function renderStepper(value: number) {
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onCommit = mock((_next: unknown[]) => {});
	render(
		<StepperField
			schema={SMALL_INT}
			values={[value]}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onPreview={() => {}}
			onCommit={onCommit}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onCancel={() => {}}
			path="chambers"
		/>,
	);
	return { onCommit };
}

test("the stepper's ± commit one step and are BOUNDED at each end", () => {
	const { onCommit } = renderStepper(3);
	fireEvent.click(screen.getByRole("button", { name: "increase Chambers" }));
	expect(onCommit).toHaveBeenLastCalledWith([4]);
	fireEvent.click(screen.getByRole("button", { name: "decrease Chambers" }));
	// Two clicks in, one each way: the second reads the COMMITTED value, so a stepper
	// that stepped its own stale draft would answer 5 here.
	expect(onCommit).toHaveBeenLastCalledWith([2]);
});

test("ONE press is ONE commit — the row must not re-dispatch the click", () => {
	// Found by the segmented control's own count assertion and shared with it: both were
	// wrapped in `FieldRow`'s `<label>`. The double dispatch itself is a HAPPY-DOM
	// artifact — WHATWG says a label does nothing for events targeted at interactive
	// content descendants, so a browser does not double-fire — but it is what made the
	// wrapper visible, and the wrapper is wrong in a browser for two other reasons
	// (`FieldGroupRow`'s TSDoc: the caption presses the first control, and every member
	// answers to the row's name). Keeping the count assertion because NOTHING about the
	// rendered output shows a re-dispatch — only a call count does.
	const { onCommit } = renderStepper(3);
	fireEvent.click(screen.getByRole("button", { name: "increase Chambers" }));
	expect(onCommit).toHaveBeenCalledTimes(1);
});

test("the stepper disables the end it is already at", () => {
	renderStepper(2);
	const down = screen.getByRole("button", {
		name: "decrease Chambers",
	}) as HTMLButtonElement;
	const up = screen.getByRole("button", {
		name: "increase Chambers",
	}) as HTMLButtonElement;
	expect(down.disabled).toBe(true);
	expect(up.disabled).toBe(false);
});
