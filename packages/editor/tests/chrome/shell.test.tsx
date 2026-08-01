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
import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import type { ReactElement } from "react";
import type { ConfirmRequest } from "../../src/frontend/components/ConfirmDialog.tsx";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { Shell } from "../../src/frontend/components/shell/Shell.tsx";
import { armedKeymap } from "../../src/frontend/components/shell/StatusBar.tsx";
import {
	FieldHostStateProvider,
	useFieldHostState,
} from "../../src/frontend/hooks/useFieldHostState.tsx";
import { ACTIONS } from "../../src/frontend/lib/actions.ts";
import { SESSION_VERBS } from "../../src/frontend/lib/field-session.ts";
import { notify, TOAST_TTL_MS } from "../../src/frontend/lib/notify-store.ts";
import type { UiStore } from "../../src/frontend/lib/persist.ts";
import type {
	FieldTool,
	SelectionInfo,
	StampSession,
} from "../../src/viewport-host/index.ts";
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
/** The minimum a generator needs to reach the stamp form. */
const HALL_GEN_MIN = {
	id: "hall",
	name: "Hall",
	paramSchema: { type: "object", properties: {} },
	defaults: {},
	placesProps: false,
	// core's own declaration: a hall does not read its seed.
	usesSeed: false,
};

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

/** The flags palette's own box (a labelled region), or null once it is collapsed or
 *  hidden — both of which take it out of the accessibility tree, which is precisely the
 *  claim those states make.
 *
 *  The generic SUBJECT for every palette-layer geometry case below (drag, dock, collapse,
 *  restore, ⌘\, Reset). It was `controls` until F4.5b Task 14 retired that id with the
 *  FieldPanel stack; `flags` inherited the role because it is the other palette that ships
 *  OPEN, which is what a case about where a palette sits needs. The one thing that did NOT
 *  survive the swap is a DOCKED default — nothing docks on a fresh workspace any more, so
 *  the cases that used to read `right: 0px` off the shipped arrangement read this palette's
 *  floating origin instead, and docking is now only ever asserted after a drag. */
const flagsPalette = () => screen.queryByRole("region", { name: "Flags" });

/** Where `flags` sits before anything moves it, as strings the style attribute uses. */
const FLAGS_DEFAULT_LEFT = "24px";
const FLAGS_DEFAULT_TOP = "380px";

/** The entities palette's box — open in the default arrangement, unlike the log. */
const entitiesPalette = () =>
	screen.queryByRole("region", { name: "Entities" });

/** A persisted arrangement that is nothing like the default, so a restore is visible.
 *  `edge: null` is what makes it float at an x/y a test can read off the style. */
const MOVED = {
	palettes: {
		flags: {
			x: 120,
			y: 60,
			edge: null,
			collapsed: false,
			open: true,
		},
	},
	hidden: false,
};

/** Open the burger. Radix opens on pointerdown, not click. */
function openBurger(): void {
	act(() => {
		fireEvent.pointerDown(screen.getByLabelText("editor menu"), {
			button: 0,
			pointerType: "mouse",
		});
	});
}

/** Open the burger and click one of its items. */
function pickMenuItem(label: string | RegExp): void {
	openBurger();
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

// --- the provider owns the single-slot seams ---------------------------------

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

/** A dig brush, the host's own default tool — the value shape `fire.tool` carries. */
const DIG_TOOL: FieldTool = {
	effect: "dig",
	materialId: 0,
	mask: { kind: "none" },
	smooth: { strength: 16, iterations: 1, mode: "both" },
	hollow: null,
};

/** The four seams the control stack held until F4.5b Task 2, with the push that proves
 *  each slot is live. Table-driven rather than four copies of the case above: the claim
 *  is identical in all four, and four near-identical blocks would bury the one line that
 *  differs. */
const LIFTED_SEAMS: readonly (readonly [
	string,
	(stub: ReturnType<typeof makeStubHost>) => boolean,
])[] = [
	["tool", (s) => s.fire.tool(DIG_TOOL)],
	["selection", (s) => s.fire.selection(null)],
	["stamp", (s) => s.fire.stamp(null)],
	[
		"flags",
		(s) =>
			s.fire.flags({
				total: 0,
				byKindSeverity: [],
				visible: [],
				selected: null,
			}),
	],
];

// The path the real editor ALWAYS takes, and the one no other case covers: App mounts the
// shell before the engine bundle has landed, so every one of the ten effects first runs
// with `engineReady` false and claims nothing. A provider that read the flag only at mount
// would leave all ten slots empty for the whole session — every readout dead, nothing
// thrown. The other direction (ready → not ready) is unreachable: `status` never leaves
// `ready`, and App assigns the host exactly once.
test("no seam is claimed before engine-ready, and each is claimed exactly once after", () => {
	const stub = makeStubHost();
	const tree = (engineReady: boolean) => (
		<FieldHostStateProvider host={stub.host} engineReady={engineReady}>
			<span />
		</FieldHostStateProvider>
	);
	const { rerender } = render(tree(false));
	const claims = () => [
		["stats", stub.calls.subscribeStats.mock.calls.length],
		["toolError", stub.calls.subscribeToolError.mock.calls.length],
		["cameraPose", stub.calls.subscribeCameraPose.mock.calls.length],
		["entities", stub.calls.subscribeEntities.mock.calls.length],
		["drift", stub.calls.subscribeDrift.mock.calls.length],
		["tool", stub.calls.subscribeTool.mock.calls.length],
		["selection", stub.calls.subscribeSelection.mock.calls.length],
		["stamp", stub.calls.subscribeStamp.mock.calls.length],
		["flags", stub.calls.subscribeFlags.mock.calls.length],
		["history", stub.calls.subscribeHistory.mock.calls.length],
	];
	// Nothing claimed while the host has no GPU behind it — subscribing here would mean
	// mirroring state from a host that cannot yet produce any.
	expect(claims().filter(([, n]) => n !== 0)).toEqual([]);

	act(() => {
		rerender(tree(true));
	});
	// …and the transition claims each seam ONCE, not once per effect re-run.
	expect(claims().filter(([, n]) => n !== 1)).toEqual([]);
});

test("the provider claims — and releases — the four seams lifted off the panel", () => {
	for (const [name, push] of LIFTED_SEAMS) {
		const stub = makeStubHost();
		const { unmount } = render(
			<FieldHostStateProvider host={stub.host} engineReady>
				<span />
			</FieldHostStateProvider>,
		);
		const deliver = (): boolean => {
			let delivered = false;
			act(() => {
				delivered = push(stub);
			});
			return delivered;
		};
		// Claimed with no consumer mounted at all: the provider subscribes because it is
		// the OWNER, not because something below it happens to be reading. A seam nobody
		// claims is a control that goes dead with nothing thrown.
		expect([name, deliver()]).toEqual([name, true]);
		unmount();
		// …and freed on the way out, the stats-slot rule above: an unsubscribe that leaves
		// the slot occupied makes the NEXT mount's claim the silent loser.
		expect([name, deliver()]).toEqual([name, false]);
	}
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
	// The reason comes from the REGISTRY entry's label since F4.5b Task 8 (`world.bake`),
	// so the burger item and this tooltip cannot word it differently — and it names the way
	// out, not just the blocker.
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

/** Serve the world commands so a case can actually NAME a world and save it. The catalog
 *  GETs (anything not `/api/*`) 404 as usual. */
function stubWorldDaemon(): { commands: () => string[]; bakes: unknown[] } {
	const commands: string[] = [];
	const bakes: unknown[] = [];
	globalThis.fetch = ((input: unknown, init?: RequestInit) => {
		const url = String(input);
		if (!url.startsWith("/api/"))
			return Promise.resolve(new Response("", { status: 404 }));
		const command = url.slice("/api/".length);
		commands.push(command);
		const body = JSON.parse(String(init?.body ?? "null")) as unknown;
		if (command === "generation.bake") bakes.push(body);
		return Promise.resolve(
			new Response(
				JSON.stringify(
					command === "world.list"
						? { defaultName: null, worlds: [] }
						: { files: 7 },
				),
				{ status: 200 },
			),
		);
	}) as unknown as typeof fetch;
	return { commands: () => commands, bakes };
}

test("⌘S on a NAMED world writes straight to it — no drawer, no second question", async () => {
	const daemon = stubWorldDaemon();
	const stub = makeStubHost();
	await renderShell(stub);

	// Name it the way a user does: ⌘S on an untitled world opens the drawer, the drawer
	// takes the name. Reaching the named path through the real flow is the point — a
	// test that injected the name would not prove the flow reaches it.
	act(() => {
		fireEvent.keyDown(window, { key: "s", metaKey: true });
	});
	const field = await waitFor(() =>
		screen.getByLabelText("save as world name"),
	);
	act(() => {
		fireEvent.change(field, { target: { value: "cavern" } });
	});
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
	await waitFor(() => screen.getByRole("button", { name: "cavern" }));
	expect(daemon.bakes.length).toBe(1);

	// NOW the primary path: the chord writes the named world directly. This is the save
	// the editor performs all day, and until here it was only ever reached transitively.
	await act(async () => {
		fireEvent.keyDown(window, { key: "s", metaKey: true });
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
	await waitFor(() => expect(daemon.bakes.length).toBe(2));
	expect(daemon.bakes[1]).toMatchObject({ cleanDir: "worlds/cavern" });
	// …and it did NOT re-open the drawer to ask a question it already has the answer to.
	expect(screen.queryByRole("dialog") === null).toBe(true);
});

test("⌘Z / ⇧⌘Z step the FIELD's history — the editor has no second one", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// The chord is gated on the same depth the menu item is (the registry has ONE
	// `enabled` and both surfaces read it), so a stack has to exist before it steps —
	// which is the half asserted first, because a key that fires into an empty stack
	// would pass the rest of this case for the wrong reason.
	act(() => {
		fireEvent.keyDown(window, { key: "z", metaKey: true });
	});
	expect(stub.calls.undo).not.toHaveBeenCalled();

	act(() => {
		stub.fire.stats(makeStats({ undoDepth: 2, redoDepth: 1 }));
	});
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
		stub.fire.toolError("selection found no matching cells");
	});
	const toast = toastText("selection found no matching cells");
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
	expect(toastText("selection found no matching cells")).toBeTruthy();
	act(() => {
		fireEvent.click(
			screen.getByLabelText("dismiss: selection found no matching cells"),
		);
	});
	// The dismiss button IS the row, and it is the unambiguous handle: the stack itself
	// still stands (the toolbar's catalog info is riding out its TTL beside it).
	expect(
		screen.queryByLabelText("dismiss: selection found no matching cells"),
	).toBeNull();
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
		stub.fire.toolError("selection found no matching cells");
	});
	// …and a refusal interrupts.
	expect(liveRegion("assertive").textContent).toBe(
		"selection found no matching cells",
	);
	expect(liveRegion("polite").textContent).toBe("no catalog — rock only");

	// Dismissing is the USER acting, not the editor speaking: the regions must not
	// re-announce, and the announcement must not vanish with the row either.
	act(() => {
		fireEvent.click(
			screen.getByLabelText("dismiss: selection found no matching cells"),
		);
	});
	expect(
		screen.queryByLabelText("dismiss: selection found no matching cells"),
	).toBeNull();
	expect(liveRegion("assertive").textContent).toBe(
		"selection found no matching cells",
	);
});

test("the SAME refusal twice announces twice", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		stub.fire.toolError("selection found no matching cells");
	});
	const announced = liveRegion("assertive").firstElementChild;
	if (!(announced instanceof HTMLElement)) throw new Error("nothing announced");
	// Stamp the node we have seen. A text comparison cannot tell these two cases apart,
	// and comparing the ELEMENTS with toBe would serialise the fiber graph on failure.
	announced.dataset["seen"] = "1";

	act(() => {
		stub.fire.toolError("selection found no matching cells");
	});
	const second = liveRegion("assertive").firstElementChild;
	// A NEW node inside the same live region — which is what makes a repeat audible.
	// The text is identical, so a region fed by text alone goes silent here, and this is
	// the commonest case there is: the same refusal every time the gesture is retried.
	expect(second?.textContent).toBe("selection found no matching cells");
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

test("the stack holds while the pointer — or the keyboard — is in it", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const HELD = "kit layer dropped — re-toggle to refresh";

	// Fake timers from HERE, after the render: the TTL this case is about has to be a
	// number the test moves rather than four real seconds of wall clock, and the message
	// it drives has to be the one scheduled under them.
	//
	// They also move Date.now, which is the half that makes the arithmetic below mean
	// anything: the store reads its deadline off `deps.now` (Date.now in the browser
	// wiring), so a fake that advanced only the timer queue would fire the callbacks on
	// cue while every remaining-time computation still read the real wall clock.
	jest.useFakeTimers();
	try {
		act(() => {
			stub.fire.toolError(HELD, "warn");
		});
		const held = () => screen.queryByLabelText(`dismiss: ${HELD}`);
		const stack = toastStack();
		if (!(stack instanceof HTMLElement)) throw new Error("no toast stack");
		const tick = (ms: number) =>
			act(() => {
				jest.advanceTimersByTime(ms);
			});

		// Half of it read, then the pointer arrives ON THE STACK — one handler for the
		// whole column rather than per row, which is the accessible simple rule: hovering
		// anything holds everything visible, so a reader working down three rows is not
		// racing the two they have not reached yet.
		//
		// mouseOver/mouseOut, NOT mouseEnter/mouseLeave, and that is not tidiable: React
		// synthesises onMouseEnter/onMouseLeave from the over/out pair it delegates at the
		// root, and a raw `mouseenter` does not bubble, so firing the event whose name
		// matches the prop reaches no handler at all.
		tick(TOAST_TTL_MS / 2);
		act(() => {
			fireEvent.mouseOver(stack);
		});
		tick(TOAST_TTL_MS * 2);
		// Well past its deadline and still up. An auto-dismiss is a time limit on reading
		// (WCAG 2.2.1) and this is the extension.
		expect(held()).toBeTruthy();

		// Leaving spends what was LEFT — half — so a resume that restarted the clock
		// survives the first of these two lines.
		act(() => {
			fireEvent.mouseOut(stack);
		});
		tick(TOAST_TTL_MS / 2 - 1);
		expect(held()).toBeTruthy();
		tick(1);
		// `x === null` rather than `toBeNull()`, and MEASURED rather than assumed: a red
		// toBeNull() on a live element here takes 202 s to report (bun 1.3.14, this file,
		// timed this session), because the failure message serialises a happy-dom node
		// with React's whole fiber graph hanging off it. The comparison form reports in
		// ms. The 20-odd toBeNull() sites elsewhere in this file are a separate,
		// mechanical change — this note is here so the asymmetry does not read as taste.
		expect(held() === null).toBe(true);

		// The keyboard gets the same hold, through the same container: tabbing to a
		// toast's × is a reader arriving, and a row that vanished mid-Tab would move the
		// focus out from under them.
		act(() => {
			stub.fire.toolError(HELD, "warn");
		});
		const dismiss = held();
		if (!(dismiss instanceof HTMLElement)) throw new Error("no dismiss button");
		act(() => {
			dismiss.focus();
		});
		tick(TOAST_TTL_MS * 2);
		expect(held()).toBeTruthy();
		act(() => {
			dismiss.blur();
		});
		tick(TOAST_TTL_MS);
		// The comparison form again — see the note above.
		expect(held() === null).toBe(true);
	} finally {
		// In a finally, or a failed assertion above leaves every later case in this file
		// running on a clock nobody advances.
		jest.useRealTimers();
	}
});

