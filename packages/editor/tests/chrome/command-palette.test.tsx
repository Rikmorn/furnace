// Registered FIRST, before any other import in this file — Radix (and cmdk, which
// portals through Radix's Dialog) resolves `globalThis.document` at MODULE EVALUATION
// time to decide whether it may use layout effects, and its Portal never mounts if the
// answer was no. See shell.test.tsx's header for the measurement.
import "../inspector/_register.ts";

// The command palette (⌘K): D-12's SEVENTH registry reader.
//
// What these cases pin is that the palette is a VIEW over `lib/actions.ts` and owns no
// vocabulary of its own — every label, every keycap, every enabled rule and every refusal
// sentence is the registry's, reached through the same `gateAction` the keyboard uses.
// The fixture is deliberately MIXED: with no world on disk and an empty history, some
// actions are live and some are not, so the disabled-row cases are not asserting a state
// the whole table happens to be in.
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { StampSession } from "../../src/field-host/index.ts";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { Shell } from "../../src/frontend/components/shell/Shell.tsx";
import {
	ACTION_GROUPS,
	ACTIONS,
	capOf,
	groupTitle,
	TOOL_FAMILIES,
} from "../../src/frontend/lib/actions.ts";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import {
	act,
	cleanup,
	fireEvent,
	makeEditorContext,
	render,
	screen,
	within,
} from "../inspector/_harness.tsx";
import { makeHistory, makeStubHost } from "./_stub-host.ts";

afterEach(cleanup);
afterEach(() => notify.clear());

// CanvasHost fails LOUD on a zero measure and happy-dom measures everything as zero, so
// every case that mounts the real shell has to supply one (shell.test.tsx's rule).
const REAL_RECT = HTMLCanvasElement.prototype.getBoundingClientRect;
const SIZED = { x: 0, y: 0, width: 1280, height: 720 };
const realFetch = globalThis.fetch;

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
	// The field toolbar's run-once catalog GETs; a project without catalogs 404s.
	// Boundary cast: the stub serves only those GETs, not `fetch`'s statics.
	globalThis.fetch = (() =>
		Promise.resolve(
			new Response("", { status: 404 }),
		)) as unknown as typeof fetch;
});

afterEach(() => {
	HTMLCanvasElement.prototype.getBoundingClientRect = REAL_RECT;
	globalThis.fetch = realFetch;
});

/** Four generators, so the stamp family contributes member rows (a one-member family
 *  does not — see the palette's own note). */
const GENERATORS = [
	{
		id: "hall",
		name: "Hall",
		paramSchema: { type: "object", properties: {} },
		defaults: {},
		placesProps: false,
		usesSeed: false,
	},
	{
		id: "maze",
		name: "Maze",
		paramSchema: { type: "object", properties: {} },
		defaults: {},
		placesProps: false,
		usesSeed: true,
	},
];

async function renderShell(stub: ReturnType<typeof makeStubHost>) {
	const result = render(
		<EditorContext.Provider
			value={makeEditorContext({ fieldHostRef: { current: stub.host } })}
		>
			<Shell />
		</EditorContext.Provider>,
	);
	// Let the toolbar's catalog GET settle: two microtask turns.
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	return result;
}

const stubWithGenerators = () => makeStubHost({ generators: GENERATORS });

/** ⌘K on the window — the registry's own chord, dispatched by the ONE keydown listener. */
function pressCommandK(): void {
	act(() => {
		fireEvent.keyDown(window, { key: "k", metaKey: true });
	});
}

/** The palette's own dialog, named by its screen-reader-only title.
 *
 *  EVERY query below is scoped to it, and that is not caution. A native `<select>` carries
 *  the implicit roles `combobox` and `option` — the same two cmdk gives the palette's input
 *  and its rows — and the session card renders one ("merge policy"). An unscoped
 *  `queryByRole("combobox")` therefore answers about the CARD the moment a session is live,
 *  which is exactly the state the Esc case needs. Measured this session: unscoped, the Esc
 *  case passed alone and failed after `session-card.test.tsx`, reporting an open palette
 *  that had in fact closed. */
const palette = () => screen.queryByRole("dialog", { name: /Find a command/ });

function paletteInput(): HTMLElement | null {
	const box = palette();
	return box === null ? null : within(box).queryByRole("combobox");
}

function rows(): HTMLElement[] {
	const box = palette();
	return box === null ? [] : within(box).queryAllByRole("option");
}

