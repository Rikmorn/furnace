// Harness tests for the Flags palette (F4.5b Task 13, D-F4.5-15) — the advisor's
// findings promoted out of the dissolving control stack.
//
// Ported assertion-for-assertion from `field-panel.test.tsx`'s FlagsSection block
// (the clustering, the triage channels, the verify column) and extended with what
// the palette is FOR: the reframed header, the pill chips, the row↔viewport
// selection pair, and the filters' persistence.
//
// ONE test did not survive the move, and its replacement is named rather than
// implied: `FlagsSection` took `verifying` as a PROP, so a test could re-render it
// through all four button states directly. The palette reads that state out of
// context, where only the host can produce it — so those four states are asserted
// through the stub host below ("only one runs at a time", "the in-flight column is
// released…", "a SYNCHRONOUS refusal…"), which is strictly closer to production.
//
// Every case mounts under `FieldHostStateProvider`: the twelve host seams are the
// shell's, and without it `stub.fire.flags` reaches nothing at all.
//
// House rule (learned twice this slice): compare an element to `null` FIRST.
// `expect(el).toBeNull()` on a happy-dom node serialises React's fiber graph and
// hangs the run instead of reporting.
import { afterEach, expect, test } from "bun:test";
import type { FieldFlag, FlagKind, FlagSeverity } from "@furnace/core/field";
import type { ReactElement } from "react";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { FlagsPalette } from "../../src/frontend/components/shell/FlagsPalette.tsx";
import { Toasts } from "../../src/frontend/components/shell/Toasts.tsx";
import { TooltipProvider } from "../../src/frontend/components/ui/tooltip.tsx";
import { FieldHostStateProvider } from "../../src/frontend/hooks/useFieldHostState.tsx";
import type { VerifyVerdictWire } from "../../src/frontend/lib/analyzer-protocol.ts";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import { createUiStore, type UiStore } from "../../src/frontend/lib/persist.ts";
import type { FlagRow, FlagsSummary } from "../../src/viewport-host/index.ts";
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
// The notification store is a module singleton (one editor, one message log), so a
// message raised by one case is still there for the next one. Clearing also cancels
// the TTL timers, which would otherwise fire into an unmounted tree.
afterEach(() => notify.clear());

/** A Map-backed `Storage`, so the persistence cases drive the REAL `createUiStore`
 *  (versioned key, JSON round trip, schema tolerance) rather than a fake with the
 *  same method names. */
function memoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (k) => map.get(k) ?? null,
		key: (i) => [...map.keys()][i] ?? null,
		removeItem: (k) => {
			map.delete(k);
		},
		setItem: (k, v) => {
			map.set(k, v);
		},
	};
}

// The TOOLTIP provider is part of the arrangement since F4.5c Task 8: the filter chips,
// the row buttons and Verify document themselves through `ActionTip` (D-25), and a Radix
// `Tooltip` outside a provider does not degrade — it THROWS. Shell.tsx mounts exactly one
// for the whole frame; this is that one, not a second.
const withEditor = (
	ui: ReactElement,
	stub: ReturnType<typeof makeStubHost>,
	store?: UiStore,
): ReactElement => (
	<EditorContext.Provider
		value={makeEditorContext({ fieldHostRef: { current: stub.host } })}
	>
		<TooltipProvider delayDuration={300}>
			<FieldHostStateProvider host={stub.host} engineReady store={store}>
				{ui}
				<Toasts />
			</FieldHostStateProvider>
		</TooltipProvider>
	</EditorContext.Provider>
);

const renderPalette = (
	stub: ReturnType<typeof makeStubHost>,
	store?: UiStore,
) => render(withEditor(<FlagsPalette />, stub, store));

/** One stage-1 finding. `cell` is derived from `world` at the production 0.25 m
 *  lattice: the palette never reads it, but a fixture whose cell contradicted its
 *  world would mislead the next reader. */
const flagAt = (
	kind: FlagKind,
	severity: FlagSeverity,
	world: [number, number, number],
	extra: Partial<FieldFlag> = {},
): FieldFlag => ({
	kind,
	severity,
	cell: [world[0] * 4, world[1] * 4, world[2] * 4],
	world,
	chunk: "0,0,0",
	...extra,
});

/** A summary row. The keys here are DELIBERATELY opaque nonsense (`a`, `b`): the
 *  host's real format is private to field-flags.ts, and a palette that hands one
 *  of these straight back cannot be reconstructing it. */
const rowOf = (
	key: string,
	flag: FieldFlag,
	verdict?: VerifyVerdictWire,
): FlagRow => (verdict === undefined ? { key, flag } : { key, flag, verdict });