test("the hold stands until BOTH the pointer and the focus have left", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const HELD = "kit layer dropped — re-toggle to refresh";

	jest.useFakeTimers();
	try {
		act(() => {
			stub.fire.toolError(HELD, "warn");
		});
		const held = () => screen.queryByLabelText(`dismiss: ${HELD}`);
		const stack = toastStack();
		if (!(stack instanceof HTMLElement)) throw new Error("no toast stack");
		const tick = (ms: number) =>
			act(() => {
				jest.advanceTimersByTime(ms);
			});
		const dismiss = held();
		if (!(dismiss instanceof HTMLElement)) throw new Error("no dismiss button");

		// BOTH conditions on. Not a contrived pairing — it is the state this component's
		// own focus restoration produces: dismiss a row with the keyboard and focus lands
		// on its neighbour's × while the pointer has not moved (`focusAfter`, above).
		act(() => {
			fireEvent.mouseOver(stack);
		});
		act(() => {
			dismiss.focus();
		});

		// The pointer leaves; the keyboard has NOT. One reader is still in the stack, so
		// the hold stands. With a single shared latch this is where the row expires under
		// the focused element and focus falls to <body> — the very thing the focus pair
		// was added to prevent.
		act(() => {
			fireEvent.mouseOut(stack);
		});
		tick(TOAST_TTL_MS * 2);
		expect(held()).toBeTruthy();
		// Compared by LABEL: happy-dom nodes carry React's fiber graph, so a failed `toBe`
		// on two of them serialises tens of megabytes (the house rule, three cases above).
		expect(document.activeElement?.getAttribute("aria-label")).toBe(
			`dismiss: ${HELD}`,
		);

		// The mirror, from the other side: Tab out while the pointer is still parked on
		// the stack and the hold likewise stands.
		act(() => {
			fireEvent.mouseOver(stack);
		});
		act(() => {
			dismiss.blur();
		});
		tick(TOAST_TTL_MS * 2);
		expect(held()).toBeTruthy();

		// Only the LAST one to leave restarts the countdown.
		act(() => {
			fireEvent.mouseOut(stack);
		});
		tick(TOAST_TTL_MS);
		expect(held() === null).toBe(true);
	} finally {
		jest.useRealTimers();
	}
});

test("a stack that empties with focus inside it does not hold the NEXT one", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const HELD = "kit layer dropped — re-toggle to refresh";
	// This case needs the stack to actually EMPTY, and the field toolbar's catalog report
	// is riding out its TTL beside it — so start from nothing. Cleared before the fake
	// clock goes in, while the canceller it holds is still the real one.
	act(() => notify.clear());

	jest.useFakeTimers();
	try {
		const held = () => screen.queryByLabelText(`dismiss: ${HELD}`);
		act(() => {
			stub.fire.toolError(HELD, "warn");
		});
		const first = held();
		if (!(first instanceof HTMLElement)) throw new Error("no dismiss button");

		// Focus the × and then dismiss it — the last row, so focus goes nowhere and the
		// stack unmounts underneath it. A removed element raises no focusout, so the
		// component never hears the focus leave: whatever it latched is still latched.
		act(() => {
			first.focus();
		});
		act(() => {
			fireEvent.click(first);
		});
		expect(toastStack()).toBeNull();

		// A fresh message, and the plainest possible gesture over it. Without a reset the
		// stale focus latch suppresses this resume and the toast never leaves — the exact
		// stranding the store's per-timer model was shaped to rule out, re-introduced one
		// layer up by the latch that fixes the two-condition hold.
		act(() => {
			stub.fire.toolError(HELD, "warn");
		});
		const stack = toastStack();
		if (!(stack instanceof HTMLElement)) throw new Error("no toast stack");
		act(() => {
			fireEvent.mouseOver(stack);
		});
		act(() => {
			fireEvent.mouseOut(stack);
		});
		act(() => {
			jest.advanceTimersByTime(TOAST_TTL_MS);
		});
		expect(held() === null).toBe(true);
	} finally {
		jest.useRealTimers();
	}
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
		stub.fire.toolError("selection found no matching cells");
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
	expect(entries[0]?.textContent).toContain(
		"selection found no matching cells",
	);
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

test("an advisor-idle WARN leaves the status bar quiet and reads amber", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const IDLE =
		"walkability advisor idle — this project installs no agent profile";

	act(() => {
		stub.fire.toolError(IDLE, "warn");
	});
	// The boot the `warn` member exists for. The advisor is correctly idle because the
	// project installed no profile — nothing is wrong — and as an `error` (the only
	// non-cheerful severity there used to be) this one sentence opened the editor with a
	// red "1 unread error" over a clean world. The log is closed on a fresh workspace, so
	// nothing here is marking it read: the chip is absent because it was never lit.
	// Counted rather than compared to null so the failure reads as 0-vs-1.
	expect(logPalette()).toBeNull();
	expect(screen.queryAllByLabelText(/unread error/).length).toBe(0);

	// Amber on the toast, and by SHAPE as well as colour — a triangle where the error
	// row carries a circle, because colour alone must never be the only carrier.
	const toast = toastText(IDLE);
	expect(toast.className).toContain("text-warning");
	expect(toast.className).not.toContain("text-destructive-text");
	const row = toast.closest("li");
	expect(row?.className).toContain("border-warning");

	// It waits for a pause rather than interrupting: a warning is a report, and the
	// assertive region is for refusals.
	expect(liveRegion("assertive").textContent).toBe("");
	expect(liveRegion("polite").textContent).toBe(IDLE);

	// Reachable with no chip to summon it — and amber in the record too.
	pickMenuItem("Messages palette");
	const log = logPalette();
	if (!(log instanceof HTMLElement)) throw new Error("the log did not open");
	const entry = within(log).getByText(IDLE).closest("li");
	if (!(entry instanceof HTMLElement)) throw new Error("no log row");
	expect(entry.querySelectorAll(".text-warning").length).toBe(1);
	expect(entry.querySelectorAll(".text-destructive-text").length).toBe(0);
});

test("the ⚠ chip clears the ⌘\\ latch, so the log it summons is actually on screen", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		fireEvent.keyDown(window, { key: "\\", metaKey: true });
	});
	act(() => {
		stub.fire.toolError("selection found no matching cells");
	});
	act(() => {
		fireEvent.click(screen.getByLabelText(/unread error/));
	});
	// Without the un-hide the palette opens INSIDE a hidden layer and the click reads
	// as dead — the exact failure mode the F3b gate named.
	expect(logPalette()).toBeTruthy();
	// The controls palette comes back with it (⌘\ is one latch over the whole layer),
	// which is the honest cost of showing what was asked for.
	expect(flagsPalette()).toBeTruthy();
});

/** A workspace blob with the log palette open at a readable spot — the shape the store
 *  is in after a summon, and the starting point for the visibility cases below. */
const LOG_OPEN = {
	palettes: {
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
		stub.fire.toolError("selection found no matching cells");
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
		stub.fire.toolError("selection found no matching cells");
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
		stub.fire.toolError("selection found no matching cells");
	});
	act(() => {
		fireEvent.click(screen.getByLabelText(/unread error/));
	});
	// Visible, not merely open…
	const log = logPalette();
	if (!(log instanceof HTMLElement)) throw new Error("the log did not open");
	expect(
		within(log).getByText("selection found no matching cells"),
	).toBeTruthy();
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
		stub.fire.toolError("selection found no matching cells");
	});
	// The gate must not be so strict that it never marks anything: the log is right
	// there, the message is in it, so nothing is unread and the chip stays quiet.
	expect(logPalette()).toBeTruthy();
	expect(screen.queryByLabelText(/unread error/)).toBeNull();
});

// --- the named history (F4.5b Task 12, D-11) ---------------------------------

/** The History palette's own box, or null while it is closed. */
const historyPalette = () => screen.queryByRole("region", { name: "History" });

/** Push a named history through the seam, as any log mutation does. */
const pushHistory = (
	stub: ReturnType<typeof makeStubHost>,
	undo: readonly string[],
	redo: readonly string[] = [],
): void => {
	act(() => {
		stub.fire.history({
			undo,
			redo,
			undoDepth: undo.length,
			redoDepth: redo.length,
		});
	});
};

test("the status bar's `undo N` chip summons the History palette", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// Closed by default: summoned, not always-on (the message log's rule). The named
	// Undo item already carries the last step, so the LIST is what you go looking for.
	expect(historyPalette()).toBeNull();

	act(() => {
		stub.fire.stats(makeStats({ totalOps: 3, undoDepth: 3 }));
	});
	pushHistory(stub, ["stamp Hall", "dig", "segment fill"]);

	act(() => {
		fireEvent.click(
			screen.getByLabelText("3 undo steps — open the History palette"),
		);
	});
	const palette = historyPalette();
	if (!(palette instanceof HTMLElement))
		throw new Error("the History palette did not open");
	// Newest first, and the rows really are the pushed labels rather than a placeholder.
	expect(
		within(palette).getByLabelText("Undo 1 step — segment fill"),
	).toBeTruthy();
	expect(
		within(palette).getByLabelText("Undo 3 steps — stamp Hall"),
	).toBeTruthy();
});

test("the chip clears the ⌘\\ latch too, so the history it summons is on screen", async () => {
	// The ⚠ chip's case one palette over, and it applies here for the same mechanical
	// reason: both chips go through the ONE summon verb, so a regression in it would
	// break both — and this is the half that no `open`-only summon would satisfy.
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		stub.fire.stats(makeStats({ undoDepth: 1 }));
	});
	act(() => {
		fireEvent.keyDown(window, { key: "\\", metaKey: true });
	});
	act(() => {
		fireEvent.click(screen.getByLabelText(/open the History palette/));
	});
	expect(historyPalette()).toBeTruthy();
});

test("the Edit menu's History item is LIVE and summons the same palette", async () => {
	// It shipped in Task 7 DISABLED with its reason in the LABEL — a disabled Radix item
	// carries `pointer-events-none`, so a `title` on one is never shown. BOTH halves are
	// asserted: a live item still wearing the old label would read as unfinished, and the
	// new label on a dead item would be a lie.
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	expect(historyPalette()).toBeNull();
	openBurger();
	expect(screen.queryByText(/arrives with the History palette/)).toBeNull();
	expect(screen.getByText("History…").getAttribute("aria-disabled")).not.toBe(
		"true",
	);
	act(() => {
		fireEvent.click(screen.getByText("History…"));
	});
	expect(historyPalette()).toBeTruthy();
	// The palette's own checkbox in the View list is the way BACK — the Edit item is a
	// summon, not a toggle, so it must not be the only way in or out.
	pickMenuItem("History palette");
	expect(historyPalette()).toBeNull();
});

test("Undo and Redo NAME what they would step, in the menu (D-11)", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 2, undoDepth: 1, redoDepth: 1 }));
	});
	// The TOP of each stack is the LAST element, per the seam's ordering contract. Both
	// arrays carry two entries so that reading the wrong end names the wrong op rather
	// than accidentally the right one.
	pushHistory(stub, ["dig", "segment fill"], ["stamp Maze", "freeze Hall"]);

	openBurger();
	expect(screen.getByText("Undo segment fill")).toBeTruthy();
	expect(screen.getByText("Redo freeze Hall")).toBeTruthy();
	// …and the ops at the far end of each list are NOT what the items name.
	expect(screen.queryByText("Undo dig")).toBeNull();
	expect(screen.queryByText("Redo stamp Maze")).toBeNull();
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

	// The checkbox has to match the ⚠ chip's summon (StatusBar.tsx), not just its
	// `open` half, or a tick can put the palette on screen where it still can't be
	// read.
	//
	// (a) ⌘\ latches the whole layer away; ticking the box has to clear that too, or
	// the palette opens INSIDE a layer still marked `hidden` and the tick reads as
	// dead.
	act(() => {
		fireEvent.keyDown(window, { key: "\\", metaKey: true });
	});
	pickMenuItem("Messages palette");
	expect(logPalette()).toBeTruthy();

	act(() => {
		fireEvent.click(screen.getByRole("button", { name: "close Messages" }));
	});
	expect(logPalette()).toBeNull();

	// (b) closing preserves the rest of the record on purpose (see LOG_COLLAPSED), so
	// a palette closed while collapsed comes back collapsed — the tick also has to
	// un-collapse it, or the box returns as a rail chip instead of a readable body.
	cleanup();
	const stub2 = makeStubHost();
	await renderShell(
		stub2,
		fakeUiStore({
			workspace: {
				...LOG_COLLAPSED,
				palettes: {
					...LOG_COLLAPSED.palettes,
					log: { ...LOG_COLLAPSED.palettes.log, open: false },
				},
			},
		}),
	);
	pickMenuItem("Messages palette");
	expect(logPalette()).toBeTruthy();
	expect(screen.queryByRole("button", { name: "expand Messages" })).toBeNull();
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
		delivered = stub.fire.toolError("selection found no matching cells");
	});
	expect(delivered).toBe(true);
	unmount();
	// Single slot: an unsubscribe that does not FREE it leaves the next mount unable
	// to claim one — refusals would stop reaching the toast stack with nothing thrown.
	act(() => {
		delivered = stub.fire.toolError("selection found no matching cells");
	});
	expect(delivered).toBe(false);
});

