// Registered FIRST, before any other import in this file, and that ordering is
// load-bearing rather than style: Radix resolves `globalThis.document` at MODULE
// EVALUATION time to decide whether it may use layout effects, and its Portal never
// mounts if the answer was no. Import Shell before the DOM exists and the burger menu's
// content is unreachable for the rest of the process — the menu opens (aria-expanded
// flips) with nothing in it. Measured this session, moving the workspace-verb cases in.
import "../inspector/_register.ts";

// The overlay shell's skeleton: one full-window canvas between two fixed-height bars,
// with every other surface floating OVER the canvas as an absolute layer.
//
// happy-dom runs no layout (every getBoundingClientRect is zero by default), so the
// pixel outcome is never assertable here. What IS assertable is the structure that
// produces it — which is exactly what the layout contract is: the canvas fills its cell
// (`absolute inset-0`), every palette is a LAYER inside that same cell rather than a
// flex sibling that would take width off it, and the two bars are shrink-0 siblings
// OUTSIDE the cell. Sabotage-proven: making the panel a flex sibling, or dropping the
// canvas's aria-label, each fails a case below.
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { Shell } from "../../src/frontend/components/shell/Shell.tsx";
import {
	FieldHostStateProvider,
	useFieldHostState,
} from "../../src/frontend/hooks/useFieldHostState.tsx";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import type { UiStore } from "../../src/frontend/lib/persist.ts";
import {
	act,
	cleanup,
	fakeUiStore,
	fireEvent,
	makeEditorContext,
	render,
	renderWithEditor,
	screen,
	waitFor,
	within,
} from "../inspector/_harness.tsx";
import { makeStats, makeStubHost } from "./_stub-host.ts";

afterEach(cleanup);
// The notification store is a module singleton (one editor, one message log), so a
// message raised by one case is still there for the next one. Clearing also cancels
// the TTL timers, which would otherwise fire into an unmounted tree.
afterEach(() => notify.clear());

// --- environment: a laid-out canvas + a quiet catalog fetch ------------------

// CanvasHost measures the canvas at mount and FAILS LOUD on a zero box (the shell's
// CSS contract broken — see its header). happy-dom reports zero for everything, so a
// test that wants the real init path has to supply a measurement. Stubbed on the
// prototype rather than injected through a prop: the production component keeps no
// test seam, and the override is undone after every case.
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

/** The field toolbar inside the panel fires its run-once catalog GETs on mount; a
 *  project without catalogs 404s, which is a legitimate shape and the quietest one. */
function fetch404(): void {
	// Boundary cast: the stub serves only the toolbar's catalog GETs, so it implements
	// the call signature and none of `fetch`'s statics (preconnect).
	globalThis.fetch = (() =>
		Promise.resolve(
			new Response("", { status: 404 }),
		)) as unknown as typeof fetch;
}

/** The shell under a mock editor context, as an ELEMENT — so a case can re-render it
 *  with a different context (the store arriving late) rather than only mount it. */
const withEditor = (
	ui: ReactElement,
	stub: ReturnType<typeof makeStubHost>,
	store?: UiStore,
) => (
	<EditorContext.Provider
		value={makeEditorContext({ fieldHostRef: { current: stub.host }, store })}
	>
		{ui}
	</EditorContext.Provider>
);

const renderShellResult = (
	stub: ReturnType<typeof makeStubHost>,
	store?: UiStore,
) => render(withEditor(<Shell />, stub, store));

/** Let the field toolbar's run-once catalog GET settle: two microtask turns, the path
 *  awaiting fetch() then res.text(). Needed after anything that MOUNTS the panel — a
 *  reset or a re-open does, and its state lands outside act without this. */
const flushCatalog = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});

async function renderShell(
	stub: ReturnType<typeof makeStubHost>,
	store?: UiStore,
) {
	const result = renderShellResult(stub, store);
	await flushCatalog();
	return result;
}

/** The controls palette's own box (a labelled region), or null once it is collapsed or
 *  hidden — both of which take it out of the accessibility tree, which is precisely the
 *  claim those states make. */
const controlsPalette = () =>
	screen.queryByRole("region", { name: "Controls" });

/** A persisted arrangement that is nothing like the default, so a restore is visible.
 *  `edge: null` is what makes it float at an x/y a test can read off the style. */
const MOVED = {
	palettes: {
		controls: {
			x: 120,
			y: 60,
			edge: null,
			collapsed: false,
			open: true,
		},
	},
	hidden: false,
};

/** Open the burger and click one of its items. Radix opens on pointerdown, not click. */
function pickMenuItem(label: string | RegExp): void {
	act(() => {
		fireEvent.pointerDown(screen.getByLabelText("editor menu"), {
			button: 0,
			pointerType: "mouse",
		});
	});
	act(() => {
		fireEvent.click(screen.getByText(label));
	});
}

// --- (a) the one full-window canvas ------------------------------------------

test("the viewport is ONE canvas filling the cell between the bars", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);

	const canvases = document.querySelectorAll("canvas");
	expect(canvases.length).toBe(1);
	const canvas = screen.getByLabelText("field viewport");
	for (const cls of ["absolute", "inset-0", "h-full", "w-full"])
		expect(canvas.classList.contains(cls)).toBe(true);
	// Focusable: the host attaches its fly / radius / nudge keydowns to the canvas.
	expect(canvas.getAttribute("tabindex")).toBe("0");

	const cell = canvas.parentElement;
	if (!(cell instanceof HTMLElement)) throw new Error("canvas has no cell");
	// `relative` is what makes the canvas's inset-0 (and every overlay above it)
	// resolve against the cell rather than the page; flex-1 + min-h-0 is what makes
	// the cell take exactly what the two bars leave.
	for (const cls of ["relative", "flex-1", "min-h-0"])
		expect(cell.classList.contains(cls)).toBe(true);
});

