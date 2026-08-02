// Registered FIRST — the shell.test.tsx rule (Radix resolves `globalThis.document` at
// module-evaluation time; the enum row's Select never mounts if the DOM was not there yet).
import "../inspector/_register.ts";

// ONE LABEL-COLUMN WIDTH TOKEN (F4.5 holistic gate, ruling 2).
//
// The defect: `ROW_CLASS` sized every caption to its own text, so the value column started
// at a different x on every row of one form — "Width" put its slider 33 px in and "Door
// South Offset" put its slider 103 px in. The fix is one named token, `--spacing-label-col`,
// and a caption box that is exactly that wide on every row.
//
// WHAT THIS FILE PINS IS THE RULE, NOT A CLASS STRING. Three properties, and each one is
// what a snapshot could not catch:
//
//   1. The token has ONE home. The utility name every caption spells is DERIVED from the
//      custom property found in `styles.css`, so renaming the token there without renaming
//      the classes reddens, and a second declaration of it reddens too.
//   2. Every row kind the registry can render is checked, and the kind list comes FROM the
//      registry — a new field kind cannot be added without landing in the covered set or
//      the documented exception list.
//   3. Class strings are compared as SETS of the sizing utilities, never by substring. A
//      caption that kept the width but gained a `flex-1`, or that spelled `w-label-col-2`,
//      breaks set equality where `toContain("w-label-col")` would happily pass.
//
// NO GEOMETRY IS ASSERTED and none can be: happy-dom runs no layout, so every box measures
// zero here. What the harness proves is the AUTHORED rule — that one width utility, bound to
// one custom property, sizes every caption. The px arithmetic behind the token's VALUE
// (Inter's advance widths against the 280 px session palette) is recorded at the definition
// in `styles.css`, not here.

import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SeedRow } from "../../src/frontend/components/shell/session-card/SeedRow.tsx";
import { SchemaForm } from "../../src/frontend/inspector/index.tsx";
import { resolveKind } from "../../src/frontend/inspector/kind.ts";
import { registry } from "../../src/frontend/inspector/registry.tsx";
import type {
	FieldKind,
	JsonSchemaNode,
} from "../../src/frontend/inspector/types.ts";
import { humanizeLabel } from "../../src/frontend/lib/humanize.ts";
import { cleanup, render, screen } from "../inspector/_harness.tsx";

afterEach(cleanup);

const STYLES = join(import.meta.dir, "../../src/frontend/styles.css");

/** The token's name, read out of `styles.css` — and the assertion that it has exactly one
 *  home. Everything else in this file is derived from what this finds, so the classes and
 *  the custom property cannot drift apart. */
function readToken(): { utility: string } {
	const css = readFileSync(STYLES, "utf8");
	const hits = [...css.matchAll(/--spacing-(label-col)\s*:\s*[^;]+;/g)];
	expect(hits.length).toBe(1);
	const hit = hits[0];
	if (hit === undefined) throw new Error("unreachable: length checked");
	// Tailwind 4 turns `--spacing-<name>` into the `w-<name>` utility — compiled against the
	// installed 4.3.3 to check, not assumed.
	return { utility: `w-${hit[1]}` };
}

const TOKEN = readToken();

/** Utilities that decide how wide a flex child is. The caption's set of these is the whole
 *  subject of this file: it must be the token's width and nothing else, on every row. */
const SIZING = /^(?:w-|min-w-|max-w-|basis-|flex-|grow|shrink|self-)/;

const sizingOf = (el: Element): string[] =>
	el.className
		.split(/\s+/)
		.filter((c) => c !== "" && SIZING.test(c))
		.sort();

/**
 * One schema per field kind the registry maps, chosen so `resolveKind` picks that kind.
 *
 * Two kinds are deliberately absent and are NOT rows in this sense:
 *   - `object` renders a nested GROUP (`ObjectField`), whose caption is a `<p>` heading over
 *     an indented block, not a column beside a value. Its children are ordinary rows and are
 *     covered by every other entry here.
 *   - `resource` / `ref` render read-only JSON (`DefaultField`), which prints the path over a
 *     `<pre>` — again no caption column.
 * The `EXCEPTIONS` set below is checked against the registry, so those three cannot quietly
 * grow a fourth.
 */
const KIND_SCHEMA: Partial<Record<FieldKind, JsonSchemaNode>> = {
	number: { type: "number" },
	slider: { type: "number", minimum: 0, maximum: 1 },
	stepper: { type: "integer", minimum: 0, maximum: 4 },
	string: { type: "string" },
	boolean: { type: "boolean" },
	enum: { enum: ["alpha", "beta", "gamma", "delta", "epsilon"] },
	segmented: { enum: ["one", "two"] },
	vec2: { furnace: { kind: "vec2" } },
	vec3: { furnace: { kind: "vec3" } },
	vec4: { furnace: { kind: "vec4" } },
	color: { furnace: { kind: "color" } },
	quat: { furnace: { kind: "quat" } },
};

const EXCEPTIONS: readonly FieldKind[] = ["object", "resource", "ref"];

