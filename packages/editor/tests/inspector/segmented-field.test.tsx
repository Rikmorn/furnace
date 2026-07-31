// The D-25 segmented control: an enum of at most four members renders as one visible row
// of choices rather than as a dropdown that hides three of them behind a click.
//
// The cardinality rule is a `resolveKind` decision, so the fallback half is asserted
// THROUGH `SchemaForm` — the registry's single lookup is what actually picks the renderer,
// and a test that rendered `SegmentedField` directly could not tell whether the registry
// would ever choose it. Both halves of the boundary are pinned (4 → segmented, 5 → Select)
// because a rule stated only on the accepting side cannot fail.
//
// Harness import MUST be first (happy-dom globals before any DOM-touching module).

import { afterEach, expect, mock, test } from "bun:test";
import { SchemaForm } from "../../src/frontend/inspector/index.tsx";
import type { JsonSchemaNode } from "../../src/frontend/inspector/types.ts";
import { cleanup, fireEvent, render, screen } from "./_harness.tsx";

afterEach(cleanup);

function renderForm(
	properties: Record<string, JsonSchemaNode>,
	value: unknown,
) {
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onCommit = mock((_next: unknown[]) => {});
	render(
		<SchemaForm
			schema={{ type: "object", properties }}
			values={[value]}
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
	const committed = onCommit.mock.calls.at(-1)?.[0] as Record<
		string,
		unknown
	>[];
	expect(committed[0]?.["rotation"]).toBe(90);
	expect(typeof committed[0]?.["rotation"]).toBe("number");
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

test("a mixed selection checks NOTHING rather than the first member", () => {
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onCommit = mock((_next: unknown[]) => {});
	render(
		<SchemaForm
			schema={{
				type: "object",
				properties: { pillars: { enum: ["none", "grid", "colonnade"] } },
			}}
			values={[{ pillars: "none" }, { pillars: "grid" }]}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onPreview={() => {}}
			onCommit={onCommit}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onCancel={() => {}}
		/>,
	);
	expect(
		screen.getAllByRole("radio").map((r) => r.getAttribute("aria-checked")),
	).toEqual(["false", "false", "false"]);
	// …and the mixed marker is visible, the same "—" every other field uses.
	expect(screen.getByText("—")).toBeTruthy();
});