const summaryOf = (
	visible: FlagRow[],
	over: Partial<FlagsSummary> = {},
): FlagsSummary => ({
	total: visible.length,
	// Derived rather than passed, because the HEADER reads it and a fixture that
	// left it empty would render "0 candidates" over a list of candidates — a
	// fixture making the header's two numbers indistinguishable from each other.
	byKindSeverity: visible.map((r) => ({
		kind: r.flag.kind,
		severity: r.flag.severity,
		count: 1,
	})),
	visible,
	selected: null,
	...over,
});

const NARROW = rowOf("a", flagAt("narrow", "candidate", [2.5, 0, -8]));

const VERDICT_TRAPPED: VerifyVerdictWire = {
	outcome: "trapped",
	lanes: [],
	ms: 12,
};

/** A toast row's text, SCOPED to the stack. The toast layer also publishes two
 *  persistent announcement regions carrying the same string (the house
 *  live-region pattern — see Toasts), so an unscoped `getByText` is ambiguous. */
const toastText = (text: string | RegExp): HTMLElement =>
	within(screen.getByRole("list", { name: "notifications" })).getByText(text);

const chip = (band: string): HTMLButtonElement =>
	screen.getByRole("button", { name: band }) as HTMLButtonElement;

// --- the header: indictment → hint ------------------------------------------

test("the header leads with CANDIDATES and demotes the total", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(
			summaryOf([NARROW], {
				total: 12,
				byKindSeverity: [
					{ kind: "narrow", severity: "candidate", count: 4 },
					{ kind: "ledge", severity: "info", count: 8 },
				],
			}),
		);
	});
	// "Flags (12)" was an indictment; this leads with the 4 things worth looking at.
	// The count is what was FOUND, not what the chips admit — a header that counted
	// visible rows would read "0 candidates" the moment someone unticked one, which
	// is the one reading a filter must never be able to produce.
	expect(screen.getByText("Flags · 4 candidates")).toBeTruthy();
	// The total is still there, secondary, beside how much of it is on screen —
	// which is the only reading of what the chips are hiding.
	expect(screen.getByText("1 of 12 total")).toBeTruthy();
});

test("one candidate is singular", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(summaryOf([NARROW]));
	});
	expect(screen.getByText("Flags · 1 candidate")).toBeTruthy();
});

test("an empty advisor says so rather than rendering an empty list", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	// The subscribe push is an EMPTY summary. Unlike the section it replaces, the
	// palette does NOT unmount itself: it is a palette the user opened, and a box
	// that vanishes when there is good news is a box they cannot trust is working.
	expect(screen.getByText("Flags · 0 candidates")).toBeTruthy();
	expect(screen.getByText(/Nothing found/)).toBeTruthy();
});

test("filters that hide every finding are still the way back", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(summaryOf([], { total: 7 }));
	});
	// The chips stay on screen — hiding them with the rows would take away the only
	// control that can bring the rows back.
	expect(screen.getByText("all 7 hidden by the filters")).toBeTruthy();
	expect(chip("candidates")).toBeTruthy();
});

// --- the pill chips ---------------------------------------------------------

test("the shell pushes the filter defaults at engine-ready and each chip edits them", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	// Chrome and host must start in agreement (the DEFAULT_LAYERS precedent). The
	// push is the PROVIDER's — one effect keyed on the filter value, so engine-ready
	// and every later edit go through the same path instead of two that can disagree.
	expect(stub.calls.setFlagFilters.mock.calls).toEqual([
		[{ candidates: true, info: false, unreachable: false, pits: true }],
	]);
	act(() => {
		stub.fire.flags(summaryOf([NARROW]));
	});

	fireEvent.click(chip("info"));
	expect(stub.calls.setFlagFilters.mock.calls.at(-1)?.[0]).toEqual({
		candidates: true,
		info: true,
		unreachable: false,
		pits: true,
	});
	fireEvent.click(chip("candidates"));
	expect(stub.calls.setFlagFilters.mock.calls.at(-1)?.[0]).toEqual({
		candidates: false,
		info: true,
		unreachable: false,
		pits: true,
	});
	// `pits` is a VETO, not a band: unticking it subtracts one kind and leaves the
	// severity bands alone. Its default is ON, which the push above already pinned.
	fireEvent.click(chip("pits"));
	expect(stub.calls.setFlagFilters.mock.calls.at(-1)?.[0]).toEqual({
		candidates: false,
		info: true,
		unreachable: false,
		pits: false,
	});
});