// --- (c3) the View popover: what the viewport SHOWS --------------------------
//
// The controls that used to be a row inside the field palette (D-F4.5-16). They are
// asserted HERE rather than in field-panel.test.tsx because the popover lives in the top
// bar and its state lives in a shell provider — mounting the panel alone can no longer
// reach any of it.

/** Open the popover and let Radix's Popper settle (it measures in a layout effect, which
 *  lands as an un-act'ed update otherwise). */
async function openViewPopover(): Promise<void> {
	await act(async () => {
		fireEvent.click(screen.getByLabelText("view options"));
		await Promise.resolve();
	});
}

test("the editor comes up in STUDIO shading, and the popover offers normals as the debug mode", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// D-F4.5-17: studio is the default state of seeing, pushed at engine-ready so the
	// host and the control agree from the first frame. If this ever reads "normals" the
	// editor is booting into a debug view.
	expect(stub.calls.setShading.mock.calls).toEqual([["studio"]]);

	await openViewPopover();
	const studio = screen.getByLabelText("Studio") as HTMLInputElement;
	const normals = screen.getByLabelText("Normals (debug)") as HTMLInputElement;
	expect(studio.checked).toBe(true);
	expect(normals.checked).toBe(false);
	// The debug mode SAYS it is one, in the label — a full-chroma normal render is the
	// loudest thing on the screen and reads as a feature otherwise (critique P0).
	expect(normals.closest("label")?.textContent).toContain("debug");

	act(() => {
		fireEvent.click(normals);
	});
	expect(stub.calls.setShading.mock.calls.at(-1)?.[0]).toBe("normals");
	act(() => {
		fireEvent.click(studio);
	});
	expect(stub.calls.setShading.mock.calls.at(-1)?.[0]).toBe("studio");
});

test("the slice checkbox and slider drive host.setSlice(y | null)", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// The plane starts OFF, and the provider says so at engine-ready.
	expect(stub.calls.setSlice.mock.calls).toEqual([[null]]);
	await openViewPopover();
	act(() => {
		fireEvent.click(screen.getByLabelText("slice view"));
	});
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(8); // parked default
	act(() => {
		fireEvent.change(screen.getByLabelText("slice y"), {
			target: { value: "4" },
		});
	});
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(4);
	act(() => {
		fireEvent.click(screen.getByLabelText("slice view"));
	});
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(null); // off
	// …and re-ticking returns to the depth the user chose, not to the park: the slider
	// value survives the plane being switched off.
	act(() => {
		fireEvent.click(screen.getByLabelText("slice view"));
	});
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(4);
});

// D-F4.5-16's occupancy seed. The park above is what the plane falls back to; these
// three are what it does when the world can say something better. The stub answers
// `occupiedTopY()` with whatever `setOccupiedTopY` last set, `null` by default — which is
// why every case above this one exercises the fallback without asking for it.
test("enabling the slice seeds the plane just above the world's own ceiling", async () => {
	fetch404();
	const stub = makeStubHost();
	// A shallow world: everything in it is under 2 m. This is the case the fixed 8 m park
	// got wrong — the plane opened above the whole world and the tick looked like it did
	// nothing at all.
	stub.setOccupiedTopY(1.75);
	await renderShell(stub);
	await openViewPopover();
	act(() => {
		fireEvent.click(screen.getByLabelText("slice view"));
	});
	// AT the content plus the half-metre clearance — not the 8 m park, and not exactly at
	// the ceiling either (that would shave it on the first frame).
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(2.25);
	// The slider shows the seeded depth, so the control and the field agree from the
	// first frame rather than after the user touches it.
	expect((screen.getByLabelText("slice y") as HTMLInputElement).value).toBe(
		"2.25",
	);
});

test("the seed fires ONCE — a re-tick returns to the depth the user chose", async () => {
	fetch404();
	const stub = makeStubHost();
	stub.setOccupiedTopY(1.75);
	await renderShell(stub);
	await openViewPopover();
	act(() => {
		fireEvent.click(screen.getByLabelText("slice view"));
	});
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(2.25);

	// The user drags the plane somewhere, and the world grows a taller ceiling while they
	// work. Neither may take their depth away from them.
	act(() => {
		fireEvent.change(screen.getByLabelText("slice y"), {
			target: { value: "1" },
		});
	});
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(1);
	stub.setOccupiedTopY(9);
	act(() => {
		fireEvent.click(screen.getByLabelText("slice view"));
	});
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(null);
	act(() => {
		fireEvent.click(screen.getByLabelText("slice view"));
	});
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(1);
});

test("a world with nothing in it parks, and the seed stays OWED until it can fire", async () => {
	fetch404();
	const stub = makeStubHost();
	// Nothing authored: `occupiedTopY` is null and the park is the honest answer.
	await renderShell(stub);
	await openViewPopover();
	act(() => {
		fireEvent.click(screen.getByLabelText("slice view"));
	});
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(8);

	// The user digs while the plane is ON. This is the ONE window in which the
	// enable-edge gate is the only thing holding the line: the one-shot is still unspent
	// AND the world now has an answer, so a seed gated on "the plane is on" rather than
	// on the false->true edge would fire on the next slider event and snap the plane out
	// from under the hand holding it. Nothing else in this file can catch that — once the
	// seed HAS fired, the one-shot masks the missing gate on every later drag.
	stub.setOccupiedTopY(3);
	act(() => {
		fireEvent.change(screen.getByLabelText("slice y"), {
			target: { value: "6" },
		});
	});
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(6);
	expect((screen.getByLabelText("slice y") as HTMLInputElement).value).toBe(
		"6",
	);

	// …and the seed is still OWED. It fires on the next ENABLE, which is what makes a
	// `null` answer a deferral rather than a forfeit — a one-shot the empty world had
	// consumed would leave this session parked for as long as the editor is open.
	act(() => {
		fireEvent.click(screen.getByLabelText("slice view"));
	});
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(null);
	act(() => {
		fireEvent.click(screen.getByLabelText("slice view"));
	});
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(3.5);
});

test("the void checkbox drives host.setLayers(voidCast) and leaves the other layers alone", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	await openViewPopover();
	act(() => {
		fireEvent.click(screen.getByLabelText("void cast"));
	});
	expect(stub.calls.setLayers.mock.calls.at(-1)?.[0]).toEqual({
		field: true,
		kit: true,
		props: true,
		ghost: true,
		selection: true,
		grid: true,
		flags: true,
		voidCast: true,
	});
	// Off again — the host reads the false→true EDGE, so a chrome that only ever sent
	// `true` would leave the X-ray unbuildable after its first edit.
	act(() => {
		fireEvent.click(screen.getByLabelText("void cast"));
	});
	expect(stub.calls.setLayers.mock.calls.at(-1)?.[0]).toMatchObject({
		voidCast: false,
	});
});

test("the flags layer is a free display gate, beside the other six", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	await openViewPopover();
	act(() => {
		fireEvent.click(screen.getByLabelText("flags"));
	});
	expect(stub.calls.setLayers.mock.calls.at(-1)?.[0]).toEqual({
		field: true,
		kit: true,
		props: true,
		ghost: true,
		selection: true,
		grid: true,
		flags: false,
		voidCast: false,
	});
});

test("the AA switch re-inits the SAME host at the new sample count", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const canvas = screen.getByLabelText("field viewport");
	expect(stub.calls.init.mock.calls).toEqual([[canvas, { sampleCount: 4 }]]);

	await openViewPopover();
	await act(async () => {
		fireEvent.click(screen.getByLabelText("antialiasing"));
		// Two turns: the dispose is deferred behind the settled init, and the re-init is
		// chained behind that dispose.
		await Promise.resolve();
		await Promise.resolve();
	});
	// Sample count is a CONTEXT property, so the only way to change it is a round trip —
	// and the round trip has to stay ORDERED. The host holds ONE context and refuses a
	// second init while it is up, and its dispose is deferred behind the settled init,
	// so an unchained re-init lands on "already initialized": the sequence IS the
	// assertion, not the call count.
	expect(stub.order.filter((c) => c === "init" || c === "dispose")).toEqual([
		"init",
		"dispose",
		"init",
	]);
	expect(stub.calls.init.mock.calls[1]).toEqual([canvas, { sampleCount: 1 }]);
	// …and nothing failed on the way: a refused re-init reports on the status bar, which
	// is exactly what a user would see if the ordering broke.
	expect(screen.queryByText(/field host init failed/) === null).toBe(true);
	// The SAME host, not a new one: everything the editor cannot rebuild (the field, the
	// op log, the camera) is CPU state that rides through the dispose. A re-created host
	// here would silently be "your world is gone" on an AA toggle.
	expect(stub.calls.init.mock.calls[1]?.[0]).toBe(canvas);
	expect(screen.getByLabelText("field viewport")).toBe(canvas);
});

test("the view survives a restart: the popover writes UiState.view and a stored one is pushed", async () => {
	fetch404();
	const stub = makeStubHost();
	const store = fakeUiStore();
	await renderShell(stub, store);
	await openViewPopover();
	act(() => {
		fireEvent.click(screen.getByLabelText("Normals (debug)"));
	});
	act(() => {
		fireEvent.click(screen.getByLabelText("grid"));
	});
	// Debounced, like the workspace writer — nothing on disk until it settles.
	expect(store.get("view")).toBeUndefined();
	await act(async () => {
		await new Promise((r) => setTimeout(r, 250));
	});
	expect(store.get("view")).toEqual({
		shading: "normals",
		layers: {
			field: true,
			kit: true,
			props: true,
			ghost: true,
			selection: true,
			grid: false,
			flags: true,
		},
		slice: null,
	});

	// …and the way back in: a fresh shell over that blob pushes the STORED view to the
	// host, not the defaults.
	cleanup();
	const next = makeStubHost();
	await renderShell(next, store);
	await act(async () => {
		await Promise.resolve();
	});
	expect(next.calls.setShading.mock.calls.at(-1)?.[0]).toBe("normals");
	expect(next.calls.setLayers.mock.calls.at(-1)?.[0]).toMatchObject({
		grid: false,
	});
	// AA is deliberately NOT persisted: restoring it would dispose and rebuild the GPU
	// context moments after the first one came up, because the store arrives late.
	expect(next.calls.init.mock.calls).toEqual([
		[screen.getByLabelText("field viewport"), { sampleCount: 4 }],
	]);
});

test("the X-ray is a SESSION choice — ticking it writes nothing, and a stale blob cannot re-arm it", async () => {
	fetch404();
	const stub = makeStubHost();
	const store = fakeUiStore();
	await renderShell(stub, store);
	await openViewPopover();
	// Tick the X-ray AND a plain layer, so the write that follows is one the debounce
	// definitely fired — an assertion over a blob that was never written proves nothing.
	act(() => {
		fireEvent.click(screen.getByLabelText("void cast"));
	});
	act(() => {
		fireEvent.click(screen.getByLabelText("grid"));
	});
	await act(async () => {
		await new Promise((r) => setTimeout(r, 250));
	});
	const written = store.get("view");
	expect(written?.layers).toEqual({
		field: true,
		kit: true,
		props: true,
		ghost: true,
		selection: true,
		grid: false,
		flags: true,
	});
	// Said twice on purpose: `toEqual` above would still pass an implementation that
	// wrote `voidCast: undefined`, which JSON.stringify drops on the way to storage but
	// which a `store.get` off an in-memory fake hands straight back.
	expect("voidCast" in (written?.layers ?? {})).toBe(false);

	// THE MIGRATION CASE. A blob written before this rule — or hand-edited — still
	// carries the key, and the host boots with the X-ray OFF: `setLayers` fires the cast
	// on the false→true EDGE, so a restored `true` always presents that edge. Depending on
	// an unpinned race between the store and the catalog-gated world restore that is
	// either a spurious "nothing to cast yet" toast over a world nobody has dug, or an
	// unrequested whole-world worker job at boot. Neither is something the user asked for.
	store.set("view", {
		shading: "studio",
		layers: { grid: false, voidCast: true },
		slice: null,
	});
	cleanup();
	const next = makeStubHost();
	await renderShell(next, store);
	await act(async () => {
		await Promise.resolve();
	});
	// Restored, not thrown on — and the X-ray is off, so nothing fires the edge.
	expect(next.calls.setLayers.mock.calls.at(-1)?.[0]).toEqual({
		field: true,
		kit: true,
		props: true,
		ghost: true,
		selection: true,
		grid: false,
		flags: true,
		voidCast: false,
	});
	// …and the control agrees with the host, rather than showing a tick over nothing.
	await openViewPopover();
	expect((screen.getByLabelText("void cast") as HTMLInputElement).checked).toBe(
		false,
	);
});

test("the burger's View group drives the same view state, and reads it back", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// The menu is the second surface over ONE state (the popover is the first): both
	// read `useView`, so a menu item that wrote somewhere else would show up as a host
	// call the popover's own cases never make.
	pickMenuItem("Grid");
	expect(stub.calls.setLayers.mock.calls.at(-1)?.[0]).toMatchObject({
		grid: false,
	});
	pickMenuItem("Normals shading");
	expect(stub.calls.setShading.mock.calls.at(-1)?.[0]).toBe("normals");

	// …and back the other way: re-opened, both items read the state they just wrote.
	// A menu that only WROTE would show two unticked boxes over a normals-shaded,
	// gridless viewport.
	act(() => {
		fireEvent.pointerDown(screen.getByLabelText("editor menu"), {
			button: 0,
			pointerType: "mouse",
		});
	});
	const item = (name: string): HTMLElement =>
		screen.getByRole("menuitemcheckbox", { name });
	expect(item("Grid").getAttribute("aria-checked")).toBe("false");
	expect(item("Normals shading").getAttribute("aria-checked")).toBe("true");
});

// --- (c3b) the rest of the burger tree: Edit, the popover door, Help ----------

/** A burger item by the start of its label. Disabled items are still in the tree —
 *  being visibly unavailable is the whole claim some of the cases below make. */
const menuItem = (name: RegExp): HTMLElement =>
	screen.getByRole("menuitem", { name });