test("the canvas is initialized on the host, eagerly, with no size-wait", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// One init, on the canvas the shell mounted — the dock-era deferral (wait for a
	// nonzero measure) is retired, so this must have happened by first effect.
	expect(stub.calls.init.mock.calls.length).toBe(1);
	expect(stub.calls.init.mock.calls[0]?.[0]).toBe(
		screen.getByLabelText("field viewport"),
	);
});

// --- the GPU lifecycle: fail loud, dispose once, survive a rejection ---------

test("a zero measure fails LOUD instead of waiting for a resize that never comes", () => {
	fetch404();
	// No rect stub: happy-dom measures everything as zero, which is exactly the shape
	// of a broken layout contract in the browser. The retired initWhenSized would have
	// waited here forever, silently, on a canvas that renders nothing.
	HTMLCanvasElement.prototype.getBoundingClientRect = REAL_RECT;
	const stub = makeStubHost();
	expect(() =>
		renderWithEditor(
			<Shell />,
			makeEditorContext({ fieldHostRef: { current: stub.host } }),
		),
	).toThrow(/measured zero/);
	// And it refused BEFORE touching the host — a zero-size init is what core's
	// bindToCanvas rejects, so the guard has to come first to say anything useful.
	expect(stub.calls.init).not.toHaveBeenCalled();
});

test("unmounting disposes the host exactly once, after init has settled", async () => {
	fetch404();
	const stub = makeStubHost();
	const { unmount } = await renderShell(stub);
	expect(stub.calls.dispose).not.toHaveBeenCalled();
	unmount();
	// The cleanup defers dispose behind the init promise, so it lands a microtask later
	// — disposing mid-`await` would pull the context out from under init's own trailing
	// GPU creations.
	await act(async () => {
		await Promise.resolve();
	});
	expect(stub.calls.dispose.mock.calls.length).toBe(1);
});

test("an init rejection lands in the status bar, NOT the global engine-error branch", async () => {
	fetch404();
	const stub = makeStubHost({ initRejection: "requestAdapter returned null" });
	await renderShell(stub);
	// The chrome is still usable — the engine BUILT fine, one GPU surface didn't come
	// up. Blanking the editor over that would take the message with it.
	expect(screen.getByText("engine: ok")).toBeTruthy();
	const [visible, live] = screen.getAllByText(
		/field host init failed: requestAdapter returned null/,
	);
	// `-text`, not the bare fill token: --destructive is a FILL colour and reads
	// 3.55:1 as text on --card, under the 4.5:1 floor (D-23's first half, landed with
	// the toasts). The exact class matters — "text-destructive" is a SUBSTRING of it,
	// so a loose assertion here would pass either way and pin nothing.
	expect(visible?.className).toContain("text-destructive-text");
	expect(live?.className).toContain("sr-only");
});

// --- the provider owns the single stats slot ---------------------------------

test("an identical stats push does not re-render the readout", () => {
	let renders = 0;
	function Probe() {
		const { stats } = useFieldHostState();
		renders++;
		return <span>{stats?.totalOps ?? "—"}</span>;
	}
	const stub = makeStubHost();
	render(
		<FieldHostStateProvider host={stub.host} engineReady>
			<Probe />
		</FieldHostStateProvider>,
	);
	const base = renders;
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 7 }));
	});
	expect(renders).toBe(base + 1);
	// A DIFFERENT object with identical values — which is what the host pushes every
	// rAF. Without statsEqual this re-renders every consumer 60×/second on an idle
	// field, and nothing else in the suite would notice.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 7 }));
	});
	expect(renders).toBe(base + 1);
	// …and a real change still gets through, so the guard isn't just swallowing pushes.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 8 }));
	});
	expect(renders).toBe(base + 2);
});

test("the provider releases the stats slot on unmount", () => {
	const stub = makeStubHost();
	const { unmount } = render(
		<FieldHostStateProvider host={stub.host} engineReady>
			<span />
		</FieldHostStateProvider>,
	);
	/** Push through the seam and report whether the slot took it (act-wrapped: while
	 *  mounted, delivery is a state update). */
	const push = (): boolean => {
		let delivered = false;
		act(() => {
			delivered = stub.fire.stats(makeStats());
		});
		return delivered;
	};
	expect(push()).toBe(true);
	unmount();
	// Single slot: an unsubscribe that does not FREE it leaves the next mount unable to
	// claim one — the readout would be dead with nothing thrown and nothing logged.
	expect(push()).toBe(false);
});

// --- (b) the top bar ----------------------------------------------------------

test("the top bar carries the menu, the world chip and the bake verb", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	expect(screen.getByLabelText("editor menu")).toBeTruthy();
	// The chip names the world, and a fresh session has none — never prefilled (the
	// W3/W4 clobber lesson: a stale default silently overwrites the game's world).
	expect(screen.getByRole("button", { name: "untitled" })).toBeTruthy();
	// Bake writes worlds/index.json as well as the world, so it needs a name to write
	// about — disabled while untitled, with the reason on the wrapper (a disabled
	// button swallows its own tooltip).
	const bake = screen.getByRole("button", {
		name: "Bake",
	}) as HTMLButtonElement;
	expect(bake.disabled).toBe(true);
	expect(bake.parentElement?.getAttribute("title")).toContain("⌘S");
});