test("a chip is a two-state toggle to assistive tech, not a styled span", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	// The mock draws pills. A `<span>` with a class would have been the same pixels
	// and no semantics at all — `aria-pressed` is what makes "candidates is on" a
	// fact a screen reader can report, and the state has to MOVE with the click.
	expect(chip("candidates").getAttribute("aria-pressed")).toBe("true");
	expect(chip("info").getAttribute("aria-pressed")).toBe("false");
	fireEvent.click(chip("candidates"));
	expect(chip("candidates").getAttribute("aria-pressed")).toBe("false");

	// The four are a GROUP, not four loose buttons that happen to sit in a row.
	const group = screen.getByRole("group", { name: "flag filters" });
	for (const band of ["candidates", "info", "pits", "unreachable"])
		expect(group.contains(chip(band))).toBe(true);
});

// --- persistence (D-F4.5-3) -------------------------------------------------

test("the chips restore from the workspace blob, and a click writes back", () => {
	const storage = memoryStorage();
	const store = createUiStore(storage, "/tmp/project");
	store.set("flagFilters", {
		candidates: false,
		info: true,
		unreachable: false,
		pits: true,
	});
	const restored = makeStubHost();
	renderPalette(restored, store);
	// Restored into the chips…
	expect(chip("candidates").getAttribute("aria-pressed")).toBe("false");
	expect(chip("info").getAttribute("aria-pressed")).toBe("true");
	// …and PUSHED to the host, which is the half that matters: the filters gate the
	// viewport's markers too, so a restore that only repainted the chips would leave
	// them describing bands the host is not drawing.
	expect(restored.calls.setFlagFilters.mock.calls.at(-1)?.[0]).toEqual({
		candidates: false,
		info: true,
		unreachable: false,
		pits: true,
	});
});

test("a chip click is the only writer, and it lands in the blob", async () => {
	const storage = memoryStorage();
	const store = createUiStore(storage, "/tmp/project");
	const stub = makeStubHost();
	renderPalette(stub, store);
	// NOTHING is written before the first interaction — otherwise the defaults this
	// component rendered would overwrite a blob it has not read yet (the useView
	// pair's rule, and the reason `touched` exists).
	expect(store.get("flagFilters")).toBeUndefined();

	fireEvent.click(chip("info"));
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 250));
	});
	expect(store.get("flagFilters")).toEqual({
		candidates: true,
		info: true,
		unreachable: false,
		pits: true,
	});
});

// --- selection: the viewport is the primary surface -------------------------

test("a row click selects the finding on the HOST, by its own opaque key", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(summaryOf([NARROW]));
	});

	fireEvent.click(
		screen.getByLabelText("select candidate narrow @ (2.5, 0.0, -8.0)"),
	);

	// The key is the store's own opaque string, handed straight back — the chrome
	// never builds one (it cannot: the format is private to field-flags.ts). The
	// camera move that follows is the HOST's, and is pinned host-side: a row click
	// used to call `frameChunks`, which framed the finding's whole 4 m chunk.
	expect(stub.calls.selectFlag.mock.calls).toEqual([["a"]]);
	expect(stub.calls.frameChunks.mock.calls.length).toBe(0);
});

test("a marker clicked in the VIEWPORT lights up its row here", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(
			summaryOf([
				NARROW,
				rowOf("b", flagAt("narrow", "candidate", [40, 0, 0])),
			]),
		);
	});
	const row = (name: string): HTMLElement => {
		const li = screen.getByLabelText(name).closest("li");
		if (!(li instanceof HTMLElement))
			throw new Error("flag rows are no longer <li> — the row scope is gone");
		return li;
	};
	const first = "select candidate narrow @ (2.5, 0.0, -8.0)";
	const second = "select candidate narrow @ (40.0, 0.0, 0.0)";
	expect(screen.getByLabelText(first).getAttribute("aria-current")).toBe(null);

	// The host published a selection nothing in this palette asked for — which is
	// exactly what a viewport marker click produces. Both surfaces read the ONE
	// seam; neither talks to the other.
	act(() => {
		stub.fire.flags(
			summaryOf(
				[NARROW, rowOf("b", flagAt("narrow", "candidate", [40, 0, 0]))],
				{ selected: "b" },
			),
		);
	});
	expect(screen.getByLabelText(second).getAttribute("aria-current")).toBe(
		"true",
	);
	expect(screen.getByLabelText(first).getAttribute("aria-current")).toBe(null);
	expect(row(second).className).toContain("bg-primary");
	expect(row(first).className).not.toContain("bg-primary");
});