test("the burger's Edit group steps the field's ONE history, and goes dead when there is nothing to step", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);

	// A session whose host has pushed no stats has provably done nothing yet, so both
	// verbs read as unavailable rather than as items that swallow a click (this menu's
	// rule — see BurgerMenu's header).
	openBurger();
	expect(menuItem(/^Undo/).getAttribute("aria-disabled")).toBe("true");
	expect(menuItem(/^Redo/).getAttribute("aria-disabled")).toBe("true");

	// One op in the log with nothing undone: Undo lights, Redo does not. Pushed while
	// the menu is OPEN, which is also the claim that the group reads the live stats
	// rather than a value captured when the shell mounted.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 1, undoDepth: 1 }));
	});
	expect(menuItem(/^Undo/).getAttribute("aria-disabled")).toBeNull();
	expect(menuItem(/^Redo/).getAttribute("aria-disabled")).toBe("true");

	act(() => {
		fireEvent.click(menuItem(/^Undo/));
	});
	// The SAME host method the ⌘Z chord reaches — one history, two surfaces.
	expect(stub.calls.undo.mock.calls.length).toBe(1);
	expect(stub.calls.redo).not.toHaveBeenCalled();

	// …and the redo stack that undo just filled turns the other item on. Without
	// `redoDepth` on the stats seam this item could only ever be permanently enabled —
	// a Redo that no-ops on an empty stack is exactly what the disabled state is for.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 1, undoDepth: 0, redoDepth: 1 }));
	});
	openBurger();
	expect(menuItem(/^Undo/).getAttribute("aria-disabled")).toBe("true");
	act(() => {
		fireEvent.click(menuItem(/^Redo/));
	});
	expect(stub.calls.redo.mock.calls.length).toBe(1);
	expect(stub.calls.undo.mock.calls.length).toBe(1);
});

test("the burger's View options item opens the popover beside it", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// Compared to null BEFORE the expect (the fiber-graph serialisation rule).
	expect(screen.queryByLabelText("void cast") === null).toBe(true);

	pickMenuItem("View options…");
	// Let Radix's Popper settle — it measures in a layout effect, which lands as an
	// un-act'ed update otherwise (the openViewPopover helper does the same).
	await act(async () => {
		await Promise.resolve();
	});
	// The layer gates are too many to carry as menu items, so the menu's job is to be the
	// door someone who has not decoded the ⬒ chip can find. A dead item here would leave
	// the whole popover undiscoverable from the menu.
	expect(screen.getByLabelText("void cast")).toBeTruthy();
});

// The overlay is HALF derived now: the app-level groups render from the action registry
// (so a binding that moves cannot leave a row behind), and the canvas group is still a
// hand-maintained table for the keys the viewport owns. The assertions are picked to
// cover both halves and each of the sources behind them: ⌘\ and ⌘Z come from the
// registry, the fly and radius rows from field-host.ts's keydown handler, the ⇧-arrow row
// from input-map.ts's nudge table.
//
// The DERIVED half is pinned by a stronger case below (every keyed action has a row), so
// what these rows are worth is the WORDING — that the sentence beside a keycap describes
// what this build actually does.
test("Help opens the shortcut overlay, and its rows are THIS build's bindings", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	pickMenuItem("Keyboard shortcuts");
	const dialog = await waitFor(() => screen.getByRole("dialog"));
	expect(
		within(dialog).getByRole("heading", { name: "Keyboard shortcuts" }),
	).toBeTruthy();

	/** What the table says a keycap does: the <dd> beside the <dt> carrying it. */
	const meaning = (keys: string): string => {
		const cap = within(dialog).getByText(keys);
		const term = cap.closest("dt");
		if (!(term instanceof HTMLElement)) throw new Error(`no row for ${keys}`);
		return term.nextElementSibling?.textContent ?? "";
	};

	expect(meaning("⌘\\")).toContain("palette");
	expect(meaning("⌘Z")).toContain("Undo");
	// The behaviour change this slice makes, said where a user would look for it: WASD
	// only flies while the right button is held, because otherwise those letters are tool
	// keys. A fly row that still read "Fly forward / back" would be teaching a lie.
	expect(meaning("W A S D")).toContain("right button is held");
	expect(meaning("[ / ]")).toContain("Brush radius");
	expect(meaning("⇧↑ / ⇧↓")).toContain("+Y");
	// The two mouse bindings that are not keys at all, and would be the easiest to leave
	// out of a "keyboard" overlay: without them the eyedropper and RMB-look are editor
	// features with no documentation anywhere in the product.
	expect(meaning("⌥ left-click")).toContain("Sample the material");
	expect(meaning("right-drag")).toContain("Look around");
});

test("the overlay renders the REGISTRY — every keyed action has a row, with its keycap", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	pickMenuItem("Keyboard shortcuts");
	const dialog = await waitFor(() => screen.getByRole("dialog"));
	// The claim the hand-maintained table could never make: a binding cannot ship
	// undocumented, because the rows ARE the table. Every action with a `match` is
	// listed under its own keycap.
	for (const action of ACTIONS) {
		if (action.match === undefined) continue;
		const keys = action.keys ?? "";
		expect({
			id: action.id,
			listed: within(dialog).queryAllByText(keys).length,
		}).toEqual({ id: action.id, listed: 1 });
	}
});

// --- (c4) the orientation triad ----------------------------------------------

test("the axis triad rides the camera pose, over the canvas and out of its way", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// Exactly ONE subscriber to the single-slot camera-pose seam (the provider, at
	// useFieldHostState). A second one anywhere in the shell would silently steal this
	// callback — the same claim the stats and tool-error seams pin above.
	expect(stub.calls.subscribeCameraPose.mock.calls.length).toBe(1);
	const triad = screen.getByRole("img", { name: "camera orientation axes" });
	const canvas = screen.getByLabelText("field viewport");
	// A CELL child like Toasts, absolutely placed: it takes nothing off the canvas
	// (D-1), and it must not eat the orbit drags that happen in the corner it sits in.
	// Two levels up since F4.5b Task 6: the drawing now sits beside the six snap
	// buttons inside the triad's own positioning wrapper.
	const box = triad.parentElement?.parentElement;
	if (!(box instanceof HTMLElement)) throw new Error("triad has no box");
	const cell = canvas.parentElement;
	if (!(cell instanceof HTMLElement)) throw new Error("canvas has no cell");
	expect(box.parentElement).toBe(cell);
	for (const cls of ["absolute", "pointer-events-none"])
		expect(box.classList.contains(cls)).toBe(true);

	// AFTER the palette layer in DOM order, which is the difference between an
	// overlay and a hidden one: the DEFAULT arrangement docks the controls palette to
	// the right edge at top 0, i.e. over exactly the corner the triad occupies. Mounted
	// before the layer, it ships invisible in the out-of-the-box workspace — and no
	// other case here would notice.
	const layer = flagsPalette()?.parentElement;
	if (!(layer instanceof HTMLElement)) throw new Error("palette layer missing");
	const order = [...cell.children];
	expect(order.indexOf(box)).toBeGreaterThan(order.indexOf(layer));

	// It draws the pose the host pushes — the X cap moves when the camera turns. The
	// axis line's own end point is the assertion: a triad that ignored the seam would
	// render the same SVG forever.
	const xCap = (): string | null =>
		triad.querySelector("line")?.getAttribute("x2") ?? null;
	const before = xCap();
	act(() => {
		stub.fire.cameraPose({ yaw: 1.9, pitch: 0.2 });
	});
	expect(xCap()).not.toBe(before);
});

test("the triad's six tips snap the view, and are real buttons", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const drawing = screen.getByRole("img", { name: "camera orientation axes" });
	const triad = drawing.parentElement;
	if (!(triad instanceof HTMLElement)) throw new Error("triad has no wrapper");

	// SIX, not three: the −axis tips are the +axis projection negated, and a
	// ViewCube that only reached three of the six faces would be half a control.
	// The order is FIXED and asserted UNSORTED, because it is the tab order: the
	// drawing is depth-sorted so near caps paint last, and emitting the buttons in
	// that order too would reshuffle focus order on every camera move.
	const tips = within(triad).getAllByRole("button");
	expect(tips.map((t) => t.getAttribute("aria-label"))).toEqual([
		"View from +X",
		"View from -X",
		"View from +Y",
		"View from -Y",
		"View from +Z",
		"View from -Z",
	]);
	// Still depth-resolved for the pointer, via z-index rather than DOM order.
	const zOf = (name: string): number =>
		Number(
			within(triad)
				.getByRole("button", { name })
				.style.getPropertyValue("z-index"),
		);
	act(() => {
		stub.fire.cameraPose({ yaw: 0, pitch: 0 });
	});
	// At yaw 0 / pitch 0 the camera looks down −Z, so +Z points at the viewer and
	// −Z away: the near tip must win an overlap, and at this pose they overlap
	// exactly (both project to the centre).
	expect(zOf("View from +Z")).toBeGreaterThan(zOf("View from -Z"));

	// Clicking a tip is the snap. The ARGUMENTS are the assertion: axis and sign
	// are invisible to every other check here, and getting the sign wrong is the
	// one mistake that looks fine in a DOM test and wrong on screen.
	fireEvent.click(within(triad).getByRole("button", { name: "View from +X" }));
	expect(stub.calls.snapView.mock.calls.at(-1)).toEqual(["x", 1]);
	fireEvent.click(within(triad).getByRole("button", { name: "View from -Z" }));
	expect(stub.calls.snapView.mock.calls.at(-1)).toEqual(["z", -1]);

	// Keyboard reachability comes from these being REAL buttons rather than
	// role="button" on an SVG shape — focus, Enter/Space activation and the focus
	// ring are then the platform's job instead of a hand-rolled key handler's.
	// That is what this checks, and it is honest about its limit: happy-dom does
	// not synthesize a click from a keydown on a button, so firing one here would
	// pin nothing in either direction. What it CAN catch is the regression that
	// matters — a tip that stops being a button element.
	for (const tip of tips) {
		expect(tip.tagName).toBe("BUTTON");
		expect(tip.getAttribute("type")).toBe("button");
		// The overlay box is pointer-events-none (above); without this the tips
		// would be unclickable in a browser and this suite could not tell.
		expect(tip.classList.contains("pointer-events-auto")).toBe(true);
		// Tailwind v4 dropped Preflight's `cursor: pointer` on buttons, and this
		// control has no visible box — the cursor and the hover ring are the only
		// thing that says it is one. The title is the orientation cue.
		expect(tip.classList.contains("cursor-pointer")).toBe(true);
		expect(tip.getAttribute("title")).toBe(tip.getAttribute("aria-label"));
	}
});

test("a triad tip does not steal focus from the canvas, and suppresses the context menu", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const canvas = screen.getByLabelText("field viewport");
	const tip = screen.getByRole("button", { name: "View from +X" });

	// THE bug this pins: the host binds every viewport key to the CANVAS
	// (W/A/S/D, F, [ / ], ⌘Z) and its `blur` CANCELS a live move. The tips are
	// canvas SIBLINGS, so a click that moved focus would silently disarm the
	// viewport — and cost a `G`-grabbing user their grab, with nothing on screen
	// saying why. Suppressing the default on the left press is what stops the
	// browser's click-focus transfer, and it leaves Tab-focus and Enter/Space
	// alone. Asserted through defaultPrevented because focus transfer itself is a
	// browser behaviour happy-dom does not model.
	canvas.focus();
	const press = new Event("pointerdown", { bubbles: true, cancelable: true });
	Object.defineProperty(press, "button", { value: 0 });
	tip.dispatchEvent(press);
	expect(press.defaultPrevented).toBe(true);

	// A RIGHT press falls through untouched — swallowing it would make the corner
	// a dead zone for the gesture the overlay is pointer-events-none to protect.
	const rightPress = new Event("pointerdown", {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperty(rightPress, "button", { value: 2 });
	tip.dispatchEvent(rightPress);
	expect(rightPress.defaultPrevented).toBe(false);

	// …but the browser menu is still suppressed. `onContextMenu` lives on the
	// canvas, and these buttons are not canvas descendants, so without their own
	// handler a right-press here opens it over the viewport.
	const menu = new Event("contextmenu", { bubbles: true, cancelable: true });
	tip.dispatchEvent(menu);
	expect(menu.defaultPrevented).toBe(true);
});

// --- (d) the layout contract + the retired dock ------------------------------

test("the palette layer floats over the canvas and never swallows viewport input", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const canvas = screen.getByLabelText("field viewport");
	const cell = canvas.parentElement;
	const palette = flagsPalette();
	const layer = palette?.parentElement;
	if (!(palette instanceof HTMLElement) || !(layer instanceof HTMLElement))
		throw new Error("flags palette missing");

	// The layer sits in the same positioned cell as the canvas, absolutely, covering it.
	// As a flex sibling it would subtract its own width from the canvas — and then every
	// palette that opens would move the viewport, the failure this contract exists for.
	expect(layer.parentElement).toBe(cell);
	for (const cls of ["absolute", "inset-0"])
		expect(layer.classList.contains(cls)).toBe(true);
	// …and because it covers the canvas edge to edge, it must be transparent to the
	// pointer everywhere except on a palette. Without this pair, orbit/dig anywhere
	// under the layer silently stops working and no other case here notices.
	expect(layer.classList.contains("pointer-events-none")).toBe(true);
	expect(palette.classList.contains("pointer-events-auto")).toBe(true);
	// `isolate` is what CONFINES the click-to-front z-indexes to this layer. Without it
	// (position:absolute with z-index:auto creates no stacking context) a raised palette
	// competes with the layer's SIBLINGS — the triad and the toast stack, both above it
	// by DOM order alone — and a refusal ends up painted under a palette. The DOM-order
	// assertions elsewhere in this file cannot see that: they are still true when it
	// breaks.
	expect(layer.classList.contains("isolate")).toBe(true);

	expect(palette.contains(canvas)).toBe(false);
	// Placed at its floating default, and it really has a BODY — the point of the pair is
	// that this is a palette, not an empty positioned box. The flag chips render whether
	// or not the advisor has found anything, which is what makes the second half stable.
	expect(palette.style.left).toBe(FLAGS_DEFAULT_LEFT);
	expect(palette.style.top).toBe(FLAGS_DEFAULT_TOP);
	expect(
		palette.contains(screen.getByRole("button", { name: "candidates" })),
	).toBe(true);
});

test("the entities palette floats clear of the docked controls and the triad", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const entities = entitiesPalette();
	if (!(entities instanceof HTMLElement))
		throw new Error("the entities palette is not open");
	// Open out of the box: it is the reference surface for everything the dig loop
	// commits, and the list itself starts collapsed so an empty world costs one row.
	expect(within(entities).getByText("Entities (0)")).toBeTruthy();
	// Floating top-left. NOT docked, and that is a layout decision rather than taste:
	// the default arrangement already spends the right edge on controls (full height)
	// and the top-right corner on the triad, so a second dock would leave the collapsed-
	// chip rail nowhere to go.
	expect(entities.style.left).toBe("24px");
	expect(entities.style.top).toBe("24px");
	expect(entities.style.right).toBe("");
	// …and it is a separate palette, not a section of the controls stack it left.
	const controls = flagsPalette();
	if (!(controls instanceof HTMLElement)) throw new Error("controls missing");
	expect(controls.contains(entities)).toBe(false);
	expect(within(controls).queryByText(/^Entities \(/) === null).toBe(true);
});

