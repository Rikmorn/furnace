// The overlay shell's skeleton: one full-window canvas between two fixed-height bars,
// with every other surface floating OVER the canvas as an absolute layer.
//
// happy-dom runs no layout (every getBoundingClientRect is zero by default), so the
// pixel outcome is never assertable here. What IS assertable is the structure that
// produces it — which is exactly what the layout contract is: the canvas fills its cell
// (`absolute inset-0`), the control panel is a LAYER inside that same cell rather than
// a flex sibling that would take width off it, and the two bars are shrink-0 siblings
// OUTSIDE the cell. Sabotage-proven: making the panel a flex sibling, or dropping the
// canvas's aria-label, each fails a case below.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Shell } from "../../src/frontend/components/shell/Shell.tsx";
import {
	FieldHostStateProvider,
	useFieldHostState,
} from "../../src/frontend/hooks/useFieldHostState.tsx";
import {
	act,
	cleanup,
	makeEditorContext,
	render,
	renderWithEditor,
	screen,
} from "../inspector/_harness.tsx";
import { makeStats, makeStubHost } from "./_stub-host.ts";

afterEach(cleanup);

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

async function renderShell(stub: ReturnType<typeof makeStubHost>) {
	const result = renderWithEditor(
		<Shell />,
		makeEditorContext({ fieldHostRef: { current: stub.host } }),
	);
	await act(async () => {
		// Two microtask turns: the catalog path awaits fetch() then res.text().
		await Promise.resolve();
		await Promise.resolve();
	});
	return result;
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
	expect(visible?.className).toContain("text-destructive");
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

test("the top bar carries the menu and the bake verb, inert but visible", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	expect(screen.getByLabelText("editor menu")).toBeTruthy();
	// Inert items are DISABLED rather than silently dead — a live-looking button that
	// swallows clicks is the worse failure.
	const bake = screen.getByRole("button", {
		name: "Bake",
	}) as HTMLButtonElement;
	expect(bake.disabled).toBe(true);
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
	// (its text CHANGING is what announces — see StatusBar).
	const live = document.querySelector("div[aria-live='polite']");
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
	expect(visible?.className).toContain("text-destructive");
	expect(live?.className).toContain("sr-only");
	// …and no canvas was mounted, so nothing tried to init a host that may not exist.
	expect(document.querySelectorAll("canvas").length).toBe(0);
	expect(stub.calls.init).not.toHaveBeenCalled();
});

// --- (d) the layout contract + the retired dock ------------------------------

test("the control panel is a LAYER over the canvas, not a sibling that takes width", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderShell(stub);
	const canvas = screen.getByLabelText("field viewport");
	const cell = canvas.parentElement;
	const panel = screen.getByRole("complementary", { name: "field controls" });

	// Same positioned cell as the canvas, absolutely placed inside it. As a flex
	// sibling it would subtract 300px from the canvas — and then every palette that
	// opens would move the viewport, which is the failure this contract exists for.
	expect(panel.parentElement).toBe(cell);
	for (const cls of ["absolute", "inset-y-0", "right-0"])
		expect(panel.classList.contains(cls)).toBe(true);
	expect(panel.contains(canvas)).toBe(false);
	// The panel's own controls really are in there (this is the field panel, not an
	// empty box that happens to be positioned right).
	expect(panel.contains(screen.getByLabelText("world name"))).toBe(true);
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