test("a viewport selection SCROLLS its row into view", () => {
	// The other half of "the palette row highlights + scrolls". A marker click lands on
	// a finding that may be a hundred rows down a list with its own scroll box, so the
	// highlight alone is a state change nobody can see. happy-dom runs no layout, so
	// what is observable is the CALL — which is the whole of what this component does
	// (the scrolling itself is the browser's).
	const stub = makeStubHost();
	const calls: ScrollIntoViewOptions[] = [];
	const real = Element.prototype.scrollIntoView;
	Element.prototype.scrollIntoView = function scrollIntoView(
		arg?: boolean | ScrollIntoViewOptions,
	) {
		calls.push(typeof arg === "object" && arg !== null ? arg : {});
	};
	try {
		renderPalette(stub);
		act(() => {
			stub.fire.flags(summaryOf([NARROW, FAR_ROW]));
		});
		// Nothing selected: nothing scrolls. Without this the assertion below could be
		// satisfied by a component that scrolls on every push — which is the defect the
		// effect's `[flags.selected]` dep exists to prevent (the seam fires on every
		// analyzer response, and a list that jumped each time would be unreadable).
		expect(calls.length).toBe(0);

		act(() => {
			stub.fire.flags(summaryOf([NARROW, FAR_ROW], { selected: "b" }));
		});
		expect(calls.length).toBe(1);
		// `block: "nearest"` and not `"center"`: a row already on screen must stay
		// exactly where it is, or a ROW CLICK would make the list jump under the cursor
		// that clicked it (the DriftReport badge's idiom).
		expect(calls[0]?.block).toBe("nearest");

		// …and an unrelated push does not re-scroll: same selection, new rows.
		act(() => {
			stub.fire.flags(summaryOf([NARROW, FAR_ROW], { selected: "b" }));
		});
		expect(calls.length).toBe(1);
	} finally {
		Element.prototype.scrollIntoView = real;
	}
});

test("a selected CLUSTER MEMBER lights the row it was folded into", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	// Two findings 1 m apart cluster into one row whose identity is the ANCHOR's
	// key. A viewport click lands on ONE marker, which may be the member — so a row
	// that only compared its anchor would leave the user's own click unhighlighted,
	// and it is precisely in a cluster that "which one did I click?" is the question.
	act(() => {
		stub.fire.flags(
			summaryOf(
				[
					rowOf("a", flagAt("narrow", "candidate", [0, 0, 0])),
					rowOf("b", flagAt("narrow", "candidate", [1, 0, 0])),
				],
				{ selected: "b" },
			),
		);
	});
	const rowButton = screen.getByLabelText(
		"select candidate narrow ×2 @ (0.0, 0.0, 0.0)",
	);
	expect(rowButton.getAttribute("aria-current")).toBe("true");
});

test("a refused select surfaces as a toast and selects nothing", () => {
	const stub = makeStubHost({
		selectFlagRefusal: "that flag was re-analyzed away",
	});
	renderPalette(stub);
	act(() => {
		stub.fire.flags(summaryOf([NARROW]));
	});

	fireEvent.click(
		screen.getByLabelText("select candidate narrow @ (2.5, 0.0, -8.0)"),
	);

	// A row click racing a re-analysis is reachable for real. The host refuses
	// synchronously on the tool-error seam, and the message is on screen rather
	// than swallowed. This is the WHOLE claim here, deliberately: the other half —
	// that a refusal leaves the standing selection alone — is a fact about the host,
	// and a stub whose `selectFlag` never sets `selected` would satisfy an
	// "aria-current is null" assertion whether or not the refusal happened. It is
	// pinned where it can fail, in tests/field-host-flag-select.test.ts.
	expect(toastText("that flag was re-analyzed away")).toBeTruthy();
});

// --- clustering (ported verbatim: the constant, its axes, its bands) --------