// Two floating palettes make stacking real for the first time (Task 6 parked it as
// meaningless with one). A pointerdown ANYWHERE in a palette raises it — reaching for a
// control on a buried one has to uncover it, not just click through to it.
test("a pointerdown raises a palette above the others, and does not persist", async () => {
	fetch404();
	const stub = makeStubHost();
	const store = fakeUiStore();
	await renderShell(stub, store);
	const zOf = (el: Element | null): string =>
		el instanceof HTMLElement ? el.style.zIndex : "";
	// The initial order is PALETTE_IDS, so `flags` (third) starts above `entities`
	// (first). Asserted rather than assumed: the two clicks below only mean something if
	// the stack they reorder is known, and reading it off the shipped order is what makes
	// the SECOND click a genuine restoration rather than a repeat of the first.
	expect(Number(zOf(flagsPalette()))).toBeGreaterThan(
		Number(zOf(entitiesPalette())),
	);

	// A click on a palette BODY (not its header — the raise must not be a drag-handle
	// privilege) puts it on top. Entities first, because it is the one UNDER the other:
	// clicking the palette that is already on top could not tell a working raise from no
	// raise at all.
	act(() => {
		fireEvent.pointerDown(
			within(entitiesPalette() as HTMLElement).getByText("Entities (0)"),
			{ button: 0, pointerId: 1 },
		);
	});
	expect(Number(zOf(entitiesPalette()))).toBeGreaterThan(
		Number(zOf(flagsPalette())),
	);

	// …and back again, so the order is a stack rather than a one-way promotion. The flags
	// palette is the probe for this half because it is the one with a body that is always
	// there — the chips render whether or not the advisor has found anything.
	act(() => {
		fireEvent.pointerDown(screen.getByRole("button", { name: "candidates" }), {
			button: 0,
			pointerId: 2,
		});
	});
	expect(Number(zOf(flagsPalette()))).toBeGreaterThan(
		Number(zOf(entitiesPalette())),
	);

	// Deliberately NOT persisted (D-3 persists geometry, collapse and open — the
	// arrangement DECISIONS). Which palette was touched last is an accident of the final
	// minute of a session; the debounced writer must not have been armed by it.
	await act(async () => {
		await new Promise((r) => setTimeout(r, 250));
	});
	expect(store.get("workspace")).toBeUndefined();
});

// The summon guarantee, tested through the path that BREAKS it. `log` and `entities`
// share a default corner ({24,24}) on purpose, so "the log opens where you can read it"
// rests entirely on opening raising it. The initial stack is PALETTE_IDS order, which
// puts the log on top for free — so a naive test (summon on a fresh shell) passes
// against a layer that has no such guarantee at all. Clicking entities FIRST is what
// makes the assertion mean something: it demotes the log, and only a raise-on-open
// brings it back.
test("summoning a palette raises it, even after another was clicked", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const zOf = (el: Element | null): number =>
		el instanceof HTMLElement ? Number(el.style.zIndex) : Number.NaN;

	// Demote the log by using the palette that shares its corner.
	act(() => {
		fireEvent.pointerDown(
			within(entitiesPalette() as HTMLElement).getByText("Entities (0)"),
			{ button: 0, pointerId: 1 },
		);
	});
	expect(zOf(entitiesPalette())).toBeGreaterThan(zOf(flagsPalette()));

	// Now summon the log the way a user does — the ⚠ chip, which is the whole reason
	// the palette has a default position at all.
	act(() => {
		stub.fire.toolError("selection found no matching cells");
	});
	act(() => {
		fireEvent.click(screen.getByLabelText(/unread error/));
	});
	const log = logPalette();
	if (!(log instanceof HTMLElement)) throw new Error("the log did not open");
	// In FRONT of the palette parked in the same corner. Without the raise-on-open the
	// log opens underneath it and the chip reads as a click that did nothing — the exact
	// failure the ⚠ chip's un-latch and un-collapse already exist to prevent, arriving
	// through the one door left open.
	expect(zOf(log)).toBeGreaterThan(zOf(entitiesPalette()));

	// The View menu is the other opening path, and it must not be a second mechanism:
	// closing and re-opening from the menu raises it again.
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: "close Messages" }));
	});
	act(() => {
		fireEvent.pointerDown(
			within(entitiesPalette() as HTMLElement).getByText("Entities (0)"),
			{ button: 0, pointerId: 2 },
		);
	});
	pickMenuItem("Messages palette");
	expect(zOf(logPalette())).toBeGreaterThan(zOf(entitiesPalette()));
});

// The occlusion hole, and the reason the depth term is not cosmetic. Being READ is what
// takes the ⚠ chip down, and "rendering" is not "readable": a log buried under the
// palette it shares a default corner with marked every arriving error read behind an
// opaque box, so the chip never lit again and the editor silently stopped reporting
// failures. Strictly worse than the stacking glitch it looks like — the notification
// channel is what tells the user anything went wrong at all.
test("a log BURIED under another palette does not mark arriving errors read", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// Summon the log (this raises it, and marks what is already there read)…
	act(() => {
		stub.fire.toolError("first");
	});
	act(() => {
		fireEvent.click(screen.getByLabelText(/unread error/));
	});
	expect(screen.queryByLabelText(/unread error/)).toBeNull();

	// …then bury it under the palette parked in the same corner.
	act(() => {
		fireEvent.pointerDown(
			within(entitiesPalette() as HTMLElement).getByText("Entities (0)"),
			{ button: 0, pointerId: 1 },
		);
	});

	// The log is still `open`, still un-collapsed, still un-latched, still RENDERING —
	// every term the probe had before this fix — and the user cannot read a word of it.
	act(() => {
		stub.fire.toolError("second");
	});
	expect(
		screen.getByLabelText("1 unread error — open the message log"),
	).toBeTruthy();

	// Self-healing, which is what makes the under-marking direction acceptable: clicking
	// the log raises it, and the chip stands down.
	act(() => {
		fireEvent.pointerDown(
			within(logPalette() as HTMLElement).getByText("second"),
			{ button: 0, pointerId: 2 },
		);
	});
	expect(screen.queryByLabelText(/unread error/)).toBeNull();
});

test("summoning a log that is already open but buried brings it back to the front", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub, fakeUiStore({ workspace: LOG_OPEN }));
	const zOf = (el: Element | null): number =>
		el instanceof HTMLElement ? Number(el.style.zIndex) : Number.NaN;
	// Bury the (already open) log.
	act(() => {
		fireEvent.pointerDown(
			within(entitiesPalette() as HTMLElement).getByText("Entities (0)"),
			{ button: 0, pointerId: 1 },
		);
	});
	expect(zOf(logPalette())).toBeLessThan(zOf(entitiesPalette()));

	// There is NO open transition here — the log never closed — so a raise that only
	// rode false→true would leave this chip clicking into the void, on a palette that is
	// already `open: true` and therefore already "summoned" as far as the store knows.
	act(() => {
		stub.fire.toolError("buried");
	});
	act(() => {
		fireEvent.click(screen.getByLabelText(/unread error/));
	});
	expect(zOf(logPalette())).toBeGreaterThan(zOf(entitiesPalette()));
});

test("the collapsed-chip rail sits clear of the docked palette it used to cover", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: "collapse Flags" }));
	});
	const chip = screen.getByRole("button", { name: "expand Flags" });
	const rail = chip.parentElement;
	if (!(rail instanceof HTMLElement)) throw new Error("no chip rail");
	// Bottom-LEFT. It used to be top-right, which is where the axis triad sits and where
	// the default arrangement used to dock the controls palette full-height — so every
	// chip shipped on top of something.
	for (const cls of ["bottom-0", "left-0"])
		expect(rail.classList.contains(cls)).toBe(true);
	for (const gone of ["top-0", "right-0"])
		expect(rail.classList.contains(gone)).toBe(false);
	// …and it stacks ABOVE every palette. The rail used to win by DOM order alone; the
	// click-to-front z-indexes broke that, and a chip is the only way back to the
	// palette it stands for — burying one is a control that cannot be reached.
	const topPalette = Math.max(
		...[entitiesPalette(), flagsPalette()]
			.filter((el): el is HTMLElement => el instanceof HTMLElement)
			.map((el) => Number(el.style.zIndex)),
	);
	expect(Number(rail.style.zIndex)).toBeGreaterThan(topPalette);
});

test("a palette collapses to a rail chip that restores it, keeping its geometry", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub, fakeUiStore({ workspace: MOVED }));
	expect(flagsPalette()?.style.left).toBe("120px");

	act(() => {
		fireEvent.click(screen.getByRole("button", { name: "collapse Flags" }));
	});
	// Out of the layout AND out of the accessibility tree — but still MOUNTED behind
	// `hidden`, so the panel's host-subscribed state survives the round trip.
	// `getByText`, not `getByRole`: `hidden` takes the subtree out of the a11y tree,
	// which is the very claim above, so a role query would find nothing either way. The
	// text probed is the ENTITIES palette's, because `controls` renders nothing since
	// F4.5b Task 13 — a collapse that unmounted its neighbour would be the same defect
	// and is what this half is really about.
	expect(flagsPalette()).toBeNull();
	expect(screen.getByText("Entities (0)")).toBeTruthy();
	// The button that was just clicked went with the palette, so focus has to be MOVED
	// or it lands on <body> and a keyboard user restarts from the top of the document.
	const chip = screen.getByRole("button", { name: "expand Flags" });
	expect(document.activeElement).toBe(chip);

	act(() => {
		fireEvent.click(chip);
	});
	const restored = flagsPalette();
	expect(restored?.style.left).toBe("120px");
	expect(restored?.style.top).toBe("60px");
	expect(screen.queryByRole("button", { name: "expand Flags" })).toBeNull();
	// …and back the other way: the chip unmounted, so focus returns to the control that
	// now does its job.
	expect(document.activeElement).toBe(
		screen.getByRole("button", { name: "collapse Flags" }),
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
	expect(flagsPalette()).toBeNull();
	// The chord hides the CHROME, not the viewport: the canvas and its cell are exactly
	// as they were, which is the whole point of the layer being a layer.
	expect(screen.getByLabelText("field viewport")).toBe(canvas);
	// …and it hides rather than UNMOUNTS: ⌘\ is a peek, and a peek that tears the
	// palettes down would reset every host-subscribed control inside them. Probed on
	// two palettes with real bodies — `controls` renders nothing since F4.5b Task 13.
	expect(screen.getByText("Entities (0)")).toBeTruthy();
	expect(screen.getByText("Flags · 0 candidates")).toBeTruthy();

	act(() => {
		fireEvent.keyDown(window, { key: "\\", metaKey: true });
	});
	// Exact, not defaults: the palette comes back at the position it was hidden from.
	expect(flagsPalette()?.style.left).toBe("120px");
	expect(flagsPalette()?.style.top).toBe("60px");
});

test("the top bar's ⌘\\ control is live, and follows the state it toggles", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const toggle = screen.getByRole("button", { name: /hide palettes/ });
	act(() => {
		fireEvent.click(toggle);
	});
	expect(flagsPalette()).toBeNull();
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
				flags: { x: 500, y: 300, edge: null, collapsed: true, open: false },
			},
			hidden: true,
		},
	});
	await renderShell(stub, store);
	expect(flagsPalette()).toBeNull();

	pickMenuItem("Reset workspace");
	// The panel MOUNTS again here (it was closed), so let its catalog GET settle.
	await flushCatalog();

	// Back to the shipped arrangement: open, uncollapsed, at its floating default.
	expect(flagsPalette()?.style.left).toBe(FLAGS_DEFAULT_LEFT);
	expect(flagsPalette()?.style.top).toBe(FLAGS_DEFAULT_TOP);
	// …and the blob is GONE, not rewritten with the defaults: the next session starts
	// from whatever the defaults are then, not from a snapshot of today's.
	expect(store.get("workspace")).toBeUndefined();
});

test("the View menu can re-open a palette closed with its ×", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);

	act(() => {
		fireEvent.click(screen.getByRole("button", { name: "close Flags" }));
	});
	expect(flagsPalette()).toBeNull();
	// Closing must not be a trap: without this item the only way back is Reset
	// Workspace, which also discards every position the user set.
	pickMenuItem("Flags palette");
	await flushCatalog();
	expect(flagsPalette()).toBeTruthy();
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
	expect(flagsPalette()?.style.left).toBe(FLAGS_DEFAULT_LEFT);
	expect(flagsPalette()?.style.top).toBe(FLAGS_DEFAULT_TOP);

	// …and the moment it does arrive, the saved arrangement is adopted.
	act(() => {
		rerender(withEditor(<Shell />, stub, fakeUiStore({ workspace: MOVED })));
	});
	expect(flagsPalette()?.style.left).toBe("120px");
	expect(flagsPalette()?.style.top).toBe("60px");
});

// The restore is NOT a summon, and the layer cannot tell them apart on its own — a restore
// that re-opens a palette arrives as exactly the closed→open transition the summon
// safety-net raises on. That used to be harmless by coincidence (`log` was the only palette
// whose default is closed AND was last in PALETTE_IDS, so its raise landed where it already
// was); the session card made the closed set bigger and the coincidence stopped holding, so
// the provider now says where an arrangement came from.
//
// The fixture is built so the raise is OBSERVABLE, which takes work: the initial stack IS
// PALETTE_IDS order and the safety-net raises in PALETTE_IDS order, so on a fresh shell a
// spurious raise reproduces the order it started from and nothing moves. Clicking a palette
// FIRST is what makes it visible — and a late-arriving store is the real shape of this
// (project.get resolves after the first paint), not a contrivance.
test("a RESTORE does not steal the front from the palette the user is working in", async () => {
	fetch404();
	const stub = makeStubHost();
	const { rerender } = renderShellResult(stub, undefined);
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	const zOf = (el: Element | null): number =>
		el instanceof HTMLElement ? Number(el.style.zIndex) : Number.NaN;

	// The user brings the entities palette to the front.
	act(() => {
		fireEvent.pointerDown(
			within(entitiesPalette() as HTMLElement).getByText("Entities (0)"),
			{ button: 0, pointerId: 1 },
		);
	});

	// …and THEN the persisted arrangement lands, carrying an open log.
	act(() => {
		rerender(
			withEditor(
				<Shell />,
				stub,
				fakeUiStore({
					workspace: {
						palettes: {
							log: { x: 24, y: 24, edge: null, collapsed: false, open: true },
						},
						hidden: false,
					},
				}),
			),
		);
	});
	const log = logPalette();
	if (!(log instanceof HTMLElement)) throw new Error("the log did not restore");
	// The log is BACK, because that is what was on disk — and it is BEHIND the palette the
	// user just clicked, because nobody summoned it.
	expect(zOf(entitiesPalette())).toBeGreaterThan(zOf(log));

	// The other half, and the reason this is not just "never raise": a real summon after a
	// restore still raises. Without it the fix would trade one silent failure for another.
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: "close Messages" }));
	});
	pickMenuItem("Messages palette");
	expect(zOf(logPalette())).toBeGreaterThan(zOf(entitiesPalette()));
});