// --- (b2) the chords reach the world and the field's ONE history --------------

test("⌘S on an untitled world opens the drawer to name it, rather than doing nothing", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// Compared to null BEFORE the expect: a happy-dom element carries React's fiber
	// graph, so a failing `toBeNull` on one serialises tens of megabytes.
	expect(screen.queryByRole("dialog") === null).toBe(true);
	act(() => {
		fireEvent.keyDown(window, { key: "s", metaKey: true });
	});
	// D-21: naming IS the first save. A ⌘S that silently no-ops on an unnamed world is
	// the shape of "I thought I saved that".
	await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
	expect(screen.getByLabelText("save as world name")).toBeTruthy();
});

test("⌘Z / ⇧⌘Z step the FIELD's history — the editor has no second one", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		fireEvent.keyDown(window, { key: "z", metaKey: true });
	});
	expect(stub.calls.undo.mock.calls.length).toBe(1);
	expect(stub.calls.redo).not.toHaveBeenCalled();
	act(() => {
		fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
	});
	expect(stub.calls.redo.mock.calls.length).toBe(1);
	expect(stub.calls.undo.mock.calls.length).toBe(1);
});

test("a confirm dialog suppresses every chord while it is open", async () => {
	fetch404();
	const stub = makeStubHost();
	// A prompt is pending: the listener must swallow the lot. A binding that fires
	// under a modal strands it — its onCancel never runs, and the destructive action
	// the user was being asked about is left half-answered.
	renderWithEditor(
		<Shell />,
		makeEditorContext({
			fieldHostRef: { current: stub.host },
			confirmRef: {
				current: {
					title: "t",
					message: "m",
					confirmLabel: "ok",
					// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
					onConfirm: () => {},
				},
			},
		}),
	);
	await flushCatalog();
	act(() => {
		fireEvent.keyDown(window, { key: "z", metaKey: true });
		fireEvent.keyDown(window, { key: "s", metaKey: true });
	});
	expect(stub.calls.undo).not.toHaveBeenCalled();
	expect(screen.queryByRole("dialog") === null).toBe(true);
});

// --- (c) the status bar reads the host --------------------------------------

test("the status chips render what the host pushes, and idle quiet", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// Exactly ONE subscriber to the single-slot stats seam (the provider). A second
	// one anywhere in the shell would silently steal this callback.
	expect(stub.calls.subscribeStats.mock.calls.length).toBe(1);

	act(() => {
		stub.fire.stats(makeStats({ totalOps: 128, undoDepth: 5 }));
	});
	expect(screen.getByText("128 ops")).toBeTruthy();
	expect(screen.getByText("undo 5")).toBeTruthy();
	// The advisor chip is absent at 0 owed passes — an idle advisor is the normal
	// state and has nothing to report.
	expect(screen.queryByText(/analyzer/)).toBeNull();

	act(() => {
		stub.fire.stats(
			makeStats({ totalOps: 130, undoDepth: 5, analyzerPending: 1 }),
		);
	});
	expect(screen.getByText(/analyzer/)).toBeTruthy();
	act(() => {
		stub.fire.stats(
			makeStats({ totalOps: 130, undoDepth: 5, analyzerPending: 0 }),
		);
	});
	expect(screen.queryByText(/analyzer/)).toBeNull();
});

test("the status bar keeps the engine label and its live region", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	expect(screen.getByText("engine: ok")).toBeTruthy();
	// ONE persistent, visually-hidden live region that always exists in the a11y tree
	// (its text CHANGING is what announces — see StatusBar). Scoped to the FOOTER: the
	// toast layer publishes regions of its own, and an unscoped query would silently
	// start asserting about whichever one happens to come first in the document.
	const bar = screen.getByRole("contentinfo");
	const live = bar.querySelector("div[aria-live='polite']");
	expect(live?.className).toContain("sr-only");
	expect(live?.textContent).toBe("");
});

test("an engine build failure reports in the status bar, in the destructive tone", async () => {
	fetch404();
	const stub = makeStubHost();
	renderWithEditor(
		<Shell />,
		makeEditorContext({
			state: { status: "engine-error", error: "esbuild: it did not build" },
			fieldHostRef: { current: stub.host },
		}),
	);
	await act(async () => {
		await Promise.resolve();
	});
	expect(screen.getByText("engine: BUILD FAILED")).toBeTruthy();
	// TWO nodes carry it, deliberately: the visible span and the persistent live
	// region whose text change is what announces.
	const [visible, live] = screen.getAllByText("esbuild: it did not build");
	// `-text`, not the bare fill token: --destructive is a FILL colour and reads
	// 3.55:1 as text on --card, under the 4.5:1 floor (D-23's first half, landed with
	// the toasts). The exact class matters — "text-destructive" is a SUBSTRING of it,
	// so a loose assertion here would pass either way and pin nothing.
	expect(visible?.className).toContain("text-destructive-text");
	expect(live?.className).toContain("sr-only");
	// …and no canvas was mounted, so nothing tried to init a host that may not exist.
	expect(document.querySelectorAll("canvas").length).toBe(0);
	expect(stub.calls.init).not.toHaveBeenCalled();
});