const rowNames = () => rows().map((r) => r.getAttribute("aria-label"));
/** The row ⏎ would run — cmdk's own selection, mirrored to `aria-selected`. */
const selectedRow = () =>
	rows().find((r) => r.getAttribute("aria-selected") === "true")?.dataset[
		"value"
	];

/** Type into the palette's own input — the filter cmdk owns. */
function typeQuery(text: string): void {
	const input = paletteInput();
	if (input === null) throw new Error("the palette is not open");
	act(() => {
		fireEvent.change(input, { target: { value: text } });
	});
}

function pressKey(key: string, init: Record<string, unknown> = {}): void {
	const input = paletteInput();
	if (input === null) throw new Error("the palette is not open");
	act(() => {
		fireEvent.keyDown(input, { key, ...init });
	});
}

/** A press with focus on the dialog BOX rather than on its input — the state a pointer
 *  user is in the instant after clicking a row, since a cmdk row is a `div` with no tab
 *  stop and Radix's focus scope parks focus on the content. It matters because the
 *  registry's `typed` gate refuses Esc while the target IS a text field, so a press from
 *  the input is contained by the gate whether or not the dialog swallows it. Only this
 *  one reaches the window listener. */
function pressOnBox(key: string): void {
	const box = palette();
	if (box === null) throw new Error("the palette is not open");
	act(() => {
		fireEvent.keyDown(box, { key });
	});
}

/** A live stamp session, as the host publishes one. */
const SESSION: StampSession = {
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
};

// --- (a) opening and closing -------------------------------------------------

test("⌘K opens the palette; it is not there before", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	// The identity form, deliberately: a red `toBeNull()` on a LIVE element takes
	// minutes to report under this runner, where `=== null` reports in milliseconds.
	expect(paletteInput() === null).toBe(true);
	pressCommandK();
	expect(paletteInput()).toBeTruthy();
});

// The F4.5c re-critique measured this with Chrome's own AX engine over the running app:
// `role="combobox"`, `name: ""`, with an `aria-labelledby` PRESENT and resolving to empty —
// cmdk points the input at an internal label element that only `Command`'s `label` prop
// fills. Present-but-empty is the bad case rather than merely the incomplete one: it is the
// first branch the name computation takes, and a reader gets an anonymous text box in the
// middle of a dialog whose own title they may never hear again.
//
// Asserted through the ROLE QUERY rather than by reading the attribute, because the
// attribute was already there and already wrong. `getByRole(name)` runs the real accessible-
// name computation (`dom-accessibility-api`), so it follows the same `aria-labelledby` →
// element → text path a screen reader does, and an empty resolution fails it.
test("the search box is NAMED — cmdk leaves its aria-labelledby empty otherwise", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	pressCommandK();
	const box = palette();
	expect(box).toBeTruthy();
	if (box === null) return;
	// The dialog's own name, and the box inside it: one surface, one string.
	expect(
		within(box).getByRole("combobox", { name: "Find a command" }),
	).toBeTruthy();
});

test("the burger's View submenu opens it too — one action, two routes", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	act(() => {
		fireEvent.pointerDown(screen.getByLabelText("editor menu"), {
			button: 0,
			pointerType: "mouse",
		});
	});
	// Into the View submenu first: the group is a `DropdownMenuSub` since the holistic
	// gate's ruling 3, so its rows do not exist until the trigger is clicked.
	act(() => {
		fireEvent.click(screen.getByText(groupTitle("view")));
	});
	const def = ACTIONS.find((a) => a.id === "view.commandPalette");
	if (def === undefined) throw new Error("no view.commandPalette action");
	act(() => {
		fireEvent.click(screen.getByText(def.label({} as never)));
	});
	expect(paletteInput()).toBeTruthy();
	// And focus went WITH it. Radix returns focus to the burger trigger when the menu
	// closes, which for an item that opens a surface would pull focus straight back out of
	// the thing just opened — the defect `BurgerMenu`'s `handingOff` flag exists for. The
	// dialog's own focus scope is what wins here (it is modal and trapped, so a focus that
	// lands outside is pulled back), which is why this action needs no entry in that flag's
	// hand-written list. Asserted rather than assumed, because "the trap wins the race" is
	// exactly the kind of claim that quietly stops being true.
	expect(document.activeElement).toBe(paletteInput());
});

test("Esc closes the palette WITHOUT stepping the cancel ladder", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	// A LIVE session, so the assertion is not vacuous: Esc reaching the window listener
	// runs `session.escape`, whose ladder would discard exactly this.
	act(() => {
		stub.fire.stamp(SESSION);
	});
	expect(screen.queryByRole("region", { name: "Session" })).toBeTruthy();

	pressCommandK();
	pressKey("Escape");

	expect(paletteInput() === null).toBe(true);
	// The ladder never ran: the host's ONE cancel entry point was not called.
	expect(stub.calls.escape).not.toHaveBeenCalled();
	expect(screen.queryByRole("region", { name: "Session" })).toBeTruthy();
});