/** A value each kind's renderer will accept without throwing. */
const KIND_VALUE: Partial<Record<FieldKind, unknown>> = {
	number: 1,
	slider: 0.5,
	stepper: 2,
	string: "x",
	boolean: true,
	enum: "alpha",
	segmented: "one",
	vec2: [0, 0],
	vec3: [0, 0, 0],
	vec4: [0, 0, 0, 0],
	color: [0, 0, 0, 1],
	quat: [0, 0, 0, 1],
};

// A path whose humanized label appears nowhere else on the row, so `getByText` cannot land
// on a control's own text.
const PATH = "labelProbe";
const LABEL = humanizeLabel(PATH);

/** Render one property of `kind` through the real `SchemaForm` (so the registry's own
 *  lookup picks the renderer) and hand back its caption `<span>`. */
function renderCaption(kind: FieldKind): HTMLElement {
	const schema = KIND_SCHEMA[kind];
	if (schema === undefined) throw new Error(`no fixture for kind ${kind}`);
	// The fixture is bound to the resolver, not merely asserted to exist: a schema that
	// stopped resolving to `kind` would silently test a different renderer.
	expect(resolveKind(schema)).toBe(kind);
	render(
		<SchemaForm
			schema={{ type: "object", properties: { [PATH]: schema } }}
			values={[{ [PATH]: KIND_VALUE[kind] }]}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onPreview={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onCommit={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onCancel={() => {}}
		/>,
	);
	return screen.getByText(LABEL, { selector: "span" });
}

const ROW_KINDS = Object.keys(KIND_SCHEMA) as FieldKind[];

test("the covered kinds ARE the registry's kinds, minus the documented non-rows", () => {
	// The binding that stops this file from testing a stale subset: add a kind to the
	// registry and it must land in one list or the other, consciously.
	expect(new Set([...ROW_KINDS, ...EXCEPTIONS])).toEqual(
		new Set(Object.keys(registry) as FieldKind[]),
	);
});

test("every field row sizes its caption with the one label-column token", () => {
	for (const kind of ROW_KINDS) {
		const caption = renderCaption(kind);
		const sizing = sizingOf(caption);
		// The token's width, and no second opinion about how wide the caption is.
		expect({ kind, sizing }).toEqual({
			kind,
			sizing: [TOKEN.utility, "shrink-0"].sort(),
		});
		cleanup();
	}
});

test("…and the value column takes the whole remainder, so its left edge is the token", () => {
	// The other half of the same geometry, and NOT implied by the caption assertion: a fixed
	// caption only fixes the value column's left edge if the value side actually starts
	// where the caption ends. A value span that gained a `shrink-0`, or lost its `flex-1`,
	// would leave the two columns divided by whatever the controls happened to measure —
	// which is the defect again, one element to the right.
	//
	// This half was ALREADY TRUE when the token landed, so it is a guard rather than a
	// driver: it was green against the pre-token source and is recorded as such so nobody
	// reads it as evidence the change worked.
	for (const kind of ROW_KINDS) {
		const value = renderCaption(kind).nextElementSibling;
		if (value === null) throw new Error(`row for ${kind} has no value column`);
		expect({ kind, sizing: sizingOf(value) }).toEqual({
			kind,
			sizing: ["flex-1", "min-w-0"].sort(),
		});
		cleanup();
	}
});

test("a label wider than the column truncates and keeps its full text in a title", () => {
	for (const kind of ROW_KINDS) {
		const caption = renderCaption(kind);
		const classes = new Set(caption.className.split(/\s+/));
		// `truncate` is the ellipsis; without it a long label would spill across the value
		// column instead of ending in one.
		expect({ kind, truncate: classes.has("truncate") }).toEqual({
			kind,
			truncate: true,
		});
		// …and the full label stays reachable for a pointer, since the ellipsis is the only
		// thing a sighted user has left. (A screen reader is unaffected either way: the full
		// text is still the row's accessible name.)
		expect({ kind, title: caption.getAttribute("title") }).toEqual({
			kind,
			title: LABEL,
		});
		cleanup();
	}
});

test("a row does not distribute free space between its two columns", () => {
	// `justify-between` is the content-width spelling: it only does anything when the two
	// children leave slack, which is exactly the layout the token replaces. Leaving it on
	// the row would be an inert class that reads as though the geometry still depended on
	// the caption's length.
	const spread = /^justify-(?:between|around|evenly)$/;
	for (const kind of ROW_KINDS) {
		const row = renderCaption(kind).parentElement;
		if (row === null) throw new Error(`caption for ${kind} has no row`);
		const found = row.className.split(/\s+/).filter((c) => spread.test(c));
		expect({ kind, found }).toEqual({ kind, found: [] });
		cleanup();
	}
});

test("the session card's seed row adopts the same column", () => {
	// The row directly ABOVE the schema form in the same card, in the same 12 px gutter. It
	// carried a hand-written `w-[52px]`, so the caption its own comment said "lines up with
	// the ones below it" lined up with nothing.
	render(
		<SeedRow
			seed={7}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onSeed={() => {}}
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert
			onReroll={() => {}}
		/>,
	);
	const caption = screen.getByText("seed", { selector: "label" });
	expect(sizingOf(caption)).toEqual([TOKEN.utility, "shrink-0"].sort());
});