// --- (c2) what the editor SAYS: toasts, the ⚠ chip, the message log ----------
//
// The F3b gate found the host's refusals landing on a shared footer line, toneless and
// overwritten by the next routine message — reading as dead features. D-19's answer is
// here: a toned toast over the canvas, persistent while it is destructive, and a
// durable log behind it. These cases pin the whole chain, host seam included.

/** The message-log palette's box, or null while it is closed. */
const logPalette = () => screen.queryByRole("region", { name: "Messages" });

/** The toast stack, or null while nothing is on screen. */
const toastStack = () => screen.queryByRole("list", { name: "notifications" });

/** A toast row's text, SCOPED to the stack. The announcement regions carry the same
 *  string on purpose (the house live-region pattern — StatusBar's own test destructures
 *  the same visible/announced pair), so an unscoped `getByText` is ambiguous. */
const toastText = (text: string | RegExp): HTMLElement => {
	const stack = toastStack();
	if (!(stack instanceof HTMLElement)) throw new Error("no toast stack");
	return within(stack).getByText(text);
};

/** The TOAST layer's announcement region of one urgency. Always present — that is the
 *  pattern — so a null here is itself the failure.
 *
 *  Scoped to the canvas cell, where the toast layer mounts: the status bar publishes a
 *  polite region of its own (for the engine/viewport error), and taking "the first one
 *  in the document" would silently start asserting about whichever happens to come
 *  first. Two regions with the same urgency is exactly the shape that needs a scope. */
const liveRegion = (urgency: "assertive" | "polite"): HTMLElement => {
	const cell = screen.getByLabelText("field viewport").parentElement;
	const region = cell?.querySelector(`:scope > div[aria-live='${urgency}']`);
	if (!(region instanceof HTMLElement))
		throw new Error(`no ${urgency} live region in the canvas cell`);
	return region;
};

test("a host refusal becomes a persistent, toned toast over the canvas", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// Exactly ONE subscriber to the single-slot tool-error seam (the provider). The
	// panel used to hold it; a second claim anywhere would silently steal this one.
	expect(stub.calls.subscribeToolError.mock.calls.length).toBe(1);

	act(() => {
		stub.fire.toolError("select a region first");
	});
	const toast = toastText("select a region first");
	const row = toast.closest("li");
	if (!(row instanceof HTMLElement)) throw new Error("no toast row");
	expect(toast.className).toContain("text-destructive-text");
	// The body is BOUNDED: an esbuild diagnostic or a daemon stack is unbounded text,
	// and one message must not be able to cover the viewport it is reporting on.
	expect(toast.className).toContain("overflow-y-auto");

	// Inside the canvas cell, absolutely — a toast is a LAYER (D-1), not a flex
	// sibling: it must not take a pixel from the viewport or move it when it appears.
	const cell = screen.getByLabelText("field viewport").parentElement;
	const stack = toastStack();
	if (!(stack instanceof HTMLElement)) throw new Error("no toast stack");
	expect(stack.parentElement).toBe(cell);
	for (const cls of ["absolute", "pointer-events-none"])
		expect(stack.classList.contains(cls)).toBe(true);
	// …and the row itself takes the pointer back, or its dismiss × cannot be clicked.
	expect(row.classList.contains("pointer-events-auto")).toBe(true);

	// It persists: nothing but the user takes an error away.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 3 }));
	});
	expect(toastText("select a region first")).toBeTruthy();
	act(() => {
		fireEvent.click(screen.getByLabelText("dismiss: select a region first"));
	});
	// The dismiss button IS the row, and it is the unambiguous handle: the stack itself
	// still stands (the toolbar's catalog info is riding out its TTL beside it).
	expect(screen.queryByLabelText("dismiss: select a region first")).toBeNull();
});

test("toasts announce through persistent live regions, split by urgency", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// Both regions exist before any message does. This is the whole pattern (StatusBar's
	// header states it): a `role="alert"` node mounted together WITH its text is what
	// VoiceOver/Safari — our primary browser — is unreliable about, so the role has to
	// pre-exist and the TEXT CHANGING is what announces.
	expect(liveRegion("assertive").className).toContain("sr-only");
	expect(liveRegion("polite").className).toContain("sr-only");
	// The toolbar's catalog line is a report, so it waits for a pause…
	expect(liveRegion("polite").textContent).toBe("no catalog — rock only");
	expect(liveRegion("assertive").textContent).toBe("");

	act(() => {
		stub.fire.toolError("select a region first");
	});
	// …and a refusal interrupts.
	expect(liveRegion("assertive").textContent).toBe("select a region first");
	expect(liveRegion("polite").textContent).toBe("no catalog — rock only");

	// Dismissing is the USER acting, not the editor speaking: the regions must not
	// re-announce, and the announcement must not vanish with the row either.
	act(() => {
		fireEvent.click(screen.getByLabelText("dismiss: select a region first"));
	});
	expect(screen.queryByLabelText("dismiss: select a region first")).toBeNull();
	expect(liveRegion("assertive").textContent).toBe("select a region first");
});

test("the SAME refusal twice announces twice", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		stub.fire.toolError("select a region first");
	});
	const announced = liveRegion("assertive").firstElementChild;
	if (!(announced instanceof HTMLElement)) throw new Error("nothing announced");
	// Stamp the node we have seen. A text comparison cannot tell these two cases apart,
	// and comparing the ELEMENTS with toBe would serialise the fiber graph on failure.
	announced.dataset["seen"] = "1";

	act(() => {
		stub.fire.toolError("select a region first");
	});
	const second = liveRegion("assertive").firstElementChild;
	// A NEW node inside the same live region — which is what makes a repeat audible.
	// The text is identical, so a region fed by text alone goes silent here, and this is
	// the commonest case there is: the same refusal every time the gesture is retried.
	expect(second?.textContent).toBe("select a region first");
	expect(
		second instanceof HTMLElement && second.dataset["seen"],
	).toBeUndefined();
});

