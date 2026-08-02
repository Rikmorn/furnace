// Registered FIRST — the shell.test.tsx rule (Radix resolves `globalThis.document` at
// module-evaluation time; the enum row's Select never mounts if the DOM was not there yet).
import "../inspector/_register.ts";

// ONE LABEL-COLUMN WIDTH TOKEN (F4.5 holistic gate, ruling 2).
//
// The defect it replaces, the px derivation behind `5rem`, and the list of surfaces that
// deliberately do NOT adopt all live at the definition, in `styles.css`. This file does not
// re-tell any of them — one paragraph in two places is one paragraph that will disagree with
// itself. What lives HERE is only what a test can hold.
//
// FOUR PROPERTIES, and each is something a snapshot could not catch:
//
//   1. The token is declared exactly ONCE, and inside a `@theme` AT-RULE. The second half is
//      the one a name check cannot see and the one that decides whether the utility exists
//      at all — see `scanToken` below for what moving the line to `:root` actually does.
//   2. Every row kind the registry can render is checked, and the kind list comes FROM the
//      registry. The documented non-rows are not an escape hatch: each one is RENDERED and
//      must carry no label column anywhere in its tree, and the row tests carry a floor on
//      how many rows remain — so moving a name from one side to the other reddens.
//   3. Class strings are compared as SETS of the sizing utilities, never by substring, with
//      variant prefixes stripped and the inline `style` attribute checked too. A caption
//      that kept the width but gained a `flex-1`, spelled `w-label-col-2`, added a
//      `md:w-40`, or sized itself with `style={{ width: 52 }}`, all break it.
//   4. The width is bound to the ARITHMETIC it was derived from — the last test — so
//      widening a control or narrowing the palette reddens instead of silently over-running.
//
// NO GEOMETRY IS ASSERTED and none can be. happy-dom runs no layout: every box measures
// zero, `getComputedStyle` reports the authored string, and no text is ever shaped. So this
// file proves the AUTHORED rule and the arithmetic behind the number, and it can prove
// nothing about a pixel. That limit is why the derivation cites the font file directly.

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
import { PALETTES } from "../../src/frontend/lib/palette-store.ts";
import { cleanup, render, screen } from "../inspector/_harness.tsx";

afterEach(cleanup);

// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
const noop = () => {};

const EDITOR = join(import.meta.dir, "..", "..");
const read = (rel: string): string => readFileSync(join(EDITOR, rel), "utf8");

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── 1. the token's home ───────────────────────────────────────────────────────────────

/** The one spelling of the token's name in this file. Everything below is built from it. */
const TOKEN_NAME = "label-col";

/** Tailwind 4 turns a `--spacing-<name>` into `w-<name>` (and `min-w-`/`basis-`/`pl-`),
 *  checked by compiling both candidate namespaces against the installed 4.3.0 rather than
 *  assumed. This is a HARDCODE, not a derivation — see `scanToken`. */
const TOKEN_UTILITY = `w-${TOKEN_NAME}`;

const DECLARATION = new RegExp(`--spacing-${TOKEN_NAME}\\s*:\\s*([^;]+);`, "g");

/** A `@theme` at-rule and its body — `@theme` and `@theme inline` alike, both of which emit
 *  utilities. Run over COMMENT-STRIPPED css, which is load-bearing twice over: `styles.css`
 *  discusses `@theme` in prose right above each real block, so an at-rule matcher on the raw
 *  text can pair a comment's mention with somebody else's brace; and the token itself is
 *  named in that prose, so a raw declaration count reads its own DOCUMENTATION as a second
 *  home. */
const THEME_BODY = /@theme[^{]*\{([^}]*)\}/g;

const stripCssComments = (css: string): string =>
	css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * How many times the token is declared, and how many of those are inside a `@theme`
 * at-rule.
 *
 * THE AT-RULE IS THE HALF THAT MATTERS AND IT IS INVISIBLE TO A NAME CHECK. Tailwind emits
 * `w-label-col` from a `--spacing-*` declared in `@theme`; the byte-identical line in the
 * `:root` block ~120 lines above — where ~40 sibling custom properties already live, and
 * where anyone thinking "this is a design token" would naturally put it — emits NOTHING.
 * Proven against the real build rather than reasoned: with the declaration moved to `:root`,
 * `bun run build:frontend` emits a stylesheet containing zero occurrences of `w-label-col`,
 * so every caption falls back to `width: auto` and the whole defect returns. The first
 * version of this scan searched the file as raw text and stayed green through exactly that.
 *
 * NOT "DERIVED", which an earlier version of this header claimed. `DECLARATION` matches a
 * LITERAL name, so `TOKEN_UTILITY` is `w-label-col` spelled the long way round: a consistent
 * rename across css and components does not survive this, it reddens with `declarations: 0`
 * — a message that says "the token has no home", not "you renamed it". What the pair really
 * buys is TWO INDEPENDENT HARDCODES THAT MUST AGREE, the css's and the components', which is
 * worth having and is a smaller claim than derivation.
 */