test("…and from the dialog BOX too, where the typed gate is no help", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(SESSION);
	});

	pressCommandK();
	// The press the case above cannot make: from the input, `session.escape` is refused by
	// the registry's own `typed` gate (the target is a text field), so that case would
	// stay green with the dialog swallowing nothing. Focus sits HERE the moment a pointer
	// user clicks a row — cmdk rows are `div`s with no tab stop — and from here the gate
	// allows the key, so the only thing between Esc and the cancel ladder is the dialog.
	pressOnBox("Escape");

	expect(palette() === null).toBe(true);
	expect(stub.calls.escape).not.toHaveBeenCalled();
	expect(screen.queryByRole("region", { name: "Session" })).toBeTruthy();
});

// --- (b) the rows ARE the registry -------------------------------------------

test("every action is a row, plus the multi-member families' members", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	pressCommandK();

	// One row per action…
	for (const def of ACTIONS)
		expect({
			id: def.id,
			present: rows().some((r) => r.dataset["value"] === def.id),
		}).toEqual({ id: def.id, present: true });

	// …plus the members of every family that has more than one (the rail's own rule: a
	// one-member family's member IS its arm action, and two rows for one verb is the
	// defect this registry exists to prevent).
	expect(rowNames()).toContain("Brush · Dig");
	expect(rowNames()).toContain("Cell select · Wand");
	expect(rowNames()).toContain("Stamp · Maze");
	// The pointer family has exactly one member, so it contributes none.
	expect(rowNames()).not.toContain("Select · Select");
});

test("labels are CONTEXTUAL — the registry's own label function, not a static name", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	act(() => {
		stub.fire.history(makeHistory(["dig"]));
	});
	pressCommandK();
	// "Undo dig", never "Undo": the label comes from the top of the op log.
	expect(rowNames()).toContain("Undo dig ⌘Z");
});

test("keycaps come from the registry, and so does the footer's own", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	pressCommandK();
	// The row's accessible name carries the chord the table declares.
	expect(rowNames()).toContain("Save ⌘S");
	expect(rowNames()).toContain("Next brush ⇧B");
	// The footer advertises the palette's OWN chord, read from the same table — a
	// hand-typed ⌘K here is a keycap that could outlive its binding. Scoped to the footer
	// strip, because the row for that same action carries the same keycap two inches up.
	const def = ACTIONS.find((a) => a.id === "view.commandPalette");
	const cap = def === undefined ? undefined : capOf(def);
	expect(cap).toBe("⌘K");
	const box = palette();
	if (box === null) throw new Error("the palette is not open");
	const footer = within(box).getByText("↑↓ navigate").parentElement;
	if (!(footer instanceof HTMLElement)) throw new Error("no footer strip");
	expect(within(footer).getByText(cap ?? "")).toBeTruthy();
	expect(within(footer).getByText("esc close")).toBeTruthy();
});

test("rows are grouped, and the headings are the registry's group titles IN ORDER", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	pressCommandK();
	const box = palette();
	if (box === null) throw new Error("the palette is not open");
	// ORDER, not just membership — `ACTION_GROUPS`' own doc makes it load-bearing ("two
	// different orders is two different mental maps"), and this is the surface where the
	// user meets all five at once. Read off the DOM rather than compared title by title,
	// so a group that moved fails here rather than passing five presence checks.
	const headings = Array.from(box.querySelectorAll("[cmdk-group-heading]")).map(
		(h) => h.textContent,
	);
	expect(headings).toEqual(ACTION_GROUPS.map((g) => g.title));
});

test("a query nothing answers says so, rather than showing an empty box", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	pressCommandK();
	typeQuery("zzzzzzzz");
	expect(rows().length).toBe(0);
	const box = palette();
	if (box === null) throw new Error("the palette is not open");
	expect(within(box).getByText("No action matches.")).toBeTruthy();
});

test("the selection key is the action ID, not the label", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	pressCommandK();
	// cmdk derives an item's value from its textContent unless one is given. A
	// contextual label ("Undo dig") changes as the user works, so the id is what keeps
	// the selection stable across a relabel.
	const first = rows()[0];
	expect(first?.dataset["value"]).toBe(ACTIONS[0]?.id);
});

// --- (c) filtering -----------------------------------------------------------