test("dismissing a toast keeps focus in the stack while one is left", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		stub.fire.toolError("first");
		stub.fire.toolError("second");
	});
	act(() => {
		fireEvent.click(screen.getByLabelText("dismiss: first"));
	});
	// Focus follows to the toast that took its place. Without this it falls to <body>,
	// so clearing a stack by keyboard means tabbing in from the top of the document
	// again for every row (the PaletteLayer collapse/expand lesson).
	//
	// Compared by LABEL, not by node identity: happy-dom elements carry React's fiber
	// graph, so a failed `toBe` on two of them serialises tens of megabytes and reads as
	// a hung run rather than a failed assertion.
	expect(document.activeElement?.getAttribute("aria-label")).toBe(
		"dismiss: second",
	);
});

test("the ⚠ chip counts unread errors and summons the message log", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// Quiet when there is nothing wrong: a chip that is always lit is one nobody
	// reads. The log itself stays reachable from the View menu.
	expect(screen.queryByLabelText(/unread error/)).toBeNull();
	expect(logPalette()).toBeNull();

	act(() => {
		stub.fire.toolError("the void-cast budget is exhausted");
		stub.fire.toolError("select a region first");
	});
	const chip = screen.getByLabelText(
		"2 unread errors — open the message log",
	) as HTMLButtonElement;

	act(() => {
		fireEvent.click(chip);
	});
	const log = logPalette();
	if (!(log instanceof HTMLElement)) throw new Error("the log did not open");
	// Newest first, both refusals, with the toasts still on screen — the log is the
	// record, not a replacement for the notification. The THIRD entry is the field
	// toolbar's catalog report ("no catalog — rock only" on this 404 project), which
	// is the point worth pinning: both producers write the same log.
	const entries = within(log).getAllByRole("listitem");
	expect(entries.length).toBe(3);
	expect(entries[0]?.textContent).toContain("select a region first");
	expect(entries[1]?.textContent).toContain(
		"the void-cast budget is exhausted",
	);
	expect(entries[2]?.textContent).toContain("no catalog — rock only");
	expect(within(log).getByText("3 messages")).toBeTruthy();

	// Opening the log is what marks it read, so the chip goes quiet — otherwise it
	// stays lit over messages the user is looking at.
	expect(screen.queryByLabelText(/unread error/)).toBeNull();

	act(() => {
		fireEvent.click(within(log).getByRole("button", { name: "Clear" }));
	});
	expect(within(log).getByText("no messages")).toBeTruthy();
});

test("the ⚠ chip clears the ⌘\\ latch, so the log it summons is actually on screen", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		fireEvent.keyDown(window, { key: "\\", metaKey: true });
	});
	act(() => {
		stub.fire.toolError("select a region first");
	});
	act(() => {
		fireEvent.click(screen.getByLabelText(/unread error/));
	});
	// Without the un-hide the palette opens INSIDE a hidden layer and the click reads
	// as dead — the exact failure mode the F3b gate named.
	expect(logPalette()).toBeTruthy();
	// The controls palette comes back with it (⌘\ is one latch over the whole layer),
	// which is the honest cost of showing what was asked for.
	expect(controlsPalette()).toBeTruthy();
});

/** A workspace blob with the log palette open at a readable spot — the shape the store
 *  is in after a summon, and the starting point for the visibility cases below. */
const LOG_OPEN = {
	palettes: {
		controls: { x: 0, y: 0, edge: "right", collapsed: false, open: true },
		log: { x: 24, y: 24, edge: null, collapsed: false, open: true },
	},
	hidden: false,
};

/** The same, rolled up to its rail chip. `open` is still true — that is the point: the
 *  body stays MOUNTED behind the `hidden` attribute so its state survives. */
const LOG_COLLAPSED = {
	...LOG_OPEN,
	palettes: {
		...LOG_OPEN.palettes,
		log: { ...LOG_OPEN.palettes.log, collapsed: true },
	},
};

// The log marks messages read while it is on screen — and "on screen" is NOT the same
// as "mounted". A palette body renders while collapsed to its chip, and while the whole
// layer is latched away by ⌘\. Marking on render alone let an arriving error be read by
// nobody, with the ⚠ chip never lighting to say so.

test("a collapsed log does NOT mark an arriving error read", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub, fakeUiStore({ workspace: LOG_COLLAPSED }));
	// Rolled up: out of the a11y tree, but still rendering behind `hidden`.
	expect(logPalette()).toBeNull();
	expect(screen.getByRole("button", { name: "expand Messages" })).toBeTruthy();

	act(() => {
		stub.fire.toolError("select a region first");
	});
	expect(
		screen.getByLabelText("1 unread error — open the message log"),
	).toBeTruthy();
});