// The radius is bracketed from BOTH sides — 1.5 m must fold in, 2.5 m must not —
// which pins the constant to [1.5, 2.5) rather than merely "somewhere sane" (the
// membership test is `<=`, so 1.5 passes and 2.5 does not). A one-sided set
// (everything either well inside or 10 m out) passes at 2 m and at 4 m alike,
// which is a test that would not notice the constant changing. Verified by
// mutation: 1.4 and 2.6 both go red, and so do 1 and 4. The window is a metre
// wide on purpose — this is a triage heuristic, and pinning it to ±0.1 m would
// fail a deliberate re-tune that changed no behaviour anyone can see.
test("findings of one kind within 2 m collapse into one row; the ones outside it keep their own", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(
			summaryOf([
				rowOf("a", flagAt("narrow", "candidate", [0, 0, 0])),
				// 1.5 m from the anchor — inside the radius, so it folds in.
				rowOf("b", flagAt("narrow", "candidate", [1.5, 0, 0])),
				// 1.5 m from `b` but 3 m from the anchor: a cluster admits a flag near ANY
				// member, so the run chains rather than splitting.
				rowOf("c", flagAt("narrow", "candidate", [3, 0, 0])),
				// 2.5 m past the nearest member of that run (`c`) — the UPPER bound. A
				// radius that grew to 4 m would swallow it and this row would vanish.
				rowOf("d", flagAt("narrow", "candidate", [5.5, 0, 0])),
				// 4.5 m past `d` — out under any of the radii above, so the run's tail
				// cannot chain this far however the constant moves.
				rowOf("e", flagAt("narrow", "candidate", [10, 0, 0])),
				// Inside the radius of the anchor but a DIFFERENT kind: one row is one
				// kind, because the row's label and dot describe all of it.
				rowOf("f", flagAt("low-clearance", "candidate", [0.5, 0, 0])),
			]),
		);
	});
	// ×3 and not ×4: shrinking the radius below 1.5 m splits the run, growing it
	// past 2.5 m absorbs `d`. Both directions move this string.
	expect(screen.getByText("narrow ×3 @ (0.0, 0.0, 0.0)")).toBeTruthy();
	expect(screen.getByText("narrow @ (5.5, 0.0, 0.0)")).toBeTruthy();
	expect(screen.getByText("narrow @ (10.0, 0.0, 0.0)")).toBeTruthy();
	expect(screen.getByText("low-clearance @ (0.5, 0.0, 0.0)")).toBeTruthy();
});

// The radius is a SPHERE, and each axis of it has to be live. Every other fixture
// in this file sits at y = 0, which leaves the Y term dead: a `dy = 0` slip would
// collapse two floors of a shaft into one row — the exact geometry a walkability
// advisor exists to flag — with the whole suite still green.
test("the cluster radius is spherical — a 3 m gap on ANY axis is two rows", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(
			summaryOf([
				rowOf("a", flagAt("narrow", "candidate", [0, 0, 0])),
				rowOf("b", flagAt("narrow", "candidate", [3, 0, 0])),
				// Same XZ as the anchor, one storey up.
				rowOf("c", flagAt("narrow", "candidate", [0, 3, 0])),
				rowOf("d", flagAt("narrow", "candidate", [0, 0, 3])),
			]),
		);
	});
	expect(screen.getByText("narrow @ (0.0, 0.0, 0.0)")).toBeTruthy();
	expect(screen.getByText("narrow @ (3.0, 0.0, 0.0)")).toBeTruthy();
	expect(screen.getByText("narrow @ (0.0, 3.0, 0.0)")).toBeTruthy();
	expect(screen.getByText("narrow @ (0.0, 0.0, 3.0)")).toBeTruthy();
});

test("candidates sort above info, and a demoted row says so", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(
			summaryOf([
				rowOf("a", flagAt("ledge", "info", [0, 0, 0])),
				rowOf(
					"b",
					flagAt("narrow", "candidate", [0, 0, 0], { unreachable: true }),
				),
			]),
		);
	});
	const labels = screen
		.getAllByRole("button", { name: /^select / })
		.map((b) => b.getAttribute("aria-label"));
	expect(labels).toEqual([
		"select candidate narrow @ (0.0, 0.0, 0.0)",
		"select info ledge @ (0.0, 0.0, 0.0)",
	]);
	// The `unreachable` chip is opt-in, so a row it admitted has to say WHY it is
	// there — otherwise widening the filter just grows the list.
	const demoted = screen
		.getByLabelText("select candidate narrow @ (0.0, 0.0, 0.0)")
		.closest("li");
	if (!(demoted instanceof HTMLElement))
		throw new Error("flag rows are no longer <li> — the row scope is gone");
	expect(within(demoted).getByText("unreachable")).toBeTruthy();
	const info = screen.getByLabelText("select info ledge @ (0.0, 0.0, 0.0)");
	expect(info.closest("li")?.textContent).not.toContain("unreachable");
	// The band reaches a reader through THREE channels, and the assertions above
	// already cover the third (it is in each accessible name). The other two are the
	// dot's hue — alarm for what to act on, amber for context, the viewport's
	// CANDIDATE_TINT / INFO_TINT twins — and its SHAPE. Both are pinned because hue
	// alone is WCAG 1.4.1: red against amber is a hard pair, and this is the one axis
	// the whole list is triaged on.
	const dot = (row: HTMLElement, glyph: string): HTMLElement =>
		within(row).getByText(glyph);
	expect(dot(demoted, "●").className).toContain("text-destructive");
	const infoRow = info.closest("li");
	if (!(infoRow instanceof HTMLElement))
		throw new Error("flag rows are no longer <li> — the row scope is gone");
	expect(dot(infoRow, "○").className).toContain("text-warning");
	// …and the two glyphs are not interchangeable: a filled dot in the info row
	// would mean the shape channel had collapsed back onto colour alone.
	expect(within(infoRow).queryByText("●") === null).toBe(true);
	expect(within(demoted).queryByText("○") === null).toBe(true);
});

