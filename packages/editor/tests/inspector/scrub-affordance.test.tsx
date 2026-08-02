// Registered FIRST — the shell.test.tsx rule; see `boolean-field.test.tsx` for the mechanism
// and the measurement.
import "./_register.ts";

// Task 8 sub-change 4: the drag-scrub already exists on scrubbable field labels —
// make it DISCOVERABLE with an ew-resize cursor + a subtle hover underline. This pins
// that a scrubbable label (NumberField) carries the affordance classes and a plain
// label (StringField) does not.
//
// It also pins `pb-1 -mb-1`, and THIS is the file that can, because the pair is a
// property of the underline rather than of the caption: it exists to stop `truncate`'s
// `overflow: hidden` clipping ink that lands below the line box, and the only such ink is
// the hover underline. The two renders below are the contrast case — the same caption
// component, one branch with the underline and one without — which is what makes an
// unconditional class uncoverable and a scoped one two assertions. The reasoning for the
// scope (including the measurement that says descenders do NOT need it) is at
// `inspector/fields/common.tsx`'s `RowCaption`.

import { afterEach, expect, test } from "bun:test";
import { NumberField } from "../../src/frontend/inspector/fields/NumberField.tsx";
import { StringField } from "../../src/frontend/inspector/fields/StringField.tsx";
import { cleanup, render, screen } from "./_harness.tsx";

afterEach(cleanup);

// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
const noop = () => {};

/** Class MEMBERSHIP, not substring: `-mb-1` is a substring of nothing today, and that is
 *  the kind of fact that stops being true the first time someone writes `-mb-10`. */
const classesOf = (el: Element): Set<string> =>
	new Set(el.className.split(/\s+/).filter((c) => c !== ""));

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
	// The clip-edge pair, asserted AS A PAIR: `pb-1` alone would move the margin box and
	// with it every inspector row's height, so the negative margin is not a detail of the
	// padding, it is the half that makes the padding free.
	const classes = classesOf(label);
	expect({
		pad: classes.has("pb-1"),
		unmargin: classes.has("-mb-1"),
	}).toEqual({ pad: true, unmargin: true });
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
	// …and no clip-edge pair either. Nothing on this branch draws below the line box —
	// there is no underline, and no glyph in the shipped subset reaches the clip edge — so
	// carrying the pair here would be compensation for ink that cannot exist.
	const classes = classesOf(label);
	expect({
		pad: classes.has("pb-1"),
		unmargin: classes.has("-mb-1"),
	}).toEqual({ pad: false, unmargin: false });
});