test("a log hidden by the ⌘\\ latch does NOT mark an arriving error read", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub, fakeUiStore({ workspace: LOG_OPEN }));
	expect(logPalette()).toBeTruthy();

	act(() => {
		fireEvent.keyDown(window, { key: "\\", metaKey: true });
	});
	expect(logPalette()).toBeNull();
	act(() => {
		stub.fire.toolError("select a region first");
	});
	// The worst version of this bug: ⌘\ says "I want the canvas unobstructed", not "I am
	// reading the log". With the chip suppressed there is nothing left to click — and
	// the chip's own un-latch (setHidden(false)) never gets the chance to run.
	expect(
		screen.getByLabelText("1 unread error — open the message log"),
	).toBeTruthy();
});

test("the ⚠ chip un-collapses the log it summons", async () => {
	fetch404();
	const stub = makeStubHost();
	// The log was rolled up when it was last closed, and that arrangement PERSISTS —
	// `open` and `collapsed` are independent, and closing keeps the rest of the record
	// on purpose. So a summon that only sets `open` restores a palette the user still
	// cannot read.
	await renderShell(stub, fakeUiStore({ workspace: LOG_COLLAPSED }));
	act(() => {
		stub.fire.toolError("select a region first");
	});
	act(() => {
		fireEvent.click(screen.getByLabelText(/unread error/));
	});
	// Visible, not merely open…
	const log = logPalette();
	if (!(log instanceof HTMLElement)) throw new Error("the log did not open");
	expect(within(log).getByText("select a region first")).toBeTruthy();
	// …and BECAUSE it is visible, the messages are read and the chip stands down. With
	// only `open` set this chip stays lit forever over a body nobody can see, and every
	// further click repeats the same nothing — a permanently dead control.
	expect(screen.queryByLabelText(/unread error/)).toBeNull();
});

test("a visibly open log DOES mark an arriving error read", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub, fakeUiStore({ workspace: LOG_OPEN }));
	act(() => {
		stub.fire.toolError("select a region first");
	});
	// The gate must not be so strict that it never marks anything: the log is right
	// there, the message is in it, so nothing is unread and the chip stays quiet.
	expect(logPalette()).toBeTruthy();
	expect(screen.queryByLabelText(/unread error/)).toBeNull();
});

test("the message log is a palette: closed by default, re-openable from the View menu", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// Closed on a fresh workspace: an empty box over the canvas would be dead chrome.
	// It is still reachable without an error to summon it — the ⚠ chip is quiet.
	expect(logPalette()).toBeNull();
	expect(screen.queryByLabelText(/unread error/)).toBeNull();

	pickMenuItem("Messages palette");
	const log = logPalette();
	if (!(log instanceof HTMLElement)) throw new Error("the log did not open");
	// The toolbar's catalog report is already in it — a message nobody was watching
	// for is exactly what a durable log is for.
	expect(within(log).getByText("no catalog — rock only")).toBeTruthy();

	act(() => {
		fireEvent.click(within(log).getByRole("button", { name: "Clear" }));
	});
	expect(
		within(log).getByText("Saves, bakes and refusals land here."),
	).toBeTruthy();

	act(() => {
		fireEvent.click(screen.getByRole("button", { name: "close Messages" }));
	});
	expect(logPalette()).toBeNull();
});

test("the provider releases the tool-error slot on unmount", () => {
	const stub = makeStubHost();
	const { unmount } = render(
		<FieldHostStateProvider host={stub.host} engineReady>
			<span />
		</FieldHostStateProvider>,
	);
	let delivered = false;
	act(() => {
		delivered = stub.fire.toolError("select a region first");
	});
	expect(delivered).toBe(true);
	unmount();
	// Single slot: an unsubscribe that does not FREE it leaves the next mount unable
	// to claim one — refusals would stop reaching the toast stack with nothing thrown.
	act(() => {
		delivered = stub.fire.toolError("select a region first");
	});
	expect(delivered).toBe(false);
});

// --- (d) the layout contract + the retired dock ------------------------------

test("the palette layer floats over the canvas and never swallows viewport input", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const canvas = screen.getByLabelText("field viewport");
	const cell = canvas.parentElement;
	const palette = controlsPalette();
	const layer = palette?.parentElement;
	if (!(palette instanceof HTMLElement) || !(layer instanceof HTMLElement))
		throw new Error("controls palette missing");

	// The layer sits in the same positioned cell as the canvas, absolutely, covering it.
	// As a flex sibling it would subtract 300px from the canvas — and then every palette
	// that opens would move the viewport, the failure this contract exists for.
	expect(layer.parentElement).toBe(cell);
	for (const cls of ["absolute", "inset-0"])
		expect(layer.classList.contains(cls)).toBe(true);
	// …and because it covers the canvas edge to edge, it must be transparent to the
	// pointer everywhere except on a palette. Without this pair, orbit/dig anywhere
	// under the layer silently stops working and no other case here notices.
	expect(layer.classList.contains("pointer-events-none")).toBe(true);
	expect(palette.classList.contains("pointer-events-auto")).toBe(true);

	expect(palette.contains(canvas)).toBe(false);
	// Docked right by default, and the field controls really are inside it (this is the
	// field panel, not an empty box that happens to be positioned right).
	expect(palette.style.right).toBe("0px");
	expect(palette.contains(screen.getByLabelText("slice y"))).toBe(true);
});

