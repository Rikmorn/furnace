// Registered FIRST, before any other import in this file — the shell.test.tsx rule:
// Radix resolves `globalThis.document` at MODULE EVALUATION time to decide whether it
// may use layout effects, and its Portal never mounts if the answer was no. The rail's
// member flyout is a Radix Popover, so importing the rail before the DOM exists makes
// every flyout case here unreachable.
import "../inspector/_register.ts";

// The tool rail (F4.5b Task 8, D-8): the four tool FAMILIES as a fixed 44 px column
// beside the canvas cell — pointer, brush, cell-select, stamp. Four claims live here:
//
//   1. the armed family is the STRONGEST element in the rail (D-8's contrast fix —
//      the critique's inverted-hierarchy finding), not the faintest;
//   2. the rail is a fixed COLUMN, a sibling of the canvas cell, never a palette and
//      never something that can resize the canvas (D-1);
//   3. a click arms the family's CURRENT member and never cycles — cycling is ⇧+letter,
//      and the corner flyout is the mouse's way to a specific member (which is what
//      keeps deleting ToolPalette from orphaning Fill/Paint/Smooth/Wand/Room and every
//      generator past the first);
//   4. a live session locks the rail with the SAME refusal the family keys give, because
//      two surfaces disagreeing about whether a tool can be armed is the defect this
//      slice keeps closing.
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { Shell } from "../../src/frontend/components/shell/Shell.tsx";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import type {
	FieldGeneratorInfo,
	StampSession,
} from "../../src/viewport-host/index.ts";
import {
	act,
	cleanup,
	fireEvent,
	makeEditorContext,
	render,
	screen,
	within,
} from "../inspector/_harness.tsx";
import { makeStubHost } from "./_stub-host.ts";

afterEach(cleanup);
afterEach(() => notify.clear());

// --- environment (the shell.test.tsx harness, narrowed) ----------------------

const REAL_RECT = HTMLCanvasElement.prototype.getBoundingClientRect;
const SIZED = { x: 0, y: 0, width: 1280, height: 720 };

beforeEach(() => {
	HTMLCanvasElement.prototype.getBoundingClientRect = () =>
		({
			...SIZED,
			top: 0,
			left: 0,
			right: SIZED.width,
			bottom: SIZED.height,
			toJSON: () => SIZED,
		}) as DOMRect;
});

const realFetch = globalThis.fetch;
afterEach(() => {
	HTMLCanvasElement.prototype.getBoundingClientRect = REAL_RECT;
	globalThis.fetch = realFetch;
});

function fetch404(): void {
	// Boundary cast: the stub serves only the catalog GETs, so it implements the call
	// signature and none of `fetch`'s statics (preconnect).
	globalThis.fetch = (() =>
		Promise.resolve(
			new Response("", { status: 404 }),
		)) as unknown as typeof fetch;
}

const withEditor = (
	ui: ReactElement,
	stub: ReturnType<typeof makeStubHost>,
): ReactElement => (
	<EditorContext.Provider
		value={makeEditorContext({ fieldHostRef: { current: stub.host } })}
	>
		{ui}
	</EditorContext.Provider>
);

/** Two microtask turns: the catalog path awaits fetch() then res.text(). */
const flushCatalog = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});

async function renderShell(stub: ReturnType<typeof makeStubHost>) {
	const result = render(withEditor(<Shell />, stub));
	await flushCatalog();
	return result;
}

const HALL: FieldGeneratorInfo = {
	id: "hall",
	name: "Hall",
	paramSchema: { type: "object", properties: {} },
	defaults: {},
	placesProps: false,
};

const MAZE: FieldGeneratorInfo = {
	id: "maze",
	name: "Maze",
	paramSchema: { type: "object", properties: {} },
	defaults: {},
	placesProps: false,
};

function makeSession(overrides: Partial<StampSession> = {}): StampSession {
	return {
		generator: "hall",
		params: {},
		seed: 7,
		policy: "replace",
		region: { min: [0, 0, 0], max: [4, 4, 4] },
		phase: "configuring",
		run: 0,
		opCount: null,
		placementCount: null,
		error: null,
		truncatedSelection: false,
		mode: "stamp",
		entityId: null,
		...overrides,
	};
}

/** The rail itself, resolved by its landmark role rather than by a class — the claim
 *  is that the rail IS a navigation region a keyboard user can reach, not that some
 *  div happens to carry the right utilities. */
const rail = (): HTMLElement =>
	screen.getByRole("navigation", { name: "tools" });

const railButton = (name: string): HTMLButtonElement =>
	within(rail()).getByRole("button", { name }) as HTMLButtonElement;

// --- (a) four families, and the armed one is the strongest -------------------