// The band a row groups on is everything it DISPLAYS, demotion included. Two
// findings alike in kind, severity and position but differing in `unreachable` are
// the pair that proves it: folded together, one row would wear a chip that is false
// for half its members — and the reachability tag is the one thing on a flag the
// analyzer writes AFTER the fact, so mixed vintages are the normal state.
test("a demoted finding never folds into a live one's row", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(
			summaryOf([
				rowOf("a", flagAt("narrow", "candidate", [0, 0, 0])),
				rowOf(
					"b",
					flagAt("narrow", "candidate", [0.5, 0, 0], { unreachable: true }),
				),
			]),
		);
	});
	expect(screen.getByText("narrow @ (0.0, 0.0, 0.0)")).toBeTruthy();
	expect(screen.getByText("narrow @ (0.5, 0.0, 0.0)")).toBeTruthy();
});

// --- the verify column ------------------------------------------------------

// I2's forcing function, and the reason `disabled` DERIVES from `verifyRefusal`
// rather than restating its rule: the two can only disagree if something adds a
// refusal reason to one and not the other, and the failure is silent — a live
// button whose own accessible name explains why it is not. Quantified over every
// row rather than naming the pit, so it holds for reasons that do not exist yet.
test("a Verify that ANNOUNCES a refusal is a Verify that is disabled", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(
			summaryOf([
				rowOf("a", flagAt("narrow", "candidate", [0, 0, 0])),
				rowOf("b", flagAt("ledge", "info", [9, 0, 0])),
				rowOf("c", flagAt("pit", "candidate", [20, 0, 0], { cells: 6 })),
			]),
		);
	});
	const buttons = screen.getAllByRole("button", {
		name: /^verify /,
	}) as HTMLButtonElement[];
	expect(buttons.length).toBe(3);
	// ". Unavailable: " is the refusal, and it is unambiguous BECAUSE verifyName
	// breaks the sentence rather than appending a parenthetical: a row label ends in
	// "(2.5, 0.0, -8.0)", so a trailing "(…)" would match every button here.
	const announced = buttons.filter((b) =>
		(b.getAttribute("aria-label") ?? "").includes(". Unavailable: "),
	);
	expect(announced.map((b) => b.disabled)).toEqual(announced.map(() => true));
	// Non-vacuous — the fixture's pit puts at least one button in that set.
	// Deliberately `>= 1` and not `=== 1`: pinning the exact count would turn a
	// LEGITIMATE new refusal reason into a failure of this test.
	expect(announced.length).toBeGreaterThanOrEqual(1);
});

test("a pit refuses Verify with its reason in the accessible name", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(
			summaryOf([
				rowOf("a", flagAt("pit", "candidate", [9, 0, 0], { cells: 14 })),
			]),
		);
	});
	// The title rides a non-focusable wrapper span (a disabled button eats pointer
	// events), so the accessible name is the only channel that reaches a screen
	// reader — the EntitiesList blocked-Open convention.
	const verify = screen.getByLabelText(
		"verify pit @ (9.0, 0.0, 0.0) · 14 cells. Unavailable: region-level — walk it",
	) as HTMLButtonElement;
	expect(verify.disabled).toBe(true);
});

// --- D-25: VerifyVerb's three states, one channel each -----------------------
//
// The component the tooltip conversion ADDED, and the branch its first cut got wrong:
// routing on `refusal === null` handed a RUNNING verify's tooltip trigger a `disabled`
// button, so the sentence reached nobody while the docblock said it did. All three states
// are pinned here because two of them are one boolean apart.

test("an available Verify documents itself with a tooltip a keyboard opens", async () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(summaryOf([NARROW]));
	});
	const verify = screen.getByLabelText(/^verify narrow @ \(2\.5/);
	// The attribute this replaced — its absence is half the claim.
	expect(verify.getAttribute("title")).toBeNull();
	act(() => {
		fireEvent.focus(verify);
	});
	expect(
		within(await screen.findByRole("tooltip")).getByText(
			"drive the project's mover at this finding",
		),
	).toBeTruthy();
});

