// Registered FIRST — the shell.test.tsx rule; see `boolean-field.test.tsx` for the mechanism
// and the measurement.
import "./_register.ts";

// Task 8 sub-change 3: vec fields render VISIBLE axis chips (x/y/z/(w)) before each
// input — not tooltip-only (the old `title` attr). Plus the Task 8 review fix: the
// unchanged-blur dirty-check ported from NumberField (shared commit-guard) so tabbing
// through Transform position/scale doesn't fire spurious commits.

import { afterEach, expect, mock, test } from "bun:test";
import { makeVecField } from "../../src/frontend/inspector/fields/VecField.tsx";
import { cleanup, fireEvent, render, screen } from "./_harness.tsx";

afterEach(cleanup);

const VecField3 = makeVecField(3);
const VecField4 = makeVecField(4);

// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
const noop = () => {};

/** Render a vec3 seeded to `vec`, returning the x input + a commit spy. */
function renderVec3(
	vec: number[],
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	onCommit = mock((_next: unknown) => {}),
) {
	render(
		<VecField3
			schema={{ furnace: { kind: "vec3" } }}
			value={vec}
			onPreview={noop}
			onCommit={onCommit}
			onCancel={noop}
			path="position"
		/>,
	);
	const x = screen.getByTitle("x") as HTMLInputElement;
	return { x, onCommit };
}

test("vec3 renders visible x/y/z axis chips as text (not just a title attr)", () => {
	render(
		<VecField3
			schema={{ furnace: { kind: "vec3" } }}
			value={[1, 2, 3]}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onPreview={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onCommit={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onCancel={() => {}}
			path="position"
		/>,
	);
	// Each axis label is a real text node in the DOM, discoverable by getByText.
	expect(screen.getByText("x")).toBeTruthy();
	expect(screen.getByText("y")).toBeTruthy();
	expect(screen.getByText("z")).toBeTruthy();
});

test("vec4 renders the w chip too", () => {
	render(
		<VecField4
			schema={{ furnace: { kind: "vec4" } }}
			value={[1, 2, 3, 4]}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onPreview={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onCommit={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
			onCancel={() => {}}
			path="tangent"
		/>,
	);
	expect(screen.getByText("w")).toBeTruthy();
});

test("an unchanged blur on a vec component does NOT commit (dirty check)", () => {
	const { x, onCommit } = renderVec3([1, 2, 3]);
	x.focus();
	fireEvent.blur(x); // no edit → value still "1" (the committed baseline)
	expect(onCommit).not.toHaveBeenCalled();
});

test("a changed blur on a vec component commits the whole vector", () => {
	const { x, onCommit } = renderVec3([1, 2, 3]);
	x.focus();
	fireEvent.change(x, { target: { value: "5" } });
	fireEvent.blur(x);
	expect(onCommit).toHaveBeenCalledTimes(1);
	// x set to 5, other components preserved.
	expect(onCommit).toHaveBeenLastCalledWith([5, 2, 3]);
});