function scanToken(): { declarations: number; inTheme: number } {
	const css = stripCssComments(read("src/frontend/styles.css"));
	const inTheme = [...css.matchAll(THEME_BODY)].flatMap((m) => [
		...(m[1] ?? "").matchAll(DECLARATION),
	]);
	return {
		declarations: [...css.matchAll(DECLARATION)].length,
		inTheme: inTheme.length,
	};
}

test("the label-column token has one home, and that home is a @theme at-rule", () => {
	expect(scanToken()).toEqual({ declarations: 1, inTheme: 1 });
});

// ── 2. the fixtures, and the two lists they split into ────────────────────────────────

/** Everything one field kind needs to be rendered through the real form: the schema that
 *  makes `resolveKind` pick it, a value its renderer accepts, and whether it is a
 *  CAPTION→VALUE ROW at all. */
type Fixture = { schema: JsonSchemaNode; value: unknown; row: boolean };

/**
 * One fixture per kind the registry maps.
 *
 * ONE MAP, where this started as two (`KIND_SCHEMA` and `KIND_VALUE`, keyed identically and
 * read together). The pair could drift in the direction that stays GREEN: the schema lookup
 * threw on a miss, the value lookup returned a silent `undefined`, so a kind added to one
 * and not the other rendered a degenerate row with every assertion still passing.
 *
 * `row: false` IS NOT A WAY OUT, and it needs saying because flipping a flag is a one-line
 * edit. Each non-row is rendered by the last coverage test below and must carry no label
 * column anywhere in its tree, so flipping a real row to `false` reddens there; and each row
 * test asserts a FLOOR on how many rows are left, so emptying the row side reddens too. Both
 * directions were sabotaged, together with a full revert of the source change, before this
 * comment was written.
 *
 * WHY THE THREE ARE NON-ROWS:
 *   - `object` renders a nested GROUP (`ObjectField`) — a `<p>` heading over an indented
 *     block, not a column beside a value. Its CHILDREN are ordinary rows and are covered by
 *     every other entry here, which is why its fixture declares no properties.
 *   - `resource` / `ref` render read-only JSON (`DefaultField`): the path over a `<pre>`,
 *     again with no caption column.
 */
const FIXTURES: Partial<Record<FieldKind, Fixture>> = {
	number: { schema: { type: "number" }, value: 1, row: true },
	slider: {
		schema: { type: "number", minimum: 0, maximum: 1 },
		value: 0.5,
		row: true,
	},
	stepper: {
		schema: { type: "integer", minimum: 0, maximum: 4 },
		value: 2,
		row: true,
	},
	string: { schema: { type: "string" }, value: "x", row: true },
	boolean: { schema: { type: "boolean" }, value: true, row: true },
	enum: {
		schema: { enum: ["alpha", "beta", "gamma", "delta", "epsilon"] },
		value: "alpha",
		row: true,
	},
	segmented: { schema: { enum: ["one", "two"] }, value: "one", row: true },
	vec2: { schema: { furnace: { kind: "vec2" } }, value: [0, 0], row: true },
	vec3: { schema: { furnace: { kind: "vec3" } }, value: [0, 0, 0], row: true },
	vec4: {
		schema: { furnace: { kind: "vec4" } },
		value: [0, 0, 0, 0],
		row: true,
	},
	color: {
		schema: { furnace: { kind: "color" } },
		value: [0, 0, 0, 1],
		row: true,
	},
	quat: {
		schema: { furnace: { kind: "quat" } },
		value: [0, 0, 0, 1],
		row: true,
	},
	object: { schema: { type: "object", properties: {} }, value: {}, row: false },
	resource: {
		schema: { furnace: { kind: "resource" } },
		value: "materials/rock",
		row: false,
	},
	ref: { schema: { furnace: { kind: "ref" } }, value: "entity:3", row: false },
};

const kindsWhere = (row: boolean): FieldKind[] =>
	(Object.keys(FIXTURES) as FieldKind[]).filter(
		(kind) => FIXTURES[kind]?.row === row,
	);

const ROW_KINDS = kindsWhere(true);
const NON_ROW_KINDS = kindsWhere(false);

