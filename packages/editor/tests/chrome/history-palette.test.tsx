// Registered FIRST, before any other import — the shell.test.tsx ordering rule (Radix
// resolves `globalThis.document` at MODULE EVALUATION time). Nothing here opens a Radix
// surface, but the whole chrome directory keeps the discipline because the failure mode
// is silent.
import "../inspector/_register.ts";

// The History palette (F4.5b Task 12, D-11): the field's ONE history as a visible list,
// and the one surface in the editor that can step more than once per click.
//
// What is under test is the STEPPER contract, in both directions — the row a user clicks
// and the number of `undo()`/`redo()` calls it makes — plus the two things the panel says
// about itself that could be false: how many steps there are, and how many are not shown.
//
// House rule this file obeys (the second and third instances of it in this suite cost two
// minutes each): every absence assertion compares to `null` FIRST. `expect(el).toBeNull()`
// on a happy-dom element serialises React's fiber graph on failure and hangs the run
// instead of reporting.

import { afterEach, expect, test } from "bun:test";
import { HistoryPalette } from "../../src/frontend/components/shell/HistoryPalette.tsx";
import { FieldHostStateProvider } from "../../src/frontend/hooks/useFieldHostState.tsx";
import {
	act,
	cleanup,
	fireEvent,
	makeEditorContext,
	renderWithEditor,
	screen,
} from "../inspector/_harness.tsx";
import { makeHistory, makeStubHost } from "./_stub-host.ts";

afterEach(cleanup);

/** The palette under the shell's host-state provider — the arrangement the real editor
 *  mounts. The provider owns `subscribeHistory`, so a `fire.history` push needs it. */
function renderPalette(stub: ReturnType<typeof makeStubHost>) {
	return renderWithEditor(
		<FieldHostStateProvider host={stub.host} engineReady>
			<HistoryPalette />
		</FieldHostStateProvider>,
		makeEditorContext({ fieldHostRef: { current: stub.host } }),
	);
}

/** Push a history through the seam, as any log mutation does. */
function push(
	stub: ReturnType<typeof makeStubHost>,
	undo: readonly string[],
	redo: readonly string[] = [],
	depths?: { undoDepth?: number; redoDepth?: number },
): void {
	act(() => {
		stub.fire.history(makeHistory(undo, redo, depths));
	});
}

/** A row, by the accessible name that carries the whole sentence — the visible text is
 *  two columns of shorthand and repeats ("dig", "dig", "dig"), so it identifies nothing
 *  once a session has done the same thing twice. */
const row = (verb: "Undo" | "Redo", steps: number, label: string) =>
	screen.getByLabelText(
		`${verb} ${steps} step${steps === 1 ? "" : "s"} — ${label}`,
	) as HTMLButtonElement;

// --- the seam ---------------------------------------------------------------

test("the palette subscribes to nothing — the provider owns the history seam", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	// Single slot: a second subscriber here would silently steal the provider's, and the
	// Undo/Redo menu labels would stop moving with nothing thrown.
	expect(stub.calls.subscribeHistory.mock.calls.length).toBe(1);
});

test("it waits for the engine, rather than claiming an empty history", () => {
	const stub = makeStubHost();
	renderWithEditor(
		<FieldHostStateProvider host={stub.host} engineReady={false}>
			<HistoryPalette />
		</FieldHostStateProvider>,
		makeEditorContext({
			state: { status: "booting" },
			fieldHostRef: { current: stub.host },
		}),
	);
	expect(screen.queryByText(/nothing yet/)).toBe(null);
	expect(screen.getByText(/waits for the engine bundle/)).toBeTruthy();
});

test("an untouched session says so, and offers no rows", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	expect(screen.getByText("nothing yet")).toBeTruthy();
	// Not a list with a divider in it: an empty history has no current position to mark.
	// By ROW since F4.5c Task 9 — the palette is a one-column `role="grid"` now, so a
	// `listitem` query would be satisfied by there being no list anywhere ever again.
	expect(screen.queryByRole("row")).toBe(null);
});

// --- the rows ---------------------------------------------------------------

