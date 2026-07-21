// Task 8 carried fix (from Task 4 review): the shadcn Checkbox rendered the SAME check
// glyph for both checked and indeterminate, so the BooleanField MIXED state looked almost
// identical to checked. The fix adds a distinct minus/dash glyph for indeterminate. The
// field logic (data-state="indeterminate") was already correct. Harness import MUST be first.

import { afterEach, expect, test } from "bun:test";
import { BooleanField } from "../../src/frontend/inspector/fields/BooleanField.tsx";
import { cleanup, render } from "./_harness.tsx";

afterEach(cleanup);

// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
const noop = () => {};

function renderBool(values: unknown[]) {
	return render(
		<BooleanField
			schema={{ type: "boolean" }}
			values={values}
			onPreview={noop}
			onCommit={noop}
			onCancel={noop}
			path="visible"
		/>,
	);
}

// Both glyphs are always in the DOM; the visible one is chosen by the `hidden` class
// (display:none), which is JS-driven off the checked prop — so happy-dom (which can read
// the class attribute but can't compute CSS) can verify the differentiation deterministically.
test("mixed → indeterminate hides the check glyph and shows the minus glyph", () => {
	const { container } = renderBool([true, false]);
	const box = container.querySelector('[role="checkbox"]');
	expect(box?.getAttribute("data-state")).toBe("indeterminate");
	expect(
		container.querySelector("svg.lucide-check")?.getAttribute("class"),
	).toContain("hidden");
	expect(
		container.querySelector("svg.lucide-minus")?.getAttribute("class"),
	).not.toContain("hidden");
});

test("checked → shows the check glyph and hides the minus glyph", () => {
	const { container } = renderBool([true]);
	const box = container.querySelector('[role="checkbox"]');
	expect(box?.getAttribute("data-state")).toBe("checked");
	expect(
		container.querySelector("svg.lucide-check")?.getAttribute("class"),
	).not.toContain("hidden");
	expect(
		container.querySelector("svg.lucide-minus")?.getAttribute("class"),
	).toContain("hidden");
});