test("the rail carries the four tool families, and the ARMED one is the strongest element", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);

	// The four family buttons, named from the registry entries they dispatch — so a
	// label reworded in `actions.ts` moves here for nothing, and the rail cannot name a
	// verb the keyboard spells differently.
	for (const name of ["Select", "Brush", "Cell select", "Stamp Hall"])
		expect(railButton(name)).toBeTruthy();

	// D-8's contrast fix, stated as the class it is: the pressed family carries the
	// INVERTED fill (bg-primary + its foreground), which is the strongest treatment in
	// the rail. The critique's finding was the opposite — the armed tool read FAINTER
	// than its neighbours — so this is the assertion that would have caught it.
	const armed = railButton("Select");
	expect(armed.getAttribute("aria-pressed")).toBe("true");
	for (const cls of ["bg-primary", "text-primary-foreground"])
		expect(armed.classList.contains(cls)).toBe(true);

	// …and the three that are not armed carry neither. Quantified, so a future family
	// cannot ship pressed-looking by default.
	for (const name of ["Brush", "Cell select", "Stamp Hall"]) {
		const idle = railButton(name);
		expect([name, idle.getAttribute("aria-pressed")]).toEqual([name, "false"]);
		expect([name, idle.classList.contains("bg-primary")]).toEqual([
			name,
			false,
		]);
	}

	// The mirror is an INITIAL VALUE, not a push: the host initialises its armed slot to
	// `pointer` (D-F4.5-7) and the chrome initialises its mirror to the same value across
	// a fence that forbids them sharing the constant (the chrome cannot value-import
	// anything under `viewport-host/`). Nothing else would catch them diverging — the rail
	// would simply show Select pressed while LMB dug, with no call, no throw and no
	// warning. (Relocated with its subject from tests/chrome/field-panel.test.tsx.)
	expect(stub.calls.setGesture).not.toHaveBeenCalled();
});

// --- (b) a fixed column, not a palette, taking nothing off the canvas --------

test("the rail is a FIXED column beside the canvas cell — it never resizes the canvas", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);

	const column = rail();
	// 44 px (w-11) and shrink-0: the same treatment the two bars get, which is what
	// makes the canvas cell's inset budget a CONSTANT (D-1/D-2). A rail that could grow
	// with its content would move the canvas edge every time a family was added.
	for (const cls of ["w-11", "shrink-0"])
		expect(column.classList.contains(cls)).toBe(true);

	const canvas = screen.getByLabelText("field viewport");
	// The canvas is NOT inside the rail, and the rail is not inside the canvas cell:
	// they are SIBLINGS in one row. An overlay that reflowed the canvas div would put
	// one inside the other, which is the banned zero-size-canvas class coming back.
	expect(column.contains(canvas)).toBe(false);
	const cell = canvas.parentElement;
	if (!(cell instanceof HTMLElement)) throw new Error("canvas has no cell");
	expect(cell.contains(column)).toBe(false);
	expect(column.parentElement).toBe(cell.parentElement);
	// The cell keeps the classes the layout contract rests on.
	for (const cls of ["relative", "flex-1", "min-h-0"])
		expect(cell.classList.contains(cls)).toBe(true);
	// The row itself is a flex row that takes what the bars leave.
	const row = column.parentElement;
	if (!(row instanceof HTMLElement)) throw new Error("the rail has no row");
	for (const cls of ["flex", "min-h-0", "flex-1"])
		expect(row.classList.contains(cls)).toBe(true);
});

// --- (c) a click ARMS the current member; it never cycles --------------------

test("clicking an armed family re-arms its CURRENT member — clicking never cycles", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);

	// Enter the brush family: the first member (Dig).
	fireEvent.click(railButton("Brush"));
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		effect: "dig",
	});

	// Step to Fill with the ⇧ chord — the cycle's own affordance.
	act(() => {
		fireEvent.keyDown(window, { key: "B", shiftKey: true });
	});
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		effect: "fill",
	});

	// Now click the family button again. A rail that cycled on click would arm PAINT
	// here; the rail is a mode selector, so pressing the mode you are already in is
	// idempotent.
	fireEvent.click(railButton("Brush"));
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		effect: "fill",
	});
});

// The brush family is a RING, and Segment is the member that could trap it. `armedIndex`
// resolves by GESTURE before EFFECT, and `brushArming` deliberately keeps a live segment
// when an effect is picked — so a member pick that did not clear the gesture would arm dig,
// still read as "segment armed", and arm dig again on the next step, forever. Found by
// running the family round rather than by reading it: every individual rule is correct.
test("the brush family is a RING — the cycle can leave Segment", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	fireEvent.click(railButton("Brush"));

	// Five ⇧B steps from Dig: fill, paint, smooth, segment, and back to dig.
	const armed: (string | null)[] = [];
	for (let i = 0; i < 5; i++) {
		act(() => {
			fireEvent.keyDown(window, { key: "B", shiftKey: true });
		});
		armed.push(
			(stub.calls.setGesture.mock.calls.at(-1)?.[0] as string | undefined) ??
				null,
		);
	}
	// The fifth step is the one that used to be impossible: it must hand LMB back to the
	// stroke (gesture null), not leave it on the segment it just stepped off.
	expect(armed.at(-2)).toBe("segment");
	expect(armed.at(-1)).toBeNull();
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		effect: "dig",
	});
});