test("typing filters the rows — cmdk unmounts what does not match", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	pressCommandK();
	const all = rows().length;
	typeQuery("bake");
	expect(rows().length).toBeLessThan(all);
	expect(rowNames().some((n) => n?.startsWith("Bake"))).toBe(true);
});

test("the visible LABEL is searchable, not only the id", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	act(() => {
		stub.fire.history(makeHistory(["dig"]));
	});
	pressCommandK();
	// "dig" appears in no action id — only in the contextual label of `edit.undo`.
	typeQuery("undo dig");
	expect(rowNames()).toContain("Undo dig ⌘Z");
});

test("a MEMBER row is findable by the words it shows", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	pressCommandK();
	// A member row displays a COMPOSED label — the family's name and the member's. The
	// composition has to be searchable as one string, or the family half is findable only
	// where it happens to echo the action id: `tool.select` is called "Cell select", so
	// typing what that row visibly says used to miss it entirely. Every family here, not
	// just the one that broke, because the next family name to diverge from its id would
	// break exactly the same way and silently.
	for (const [query, name] of [
		["cellselectroom", "Cell select · Room"],
		["brushsegment", "Brush · Segment"],
		["stampmaze", "Stamp · Maze"],
	] as const) {
		typeQuery(query);
		expect({ query, names: rowNames() }).toEqual({
			query,
			names: expect.arrayContaining([name]),
		});
	}
});

// --- (d) refusal: disabled rows and gated rows -------------------------------

test("a disabled action is RENDERED, marked, and does not fire", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	pressCommandK();
	// No world on disk: Bake has nothing to write about, so `enabled` is false. The
	// row is visible — a verb you cannot find is worse than one you cannot run.
	const bake = rows().find((r) => r.dataset["value"] === "world.bake");
	expect(bake?.getAttribute("aria-disabled")).toBe("true");

	// …and Enter over it does nothing. Filter down and press with it SELECTED, which is
	// what decides where ⏎ lands — asserted rather than inferred from a survivor count.
	// It used to be `rows().length === 1`, and that was a fixture coincidence: `world.bake`
	// carries no `hint`, so nothing but its own value and label could match the query. Once
	// F4.5c Task 8's `menuTitle`→`hint` merge gave every documented action its sentence as a
	// search keyword, `world.makeDefault` — whose sentence names Bake, to contrast with it —
	// started matching too. That is the merge working, not a regression: the row a user
	// searching "bake" might also want is exactly what a keyword is for.
	typeQuery("Bake — name");
	// The query changed from `world.bake`, which used to isolate this row by a fixture
	// coincidence: `world.bake` carried no sentence, so nothing but its own id and label
	// could match. F4.5c Task 8's `menuTitle`→`hint` merge gave every documented action its
	// sentence as a cmdk KEYWORD, and `world.makeDefault`'s names Bake — deliberately,
	// to contrast the two — so it now matches too. That is the merge working (the row a
	// user searching "bake" might also want is exactly what a keyword is for), not a
	// regression, and the fix is a query that identifies this row rather than one that
	// happened to.
	expect(rows().map((r) => r.dataset["value"])).toEqual(["world.bake"]);
	// The MECHANISM the assertion below rests on, made explicit: cmdk never selects a
	// disabled row, so with this one alone on screen there is nothing for ⏎ to run. A
	// survivor count alone did not say that.
	expect(selectedRow()).toBeUndefined();
	// Boot noise ("no catalog — rock only") off the record first, so the assertion below
	// is "the press said NOTHING AT ALL" rather than a check against one string.
	act(() => notify.clear());
	pressKey("Enter");
	// The verb provably never ran. `world.bake` over an untitled world has a backstop of its
	// own (`notify.error("name the world first (⌘S)")` in `useWorld`), so a row that fired
	// would leave that in the log — asserted rather than assumed, because "the palette is
	// still up" is also true of a run that did nothing visible. FIRST, because it is the
	// claim: a firing row also closes the palette, and that would redden the line below and
	// leave this one unread.
	expect(notify.getSnapshot().log).toEqual([]);
	// …and it is still up, since nothing consumed the press.
	expect(paletteInput()).toBeTruthy();
});

test("a live session refuses the tool rows IN THE REGISTRY'S OWN WORDS", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(SESSION);
	});
	pressCommandK();
	const brush = rows().find((r) => r.dataset["value"] === "tool.brush");
	expect(brush?.getAttribute("aria-disabled")).toBe("true");
	// The gate's sentence, not one this component wrote.
	expect(brush?.getAttribute("aria-label")).toBe(
		"Brush B (finish the session first — ⏎ applies it, Esc discards it)",
	);

	typeQuery("tool.brush");
	pressKey("Enter");
	expect(stub.calls.setTool).not.toHaveBeenCalled();
	expect(stub.calls.setGesture).not.toHaveBeenCalled();
});