// The DRIVEN open must not claim the arrangement, and this is the case that costs the user
// something real if it does. The store arrives LATE (project.get is an RPC), and the restore
// is skipped outright once `touched` is set — so a card that opened in that window through
// the ordinary `setOpen` would silently discard the whole persisted arrangement for that
// boot, and the next drag would overwrite the blob with defaults. Narrow race, silent,
// permanent. `setDrivenOpen` is the verb that moves the state without making the claim.
test("a card that auto-opens BEFORE the store arrives does not discard the saved arrangement", async () => {
	fetch404();
	const stub = makeStubHost();
	// No store yet — the shape App is in until `project.get` resolves.
	const { rerender } = renderShellResult(stub, undefined);
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	expect(flagsPalette()?.style.left).toBe(FLAGS_DEFAULT_LEFT);
	expect(flagsPalette()?.style.top).toBe(FLAGS_DEFAULT_TOP);

	// The user selects something in the viewport. The session card auto-opens — a write to
	// the arrangement that the user did not make.
	act(() => {
		stub.fire.stamp({
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
		});
	});
	expect(screen.queryByRole("region", { name: "Session" })).toBeTruthy();

	// …and THEN the store lands. The saved arrangement must still be adopted.
	act(() => {
		rerender(withEditor(<Shell />, stub, fakeUiStore({ workspace: MOVED })));
	});
	expect(flagsPalette()?.style.left).toBe("120px");
	expect(flagsPalette()?.style.top).toBe("60px");
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
	const palette = flagsPalette();
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
	const moved = flagsPalette();
	expect(moved?.style.left).toBe("120px");
	expect(moved?.style.top).toBe("60px");
	expect(moved?.style.right).toBe("");

	// Nothing is written synchronously (a drag would write 60×/s, and every write
	// re-serializes the whole blob); the debounce lands it once.
	expect(store.get("workspace")).toBeUndefined();
	await waitFor(() => {
		expect(store.get("workspace")?.palettes["flags"]?.x).toBe(120);
	});
});

test("a drag that loses its pointer capture stops, instead of following the cursor", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub, fakeUiStore({ workspace: MOVED }));
	const header = flagsPalette()?.querySelector("header");
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
	expect(flagsPalette()?.style.left).toBe("120px");

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
	expect(flagsPalette()?.style.left).toBe("120px");
});

test("a Reset that happens BEFORE the store arrives is not undone by the restore", async () => {
	fetch404();
	const stub = makeStubHost();
	// No store yet — `project.get` has not resolved, so persistence is off.
	const { rerender } = renderShellResult(stub, undefined);
	await flushCatalog();

	pickMenuItem("Reset workspace");
	await flushCatalog();
	expect(flagsPalette()?.style.left).toBe(FLAGS_DEFAULT_LEFT);
	expect(flagsPalette()?.style.top).toBe(FLAGS_DEFAULT_TOP);

	// …and NOW the store lands, carrying the arrangement the user just discarded. The
	// naive arrival effect restores it over the reset and leaves the screen AND the disk
	// wrong; the reset has to win, and the delete it could not perform has to happen.
	const store = fakeUiStore({ workspace: MOVED });
	act(() => {
		rerender(withEditor(<Shell />, stub, store));
	});
	expect(flagsPalette()?.style.left).toBe(FLAGS_DEFAULT_LEFT);
	expect(flagsPalette()?.style.top).toBe(FLAGS_DEFAULT_TOP);
	expect(store.get("workspace")).toBeUndefined();
});

test("the canvas cell's insets come from the two bars and nothing else", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const cell = screen.getByLabelText("field viewport").parentElement;
	const row = cell?.parentElement;
	const root = row?.parentElement;
	if (
		!(cell instanceof HTMLElement) ||
		!(row instanceof HTMLElement) ||
		!(root instanceof HTMLElement)
	)
		throw new Error("shell root missing");

	// A fixed, full-window column: bar, body row, bar. `fixed inset-0` is what keeps the
	// page from scrolling as a whole — the shell owns the viewport.
	for (const cls of ["fixed", "inset-0", "flex", "flex-col"])
		expect(root.classList.contains(cls)).toBe(true);
	// EXACTLY three children. Without this count a fourth element appended after the
	// footer — the flex sibling this contract forbids — passes every other assertion
	// here silently, which is the regression most likely to actually happen.
	expect(root.children.length).toBe(3);
	const [header, middle, footer] = [...root.children];
	expect(middle).toBe(row);
	expect(header?.tagName).toBe("HEADER");
	expect(footer?.tagName).toBe("FOOTER");
	// Fixed heights, never shrinking: they ARE two thirds of the cell's inset budget.
	for (const bar of [header, footer]) {
		expect(bar?.classList.contains("shrink-0")).toBe(true);
		expect(bar?.contains(cell)).toBe(false);
	}
	expect(header?.classList.contains("h-10")).toBe(true);
	expect(footer?.classList.contains("h-7")).toBe(true);

	// The third inset is the tool rail (F4.5b Task 8): a fixed 44 px COLUMN, the row's
	// only other child, and a sibling of the cell rather than a parent of it. The same
	// count assertion carries the same force one level down — a palette that crept into
	// this row as a flex sibling is the exact regression the whole layer exists to
	// prevent, and it would take width off the canvas permanently.
	expect(row.children.length).toBe(2);
	const [rail, canvasCell] = [...row.children];
	expect(canvasCell).toBe(cell);
	// A toolbar, not a nav landmark: it arms tools rather than navigating, and the role is
	// what commits it to the roving-tabindex pattern (D-26) — see tool-rail.test.tsx.
	expect(rail?.getAttribute("role")).toBe("toolbar");
	for (const cls of ["w-11", "shrink-0"])
		expect(rail?.classList.contains(cls)).toBe(true);
	expect(rail?.contains(cell)).toBe(false);
});

test("no dock DOM survives", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	expect(document.querySelector(".dockview-theme-dark")).toBeNull();
	expect(document.querySelector(".dv-tab")).toBeNull();
});

// --- (c9) the action registry: app-level key dispatch (D-10/D-11/D-12) -------
//
// The window listener is the whole point of the registry: the canvas's own keydown
// handler dies the moment the user clicks a palette control, which is the standing F2b
// finding these bindings exist to answer. Everything below therefore fires at `window`
// (or at a text input inside the tree) — never at the canvas.

/** One committed hall, selected, as the host would publish it. */
function selectHall(stub: ReturnType<typeof makeStubHost>): void {
	stub.setEntities([
		{
			entityId: 4,
			type: "generator",
			generator: "hall",
			params: {},
			seed: 7,
			region: { min: [0, 0, 0], max: [4, 4, 4] },
			opSpan: [2, 4],
			placed: [],
		},
	]);
	act(() => {
		stub.fire.entities();
		stub.fire.entitySelection(4);
	});
}

const pressKey = (key: string, init: Record<string, unknown> = {}): void => {
	act(() => {
		fireEvent.keyDown(window, { key, ...init });
	});
};

test("the family keys arm what LMB does, and ⇧ steps through the family", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const armed = () => stub.calls.setGesture.mock.calls.map((c) => c[0]);

	pressKey("m"); // the cell-select family, first member
	pressKey("M", { shiftKey: true }); // …step
	pressKey("v"); // back to the pointer
	expect(armed()).toEqual(["box", "material", "pointer"]);

	// The brush family arms through setTool (its members are EFFECTS, not gestures)
	// and disarms the pointer that was holding LMB — both halves, because arming an
	// effect while the pointer still owns the click is a brush that never strokes.
	pressKey("b");
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		effect: "dig",
	});
	expect(armed().at(-1)).toBe(null);
	pressKey("B", { shiftKey: true });
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		effect: "fill",
	});
});

test("G grabs and ⌘J duplicates the SELECTED entity — the verbs T4 and T5 left unreachable", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);

	// With nothing selected both are disabled, and the key is still SWALLOWED (the
	// dispatcher claims a matched event before it consults `enabled`) — what must not
	// happen is a host call on an id that does not exist.
	pressKey("g");
	pressKey("j", { metaKey: true });
	expect(stub.calls.beginMove).not.toHaveBeenCalled();
	expect(stub.calls.duplicateEntity).not.toHaveBeenCalled();

	selectHall(stub);
	pressKey("g");
	pressKey("j", { metaKey: true });
	expect(stub.calls.beginMove.mock.calls).toEqual([[4]]);
	expect(stub.calls.duplicateEntity.mock.calls).toEqual([[4]]);
});

test("⌫ asks before it deletes, and names the stamp it would remove", async () => {
	fetch404();
	const stub = makeStubHost();
	const requests: ConfirmRequest[] = [];
	renderWithEditor(
		<Shell />,
		makeEditorContext({
			fieldHostRef: { current: stub.host },
			openConfirm: (r) => requests.push(r),
		}),
	);
	await flushCatalog();
	selectHall(stub);

	pressKey("Backspace");
	expect(requests.length).toBe(1);
	expect(requests[0]?.destructive).toBe(true);
	// The op count is the honest measure of what is about to go (a scatter reads
	// "1 ops" and takes every prop it placed with it).
	expect(requests[0]?.message).toContain("3 ops");
	// Nothing is deleted until the prompt is answered.
	expect(stub.calls.deleteEntity).not.toHaveBeenCalled();
	act(() => requests[0]?.onConfirm());
	expect(stub.calls.deleteEntity.mock.calls).toEqual([[4]]);
});

test("Esc runs the host's cancel ladder, from anywhere", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	pressKey("Escape");
	expect(stub.calls.escape.mock.calls.length).toBe(1);
});

test("the FLY LETTERS stand down while the right button is held — polled per press", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN_MIN] });
	await renderShell(stub);

	// `S` is fly-backward AND the stamp family — the one keycap in the table that
	// collides. What separates them is the button, and the button goes down and up
	// BETWEEN renders, so the gate has to ask the host at the moment of the press: a ctx
	// that snapshotted this would answer for a frame that has already gone.
	stub.setLooking(true);
	pressKey("s");
	expect(stub.calls.startStamp).not.toHaveBeenCalled();

	stub.setLooking(false);
	pressKey("s");
	expect(stub.calls.startStamp.mock.calls).toEqual([["hall"]]);

	// Everything that does NOT collide stays live while looking, and that is the point of
	// keying this on the fly set rather than on "is it a bare key": `R` and `F` are not
	// fly letters, and turning a ghost while orbiting round it is a normal gesture.
	stub.setLooking(true);
	pressKey("f");
	pressKey("Escape");
	expect(stub.calls.frameSelection.mock.calls.length).toBe(1);
	expect(stub.calls.escape.mock.calls.length).toBe(1);
});

test("a bare key typed into a text field is a CHARACTER, not a binding", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// The world drawer's name form is a real text input inside the shell — a place the
	// user genuinely types letters that are also bindings.
	pickMenuItem("Save as…");
	const input = await waitFor(() =>
		screen.getByLabelText("save as world name"),
	);

	act(() => {
		fireEvent.keyDown(input, { key: "v" });
		fireEvent.keyDown(input, { key: "b" });
	});
	expect(stub.calls.setGesture).not.toHaveBeenCalled();
	expect(stub.calls.setTool).not.toHaveBeenCalled();

	// A ⌘-chord is the opposite case and stays live in the same field: the browser
	// default it replaces (the input's own undo stack) is worse.
	act(() => {
		stub.fire.stats(makeStats({ undoDepth: 1 }));
	});
	act(() => {
		fireEvent.keyDown(input, { key: "z", metaKey: true });
	});
	expect(stub.calls.undo.mock.calls.length).toBe(1);
});

test("a family key during a live session refuses OUT LOUD rather than going quiet", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		stub.fire.stamp({
			generator: "hall",
			params: {},
			seed: 1,
			policy: "replace",
			region: { min: [0, 0, 0], max: [4, 4, 4] },
			phase: "ready",
			run: 1,
			opCount: 3,
			placementCount: 0,
			error: null,
			truncatedSelection: false,
			mode: "stamp",
			entityId: null,
		});
	});

	// Cleared first so the assertion below reads THIS message: the toast stack is
	// capped at three, and a shell that has already said something (the 404 catalog
	// pass does) can push a fourth into the log without ever giving it a slot.
	act(() => notify.clear());
	pressKey("b");
	expect(stub.calls.setTool).not.toHaveBeenCalled();
	// The hint is the whole point of refusing here rather than silently: a key that
	// looks dead teaches the user it IS dead. Asserted inside the toast STACK rather
	// than anywhere on screen — the live region carries the same string, and a message
	// that only reached the log would be a hint nobody sees.
	expect(
		within(screen.getByLabelText("notifications")).getByText(
			/finish the session first/,
		),
	).toBeTruthy();

	// Esc and ⏎ stay live — they are how the session ends. ⏎ goes through the MOVE-AWARE
	// verb, not `commitSession`: a grab started from the Edit menu or by `G` with a
	// palette control focused never gave the canvas focus, so this listener is the only
	// one that can answer the "⏎ drop" the status bar advertises.
	pressKey("Enter");
	expect(stub.calls.confirmSession.mock.calls.length).toBe(1);
});

