// Registered FIRST — the shell.test.tsx rule. A BARE side-effect import, which is the only
// spelling that survives: Biome's `organizeImports` sorts `./_harness.tsx` below
// `../../src/…`, so "put the harness import first" reverts on the next `bun run check`,
// while a side-effect import keeps its position. See the module-order note below for what
// it buys and what it cost to find.
import "./_register.ts";

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
// That split is a division of labour, not a limitation, and the reason recorded here has
// now been wrong TWICE. Both wrong versions reported the SYMPTOM correctly and named the
// wrong cause, so the symptom is worth stating once: the trigger reports
// `aria-expanded="true"` while 0 elements carry `role="listbox"` and 0 carry `role="option"`.
//
// The original blamed happy-dom — a Radix `Select` item "cannot be clicked" because
// `SelectContent` positions itself from measurements happy-dom does not do. F4.5c's first
// correction kept the symptom and blamed the EVENT FORM instead: a bare `pointerDown` with
// no `{ button: 0, pointerType: "mouse" }`. That one is disprovable from the symptom alone —
// a bare `pointerDown` leaves `aria-expanded="false"`, so it cannot be what produced a
// report of `true` with zero options.
//
// The real variable is MODULE-EVALUATION ORDER, and the fix is line 6. Measured at F4.5c
// Task 12 against this file, changing only where registration happens:
//
//   without line 6 (as this file stood):  expanded=true, listbox=0, option=0
//   with line 6 (as it stands now):       expanded=true, listbox=1, option=5, and a click
//                                         on the "270" item commits [[270]]
//
// A plain `click` and keyboard `Enter` behave identically to `pointerDown` in BOTH
// directions; a bare `pointerDown` fails to open the trigger in both, which is a real fact
// and a much smaller one. The mechanism is a feature detection captured at load:
// `@radix-ui/react-use-layout-effect` binds `globalThis?.document ? useLayoutEffect : noop`
// ONCE in its module body, and `@radix-ui/react-portal` mounts via
// `useLayoutEffect(() => setMounted(true), [])`. Reach Radix before `_register.ts` installs
// happy-dom's globals and that hook is inert for the rest of the PROCESS: `mounted` never
// turns true, and the portal renders `null` under a trigger that opened perfectly well.
//
// Process-wide rather than per-file, which is why it hid for two rounds: bun evaluates a
// module once per RUN, so a chrome file — 13 of the 16 carry line 6 — used
// to repair this one by loading first, and the same case passed in `bun test
// packages/editor` and failed run on its own. `shell.test.tsx` driving the Radix
// DropdownMenu's portal was never in tension with any of it; it registers first.
//
// So this file CAN now drive its own commit, in any run, and does not — because
// `SegmentedField`'s case already drives the identical `lib/enum-options.ts` mapping end to
// end and a second copy would pin the same thing twice. What stays genuinely uncovered is
// narrow: rewriting `onValueChange` to commit the raw index string would pass everything
// here (deleting it outright is caught by typecheck and by the display case below).

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
