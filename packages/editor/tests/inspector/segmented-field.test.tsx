// Registered FIRST — the shell.test.tsx rule. A BARE side-effect import is the only spelling
// that survives `organizeImports`; this file renders a Radix `Select` and a `Tooltip`, both
// of which mount through portals that go missing if happy-dom arrives after Radix. See
// `enum-field.test.tsx`'s header for the measurement.
import "./_register.ts";

// The D-25 segmented control: an enum of at most four members renders as one visible row
// of choices rather than as a dropdown that hides three of them behind a click.
//
// The cardinality rule is a `resolveKind` decision, so the fallback half is asserted
// THROUGH `SchemaForm` — the registry's single lookup is what actually picks the renderer,
// and a test that rendered `SegmentedField` directly could not tell whether the registry
// would ever choose it. Both halves of the boundary are pinned (4 → segmented, 5 → Select)
// because a rule stated only on the accepting side cannot fail.

import { afterEach, expect, mock, test } from "bun:test";
import { Segmented } from "../../src/frontend/components/ui/segmented.tsx";
import { TooltipProvider } from "../../src/frontend/components/ui/tooltip.tsx";
import { SchemaForm } from "../../src/frontend/inspector/index.tsx";
import type { JsonSchemaNode } from "../../src/frontend/inspector/types.ts";
import { cleanup, fireEvent, render, screen } from "./_harness.tsx";

afterEach(cleanup);

function renderForm(
	properties: Record<string, JsonSchemaNode>,
	value: unknown,
) {
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onCommit = mock((_next: unknown) => {});
	render(
		<SchemaForm
			schema={{ type: "object", properties }}
			value={value}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onPreview={() => {}}
			onCommit={onCommit}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onCancel={() => {}}
		/>,
	);
	return { onCommit };
}

test("an enum of ≤ 4 members renders as a radiogroup with every choice visible", () => {
	renderForm(
		{ pillars: { enum: ["none", "grid", "colonnade"] } },
		{ pillars: "grid" },
	);
	const group = screen.getByRole("radiogroup", { name: "Pillars" });
	const radios = screen.getAllByRole("radio");
	expect(radios.map((r) => r.textContent)).toEqual([
		"none",
		"grid",
		"colonnade",
	]);
	// The selected one says so in ARIA, not only in its fill: a segmented control whose
	// state lives purely in a Tailwind class is invisible to everything but a screenshot.
	expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual([
		"false",
		"true",
		"false",
	]);
	expect(group.contains(radios[0] ?? null)).toBe(true);
});

test("a 5-member enum falls back to the Select — the boundary's OTHER side", () => {
	renderForm(
		{ theme: { enum: ["mixed", "wet", "dry", "crystal", "fungal"] } },
		{ theme: "wet" },
	);
	// `queryByRole` returns null when absent; compare to null FIRST (a failing
	// `toBeNull()` on a happy-dom element serialises React's fiber graph and hangs).
	expect(screen.queryByRole("radiogroup") === null).toBe(true);
	expect(screen.getByRole("combobox", { name: "Theme" })).toBeTruthy();
});

test("picking a segment COMMITS the schema member, not its label", () => {
	// The numeric case, which is the whole reason the member travels beside the label.
	const { onCommit } = renderForm(
		{ rotation: { enum: [0, 90, 180, 270] } },
		{
			rotation: 0,
		},
	);
	fireEvent.click(screen.getByRole("radio", { name: "90" }));
	expect(onCommit).toHaveBeenCalledTimes(1);
	const committed = onCommit.mock.calls.at(-1)?.[0] as Record<string, unknown>;
	expect(committed["rotation"]).toBe(90);
	expect(typeof committed["rotation"]).toBe("number");
});

test("the segmented control is ONE tab stop with a roving tabindex (D-26)", () => {
	renderForm(
		{ pillars: { enum: ["none", "grid", "colonnade"] } },
		{ pillars: "grid" },
	);
	const radios = screen.getAllByRole("radio");
	// The checked member is the one Tab reaches; the others are reachable with arrows,
	// which is the ARIA radiogroup contract. Three tab stops for one choice is the
	// pattern the rail's roving tabindex already retired on this shell.
	expect(radios.map((r) => r.getAttribute("tabindex"))).toEqual([
		"-1",
		"0",
		"-1",
	]);
});

// --- focus follows selection, and the structure that lets it -----------------