test("the status bar's keymap line follows what is armed", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// WHOLE lines, not prefixes. A first cut matched `/LMB select · G grab/` and stayed
	// GREEN when the tail of that very line was changed from "⌫ delete" to "X delete" —
	// a guard that could not fire on three quarters of what it claimed to pin.
	expect(
		screen.getByText("LMB select · G grab · F frame · ⌫ delete"),
	).toBeTruthy();

	pressKey("b");
	expect(
		screen.getByText("LMB dig · [ ] radius · ⇧ smooth · ⌃ fill · X swap"),
	).toBeTruthy();
	// ⌃ swaps SYMMETRICALLY (field-host's deriveMomentary), so under fill it gives dig.
	pressKey("B", { shiftKey: true });
	expect(
		screen.getByText("LMB fill · [ ] radius · ⇧ smooth · ⌃ dig · X swap"),
	).toBeTruthy();

	pressKey("m");
	expect(screen.getByText("click ×2 spans a region · Esc clears")).toBeTruthy();
});

/** A fresh STAMP session — the base the three state fixtures below vary. */
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

test("the keymap's session line ends with the SAME verbs the card and the strip show", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);

	// A STAMP: the branch that was wrong. This line re-derived its pair from `moving`
	// alone, so a stamp inherited RECONFIGURE's "apply / discard" while the card said
	// "commit / discard" and the session strip said "apply / revert" — three surfaces,
	// three answers, all on screen at once during the soak gate's create-a-hall step.
	const live = (s: StampSession) =>
		act(() => {
			stub.fire.stamp(s);
		});
	live(SESSION);
	expect(
		screen.getByText(
			`← → ↑ ↓ nudge · R rotate ¼ · ⏎ ${SESSION_VERBS.STAMP.primary} · Esc ${SESSION_VERBS.STAMP.secondary}`,
		),
	).toBeTruthy();

	// RECONFIGURE and MOVE, so the assertion above cannot pass by the table having one row
	// that happens to match: all three rows are distinct and all three are read HERE.
	live({ ...SESSION, mode: "reconfigure", entityId: 3 });
	expect(
		screen.getByText(
			`← → ↑ ↓ nudge · R rotate ¼ · ⏎ ${SESSION_VERBS.RECONFIGURE.primary} · Esc ${SESSION_VERBS.RECONFIGURE.secondary}`,
		),
	).toBeTruthy();

	// The STEERING half stays a `moving` branch, and correctly: a move is dragged and
	// everything else is nudged. That is a fact about `moving`, not about the state tag,
	// which is why only the VERBS came out of the branch.
	live({ ...SESSION, mode: "reconfigure", entityId: 3, moving: true });
	expect(
		screen.getByText(
			`drag ghost move · R rotate ¼ · ⏎ ${SESSION_VERBS.MOVE.primary} · Esc ${SESSION_VERBS.MOVE.secondary}`,
		),
	).toBeTruthy();
});

test("the keymap asks for a region while a stamp is armed, and names the generator", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN_MIN] });
	await renderShell(stub);

	act(() => {
		stub.fire.pendingStamp({ id: "hall", name: "Hall" });
	});
	// The pending arm SHADOWS the gesture: the mirror still says `pointer` underneath
	// (nothing armed anything else), so a line derived from `gesture` alone would go on
	// saying "LMB select · G grab" while LMB was drawing a region.
	// "click ×2", not "drag": the mechanism IS the box gesture's two presses (there is
	// no region branch in `onPointerUp`), and the box line uses the same verb.
	expect(
		screen.getByText("click ×2 to span a region for Hall · Esc cancels"),
	).toBeTruthy();

	act(() => {
		stub.fire.pendingStamp(null);
	});
	expect(
		screen.getByText("LMB select · G grab · F frame · ⌫ delete"),
	).toBeTruthy();
});

test("the keymap names only keys that are LIVE — under paint, ⌃ and X are not", () => {
	// A TRUTH assertion, not a wording one. The line is derived from the effect, and the
	// three facts it has to respect all live elsewhere: ⌃ passes through on paint and
	// smooth (`deriveMomentary`), `tool.swapEffect.enabled` is false off dig/fill, and ⇧
	// derives smooth from whatever is armed — so under smooth it is a no-op.
	//
	// Asserted against the pure function rather than the DOM: pinning the rendered string
	// pins WORDING DRIFT and never truth, which is exactly how the static line got away
	// with naming three dead keys.
	const brush = (effect: FieldTool["effect"]): string =>
		armedKeymap({ ...DIG_TOOL, effect }, null, null, null);

	expect(brush("dig")).toBe(
		"LMB dig · [ ] radius · ⇧ smooth · ⌃ fill · X swap",
	);
	expect(brush("fill")).toBe(
		"LMB fill · [ ] radius · ⇧ smooth · ⌃ dig · X swap",
	);
	for (const effect of ["paint", "smooth"] as const) {
		const line = brush(effect);
		expect({
			effect,
			ctrl: line.includes("⌃"),
			swap: line.includes("X"),
		}).toEqual({
			effect,
			ctrl: false,
			swap: false,
		});
	}
	// …and ⇧ goes with it under smooth, where deriving smooth changes nothing.
	expect(brush("smooth")).toBe("LMB smooth · [ ] radius");
	expect(brush("paint")).toBe("LMB paint · [ ] radius · ⇧ smooth");
});

test("the burger's Edit group names the stamp its verbs would act on, in table order", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	selectHall(stub);
	openBurger();
	// The chord acts on "whatever is selected" without saying so; the menu is where
	// that noun becomes visible.
	expect(await waitFor(() => screen.getByText("Delete hall #4"))).toBeTruthy();

	// ORDER is a real claim and nothing else pins it: the group renders in array
	// position, so reordering the table silently reorders the menu. Undo/Redo lead
	// because they are the most-reached; History closes the group as the way into the
	// palette that lists them.
	const group = screen.getByText("Edit").closest("[role='group']");
	if (!(group instanceof HTMLElement)) throw new Error("no Edit group");
	const labels = [...group.querySelectorAll("[role='menuitem']")].map(
		// The item renders `{label}{chord}`, so the label is the FIRST child node and the
		// chord is a trailing <span>. Read the node rather than stripping keycaps out of
		// `textContent` with a regex — that would have to know every keycap in the table,
		// which is exactly the coupling the registry exists to remove.
		(el) => el.firstChild?.textContent,
	);
	expect(labels).toEqual([
		"Undo",
		"Redo",
		"Duplicate hall #4",
		"Delete hall #4",
		"Move hall #4",
		// F4.5b Task 13: the Field panel's selection footer dissolved, and its two verbs
		// landed in the registry so the status chip's popover and this menu render the
		// same pair from one table. Clear names its object the way the stamp verbs above
		// it do; with nothing selected it reads "Clear selection" and is disabled.
		"Clear selection",
		"Reselect",
		// Live since F4.5b Task 12 — it summons the palette rather than explaining its
		// own absence in the label (see the History cases above).
		"History…",
	]);
});

// --- (c9b) the selection chip (F4.5b Task 13) --------------------------------
//
// The Field panel's selection footer dissolved with the panel. Its count, its
// truncation warning and its Clear / Reselect verbs are a status-bar chip now — the
// coverage below is ported from `field-panel.test.tsx`'s footer case and extended
// with the two things the footer could not say: the display cap, and the fact that
// both verbs come from the ONE action table the Edit menu renders.

/** A `SelectionInfo` with `overrides` applied — a region selection by default, which
 *  is the kind that never carries a `displayed`. */
const selectionOf = (
	overrides: Partial<SelectionInfo> = {},
): SelectionInfo => ({
	spec: { kind: "region", min: [0, 0, 0], max: [1, 1, 1] },
	count: 12,
	truncated: false,
	aabb: { min: [0, 0, 0], max: [1, 1, 1] },
	...overrides,
});

const selectionChip = (name: string | RegExp): HTMLElement =>
	screen.getByLabelText(name);

test("the selection chip appears with a selection, counts it, and goes with it", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// ABSENT with nothing selected. The chip is a readout, and "sel 0 cells" on every
	// boot is a permanent affordance for a state with nothing to say — Reselect stays
	// reachable from the Edit menu, which is where a verb with no object belongs.
	expect(screen.queryByText(/^sel /) === null).toBe(true);

	act(() => {
		stub.fire.selection(selectionOf({ count: 12 }));
	});
	expect(screen.getByText("sel 12 cells")).toBeTruthy();
	expect(selectionChip("12 cells selected — clear or reselect")).toBeTruthy();

	act(() => {
		stub.fire.selection(selectionOf({ count: 1 }));
	});
	expect(screen.getByText("sel 1 cell")).toBeTruthy();

	act(() => {
		stub.fire.selection(null);
	});
	expect(screen.queryByText(/^sel /) === null).toBe(true);
});

test("the chip's popover runs Clear and Reselect through the action table", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		stub.fire.selection(selectionOf({ count: 12 }));
	});

	act(() => {
		fireEvent.click(selectionChip("12 cells selected — clear or reselect"));
	});
	// The labels are the REGISTRY's — the Edit menu renders the same two from the same
	// table, so the popover cannot offer a verb the menu does not.
	fireEvent.click(
		screen.getByRole("button", { name: "Clear 12 selected cells" }),
	);
	expect(stub.calls.clearSelection.mock.calls.length).toBe(1);
	fireEvent.click(screen.getByRole("button", { name: "Reselect" }));
	expect(stub.calls.reselect.mock.calls.length).toBe(1);
});

test("the chip says which of TWO limits it is under, and they are different limits", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// A flood the budget stopped: what is SELECTED is partial.
	act(() => {
		stub.fire.selection(
			selectionOf({
				spec: { kind: "flood-void", seed: [0, 0, 0], budget: 200000 },
				count: 200000,
				truncated: true,
			}),
		);
	});
	act(() => {
		fireEvent.click(selectionChip(/^200000 cells selected/));
	});
	expect(screen.getByText(/flood truncated at 200,000 cells/)).toBeTruthy();
	// …and nothing about the DISPLAY, because this fixture's is complete. The two are
	// independent: a truncated selection can be drawn in full, and a complete one can
	// be drawn in part.
	expect(screen.queryByText(/showing /) === null).toBe(true);

	// The other limit, alone: every selected cell is real, but the viewport is only
	// drawing 65 536 of them.
	act(() => {
		stub.fire.selection(
			selectionOf({
				spec: { kind: "flood-void", seed: [0, 0, 0], budget: 200000 },
				count: 196392,
				truncated: false,
				displayed: 65536,
			}),
		);
	});
	expect(screen.getByText(/showing 65,536 of 196,392 cells/)).toBeTruthy();
	expect(screen.queryByText(/flood truncated/) === null).toBe(true);
});

// --- (c9c) the stats chips: ops + analyzer detail popovers (D-19) ------------
//
// F4.5a moved five op-cost fields into the stats push and then rendered NONE of them —
// the footer meter they belonged to was deleted with the panel. D-19's answer is a
// popover per chip, which is how a 28 px bar carries detail without growing.
//
// Every number in the fixture below is DISTINCT on purpose: with two rows sharing a
// value, an assertion that FINDS the value proves nothing about which field produced
// it — and a row wired to the wrong `stats` member would stay green.

/** A status chip, scoped to the BAR. Unscoped is ambiguous the moment the chip's own
 *  popover is open: the portalled content carries the same accessible name as its
 *  trigger (so the `role="dialog"` is identifiable as that chip's), which puts two
 *  matches in the document at once. */
const statusChip = (name: string | RegExp): HTMLElement =>
	within(screen.getByRole("contentinfo")).getByLabelText(name);

/** A detail row's value, found by its LABEL — the PAIRING is the claim. Reading a bare
 *  number off the popover would pass on any row that happened to carry it. */
const rowValue = (label: string): string => {
	const dt = screen.getByText(label);
	const dd = dt.nextElementSibling;
	if (!(dd instanceof HTMLElement)) throw new Error(`no value for "${label}"`);
	return dd.textContent ?? "";
};

/** The digit grouping the popover applies, computed the way the UI computes it. Pinning
 *  the literal "1,284" would redden this file under any locale whose separator differs,
 *  for reasons that have nothing to do with the code under test — and the UI's own
 *  `toLocaleString` is deliberately locale-aware. */
const grouped = (n: number): string => n.toLocaleString();

/** The op-cost meter's readings: six fields, no two alike.
 *
 *  The two ms fields are FRACTIONAL, and that is the point. Both are `performance.now()`
 *  deltas in the real host, so integers here are a fixture coincidence that an assertion
 *  would enshrine: with `lastRemeshMs: 12` the row reads "12 ms" whether or not anything
 *  rounds, and the three fraction digits `toLocaleString` grants by default ship unseen. */
const METER = makeStats({
	totalOps: 1284,
	chunks: 41,
	// A duration only means anything once a remesh has LANDED, and `remeshVersion` is
	// what says one has — a fixture carrying 12 ms at version 0 describes a state the
	// host cannot produce.
	remeshVersion: 9,
	lastRemeshMs: 12.3456,
	lastReconfigureMs: 236.78,
	liveGenerators: 7,
	compactableOps: 93,
	undoDepth: 5,
});

test("the ops chip opens a meter for the six fields behind the count", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		stub.fire.stats(METER);
	});
	// A CLOSED chip costs nothing: Radix mounts portalled content only while the
	// popover is open, which is the property the body-as-element shape preserves.
	// `=== null` rather than `toBeNull()`: this assertion's failure mode is a LIVE
	// element, and serialising one through happy-dom + React's fiber graph takes ~200 s
	// to report what the identity form reports in milliseconds (measured).
	expect(screen.queryByText("live generators") === null).toBe(true);

	act(() => {
		fireEvent.click(statusChip("1284 ops — the op-cost meter"));
	});
	expect(rowValue("ops in the log")).toBe(grouped(1284));
	expect(rowValue("chunks allocated")).toBe("41");
	// ROUNDED to the millisecond, from a fractional fixture: a "how heavy has this got?"
	// readout carries no microsecond noise, and 12.3456 → "12" / 236.78 → "237" is a
	// claim about the code rather than about the numbers it was handed.
	expect(rowValue("last remesh")).toBe("12 ms");
	expect(rowValue("last reconfigure")).toBe("237 ms");
	expect(rowValue("live generators")).toBe("7");
	expect(rowValue("compactable ops")).toBe("93");
	// The one number that MISLEADS without its claim: a non-zero compactable count is
	// the meter climbing toward the next load's threshold, not work waiting.
	expect(screen.getByText(/the NEXT load could fold/)).toBeTruthy();
});