test("and the family's MEMBERS are refused with it", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(SESSION);
	});
	pressCommandK();
	const dig = rows().find((r) =>
		r.getAttribute("aria-label")?.startsWith("Brush · Dig"),
	);
	expect(dig?.getAttribute("aria-disabled")).toBe("true");
});

// --- (e) dispatch ------------------------------------------------------------

test("Enter runs the action through the registry", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	pressCommandK();
	typeQuery("view.frame");
	// cmdk re-selects the best match after every filter change; ⏎ runs THAT row, so the
	// case pins which one it is rather than assuming the query left exactly one.
	expect(selectedRow()).toBe("view.frame");
	pressKey("Enter");
	expect(stub.calls.frameSelection).toHaveBeenCalledTimes(1);
	// And the palette is gone: running a verb is the end of the palette's job.
	expect(paletteInput() === null).toBe(true);
});

test("the palette CLOSES before the action runs", async () => {
	const stub = stubWithGenerators();
	// A plain array rather than a `let`: TS narrows a `let` initialised to `null` and
	// never reassigned in its own scope, so the assertion below would compare against a
	// type of `null`. Pushing records the same fact without lying to the checker.
	const seen: boolean[] = [];
	stub.calls.frameSelection.mockImplementation(() => {
		seen.push(paletteInput() !== null);
	});
	await renderShell(stub);
	pressCommandK();
	typeQuery("view.frame");
	expect(selectedRow()).toBe("view.frame");
	pressKey("Enter");
	// Ordering, not wording: React batches, so "close first" in source is only true at
	// runtime if the close is flushed. Task 10's focus return rides on this.
	expect(seen).toEqual([false]);
});

// --- (f) the keyboard the palette does NOT claim ------------------------------

test("cmdk's vim bindings are OFF — ⌃N is not a navigation key here", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	pressCommandK();
	const firstSelected = selectedRow();
	pressKey("n", { ctrlKey: true });
	const afterSelected = selectedRow();
	// Unmoved: ⌃N/⌃J/⌃P/⌃K are cmdk's default second set of arrows, and ⌃J is this
	// editor's ⌘J (a chord is `mod` = ⌘ OR Ctrl, and chords are live inside text
	// fields). Two owners for one press is what the ownership rule forbids.
	expect(afterSelected).toBe(firstSelected);
});

test("the arrows still move the selection", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	pressCommandK();
	const before = selectedRow();
	pressKey("ArrowDown");
	const after = selectedRow();
	expect(after === before).toBe(false);
});

// --- (g) the layout contract --------------------------------------------------

test("the palette is a LAYER — the canvas cell keeps its box", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	const canvas = screen.getByLabelText("field viewport");
	const cell = canvas.parentElement;
	if (!(cell instanceof HTMLElement)) throw new Error("canvas has no cell");
	const row = cell.parentElement;
	if (!(row instanceof HTMLElement)) throw new Error("cell has no row");
	const childCount = cell.children.length;

	pressCommandK();

	// The canvas is where it was, sized how it was (D-1: nothing may move the cell's
	// insets), and the palette is OUTSIDE both the cell and the body row.
	expect(canvas.parentElement === cell).toBe(true);
	for (const cls of ["absolute", "inset-0", "h-full", "w-full"])
		expect(canvas.classList.contains(cls)).toBe(true);
	expect(cell.children.length).toBe(childCount);
	expect(row.children.length).toBe(2);
	const box = palette();
	if (box === null) throw new Error("the palette is not open");
	expect(cell.contains(box)).toBe(false);
	expect(row.contains(box)).toBe(false);
});

// --- (h) the registry's own bookkeeping ---------------------------------------

test("the palette is NOT one of the floating palettes", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	pressCommandK();
	// It takes no PaletteId, so `⌘\` cannot hide it and the workspace never persists it.
	act(() => {
		fireEvent.keyDown(window, { key: "\\", metaKey: true });
	});
	expect(paletteInput()).toBeTruthy();
});

test("every family the rail renders is reachable by name", async () => {
	const stub = stubWithGenerators();
	await renderShell(stub);
	pressCommandK();
	for (const family of TOOL_FAMILIES)
		expect({
			id: family.arm.id,
			present: rows().some((r) => r.dataset["value"] === family.arm.id),
		}).toEqual({ id: family.arm.id, present: true });
});