test("a RUNNING Verify carries no channel at all — not a tooltip, not a title", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(summaryOf([NARROW]));
	});
	const verify = (): HTMLButtonElement =>
		screen.getByLabelText(/^verify narrow @ \(2\.5/) as HTMLButtonElement;
	fireEvent.click(verify());
	expect(verify().textContent).toBe("Verifying…");

	// Disabled by the user's own press: in a BROWSER it takes neither pointer events nor
	// focus, so a tooltip trigger merged onto it can never fire. The ruling is that this
	// state needs no channel (the button already says "Verifying…"); what must not happen
	// is a trigger that silently promises one.
	//
	// The focus assertion below detects exactly that TRIGGER, and deliberately so: happy-dom
	// dispatches a synthetic focus at a disabled button where a real browser would not, so a
	// wrapped control opens its tooltip here — which is why this line reddens against the
	// wrong routing and would be untestable if it only mirrored the browser's own refusal.
	expect(verify().disabled).toBe(true);
	expect(verify().getAttribute("title")).toBeNull();
	expect(verify().parentElement?.getAttribute("title")).toBeNull();
	act(() => {
		fireEvent.focus(verify());
	});
	expect(screen.queryByRole("tooltip") === null).toBe(true);
});

test("a REFUSED Verify puts its reason on the wrapper, and none on the button", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(
			summaryOf([
				rowOf("a", flagAt("pit", "candidate", [9, 0, 0], { cells: 14 })),
			]),
		);
	});
	// The EntitiesList blocked-verb convention, asserted from both sides: the reason on
	// the hoverable wrapper for a mouse, in the accessible NAME for everyone else, and no
	// second `title` on the button underneath (the double-`title` D-25 replaced).
	const verify = screen.getByLabelText(
		"verify pit @ (9.0, 0.0, 0.0) · 14 cells. Unavailable: region-level — walk it",
	);
	expect(verify.getAttribute("title")).toBeNull();
	expect(verify.parentElement?.getAttribute("title")).toBe(
		"region-level — walk it",
	);
});

test("a verdict on the next push badges the row", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(summaryOf([NARROW]));
	});
	expect(screen.queryByText("trapped") === null).toBe(true);
	// Stage 2's answer arrives joined onto the row it was taken on (the host pushes
	// a fresh summary), not as a separate verdict channel.
	act(() => {
		stub.fire.flags(summaryOf([rowOf("a", NARROW.flag, VERDICT_TRAPPED)]));
	});
	expect(screen.getByText("trapped")).toBeTruthy();
});

// Stage 2 takes ONE flag, so a cluster row's verdict is a sample, not a survey —
// and `narrow ×2 · trapped` reads as two proven traps. The scope therefore has to
// ride the two channels assistive tech actually gets: a chip's own text (a `title`
// on a generic span reaches a mouse and nothing else, and `aria-label` on one has
// no reliable exposure) and the accessible NAME of the verb.
test("a cluster's verdict and Verify say WHICH finding they are about", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(
			summaryOf([
				rowOf("a", flagAt("narrow", "candidate", [0, 0, 0]), VERDICT_TRAPPED),
				rowOf("b", flagAt("narrow", "candidate", [1, 0, 0])),
			]),
		);
	});
	expect(screen.getByText("first: trapped")).toBeTruthy();
	expect(
		screen.getByLabelText(
			"verify narrow ×2 @ (0.0, 0.0, 0.0) — the first finding in this row",
		),
	).toBeTruthy();
});

/** The second of two rows far enough apart not to cluster (CLUSTER_RADIUS_M is
 *  2 m), so the list renders two independent Verify buttons. */
const FAR_ROW = rowOf("b", flagAt("narrow", "candidate", [40, 0, 0]));
const TWO_ROWS: FlagRow[] = [NARROW, FAR_ROW];

test("Verify hands back the row's own key, and only one runs at a time", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(summaryOf(TWO_ROWS));
	});

	fireEvent.click(screen.getByLabelText("verify narrow @ (2.5, 0.0, -8.0)"));
	// The host verb, with the store's own opaque key handed straight back.
	expect(stub.calls.verifyFlag.mock.calls).toEqual([["a"]]);
	// …and the chrome adopts the in-flight row itself, because nothing pushes it
	// back: `verifyFlag` is fire-and-forget and the verdict is the next signal.
	const running = screen.getByLabelText(
		"verify narrow @ (2.5, 0.0, -8.0)",
	) as HTMLButtonElement;
	expect(running.textContent).toBe("Verifying…");
	expect(running.disabled).toBe(true);
	// Budgeted verb: every OTHER row refuses, with the reason in its name, and a
	// click on one starts nothing.
	const other = screen.getByLabelText(
		"verify narrow @ (40.0, 0.0, 0.0). Unavailable: a verify is already running",
	) as HTMLButtonElement;
	expect(other.disabled).toBe(true);
	fireEvent.click(other);
	expect(stub.calls.verifyFlag.mock.calls).toEqual([["a"]]);
});