/** Anti-vacuity floors, asserted INSIDE each test that iterates rather than once at load
 *  (the `register-first.test.ts` idiom). A `for` loop over an empty list is a green test
 *  that holds nothing, and shrinking the list is the cheapest way to make this file agree
 *  with any source at all. */
const MIN_ROW_KINDS = 12;
const MIN_NON_ROW_KINDS = 3;

// A path whose humanized label appears nowhere else on the row, so `getByText` cannot land
// on a control's own text.
const PATH = "labelProbe";
const LABEL = humanizeLabel(PATH);

/** Render one property of `kind` through the real `SchemaForm`, so the registry's own lookup
 *  picks the renderer. */
function renderFixture(kind: FieldKind): ReturnType<typeof render> {
	const fixture = FIXTURES[kind];
	if (fixture === undefined) throw new Error(`no fixture for kind ${kind}`);
	// The fixture is bound to the resolver, not merely asserted to exist: a schema that
	// stopped resolving to `kind` would silently test a different renderer.
	expect(resolveKind(fixture.schema)).toBe(kind);
	return render(
		<SchemaForm
			schema={{ type: "object", properties: { [PATH]: fixture.schema } }}
			values={[{ [PATH]: fixture.value }]}
			onPreview={noop}
			onCommit={noop}
			onCancel={noop}
		/>,
	);
}

const renderCaption = (kind: FieldKind): HTMLElement => {
	renderFixture(kind);
	return screen.getByText(LABEL, { selector: "span" });
};

// ── 3. how a class set is compared ────────────────────────────────────────────────────

/** Utilities that decide how wide a flex child is. The caption's set of these is the whole
 *  subject of this file: it must be the token's width and nothing else, on every row. */
const SIZING = /^(?:w-|min-w-|max-w-|basis-|flex-|grow|shrink|self-|size-)/;

/** A class with its variant chain stripped — `md:w-40` → `w-40`, `hover:basis-1/2` →
 *  `basis-1/2`. A responsive or state override is a SECOND OPINION about the width in
 *  exactly the sense this file forbids, and without this it reads as an unrelated class. */
const base = (cls: string): string => cls.slice(cls.lastIndexOf(":") + 1);

const classesOf = (el: Element): string[] =>
	(el.getAttribute("class") ?? "").split(/\s+/).filter((c) => c !== "");

const sizingOf = (el: Element): string[] =>
	classesOf(el)
		.filter((c) => SIZING.test(base(c)))
		.sort();

const EXPECTED_CAPTION_SIZING = [TOKEN_UTILITY, "shrink-0"].sort();

// ── 4. the rule, on every row ─────────────────────────────────────────────────────────

test("the covered kinds ARE the registry's kinds, and each is a row or a documented non-row", () => {
	// The binding that stops this file from testing a stale subset: add a kind to the
	// registry and it must get a fixture here, on one side of `row` or the other.
	expect(new Set(Object.keys(FIXTURES))).toEqual(
		new Set(Object.keys(registry)),
	);
});

test("every field row sizes its caption with the one label-column token", () => {
	expect(ROW_KINDS.length).toBeGreaterThanOrEqual(MIN_ROW_KINDS);
	for (const kind of ROW_KINDS) {
		const caption = renderCaption(kind);
		// The token's width, no second opinion about how wide the caption is, and no inline
		// style — which is the one way to size a box that a class-set comparison is blind to.
		expect({
			kind,
			sizing: sizingOf(caption),
			inline: caption.getAttribute("style"),
		}).toEqual({ kind, sizing: EXPECTED_CAPTION_SIZING, inline: null });
		cleanup();
	}
});