// --- (d) the corner tick is a real member flyout -----------------------------

test("a multi-member family opens its members from the corner; a single-member one has no corner", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);

	// Pointer is a family of ONE, so a corner that promised more members would promise
	// nothing — and ⇧V would be a key that does nothing either.
	expect(
		within(rail()).queryByRole("button", { name: "Select tools" }) === null,
	).toBe(true);

	// The brush family has five. Its corner opens them, each named, and a click arms
	// that member directly — the mouse's route to Paint now that ToolPalette is gone.
	fireEvent.click(railButton("Brush tools"));
	const menu = await screen.findByRole("group", { name: "Brush tools" });
	expect(
		within(menu)
			.getAllByRole("button")
			.map((b) => b.textContent),
	).toEqual(["Dig", "Fill", "Paint", "Smooth", "Segment"]);
	fireEvent.click(within(menu).getByRole("button", { name: "Paint" }));
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		effect: "paint",
	});
});

test("the stamp family's members ARE the registry generators", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL, MAZE] });
	await renderShell(stub);

	fireEvent.click(railButton("Stamp tools"));
	const menu = await screen.findByRole("group", { name: "Stamp tools" });
	expect(
		within(menu)
			.getAllByRole("button")
			.map((b) => b.textContent),
	).toEqual(["Hall", "Maze"]);
	// The SECOND one: without the flyout a mouse-only user could only ever reach the
	// generator the `S` cursor happened to point at.
	fireEvent.click(within(menu).getByRole("button", { name: "Maze" }));
	expect(stub.calls.startStamp.mock.calls.at(-1)).toEqual(["maze"]);
});

// --- (e) D-25: a REAL tooltip, keyboard-reachable, from the registry ---------

test("a rail button's docs are a real tooltip a keyboard reaches — not a `title`", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	const brush = railButton("Brush");

	// `title` is what this replaces (D-25). A `title` is mouse-only, cannot be styled, is
	// swallowed by a disabled control, and on many screen readers is not announced at all
	// — so its absence is half the claim.
	expect(brush.getAttribute("title")).toBeNull();

	// FOCUS, not hover: the point of the Radix tooltip is that the keyboard gets the same
	// documentation the mouse does, and focus is how a keyboard asks for it.
	act(() => {
		fireEvent.focus(brush);
	});
	// The copy comes off the registry entry — label, keycap, hint — so a reworded action
	// moves the tooltip with it and neither can be reworded alone.
	const tip = await screen.findByRole("tooltip");
	expect(within(tip).getByText("Brush")).toBeTruthy();
	expect(within(tip).getByText("B")).toBeTruthy();
	expect(within(tip).getByText(/Arm the brush family/)).toBeTruthy();
});

// --- (f) a live session locks the rail, the way the keys are locked ----------

test("a live session locks every rail family with the refusal the family KEYS give", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(makeSession());
	});

	// All four, quantified. The registry already refuses V/B/M/S while a session stands
	// (`armsTool`), so a rail button that still armed would be the two-surfaces-disagree
	// defect — and it would silently replace the session the user is configuring.
	//
	// The reason rides the accessible NAME (the EntitiesList row-verb convention): a
	// disabled button swallows pointer events, so a tooltip on it never fires and a
	// keyboard user would get nothing at all.
	for (const [name, prefix] of [
		["Select", /^Select \(/],
		["Brush", /^Brush \(/],
		["Cell select", /^Cell select \(/],
		["Stamp", /^Stamp Hall \(/],
	] as const) {
		const disabled = within(rail()).getByRole("button", {
			name: prefix,
		}) as HTMLButtonElement;
		expect([name, disabled.disabled]).toEqual([name, true]);
		// …and the way out is named IN it, not left to be guessed. The registry's own
		// gate hint, so the rail and the key say the same sentence.
		expect([
			name,
			/finish the session first/.test(
				disabled.getAttribute("aria-label") ?? "",
			),
		]).toEqual([name, true]);
	}

	// The stamp family is what reads as pressed while a session stands: a session IS the
	// staged grammar being exercised (D-7), and the rail is the only place that says so.
	const pressedOf = (prefix: RegExp): string | null =>
		within(rail())
			.getByRole("button", { name: prefix })
			.getAttribute("aria-pressed");
	expect(pressedOf(/^Stamp Hall \(/)).toBe("true");
	expect(pressedOf(/^Select \(/)).toBe("false");
});