test("the in-flight column is released by a verdict AND by a refusal", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	act(() => {
		stub.fire.flags(summaryOf(TWO_ROWS));
	});
	const verifyA = (): HTMLButtonElement =>
		screen.getByLabelText(/^verify narrow @ \(2\.5/) as HTMLButtonElement;

	// (1) the verdict push — the ordinary end of a verify.
	fireEvent.click(verifyA());
	expect(verifyA().textContent).toBe("Verifying…");
	act(() => {
		stub.fire.flags(
			summaryOf([rowOf("a", NARROW.flag, VERDICT_TRAPPED), FAR_ROW]),
		);
	});
	expect(verifyA().textContent).toBe("verify ▸");

	// (2) a REFUSAL. The host's four refusals (busy, no profile, a key it no longer
	// holds, a pit) all report on the tool-error seam and push NO flags — so a column
	// released only by (1) would stick until the next edit, showing a verify that
	// never started as one still running.
	fireEvent.click(verifyA());
	expect(verifyA().textContent).toBe("Verifying…");
	act(() => {
		stub.fire.toolError("that flag was re-analyzed away");
	});
	expect(verifyA().textContent).toBe("verify ▸");
	// …and the refusal is not swallowed on the way: it is on screen as a toast,
	// which is the only place it is said now.
	expect(toastText("that flag was re-analyzed away")).toBeTruthy();

	// (3) a WARN does NOT release it, which is the other half of (2)'s reasoning. The
	// release exists because a refusal pushes no flags, so nothing else would ever say
	// the verify never began — and every one of those refusals is an `error`. A warning
	// is not a way a verify can fail to start, so releasing on one could only ever blank
	// a column that is telling the truth: the verify is still running, the host still
	// refuses a second with "a verify is already running", and the row would offer a
	// button that does nothing.
	fireEvent.click(verifyA());
	expect(verifyA().textContent).toBe("Verifying…");
	act(() => {
		stub.fire.toolError(
			"walkability advisor idle — this project installs no agent profile",
			"warn",
		);
	});
	expect(verifyA().textContent).toBe("Verifying…");
	// Said, though — a warning that released nothing must still be readable, or the
	// branch would be indistinguishable from dropping the message on the floor.
	expect(
		toastText(
			"walkability advisor idle — this project installs no agent profile",
		),
	).toBeTruthy();
	// …and the ERROR half still works from this same state, so the case cannot pass by
	// the release having stopped working altogether.
	act(() => {
		stub.fire.toolError("a verify is already running");
	});
	expect(verifyA().textContent).toBe("verify ▸");
});

test("a SYNCHRONOUS refusal never leaves the column stuck", () => {
	// ALL FOUR of the host's verify refusals report from INSIDE verifyFlag, before it
	// returns (only a stage-2 FAILURE is async). So the adopt has to happen first:
	// adopting afterwards overwrites the release that refusal already performed, and
	// the row reads "Verifying…" forever over a verify that never started.
	const stub = makeStubHost({ verifyRefusal: "a verify is already running" });
	renderPalette(stub);
	act(() => {
		stub.fire.flags(summaryOf(TWO_ROWS));
	});
	const verifyA = (): HTMLButtonElement =>
		screen.getByLabelText(/^verify narrow @ \(2\.5/) as HTMLButtonElement;

	fireEvent.click(verifyA());
	expect(stub.calls.verifyFlag.mock.calls).toEqual([["a"]]);
	expect(verifyA().textContent).toBe("verify ▸");
	expect(toastText("a verify is already running")).toBeTruthy();
});

// --- the engine-boot gate ---------------------------------------------------

test("before the engine bundle lands the palette makes no claim about the world", () => {
	const stub = makeStubHost();
	render(
		<EditorContext.Provider
			value={makeEditorContext({
				state: { status: "booting" },
				fieldHostRef: { current: stub.host },
			})}
		>
			<TooltipProvider delayDuration={300}>
				<FieldHostStateProvider host={stub.host} engineReady={false}>
					<FlagsPalette />
				</FieldHostStateProvider>
			</TooltipProvider>
		</EditorContext.Provider>,
	);
	// "Flags · 0 candidates" here would be a claim about a world nothing has
	// analysed yet — the same gate, and deliberately the same sentence, every other
	// host-reading palette carries.
	expect(screen.getByText(/waits for the engine bundle/)).toBeTruthy();
	expect(screen.queryByText(/candidates/) === null).toBe(true);
});