test("a palette collapses to a rail chip that restores it, keeping its geometry", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub, fakeUiStore({ workspace: MOVED }));
	expect(controlsPalette()?.style.left).toBe("120px");

	act(() => {
		fireEvent.click(screen.getByRole("button", { name: "collapse Controls" }));
	});
	// Out of the layout AND out of the accessibility tree — but still MOUNTED behind
	// `hidden`, so the panel's host-subscribed state survives the round trip.
	expect(controlsPalette()).toBeNull();
	expect(screen.getByLabelText("slice y")).toBeTruthy();
	// The button that was just clicked went with the palette, so focus has to be MOVED
	// or it lands on <body> and a keyboard user restarts from the top of the document.
	const chip = screen.getByRole("button", { name: "expand Controls" });
	expect(document.activeElement).toBe(chip);

	act(() => {
		fireEvent.click(chip);
	});
	const restored = controlsPalette();
	expect(restored?.style.left).toBe("120px");
	expect(restored?.style.top).toBe("60px");
	expect(screen.queryByRole("button", { name: "expand Controls" })).toBeNull();
	// …and back the other way: the chip unmounted, so focus returns to the control that
	// now does its job.
	expect(document.activeElement).toBe(
		screen.getByRole("button", { name: "collapse Controls" }),
	);
});

test("⌘\\ hides the whole layer and restores the EXACT arrangement (D-3)", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub, fakeUiStore({ workspace: MOVED }));
	const canvas = screen.getByLabelText("field viewport");

	act(() => {
		fireEvent.keyDown(window, { key: "\\", metaKey: true });
	});
	expect(controlsPalette()).toBeNull();
	// The chord hides the CHROME, not the viewport: the canvas and its cell are exactly
	// as they were, which is the whole point of the layer being a layer.
	expect(screen.getByLabelText("field viewport")).toBe(canvas);
	// …and it hides rather than UNMOUNTS: ⌘\ is a peek, and a peek that tears the
	// palettes down would reset every host-subscribed control inside them.
	expect(screen.getByLabelText("slice y")).toBeTruthy();

	act(() => {
		fireEvent.keyDown(window, { key: "\\", metaKey: true });
	});
	// Exact, not defaults: the palette comes back at the position it was hidden from.
	expect(controlsPalette()?.style.left).toBe("120px");
	expect(controlsPalette()?.style.top).toBe("60px");
});

test("the top bar's ⌘\\ control is live, and follows the state it toggles", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const toggle = screen.getByRole("button", { name: /hide palettes/ });
	act(() => {
		fireEvent.click(toggle);
	});
	expect(controlsPalette()).toBeNull();
	// A toggle that still says "hide" while everything is hidden is a lie the user has
	// to test by clicking.
	expect(screen.getByRole("button", { name: /show palettes/ })).toBeTruthy();
});

test("Reset workspace restores the defaults AND drops the persisted arrangement", async () => {
	fetch404();
	const stub = makeStubHost();
	const store = fakeUiStore({
		workspace: {
			palettes: {
				controls: { x: 120, y: 60, edge: null, collapsed: true, open: false },
			},
			hidden: true,
		},
	});
	await renderShell(stub, store);
	expect(controlsPalette()).toBeNull();

	pickMenuItem("Reset workspace");
	// The panel MOUNTS again here (it was closed), so let its catalog GET settle.
	await flushCatalog();

	// Back to the shipped arrangement: open, uncollapsed, docked right.
	expect(controlsPalette()?.style.right).toBe("0px");
	// …and the blob is GONE, not rewritten with the defaults: the next session starts
	// from whatever the defaults are then, not from a snapshot of today's.
	expect(store.get("workspace")).toBeUndefined();
});

test("the View menu can re-open a palette closed with its ×", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);

	act(() => {
		fireEvent.click(screen.getByRole("button", { name: "close Controls" }));
	});
	expect(controlsPalette()).toBeNull();
	// Closing must not be a trap: without this item the only way back is Reset
	// Workspace, which also discards every position the user set.
	pickMenuItem("Controls palette");
	await flushCatalog();
	expect(controlsPalette()).toBeTruthy();
});

test("a persisted arrangement is adopted when the store arrives LATE", async () => {
	fetch404();
	const stub = makeStubHost();
	// First render with NO store — the shape App is in until `project.get` resolves, and
	// the shape it stays in forever if that call fails. The cockpit must not wait on it:
	// gating the palettes on a store that may never arrive is how the whole control
	// surface goes missing on a daemon hiccup.
	const { rerender } = renderShellResult(stub, undefined);
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	expect(controlsPalette()?.style.right).toBe("0px");

	// …and the moment it does arrive, the saved arrangement is adopted.
	act(() => {
		rerender(withEditor(<Shell />, stub, fakeUiStore({ workspace: MOVED })));
	});
	expect(controlsPalette()?.style.left).toBe("120px");
	expect(controlsPalette()?.style.top).toBe("60px");
});

/** Give the LAYER (a div) a measured box for the duration of `f`. happy-dom measures
 *  everything as zero, and the layer's size is what turns a drag into bounds; the
 *  palette itself keeps measuring zero, which only means its origin may range over the
 *  whole cell. */
function withLayerBox(f: () => void): void {
	const realRect = HTMLDivElement.prototype.getBoundingClientRect;
	HTMLDivElement.prototype.getBoundingClientRect = () =>
		({ x: 0, y: 0, top: 0, left: 0, width: 1000, height: 600 }) as DOMRect;
	try {
		f();
	} finally {
		HTMLDivElement.prototype.getBoundingClientRect = realRect;
	}
}

