// EnumField's first test, and the defect it exists to close.
//
// THE DEFECT: the field stringified every member for display (`schema.enum.map(String)`)
// and then committed the STRING back — `onCommit(values.map(() => v))` where `v` is the
// Radix item's string value. So a numeric enum round-tripped `90` as `"90"`, and every
// consumer that validates its params (every core generator does, setup-loud) refused it.
// That is why `rotation` carries a STRING enum in core today: the workaround was in the
// schema because the field could not be trusted with the member.
//
// The fix is a mapping, not a parse: the option's transport value is its INDEX, so the
// member travels beside its label and comes back by identity. Parsing the label instead
// (`Number(v)`) would work for numbers and silently lie for `"1"` vs `1`, and there is no
// third option that keeps ONE spelling.
//
// WHERE THE COMMIT IS PINNED, and where it is NOT. The cases below cover the mapping and
// this field's DISPLAY binding; the commit is driven end to end through `SegmentedField`
// instead (`segmented-field.test.tsx`, "picking a segment COMMITS the schema member"),
// which consumes this same `lib/enum-options.ts` and asserts `toBe(90)` plus
// `typeof === "number"` after a real click.
//
// That split is a division of labour, not a limitation, and the reason recorded here until
// F4.5c was FALSE. It claimed a Radix `Select` item "cannot be clicked under happy-dom" —
// 0 elements with `role="listbox"`, 0 with `role="option"`, keyboard and plain click both
// dead ends. Re-probed at F4.5c Task 0 against happy-dom 20.10.6 through this same harness:
// the portal mounts (1 listbox, 5 options), a plain `click` on the trigger opens it, and
// keyboard `Enter` opens it. The one form that genuinely fails is a bare `pointerDown` with
// no `{ button: 0, pointerType: "mouse" }`, which is what the original probe must have
// used. `shell.test.tsx` already drove the Radix DropdownMenu's portal while this comment
// said portals do not mount.
//
// So the residue is smaller than it was written to be: this file could drive its own
// commit if it wanted to, and does not, because `SegmentedField`'s case already drives the
// identical `lib/enum-options.ts` mapping end to end and a second copy would pin the same
// thing twice. What stays genuinely uncovered is narrow — rewriting `onValueChange` to
// commit the raw index string would pass everything here (deleting it outright is caught by
// typecheck and by the display case below).
//
// Harness import MUST be first (happy-dom globals before any DOM-touching module).

import { afterEach, expect, mock, test } from "bun:test";
import { EnumField } from "../../src/frontend/inspector/fields/EnumField.tsx";
import {
	enumOptions,
	memberAt,
} from "../../src/frontend/inspector/lib/enum-options.ts";
import { cleanup, render, screen } from "./_harness.tsx";

afterEach(cleanup);

// --- the mapping (pure) ------------------------------------------------------

test("enumOptions carries the MEMBER beside its label", () => {
	expect(enumOptions({ enum: [0, 90, 180, 270] })).toEqual([
		{ value: "0", label: "0", member: 0 },
		{ value: "1", label: "90", member: 90 },
		{ value: "2", label: "180", member: 180 },
		{ value: "3", label: "270", member: 270 },
	]);
});

test('memberAt returns the NUMBER 90, not the string "90"', () => {
	const options = enumOptions({ enum: [0, 90] });
	const picked = memberAt(options, "1");
	expect(picked).toBe(90);
	// The discriminating half: `toBe(90)` passes for `"90"` under `==` but not `===`, and
	// bun's `toBe` is `Object.is` — so this second assertion is what a string would fail
	// most legibly.
	expect(typeof picked).toBe("number");
});

test("the transport value is the INDEX, so duplicate LABELS stay distinguishable", () => {
	// `String(1) === String("1")`, so a label-keyed mapping collapses these two members
	// into one option and picks whichever it finds first.
	const options = enumOptions({ enum: [1, "1"] });
	expect(options.map((o) => o.value)).toEqual(["0", "1"]);
	expect(memberAt(options, "0")).toBe(1);
	expect(memberAt(options, "1")).toBe("1");
});

test("the current member resolves to its option value by IDENTITY", () => {
	const options = enumOptions({ enum: [0, 90, 180] });
	// What the trigger binds to. A field that bound `String(values[0])` would show the
	// placeholder for every numeric enum, because no option's value is "90".
	expect(options.find((o) => o.member === 90)?.value).toBe("1");
});

test("memberAt on an unknown value returns undefined rather than guessing", () => {
	expect(memberAt(enumOptions({ enum: ["a"] }), "9")).toBe(undefined);
});

// --- the rendered field ------------------------------------------------------

/** Render a single-target EnumField and return the commit spy. */
function renderEnum(schema: { enum: unknown[] }, value: unknown) {
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onCommit = mock((_next: unknown[]) => {});
	render(
		<EnumField
			schema={schema}
			values={[value]}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onPreview={() => {}}
			onCommit={onCommit}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onCancel={() => {}}
			path="rotation"
		/>,
	);
	return { onCommit };
}

test("a numeric enum's trigger shows the member's LABEL, not the placeholder", () => {
	// Five members so `resolveKind` would send this to the Select rather than the
	// segmented control — the case EnumField still owns after D-25.
	renderEnum({ enum: [0, 45, 90, 180, 270] }, 90);
	const trigger = screen.getByRole("combobox", { name: "Rotation" });
	// The pre-fix field bound `String(values[0] ?? "")` against options whose values were
	// also stringified, so this one happened to work — the break was on the way OUT. The
	// assertion is here anyway because the index mapping is a NEW way to get it wrong.
	expect(trigger.textContent).toContain("90");
});

test("a mixed selection shows the mixed placeholder rather than a member", () => {
	renderEnum({ enum: [0, 90] }, 0);
	cleanup();
	// biome-ignore lint/suspicious/noEmptyBlockStatements: mock records calls; impl is a no-op
	const onCommit = mock((_next: unknown[]) => {});
	render(
		<EnumField
			schema={{ enum: [0, 90] }}
			values={[0, 90]}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onPreview={() => {}}
			onCommit={onCommit}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onCancel={() => {}}
			path="rotation"
		/>,
	);
	expect(
		screen.getByRole("combobox", { name: "Rotation" }).textContent,
	).toContain("—");
});
