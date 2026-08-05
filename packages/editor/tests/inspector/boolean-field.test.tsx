// Registered FIRST — the shell.test.tsx rule. This file reaches Radix (`BooleanField` →
// `ui/checkbox.tsx` → `@radix-ui/react-checkbox`) above its harness import, and the shim in
// `@radix-ui/react-use-layout-effect` picks its branch ONCE per process, so without this line
// the file poisons every Radix portal in the run. Measured at F4.5c Task 15 on the pair
// `boolean-field + enum-field`: 9 pass / 0 fail with the line, 8 pass / 1 fail without it.
import "./_register.ts";

// Task 8 carried fix (from Task 4 review): the shadcn Checkbox rendered the SAME check
// glyph for both checked and indeterminate, so the two states looked almost identical.
// The fix adds a distinct minus/dash glyph for indeterminate.
//
// The indeterminate case is driven through `ui/checkbox.tsx` DIRECTLY rather than through
// `BooleanField`, because the field no longer produces it: the inspector edits ONE target,
// so there is no disagreeing selection left to render as a dash. Radix's `CheckedState` is
// still tri-state, so the primitive keeps the glyph and keeps the pin.

import { afterEach, expect, test } from "bun:test";
import { Checkbox } from "../../src/frontend/components/ui/checkbox.tsx";
import { BooleanField } from "../../src/frontend/inspector/fields/BooleanField.tsx";
import { cleanup, render } from "./_harness.tsx";

afterEach(cleanup);

// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
const noop = () => {};

function renderBool(value: unknown) {
	return render(
		<BooleanField
			schema={{ type: "boolean" }}
			value={value}
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
test("indeterminate hides the check glyph and shows the minus glyph", () => {
	const { container } = render(<Checkbox checked="indeterminate" />);
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
	const { container } = renderBool(true);
	const box = container.querySelector('[role="checkbox"]');
	expect(box?.getAttribute("data-state")).toBe("checked");
	expect(
		container.querySelector("svg.lucide-check")?.getAttribute("class"),
	).not.toContain("hidden");
	expect(
		container.querySelector("svg.lucide-minus")?.getAttribute("class"),
	).toContain("hidden");
});