test("dragging the header moves the palette and persists it once, debounced", async () => {
	fetch404();
	const stub = makeStubHost();
	const store = fakeUiStore();
	await renderShell(stub, store);
	const palette = controlsPalette();
	const header = palette?.querySelector("header");
	if (!(palette instanceof HTMLElement) || !(header instanceof HTMLElement))
		throw new Error("palette header missing");

	withLayerBox(() => {
		act(() => {
			fireEvent.pointerDown(header, {
				button: 0,
				pointerId: 1,
				clientX: 500,
				clientY: 400,
			});
			// buttons:1 — the primary button is still held. It is what says this pointer is
			// still dragging, and the guard below reads it.
			fireEvent.pointerMove(header, {
				pointerId: 1,
				buttons: 1,
				clientX: 620,
				clientY: 460,
			});
			fireEvent.pointerUp(header, { pointerId: 1, clientX: 620, clientY: 460 });
		});
	});

	// Undocked and placed by the pointer delta — 24px from either edge would have
	// snapped it, 120 does not.
	const moved = controlsPalette();
	expect(moved?.style.left).toBe("120px");
	expect(moved?.style.top).toBe("60px");
	expect(moved?.style.right).toBe("");

	// Nothing is written synchronously (a drag would write 60×/s, and every write
	// re-serializes the whole blob); the debounce lands it once.
	expect(store.get("workspace")).toBeUndefined();
	await waitFor(() => {
		expect(store.get("workspace")?.palettes["controls"]?.x).toBe(120);
	});
});

test("a drag that loses its pointer capture stops, instead of following the cursor", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub, fakeUiStore({ workspace: MOVED }));
	const header = controlsPalette()?.querySelector("header");
	if (!(header instanceof HTMLElement))
		throw new Error("palette header missing");

	withLayerBox(() => {
		act(() => {
			fireEvent.pointerDown(header, {
				button: 0,
				pointerId: 1,
				clientX: 500,
				clientY: 400,
			});
			// Capture taken away mid-gesture with NO pointerup — what the browser does
			// when the captured element is hidden or removed, which ⌘\ and a collapse both
			// do to this very header.
			fireEvent.lostPointerCapture(header, { pointerId: 1 });
			fireEvent.pointerMove(header, {
				pointerId: 1,
				buttons: 1,
				clientX: 900,
				clientY: 500,
			});
		});
	});
	// Still where it was. Without the release the palette keeps tracking a pointer whose
	// button is no longer down, and the next click looks like a teleport.
	expect(controlsPalette()?.style.left).toBe("120px");

	// The second guard, alone: a move whose buttons say nothing is pressed ends the
	// gesture even if the lostpointercapture event never arrives.
	withLayerBox(() => {
		act(() => {
			fireEvent.pointerDown(header, {
				button: 0,
				pointerId: 2,
				clientX: 500,
				clientY: 400,
			});
			fireEvent.pointerMove(header, {
				pointerId: 2,
				buttons: 0,
				clientX: 700,
				clientY: 500,
			});
			fireEvent.pointerMove(header, {
				pointerId: 2,
				buttons: 1,
				clientX: 900,
				clientY: 520,
			});
		});
	});
	expect(controlsPalette()?.style.left).toBe("120px");
});

test("a Reset that happens BEFORE the store arrives is not undone by the restore", async () => {
	fetch404();
	const stub = makeStubHost();
	// No store yet — `project.get` has not resolved, so persistence is off.
	const { rerender } = renderShellResult(stub, undefined);
	await flushCatalog();

	pickMenuItem("Reset workspace");
	await flushCatalog();
	expect(controlsPalette()?.style.right).toBe("0px");

	// …and NOW the store lands, carrying the arrangement the user just discarded. The
	// naive arrival effect restores it over the reset and leaves the screen AND the disk
	// wrong; the reset has to win, and the delete it could not perform has to happen.
	const store = fakeUiStore({ workspace: MOVED });
	act(() => {
		rerender(withEditor(<Shell />, stub, store));
	});
	expect(controlsPalette()?.style.right).toBe("0px");
	expect(store.get("workspace")).toBeUndefined();
});

test("the canvas cell's insets come from the two bars and nothing else", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const cell = screen.getByLabelText("field viewport").parentElement;
	const root = cell?.parentElement;
	if (!(cell instanceof HTMLElement) || !(root instanceof HTMLElement))
		throw new Error("shell root missing");

	// A fixed, full-window column: bar, cell, bar. `fixed inset-0` is what keeps the
	// page from scrolling as a whole — the shell owns the viewport.
	for (const cls of ["fixed", "inset-0", "flex", "flex-col"])
		expect(root.classList.contains(cls)).toBe(true);
	// EXACTLY three children. Without this count a fourth element appended after the
	// footer — the flex sibling this contract forbids — passes every other assertion
	// here silently, which is the regression most likely to actually happen.
	expect(root.children.length).toBe(3);
	const [header, middle, footer] = [...root.children];
	expect(middle).toBe(cell);
	expect(header?.tagName).toBe("HEADER");
	expect(footer?.tagName).toBe("FOOTER");
	// Fixed heights, never shrinking: they ARE the cell's inset budget.
	for (const bar of [header, footer]) {
		expect(bar?.classList.contains("shrink-0")).toBe(true);
		expect(bar?.contains(cell)).toBe(false);
	}
	expect(header?.classList.contains("h-10")).toBe(true);
	expect(footer?.classList.contains("h-7")).toBe(true);
});

test("no dock DOM survives", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	expect(document.querySelector(".dockview-theme-dark")).toBeNull();
	expect(document.querySelector(".dv-tab")).toBeNull();
});
