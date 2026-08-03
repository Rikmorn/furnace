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
	usesSeed: false,
};

const MAZE: FieldGeneratorInfo = {
	id: "maze",
	name: "Maze",
	paramSchema: { type: "object", properties: {} },
	defaults: {},
	placesProps: false,
	usesSeed: true,
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
 *  is that the rail IS a toolbar a keyboard user can reach, not that some div happens to
 *  carry the right utilities. `toolbar` and not `navigation`: this arms tools, it does not
 *  navigate, and the role is what commits it to the roving-tabindex pattern below (D-26). */
const rail = (): HTMLElement => screen.getByRole("toolbar", { name: "tools" });

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
	// AND AN AVAILABLE CONTROL SAYS NOTHING. The other half of W-1's mechanism, and the
	// half that breaks silently: the refusal notice hangs off the same click path a
	// working button uses, so a guard that read "was this clicked" instead of "is there a
	// reason" would toast on every successful arm in the editor. Measured as GROWTH rather
	// than emptiness — the boot logs "no catalog — rock only" under `fetch404`.
	const before = notify.getSnapshot().log.length;
	fireEvent.click(railButton("Brush"));
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		effect: "fill",
	});
	expect(notify.getSnapshot().log.length).toBe(before);
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

test("a multi-member family opens its members from a flyout; a single-member one has none", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);

	// Pointer is a family of ONE, so a flyout that promised more members would promise
	// nothing — and ⇧V would be a key that does nothing either.
	expect(
		within(rail()).queryByRole("button", { name: "Select tools" }) === null,
	).toBe(true);

	// The brush family has five. Its flyout opens them, each named, and a click arms that
	// member directly — the mouse's route to Paint now that ToolPalette is gone.
	fireEvent.click(railButton("Brush tools"));
	const menu = await screen.findByRole("group", { name: "Brush tools" });
	expect(
		within(menu)
			.getAllByRole("button")
			.map((b) => (b.getAttribute("aria-label") ?? "").split(" — ")[0]),
	).toEqual(["Dig", "Fill", "Paint", "Smooth", "Segment"]);
	fireEvent.click(within(menu).getByRole("button", { name: /^Paint —/ }));
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
			.map((b) => (b.getAttribute("aria-label") ?? "").split(" — ")[0]),
	).toEqual(["Hall", "Maze"]);
	// The SECOND one: without the flyout a mouse-only user could only ever reach the
	// generator the `S` cursor happened to point at.
	fireEvent.click(within(menu).getByRole("button", { name: /^Maze —/ }));
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
	// TWO generators and a session on the SECOND one. The first cut of this case fired the
	// default `makeSession()` (generator "hall") against a one-generator registry, so the
	// rail's label and the session's generator agreed BY FIXTURE COINCIDENCE and the rail
	// could have been naming either. It was naming the ⇧S cursor.
	const stub = makeStubHost({ generators: [HALL, MAZE] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(
			makeSession({ generator: "maze", mode: "reconfigure", entityId: 3 }),
		);
	});

	// (1) THE RAIL NAMES THE LIVE SESSION. The ⇧S cursor is still on Hall (nothing moved
	// it — a session does not), so a rail reading `tool.stamp`'s own label says "Stamp
	// Hall" while the session strip six inches away says `maze #3`. D-8's arming channel
	// lying about the state D-7 exists for.
	const stamp = within(rail()).getByRole("button", { name: /^Stamp Maze/ });
	expect(stamp.getAttribute("aria-pressed")).toBe("true");
	expect(
		within(rail()).queryByRole("button", { name: /^Stamp Hall/ }) === null,
	).toBe(true);

	// (2) The pressed family stays the STRONGEST element while it is refused. Dimming it
	// would make D-8's contrast fix a 40 %-opacity claim, and mock frame 2 draws it
	// pressed and undimmed.
	expect(stamp.classList.contains("bg-primary")).toBe(true);
	expect(stamp.classList.contains("opacity-40")).toBe(false);

	// (3) All four refuse, with the registry's own sentence in the accessible NAME (a
	// tooltip on an unavailable control is the least reliable channel there is).
	for (const [name, prefix] of [
		["Select", /^Select \(/],
		["Brush", /^Brush \(/],
		["Cell select", /^Cell select \(/],
		["Stamp", /^Stamp Maze \(/],
	] as const) {
		const refused = within(rail()).getByRole("button", { name: prefix });
		// `aria-disabled`, NOT `disabled`: a disabled button leaves the tab order, and the
		// refusal sentence rides the name precisely so a keyboard user gets it.
		expect([name, refused.getAttribute("aria-disabled")]).toEqual([
			name,
			"true",
		]);
		expect([name, (refused as HTMLButtonElement).disabled]).toEqual([
			name,
			false,
		]);
		expect([
			name,
			/finish the session first/.test(refused.getAttribute("aria-label") ?? ""),
		]).toEqual([name, true]);
	}

	// (4) …and a refused family does not act on a click. With `aria-disabled` the browser
	// no longer enforces that, so the handler must.
	fireEvent.click(within(rail()).getByRole("button", { name: /^Select \(/ }));
	expect(stub.calls.setGesture).not.toHaveBeenCalled();

	// (5) …and it SAYS WHY (W-1). The rail's refusal is reachable three ways — the
	// tooltip, the accessible name, and pressing the thing — and the third one is the
	// gesture a user actually makes. It answered with nothing before this. Same sentence
	// as the name carries and as the KEY gives, because all three read `controlVerdict`.
	expect(notify.getSnapshot().log[0]?.text).toMatch(/finish the session first/);

	// A SECOND press does not stack a second copy: `aria-disabled` keeps the control live,
	// so an impatient user can hammer it, and TOAST_CAP is 3 — three presses would fill
	// the stack with one sentence. Counted BY SENTENCE, since the boot's "no catalog —
	// rock only" is holding a slot of its own here.
	fireEvent.click(within(rail()).getByRole("button", { name: /^Select \(/ }));
	const said = (): number =>
		notify
			.getSnapshot()
			.toasts.filter((t) => /finish the session first/.test(t.text)).length;
	expect(said()).toBe(1);

	// (6) …AND SO DOES THE FLYOUT TAB, which is a second refused control on the same
	// family and had its own silent branch: it vetoes Radix's toggle so the popover stays
	// shut, and a veto with nothing said is the W-1 defect one level down. It matters more
	// here than on the button above, not less — this tab is the mouse's ONLY route to
	// Fill / Paint / Smooth / Segment, so a user reaching for it during a session is
	// exactly the person owed the sentence.
	//
	// Cleared first BECAUSE of the coalesce: the family button's press left this very
	// sentence on screen, so a surviving toast would make this pass without the flyout
	// saying anything at all.
	act(() => notify.clear());
	fireEvent.click(within(rail()).getByRole("button", { name: "Brush tools" }));
	expect(said()).toBe(1);
	// The popover stayed shut — the refusal is a veto, not a silent no-op with a menu.
	expect(screen.queryByRole("group", { name: "Brush tools" }) === null).toBe(
		true,
	);
});

test("a PENDING stamp presses the stamp family — and stays armable, unlike a session", async () => {
	fetch404();
	// TWO generators and an arm on the SECOND, for the session case's reason: with one
	// generator the rail's label would agree with the arm by coincidence and could be
	// naming either it or the ⇧S cursor (which nothing has moved off Hall).
	const stub = makeStubHost({ generators: [HALL, MAZE] });
	await renderShell(stub);
	act(() => {
		stub.fire.pendingStamp({ id: "maze", name: "Maze" });
	});

	// The rail names the ARM, and presses it. Nothing pushed a session and nothing armed
	// a gesture, so the chrome's mirror still reads `pointer` underneath — which is
	// exactly what would leave TWO families pressed without the shadow.
	const stamp = within(rail()).getByRole("button", { name: /^Stamp Maze/ });
	expect(stamp.getAttribute("aria-pressed")).toBe("true");
	expect(
		within(rail())
			.getByRole("button", { name: /^Select/ })
			.getAttribute("aria-pressed"),
	).toBe("false");

	// …and unlike a session, an arm does NOT lock the rail: arming another tool is one of
	// the documented ways out of region-draw, so every family stays live and unrefused.
	const select = within(rail()).getByRole("button", { name: "Select" });
	expect(select.getAttribute("aria-disabled")).toBeNull();
	fireEvent.click(select);
	expect(stub.calls.setGesture.mock.calls).toEqual([["pointer"]]);
});

test("arming the BRUSH cancels a pending stamp — even with the brush already armed", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);

	// Get LMB onto the brush first (gesture → null). This is the state the clause
	// exists for: `brushArming` reports no disarm when there is no gesture to drop, so
	// the second click below would push nothing at all without it — and `setGesture` is
	// what cancels the arm host-side.
	fireEvent.click(within(rail()).getByRole("button", { name: "Brush" }));
	expect(stub.calls.setGesture.mock.calls).toEqual([[null]]);

	act(() => {
		stub.fire.pendingStamp({ id: "hall", name: "Hall" });
	});
	fireEvent.click(within(rail()).getByRole("button", { name: "Brush" }));
	// The SECOND null is the discriminating one — a redundant push while nothing is
	// armed, and the only signal the host gets that the user has picked up a brush.
	expect(stub.calls.setGesture.mock.calls).toEqual([[null], [null]]);
});

// --- (g) D-26: the rail is ONE tab stop, walked with the arrows --------------

test("the rail is a vertical toolbar with a roving tabindex — one tab stop, arrows walk it", async () => {
	fetch404();
	// TWO generators, so the stamp family has a flyout too and the control count is the
	// full seven. With one generator it is six, and a test that pinned six would go red on
	// a project that simply registered a second generator.
	const stub = makeStubHost({ generators: [HALL, MAZE] });
	await renderShell(stub);
	const bar = rail();
	// The landmark itself: `toolbar`, not `<nav>` (this arms tools, it does not navigate),
	// and oriented so a screen reader announces which arrows to use.
	expect(bar.getAttribute("aria-orientation")).toBe("vertical");

	const buttons = () =>
		Array.from(bar.querySelectorAll("button")) as HTMLButtonElement[];
	// Four families + a flyout trigger on the three multi-member ones = 7 controls, and
	// exactly ONE of them is in the tab order. Seven tab stops for one mode selector is
	// what the roving pattern exists to prevent.
	expect(buttons().length).toBe(7);
	const stops = () => buttons().filter((b) => b.tabIndex === 0);
	expect(stops().length).toBe(1);
	expect(stops()[0] === buttons()[0]).toBe(true);

	// ↓ moves the stop AND the focus together — a stop that did not follow focus would
	// send the next Tab back to the top of the column.
	buttons()[0]?.focus();
	act(() => {
		fireEvent.keyDown(bar, { key: "ArrowDown" });
	});
	// Compared as BOOLEANS, never as elements: a happy-dom node carries React's fiber
	// graph, so a failing element comparison serialises tens of megabytes and reads as a
	// hung run rather than a failed assertion (the house rule — and the select case below
	// hit it during sabotage).
	expect(document.activeElement === buttons()[1]).toBe(true);
	expect(stops().length === 1 && stops()[0] === buttons()[1]).toBe(true);

	// End jumps to the last control, and ↓ WRAPS from there rather than dead-ending.
	act(() => {
		fireEvent.keyDown(bar, { key: "End" });
	});
	expect(document.activeElement === buttons()[6]).toBe(true);
	act(() => {
		fireEvent.keyDown(bar, { key: "ArrowDown" });
	});
	expect(document.activeElement === buttons()[0]).toBe(true);
});

// The ONE case F4.5c Task 9 added to this file, and it is named as the deviation it is:
// the extraction was behaviour-identical, but the tooltip VETO that came with it is a real
// behaviour change to the rail — seven controls in a roving column is seven tooltips
// popped on the way down it, and Radix opens on focus with no delay. Without a case here
// the suppression rides in on the rail with no coverage at all, which is the shape of a
// change nobody can find later.
test("arrow travel down the rail pops no tooltip; a settled focus still does", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	const bar = rail();
	const buttons = () =>
		Array.from(bar.querySelectorAll("button")) as HTMLButtonElement[];

	buttons()[0]?.focus();
	act(() => {
		fireEvent.keyDown(bar, { key: "ArrowDown" });
	});
	expect(document.activeElement === buttons()[1]).toBe(true);
	expect(screen.queryByRole("tooltip") === null).toBe(true);

	// …and the SAME control still documents itself when focus arrives any other way, which
	// is the half D-25 is about: the tip stopped chasing the cursor, it did not go away.
	act(() => {
		fireEvent.focus(buttons()[1] as HTMLElement);
	});
	expect(await screen.findByRole("tooltip")).toBeTruthy();
});

// --- (h) WCAG 2.5.8: the flyout trigger is a real target ---------------------

test("the member flyout's trigger is a 24 px target that does not overlap the family button", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	const trigger = railButton("Brush tools");
	// 24 px tall × the family button's own 32 px width. The mock draws a 14 px corner
	// tick; inside a 44 px column that cannot be 24 × 24 AND clear of the family button,
	// and this is the only mouse route to Fill / Paint / Smooth / Segment.
	expect(trigger.classList.contains("h-6")).toBe(true);
	expect(trigger.classList.contains("w-8")).toBe(true);
	// BELOW it, not over it: `absolute` inside the family button's own box is what ate a
	// corner of its hit area.
	expect(trigger.classList.contains("absolute")).toBe(false);
	const family = railButton("Brush");
	expect(family.contains(trigger)).toBe(false);
	expect(
		trigger.compareDocumentPosition(family) & Node.DOCUMENT_POSITION_PRECEDING,
	).toBeTruthy();
});

// --- (i) the per-member docs that ToolPalette's tooltips used to carry -------

test("each flyout member carries its OWN sentence — including the 60 m segment cap", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	fireEvent.click(railButton("Brush tools"));
	const menu = await screen.findByRole("group", { name: "Brush tools" });

	// The registry's `hint` is FAMILY-level ("Arm the brush family"), so these four facts
	// had no home once ToolPalette's per-button tooltips were deleted. They are in the
	// accessible NAME, not only in a muted second line: a line that is `aria-hidden` puts
	// the momentary modifiers out of reach of exactly the users who cannot find them by
	// experiment.
	const named = (re: RegExp): HTMLElement =>
		within(menu).getByRole("button", { name: re });
	expect(named(/^Dig — .*hold ⌃/)).toBeTruthy();
	expect(named(/^Smooth — .*hold ⇧/)).toBeTruthy();
	expect(named(/^Paint — .*organic classes only/)).toBeTruthy();
	// `field-host.ts`'s MAX_SEGMENT_M doc names this as its restating site. Between the
	// deletion of ToolPalette and this hint the cap had NO affordance at all — a user met
	// it only as a refusal after drawing too far.
	expect(named(/^Segment — .*max 60 m/)).toBeTruthy();
});