// The arrow handler in `ui/segmented.tsx` moves focus by POSITION:
// `e.currentTarget.parentElement.children[next]`. That is the radiogroup convention (without
// it the roving tabindex moves out from under the focused button, and the next Tab leaves
// from somewhere the user cannot see), and it carries a structural precondition the type
// cannot state — each button must be a DIRECT child of the radiogroup.
//
// Undefended until the Task 12 review, which found the mechanism deletable with the whole
// suite still green. It is defended here because Task 12 is exactly what put it at risk: the
// View popover's members are now wrapped in `ActionTip`, and a wrapper element around any
// button would make `children[next]` index the wrong thing — silently, since nothing else
// reads it. Radix's `Slot` merges the tooltip trigger INTO the button today, so the DOM is
// still a flat row; the second case is what will notice if that ever stops being true.
//
// happy-dom PROVES this one rather than approximating it: the component calls `.focus()`
// explicitly, and happy-dom implements `HTMLElement.focus()` by moving
// `document.activeElement`. (What it does NOT do is move focus on click — no assertion here
// depends on that.)

/** Assert `el` has focus, LABEL first.
 *
 *  Identity is the claim, but `expect(activeElement).toBe(el)` serialises both DOM nodes on
 *  failure — and `document.activeElement` defaults to `<body>`, so a red run prints the
 *  whole tree plus happy-dom's window (measured: 2.1 s and a screen of noise, against
 *  0.4 s). Same family as this suite's `=== null` rule. The label assertion fails first and
 *  says which member has focus in one word; the boolean then pins identity without printing
 *  anything. */
function expectFocused(el: HTMLElement, label: string): void {
	expect(document.activeElement?.textContent).toBe(label);
	expect(document.activeElement === el).toBe(true);
}

test("ArrowRight moves FOCUS to the newly selected member, not just the selection", () => {
	renderForm(
		{ pillars: { enum: ["none", "grid", "colonnade"] } },
		{ pillars: "grid" },
	);
	const radios = screen.getAllByRole("radio");
	const [first, second, third] = radios;
	if (!(first && second && third)) throw new Error("expected three members");

	// From the selected member (index 1). Arrowing does not commit and the `value` prop does
	// not move, so this asserts the FOCUS half on its own — which is the half with no other
	// witness.
	fireEvent.keyDown(second, { key: "ArrowRight" });
	expectFocused(third, "colonnade");

	// …and it wraps, the radiogroup convention: ArrowRight off the end lands on the first.
	fireEvent.keyDown(third, { key: "ArrowRight" });
	expectFocused(first, "none");

	// ArrowLeft is the same handler's other branch; wrapping backwards off index 0.
	fireEvent.keyDown(first, { key: "ArrowLeft" });
	expectFocused(third, "colonnade");
});

test("a member wrapped in ActionTip is still a DIRECT child of the radiogroup", () => {
	// The View popover's shape (D-25 hints), rendered through the real `Segmented` rather
	// than through a schema — `SegmentedField` never supplies hints, so this arrangement has
	// no other test that would see it.
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onChange = mock((_v: string) => {});
	render(
		<TooltipProvider>
			<Segmented
				label="Shading"
				value="studio"
				options={[
					{ value: "studio", label: "Studio", hint: "lit from the camera" },
					{ value: "normals", label: "Normals", hint: "surface direction" },
				]}
				onChange={onChange}
			/>
		</TooltipProvider>,
	);
	const group = screen.getByRole("radiogroup", { name: "Shading" });
	const radios = screen.getAllByRole("radio");
	const [studio, normals] = radios;
	if (!(studio && normals)) throw new Error("expected two members");

	// The precondition, stated directly: Slot merged the trigger into the button, so the
	// group's children ARE the radios. A wrapper node here is what would break the arrow
	// handler's positional lookup while leaving every other assertion in this file green.
	expect(studio.parentElement === group).toBe(true);
	expect(Array.from(group.children).map((c) => c.textContent)).toEqual([
		"Studio",
		"Normals",
	]);

	// …and the consequence, so the precondition is not asserted for its own sake.
	fireEvent.keyDown(studio, { key: "ArrowRight" });
	expectFocused(normals, "Normals");
});

test("a value naming no member checks NOTHING rather than the first member", () => {
	// The stale-param case: a schema that dropped `arcade` must not silently read as
	// `none`. `null` down to the widget is what makes the whole group uncheck.
	render(
		<SchemaForm
			schema={{
				type: "object",
				properties: { pillars: { enum: ["none", "grid", "colonnade"] } },
			}}
			value={{ pillars: "arcade" }}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onPreview={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onCommit={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onCancel={() => {}}
		/>,
	);
	expect(
		screen.getAllByRole("radio").map((r) => r.getAttribute("aria-checked")),
	).toEqual(["false", "false", "false"]);
});