test("the value column takes the whole remainder, so its left edge is the token", () => {
	// The other half of the same geometry, and NOT implied by the caption assertion: a fixed
	// caption only fixes the value column's left edge if the value side actually starts
	// where the caption ends. A value span that gained a `shrink-0`, or lost its `flex-1`,
	// would leave the two columns divided by whatever the controls happened to measure —
	// which is the defect again, one element to the right.
	//
	// This half was ALREADY TRUE when the token landed, so it is a guard rather than a
	// driver: it was green against the pre-token source and is recorded as such so nobody
	// reads it as evidence the change worked.
	expect(ROW_KINDS.length).toBeGreaterThanOrEqual(MIN_ROW_KINDS);
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

test("every caption carries `truncate` and a `title` holding its full label", () => {
	// NOT "a long label truncates" — nothing here is long, and happy-dom could not tell if it
	// were. `Label Probe` measures 67.87 px against an 80 px column. What this holds is that
	// the two things a clipped label needs are present on every row: the ellipsis, and the
	// full text somewhere a pointer can reach. Whether they FIRE is a browser question.
	expect(ROW_KINDS.length).toBeGreaterThanOrEqual(MIN_ROW_KINDS);
	for (const kind of ROW_KINDS) {
		const caption = renderCaption(kind);
		expect({
			kind,
			truncate: classesOf(caption).includes("truncate"),
			title: caption.getAttribute("title"),
		}).toEqual({ kind, truncate: true, title: LABEL });
		cleanup();
	}
});

test("a row does not distribute free space between its two columns", () => {
	// Why `justify-between`'s absence is the point rather than an omission is argued where
	// `ROW_CLASS` lives (`inspector/fields/common.tsx`). This is the check.
	const spread = /^justify-(?:between|around|evenly)$/;
	expect(ROW_KINDS.length).toBeGreaterThanOrEqual(MIN_ROW_KINDS);
	for (const kind of ROW_KINDS) {
		const row = renderCaption(kind).parentElement;
		if (row === null) throw new Error(`caption for ${kind} has no row`);
		const found = classesOf(row).filter((c) => spread.test(base(c)));
		expect({ kind, found }).toEqual({ kind, found: [] });
		cleanup();
	}
});

test("a documented non-row renders no label column anywhere in its tree", () => {
	// What turns `row: false` from an assertion-free hatch into a claim about the DOM. The
	// registry test above is INVARIANT under moving a name from one list to the other — the
	// union is unchanged either way — so without this, hollowing out the row set and
	// declaring every kind an exception is six green tests over three assertions.
	expect(NON_ROW_KINDS.length).toBeGreaterThanOrEqual(MIN_NON_ROW_KINDS);
	for (const kind of NON_ROW_KINDS) {
		const { container } = renderFixture(kind);
		const wearing = [...container.querySelectorAll("*")]
			.filter((el) => classesOf(el).includes(TOKEN_UTILITY))
			.map((el) => el.tagName.toLowerCase());
		expect({ kind, wearing }).toEqual({ kind, wearing: [] });
		cleanup();
	}
});

test("the session card's seed row adopts the same column", () => {
	// The row directly ABOVE the schema form in the same card, in the same 12 px gutter. What
	// it carried before, and why its own comment was wrong about it, is at `SeedRow.tsx`.
	render(<SeedRow seed={7} onSeed={noop} onReroll={noop} />);
	const caption = screen.getByText("seed", { selector: "label" });
	expect({
		sizing: sizingOf(caption),
		inline: caption.getAttribute("style"),
	}).toEqual({ sizing: EXPECTED_CAPTION_SIZING, inline: null });
});

// ── 5. the width's binding constraint ─────────────────────────────────────────────────
//
// The token's VALUE is deliberately NOT pinned: a number asserted against a copy of itself
// holds nothing, and 5rem → 4.5rem is a legitimate change this file should not fight. What
// IS pinned is the inequality the value was chosen to satisfy — caption + row gap + the
// WIDEST value cluster must fit inside the session palette's usable row. Widen `w-20` in
// `SliderField`, or narrow the palette to 260, and today the column silently over-runs the
// control it names with every assertion above still green, because none of them looks at a
// number. (5rem → 6rem DOES redden here, and that is the difference between constrained and
// pinned: 6rem genuinely does not fit.)
//
// Every input is READ from the file that owns it, and every reader THROWS rather than
// defaulting. A test that can pass by reading zero, by missing a key, or off a stale copy of
// the numbers kept here would be the exact disease the rest of this file is about.

/** Tailwind's spacing scale: one step is 4 px, so `w-20` is 80 and `gap-1` is 4. */
const SPACING_STEP_PX = 4;

/** `rem` → px at the browser default root size, which this chrome never changes. */
const REM_PX = 16;

/** Tailwind's bare `border`: 1 px, and the palette's width is border-box, so two of these
 *  come out of it. */
const PALETTE_BORDER_PX = 1;

/** The ONE input that is not read off a source constant, named as a measurement rather than
 *  smuggled into a total: the `text-2xs` unit chip a slider row prints after its value. Its
 *  width is the advance sum of `cells` — the widest unit core's generators declare — at the
 *  10 px `--text-2xs` gives it, measured from the shipped `fonts/inter-variable-latin.woff2`
 *  (21.665 px). Nothing in `bun test` can shape text, so this cannot be re-derived here. */
const UNIT_CHIP_PX = 21.665;

/** Comments out first, on every file this section reads, and it is not a nicety: `styles.css`
 *  DOCUMENTS this very arithmetic a few lines above the token, so an anchor run over the raw
 *  text finds the prose copy as a second match. (Discovered by sabotage, not by inspection —
 *  the first draft of this section skipped the strip and a one-sentence comment mentioning
 *  `--spacing-label-col: 5rem;` reddened the run.) Stripping can only ever REMOVE matches, so
 *  it degrades into a loud "found 0" and never into a silent wrong number. */
const stripJsComments = (src: string): string =>
	src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

type Source = { text: string; where: string };
const cssSource = (rel: string): Source => ({
	text: stripCssComments(read(rel)),
	where: rel,
});
const tsxSource = (rel: string): Source => ({
	text: stripJsComments(read(rel)),
	where: rel,
});

/** One number, out of one file, by an anchor that must match EXACTLY once. Both failure
 *  modes are loud and different: zero matches means the code moved out from under the
 *  anchor, two means the anchor stopped being specific. Neither can silently become 0. */
function readSteps(src: Source, anchor: RegExp, what: string): number {
	const hits = [...src.text.matchAll(anchor)];
	if (hits.length !== 1)
		throw new Error(
			`${what}: expected exactly 1 match in ${src.where}, found ${hits.length}`,
		);
	const steps = Number(hits[0]?.[1]);
	if (!Number.isFinite(steps) || steps <= 0)
		throw new Error(
			`${what}: read ${JSON.stringify(hits[0]?.[1])} from ${src.where}, not a positive number`,
		);
	return steps;
}

/** Presence of an anchor, for a fact that contributes a constant rather than a number — the
 *  palette's `border`. If it ever becomes `border-2` this needle vanishes and the reader
 *  throws, which is the right answer: the arithmetic no longer describes the box. */
function requireAnchor(src: Source, anchor: RegExp, what: string): void {
	const hits = [...src.text.matchAll(anchor)];
	if (hits.length !== 1)
		throw new Error(
			`${what}: expected exactly 1 match in ${src.where}, found ${hits.length}`,
		);
}

test("the label column still fits beside the widest value cluster it sits next to", () => {
	// THE ROW. A session palette is border-box at its declared width, less its two 1 px
	// borders and the card's `px-3` gutter either side.
	requireAnchor(
		tsxSource("src/frontend/components/shell/Palette.tsx"),
		/overflow-hidden border border-border bg-card/g,
		"the palette's 1 px border",
	);
	const gutter =
		SPACING_STEP_PX *
		readSteps(
			tsxSource("src/frontend/components/shell/SessionCard.tsx"),
			/className="px-(\d+) py-1">\s*<SchemaForm/g,
			"the card's form gutter",
		);
	const inner = PALETTES.session.width - 2 * PALETTE_BORDER_PX - 2 * gutter;

	// THE CAPTION. Read from the css, so this is the same number the browser spends.
	const caption =
		REM_PX *
		readSteps(
			cssSource("src/frontend/styles.css"),
			new RegExp(`--spacing-${TOKEN_NAME}\\s*:\\s*([\\d.]+)rem;`, "g"),
			"the label column",
		);

	// THE GAPS. One between the two columns (`ROW_CLASS`), and one inside the value cluster
	// (`FieldRow`'s value span), which a three-part slider row spends twice.
	const common = tsxSource("src/frontend/inspector/fields/common.tsx");
	const rowGap =
		SPACING_STEP_PX *
		readSteps(
			common,
			/const ROW_CLASS = "flex items-center gap-(\d+) py-0\.5";/g,
			"the row gap",
		);
	const clusterGap =
		SPACING_STEP_PX *
		readSteps(
			common,
			/<span className="flex min-w-0 flex-1 justify-end gap-(\d+)">/g,
			"the value-cluster gap",
		);

	// THE WIDEST CLUSTER: a slider row carrying a unit — range, exact input, unit chip.
	const slider = tsxSource("src/frontend/inspector/fields/SliderField.tsx");
	const range =
		SPACING_STEP_PX *
		readSteps(
			slider,
			/className="h-4 w-(\d+) shrink-0 accent-primary"/g,
			"the slider's range",
		);
	const exact =
		SPACING_STEP_PX *
		readSteps(slider, /className="w-(\d+)"/g, "the slider's exact input");

	const cluster = range + clusterGap + exact + clusterGap + UNIT_CHIP_PX;
	const spent = caption + rowGap + cluster;

	// The breadcrumb rides BOTH sides so it prints in the diff without being pinned: a
	// failure has to say which side moved and by how much, since the fix is a design choice
	// (narrow a control, widen the palette, shorten the column) and not a revert.
	const budget = `caption ${caption} + gap ${rowGap} + cluster ${round2(cluster)} = ${round2(spent)} of ${inner} px`;
	expect({ budget, fits: spent <= inner }).toEqual({ budget, fits: true });
});