test("the two 'has not happened yet' rows read their OWN sentinel, not a shared zero", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// A fresh boot: nothing has remeshed and nothing has reconfigured.
	act(() => {
		stub.fire.stats(
			makeStats({
				totalOps: 3,
				remeshVersion: 0,
				lastRemeshMs: 0,
				lastReconfigureMs: 0,
			}),
		);
	});
	act(() => {
		fireEvent.click(statusChip("3 ops — the op-cost meter"));
	});
	expect(rowValue("last remesh")).toBe("none yet");
	// FieldStats declares 0 = "none has run this session". "0 ms" would read as a
	// reconfigure that cost nothing, which is the opposite claim.
	expect(rowValue("last reconfigure")).toBe("none this session");

	// And here is why the remesh row cannot borrow the reconfigure's zero test: a remesh
	// that LANDED and took under half a millisecond rounds to 0, which is a different
	// fact from no remesh at all. `remeshVersion` separates them; the duration cannot.
	act(() => {
		stub.fire.stats(
			makeStats({
				totalOps: 3,
				remeshVersion: 4,
				lastRemeshMs: 0.21,
				lastReconfigureMs: 0,
			}),
		);
	});
	expect(rowValue("last remesh")).toBe("0 ms");
});

test("the analyzer chip names the passes it is owed, and is absent when owed none", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// Absent at 0 — and that absence is WHY the popover only ever describes the
	// catching-up state. An idle advisor has nothing to report.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 6, analyzerPending: 0 }));
	});
	expect(screen.queryByText(/analyzer/) === null).toBe(true);

	act(() => {
		stub.fire.stats(makeStats({ totalOps: 6, analyzerPending: 2 }));
	});
	// Closed: nothing of the body in the DOM (identity form — see the ops case).
	expect(screen.queryByText("passes owed") === null).toBe(true);
	act(() => {
		fireEvent.click(statusChip("analyzer catching up — 2 passes owed"));
	});
	expect(rowValue("passes owed")).toBe("2");
	expect(screen.getByText(/catching up with your edits/)).toBeTruthy();
});

test("the analyzer chip outlives its own zero while its popover is open", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 6, analyzerPending: 1 }));
	});
	act(() => {
		fireEvent.click(statusChip("analyzer catching up — 1 pass owed"));
	});
	expect(rowValue("passes owed")).toBe("1");

	// The last pass lands WHILE the user is reading. Unmounting the trigger here takes
	// the whole layer with it mid-sentence and drops focus to the body — and the
	// sentence it interrupts is the one promising this very thing would happen.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 6, analyzerPending: 0 }));
	});
	expect(screen.getByText(/the advisor has caught up/)).toBeTruthy();
	// …and it stops claiming to be behind while it stands there: a popover reading
	// "catching up · 0 owed" contradicts itself in front of the person reading it.
	expect(screen.queryByText(/catching up with your edits/) === null).toBe(true);

	// CLOSING is what retires it — the chip goes on the next render, not before.
	act(() => {
		fireEvent.click(statusChip("analyzer caught up"));
	});
	expect(screen.queryByText(/analyzer/) === null).toBe(true);
});

test("both stats popovers are portal LAYERS — the bar and the canvas cell keep their boxes", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		stub.fire.stats(makeStats({ ...METER, analyzerPending: 1 }));
	});
	const bar = screen.getByRole("contentinfo");
	const cell = screen.getByLabelText("field viewport").parentElement;
	if (!(cell instanceof HTMLElement)) throw new Error("canvas has no cell");

	act(() => {
		fireEvent.click(statusChip("1284 ops — the op-cost meter"));
	});
	// OUT of both boxes. The bar is fixed-height and the canvas cell takes exactly what
	// the two bars leave, so a popover rendered INSIDE either would grow the chrome and
	// take pixels off the viewport it is reporting on.
	const opsBody = screen.getByText("ops in the log");
	expect(bar.contains(opsBody)).toBe(false);
	expect(cell.contains(opsBody)).toBe(false);

	act(() => {
		fireEvent.click(statusChip("analyzer catching up — 1 pass owed"));
	});
	const analyzerBody = screen.getByText("passes owed");
	expect(bar.contains(analyzerBody)).toBe(false);
	expect(cell.contains(analyzerBody)).toBe(false);
});

// --- (m2) the long-job chips (D-19) ------------------------------------------
//
// D-F4.5-19 asks for "progress + cooperative cancel (the job polls; no cancel theater)".
// NEITHER of the editor's two long jobs can poll, so what ships is the second clause:
// an indeterminate readout and NO ✕. The mechanical reasons are recorded at the three
// sites that would have to change (`StatusBar`'s `JobChips`, `useWorld`'s `write`,
// `field-host`'s `requestVoidCast`); what these cases pin is the CONTRACT — the chip
// appears while the job stands, goes when it lands, and offers nothing to click.

/** The VISIBLE long-job readout, scoped to the bar. By TEXT rather than by label: these
 *  are the one kind of chip that is not a control, so unlike the ops/analyzer/undo chips
 *  they carry no `aria-label` — a name on a roleless span is a name most screen readers
 *  drop on the floor, and the bar's persistent live region is what announces instead.
 *
 *  Which is exactly why the live region has to be filtered out here: it carries the SAME
 *  string by design, so an unfiltered query finds two nodes and throws. TWO nodes for one
 *  fact is the error line's shape as well — see the case below that asserts the region
 *  directly. */
const jobChip = (text: string): HTMLElement | null =>
	within(screen.getByRole("contentinfo"))
		.queryAllByText(text)
		.find((el) => el.closest("[aria-live]") === null) ?? null;

test("a void cast in flight puts an uncancellable chip on the bar", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// Idle: nothing. A chip that is always there for a state with nothing to say is a
	// chip people stop seeing (the analyzer chip's rule, same bar).
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 6, voidCastPending: false }));
	});
	expect(jobChip("void cast…") === null).toBe(true);

	act(() => {
		stub.fire.stats(makeStats({ totalOps: 6, voidCastPending: true }));
	});
	const chip = jobChip("void cast…");
	if (chip === null)
		throw new Error("no void-cast chip while one was in flight");
	// NO cancel affordance, and no click target at all: `discardVoidCast` bumps a
	// generation and DROPS the answer — the worker goes on computing either way — so a ✕
	// here would be the cancel theater D-F4.5-19 names.
	expect(within(chip).queryByRole("button") === null).toBe(true);
	expect(chip.closest("button") === null).toBe(true);

	// …and it goes when the cast lands, rather than needing a click to dismiss.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 6, voidCastPending: false }));
	});
	expect(jobChip("void cast…") === null).toBe(true);
});

test("the bar announces a long job through a PERSISTENT live region", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	// The region exists before there is anything to say — the error line's rule, for the
	// error line's reason: a live region added to the DOM already holding its text is one
	// VoiceOver/Safari can miss entirely.
	const region = screen
		.getByRole("contentinfo")
		.querySelector('[aria-live="polite"][data-long-job]');
	if (!(region instanceof HTMLElement))
		throw new Error("the bar has no long-job live region");
	expect(region.textContent).toBe("");

	act(() => {
		stub.fire.stats(makeStats({ voidCastPending: true }));
	});
	expect(region.textContent).toBe("void cast…");
});

/** Serve the world commands with every `generation.bake` after the FIRST held open, so a
 *  case can name a world (that first save settles) and then sit inside the second write
 *  for as long as it needs to. The drawer's catalog GETs 404 as usual. */
function stubHeldWorldDaemon(): { release: () => void } {
	const held: ((r: Response) => void)[] = [];
	let bakes = 0;
	const ok = () => new Response(JSON.stringify({ files: 7 }), { status: 200 });
	globalThis.fetch = ((input: unknown, init?: RequestInit) => {
		void init;
		const url = String(input);
		if (!url.startsWith("/api/"))
			return Promise.resolve(new Response("", { status: 404 }));
		const command = url.slice("/api/".length);
		if (command === "world.list")
			return Promise.resolve(
				new Response(JSON.stringify({ defaultName: null, worlds: [] }), {
					status: 200,
				}),
			);
		if (command !== "generation.bake")
			return Promise.resolve(new Response("{}", { status: 200 }));
		bakes += 1;
		if (bakes === 1) return Promise.resolve(ok());
		return new Promise<Response>((res) => held.push(res));
	}) as unknown as typeof fetch;
	return {
		release: () => {
			for (const settle of held.splice(0)) settle(ok());
		},
	};
}

/** Let a world verb walk its await chain: `world.list`, then the upload. */
const settleWorldVerb = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});

/** Settle every held upload and let the verb move on. Called TWICE for a bake, which
 *  posts two: the world's files, then `worlds/index.json` — and the second is issued only
 *  once the first has landed, so one release leaves the verb mid-flight. */
const releaseUpload = (daemon: { release: () => void }) =>
	act(async () => {
		daemon.release();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});

test("a world write in flight names the VERB on the bar, and offers no way out", async () => {
	const daemon = stubHeldWorldDaemon();
	const stub = makeStubHost();
	await renderShell(stub);

	// Name it the way a user does — and that first save SETTLES, which is what leaves a
	// named world for the two hung writes below to run against.
	act(() => {
		fireEvent.keyDown(window, { key: "s", metaKey: true });
	});
	const field = await waitFor(() =>
		screen.getByLabelText("save as world name"),
	);
	act(() => {
		fireEvent.change(field, { target: { value: "cavern" } });
	});
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	});
	await waitFor(() => screen.getByRole("button", { name: "cavern" }));
	// Settled: the bar says nothing. The chip is a readout of a job, not of a world.
	expect(jobChip("saving…") === null).toBe(true);

	// ⌘S on the named world — the write the editor performs all day. It hangs at the
	// upload, which is where the chip has to be.
	act(() => {
		fireEvent.keyDown(window, { key: "s", metaKey: true });
	});
	await settleWorldVerb();
	const chip = jobChip("saving…");
	if (chip === null) throw new Error("no chip while a write was in flight");
	// Nothing to click: a mid-flight abort has the same semantics as a failure (the
	// daemon cleanDir's the world directory before rewriting it), and `saveWorld` already
	// refuses to characterise that state.
	expect(chip.closest("button") === null).toBe(true);
	expect(within(chip).queryByRole("button") === null).toBe(true);

	await releaseUpload(daemon);
	expect(jobChip("saving…") === null).toBe(true);

	// A BAKE is the same code path with `makeDefault`, and it says so: one label per
	// verb, so the word on the bar is not a coincidence of the save case above. It is
	// also the verb that changes what the GAME loads, which is worth its own word.
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: "Bake" }));
	});
	await settleWorldVerb();
	expect(jobChip("baking…")).toBeTruthy();
	expect(jobChip("saving…") === null).toBe(true);
	// Still baking after the FIRST upload lands — `worlds/index.json` is a second call the
	// verb has not made yet, and a readout that cleared here would go quiet mid-job.
	await releaseUpload(daemon);
	expect(jobChip("baking…")).toBeTruthy();
	await releaseUpload(daemon);
	expect(jobChip("baking…") === null).toBe(true);
});

test("a job chip arrives at the FRONT of the right cluster — nothing beside it moves", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	act(() => {
		stub.fire.stats(makeStats({ ...METER, voidCastPending: false }));
	});
	const bar = screen.getByRole("contentinfo");
	// The chips right of the spacer are RIGHT-anchored, so an arrival only displaces what
	// is to its LEFT. A chip that comes and goes therefore has to be first in that group
	// or it shoves `ops` — a click target — sideways under a cursor on its way to it.
	const chips = () =>
		[...bar.querySelectorAll("button")].map((b) =>
			b.getAttribute("aria-label"),
		);
	const before = chips();
	act(() => {
		stub.fire.stats(makeStats({ ...METER, voidCastPending: true }));
	});
	// The interactive chips are unchanged in identity AND in order: the readout is not
	// one of them and did not push into the middle of them.
	expect(chips()).toEqual(before);
	const chip = jobChip("void cast…");
	if (chip === null)
		throw new Error("no void-cast chip while one was in flight");
	const opsChip = statusChip(/op-cost meter/);
	// Boundary cast: `compareDocumentPosition` returns a bitmask, and FOLLOWING is the
	// bit that answers "is `ops` after the readout in document order?".
	expect(
		(chip.compareDocumentPosition(opsChip) &
			Node.DOCUMENT_POSITION_FOLLOWING) !==
			0,
	).toBe(true);
});

// --- (c10) the gate's target predicate: which controls swallow a bare key -----
//
// `isTextInputTarget` decides this, and it has to be right in BOTH directions. Too wide
// and a binding dies behind a control the user is merely FOCUSED on — the F2b
// "touch a panel and the keys stop working" class, relocated from the canvas to a
// slider. Too narrow and a key the user pressed for the CONTROL runs an editor verb —
// which for Esc means losing the session they were configuring.

/** Arm the brush so `BrushInspector` renders: it carries both shapes this predicate has
 *  to separate — a native `<select>` (mask) and an `<input type="range">` (radius). */
function armBrushInspector(): void {
	act(() => {
		fireEvent.keyDown(window, { key: "b" });
	});
}

test("Esc pressed on a native <select> dismisses the DROPDOWN — it does not run the ladder", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN_MIN] });
	await renderShell(stub);
	armBrushInspector();
	const select = screen.getByLabelText("brush mask");

	// Esc is the conventional way to dismiss a native select popup, so this is the
	// expected keystroke rather than an exotic one — and the ladder's rung 2 would
	// cancel a live session with it.
	act(() => {
		stub.fire.stamp({
			generator: "hall",
			params: {},
			seed: 1,
			policy: "replace",
			region: { min: [0, 0, 0], max: [4, 4, 4] },
			phase: "ready",
			run: 1,
			opCount: 3,
			placementCount: null,
			error: null,
			truncatedSelection: false,
			mode: "stamp",
			entityId: null,
		});
	});
	act(() => {
		fireEvent.keyDown(select, { key: "Escape" });
	});
	expect(stub.calls.escape).not.toHaveBeenCalled();

	// ⏎ is the select's own commit key, and would otherwise APPLY that session.
	act(() => {
		fireEvent.keyDown(select, { key: "Enter" });
	});
	expect(stub.calls.commitSession).not.toHaveBeenCalled();
});

test("a bare key on a RANGE slider still binds — a slider is not typed text", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	armBrushInspector();
	const slider = screen.getByLabelText("brush radius");
	stub.calls.setGesture.mockClear();

	// The brush-radius slider is the control a user drags WHILE LOOKING AT THE FIELD, so
	// a binding that dies while it holds focus is the worst case of the class, not the
	// mildest. `V` must still arm the pointer.
	act(() => {
		fireEvent.keyDown(slider, { key: "v" });
	});
	expect(stub.calls.setGesture.mock.calls).toEqual([["pointer"]]);
});