test("rows run NEWEST-FIRST, and each names the steps it would take", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	push(stub, ["stamp Hall", "dig", "segment fill"]);

	// The seam's ordering contract is newest-LAST in the array; the list inverts it, so
	// the thing ⌘Z would do sits at the top of the panel.
	const labels = screen
		.getAllByRole("button")
		.map((b) => b.textContent ?? "")
		.map((t) => t.replace(/^\d+/, ""));
	expect(labels).toEqual(["segment fill", "dig", "stamp Hall"]);

	// …and the step count grows with distance from the current state. `stamp Hall` is
	// three ops ago, so reaching the state before it is three ⌘Z.
	expect(row("Undo", 1, "segment fill")).toBeTruthy();
	expect(row("Undo", 2, "dig")).toBeTruthy();
	expect(row("Undo", 3, "stamp Hall")).toBeTruthy();
});

test("an undo-side click steps that many times, and no more", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	push(stub, ["stamp Hall", "dig", "segment fill"]);

	fireEvent.click(row("Undo", 3, "stamp Hall"));
	// THREE undos and ZERO redos: a stepper takes the user's own ⌘Z presses for them,
	// and a click on the undo side must never step forward.
	expect(stub.calls.undo.mock.calls.length).toBe(3);
	expect(stub.calls.redo.mock.calls.length).toBe(0);

	fireEvent.click(row("Undo", 1, "segment fill"));
	expect(stub.calls.undo.mock.calls.length).toBe(4);
});

test("the REDO side steps forward, with the next redo nearest the divider", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	// Two ops undone: `dig` is the next redo (top of the redo stack, so LAST in the
	// array), `paint` is two forward.
	push(stub, ["stamp Hall"], ["paint", "dig"]);

	// Order on screen: furthest-future first, so the list reads as one timeline.
	const labels = screen
		.getAllByRole("button")
		.map((b) => b.textContent ?? "")
		.map((t) => t.replace(/^\+?\d+/, ""));
	expect(labels).toEqual(["paint", "dig", "stamp Hall"]);

	fireEvent.click(row("Redo", 2, "paint"));
	expect(stub.calls.redo.mock.calls.length).toBe(2);
	// The DISCRIMINATING half: a redo-side click that called `undo` would walk the user
	// backwards through work they were trying to recover.
	expect(stub.calls.undo.mock.calls.length).toBe(0);
});

test("the divider is not a row — there is nothing to click at the current position", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	push(stub, ["dig"], ["paint"]);
	// Two steps, two buttons. A third would mean the current position had been rendered
	// as something clickable that does nothing.
	expect(screen.getAllByRole("button").length).toBe(2);
});

// --- what the panel SAYS about itself ---------------------------------------

test("the header counts the TRUE depths, not the rows in hand", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	// 50 rows out of 130 steps — a session past the seam's tail. The header must read the
	// depth, or a long session would appear to stop growing at the bound.
	push(stub, Array(50).fill("dig"), [], { undoDepth: 130 });
	expect(screen.getByText(/130 steps/)).toBeTruthy();
	expect(screen.queryByText(/50 steps/)).toBe(null);
});

test("older steps that are not listed are NAMED, and only when there are some", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	push(stub, Array(50).fill("dig"), [], { undoDepth: 130 });
	expect(screen.getByText(/80 older steps not listed/)).toBeTruthy();

	// The BOUNDARY, and the reason the line is derived from a subtraction rather than
	// from "the list is full": a history of exactly 50 with a depth of exactly 50 has
	// nothing hidden, and a `length === TAIL` test would claim 0 older steps out loud.
	push(stub, Array(50).fill("dig"));
	expect(screen.queryByText(/older step/)).toBe(null);

	// Singular, because "1 older steps" is the kind of thing a reader stops trusting.
	push(stub, Array(50).fill("dig"), [], { undoDepth: 51 });
	expect(screen.getByText(/1 older step not listed/)).toBeTruthy();
});

test("a truncated REDO side is named too, not silently shortened", () => {
	// The side that is easy to forget: 60 presses of ⌘Z is a reachable thing to do, and
	// the tail keeps the entries NEAREST the current state — so what falls off the redo
	// list is the furthest future, and it falls off the TOP.
	const stub = makeStubHost();
	renderPalette(stub);
	push(stub, ["dig"], Array(50).fill("fill"), { redoDepth: 63 });
	expect(screen.getByText(/13 further redo steps not listed/)).toBeTruthy();
	// …and the header's own count is the TRUE depth, so the two agree.
	expect(screen.getByText(/63 undone/)).toBeTruthy();

	// Nothing hidden, nothing claimed — the boundary, as on the undo side.
	push(stub, ["dig"], Array(50).fill("fill"));
	expect(screen.queryByText(/further redo/)).toBe(null);
});

test("the undone count appears only while something is undone", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	push(stub, ["dig"]);
	expect(screen.queryByText(/undone/)).toBe(null);
	push(stub, ["dig"], ["paint", "fill"]);
	expect(screen.getByText(/2 undone/)).toBeTruthy();
});

// The two SUMMON affordances (the status bar's `undo N` chip, the Edit menu's History
// item) and the two NAMED menu items live in shell.test.tsx: each needs the real Shell —
// four writes across two providers, and a palette that is unmounted while closed — plus
// that file's canvas-measurement and catalog-fetch environment.

// --- F4.5c Task 9 (D-26): the row grid --------------------------------------

const historyGrid = (): HTMLElement =>
	screen.getByRole("grid", { name: "history" });

const historyStops = (): HTMLButtonElement[] =>
	Array.from(
		historyGrid().querySelectorAll<HTMLButtonElement>(
			'[role="row"] > [role="gridcell"]:first-child button',
		),
	);

// THREE rows, because "one tab stop" is vacuous on a one-row list and an arrow that
// lands where it started proves nothing.
test("the history list is ONE tab stop, walked with ↑/↓, stepped with ⏎", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	push(stub, ["stamp Hall", "dig", "segment fill"]);

	const tabbable = () => historyGrid().querySelectorAll('[tabindex="0"]');
	expect(historyStops().length).toBe(3);
	expect(tabbable().length).toBe(1);
	expect(tabbable()[0] === historyStops()[0]).toBe(true);

	// ↓ moves focus and NOTHING else: a history row is a command, and arrowing onto one
	// must not step the log. This is the assertion that would redden if this list were
	// given the entities grid's selection-follows-cursor rule by copy-paste.
	historyStops()[0]?.focus();
	act(() => {
		fireEvent.keyDown(historyGrid(), { key: "ArrowDown" });
	});
	expect(document.activeElement === historyStops()[1]).toBe(true);
	expect(stub.calls.undo.mock.calls.length).toBe(0);

	// ⏎ is what takes the steps — and it has to be performed by the grid, because
	// `session.confirm` claims ⏎ on the window and preventDefaults a focused button's
	// native activation before it can happen.
	act(() => {
		fireEvent.keyDown(historyGrid(), { key: "Enter" });
	});
	// The SECOND row from the top is `dig`, which is two ⌘Z away.
	expect(stub.calls.undo.mock.calls.length).toBe(2);
});

// The bound's two "not listed" lines are rows of the grid that carry no control. The
// stop must skip them — it moves between BUTTONS — or ↑/↓ would stall on a note.
test("a 'not listed' note is a row the stop walks past", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	push(stub, ["dig", "fill"], ["paint"], { undoDepth: 9, redoDepth: 4 });
	expect(screen.getByText(/7 older steps not listed/)).toBeTruthy();
	expect(screen.getByText(/3 further redo steps not listed/)).toBeTruthy();
	// Five rows on screen, three of them steps.
	expect(screen.getAllByRole("row").length).toBe(5);
	expect(historyStops().length).toBe(3);

	historyStops()[2]?.focus();
	act(() => {
		fireEvent.keyDown(historyGrid(), { key: "ArrowDown" });
	});
	// WRAPPED to the first step, not stranded on the note below it.
	expect(document.activeElement === historyStops()[0]).toBe(true);
});
