// Registered FIRST — the shell.test.tsx rule (Radix resolves `globalThis.document` at
// module-evaluation time; the ⋯ popover never mounts if the DOM was not there yet).
import "../inspector/_register.ts";

// The top strip (F4.5b Task 8, D-6/D-7): the armed tool's name and its primary params,
// in the fixed 40 px top bar — and the SESSION strip that replaces it while a session is
// live (mock frame 2).
//
// Four claims:
//   1. the params are PER EFFECT, and the dead controls are gone — dig and smooth ignore
//      `materialId` (field-host.ts's FieldTool doc says so in as many words), so the
//      swatches render under paint and fill and nowhere else;
//   2. the strip never wraps and never changes height: ONE flex row, `overflow-hidden`,
//      and the params degrade as a UNIT behind a container query, leaving `name + ⋯`;
//   3. the ⋯ holds everything the strip shows PLUS the rest — by construction, from one
//      per-effect list, so the two cannot drift;
//   4. a live session swaps the whole strip for the session strip AND takes Bake off the
//      bar, because a bake mid-session would write a world the ghost has not joined yet.
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { Shell } from "../../src/frontend/components/shell/Shell.tsx";
import { SESSION_VERBS } from "../../src/frontend/lib/field-session.ts";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import type {
	FieldEntityInfo,
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

// --- environment -------------------------------------------------------------

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

/** A two-class catalog (rock organic + masonry kit), the shape parseMaterialsCatalog
 *  accepts — the swatch strip needs `classes.length > 1` to render at all. */
const CATALOG_JSON = JSON.stringify({
	version: 1,
	classes: [
		{ id: 0, name: "rock", kind: "organic", color: [0.6, 0.6, 0.6, 1] },
		{
			id: 1,
			name: "masonry",
			kind: "kit",
			color: [0.5, 0.5, 0.5, 1],
			kit: {
				panelProud: 0.06,
				panelReveal: 0.02,
				collarSection: 0.14,
				backingColor: [0.4, 0.4, 0.4, 1],
				pieceColors: {
					panel: [0.55, 0.53, 0.5, 1],
					floor: [0.42, 0.4, 0.38, 1],
					trim: [0.35, 0.33, 0.3, 1],
					collar: [0.3, 0.28, 0.26, 1],
				},
			},
		},
	],
});

/** Serve the materials catalog and 404 the other two — the strip's material control is
 *  the only catalog-dependent thing here. */
function stubCatalog(): void {
	// Boundary cast: the stub serves only the catalog GETs, so it implements the call
	// signature and none of `fetch`'s statics.
	globalThis.fetch = ((input: unknown) => {
		const url = String(input);
		const catalog = url.includes("materials.json");
		return Promise.resolve(
			catalog
				? new Response(CATALOG_JSON, { status: 200 })
				: new Response("", { status: 404 }),
		);
	}) as unknown as typeof fetch;
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

const MAZE_ENTITY: FieldEntityInfo = {
	entityId: 3,
	type: "generator",
	generator: "maze",
	params: {},
	seed: 1,
	region: { min: [0, 0, 0], max: [4, 4, 4] },
	opSpan: [0, 0],
	// `frozen`/`baked` are `?: true` in core, so ABSENT is the only way to spell "not
	// frozen" — `false` does not type-check.
	placed: [],
};

/** The strip's own box — a labelled toolbar in the top bar, resolved by role so the
 *  claim is about a region a screen reader reaches, not about a div. */
const strip = (): HTMLElement =>
	screen.getByRole("group", { name: "tool options" });

const sessionStrip = (): HTMLElement =>
	screen.getByRole("region", { name: "live session" });

/** Every param the strip can carry, keyed by the accessible name its control already
 *  has. No test-only DOM hook: what makes a param "present" is the same thing that
 *  makes it reachable — its label. The iteration order here is the canonical one the
 *  assertions read, NOT the display order (which is the component's business). */
const PARAM_LABEL = {
	radius: "brush radius",
	mask: "brush mask",
	material: "brush material",
	hollow: "hollow fill",
	strength: "smooth strength",
	iterations: "smooth iterations",
	mode: "smooth mode",
} as const;

const paramsIn = (box: HTMLElement): string[] =>
	Object.entries(PARAM_LABEL)
		.filter(([, label]) => within(box).queryAllByLabelText(label).length > 0)
		.map(([id]) => id);

const stripParams = (): string[] => paramsIn(strip());

/** Arm a brush effect through the KEYBOARD family — the same funnel the rail button
 *  dispatches, so these cases never depend on the rail's markup. Steps with ⇧B until
 *  the strip names the target rather than counting from a presumed start state: the
 *  family is a ring, and a count is only right from one place on it. */
function armEffect(effect: "dig" | "fill" | "paint" | "smooth"): void {
	act(() => {
		fireEvent.keyDown(window, { key: "b" });
	});
	const want = effect.toUpperCase();
	for (let i = 0; i < 5; i++) {
		if (within(strip()).queryAllByText(want).length > 0) return;
		act(() => {
			fireEvent.keyDown(window, { key: "B", shiftKey: true });
		});
	}
	throw new Error(`the brush family never reached ${want}`);
}

// --- (a) per-effect params, and the dead material control is GONE ------------

test("each brush effect shows its OWN params — and material only where the host reads it", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);

	// dig: radius + mask. NOT material — `FieldTool.materialId` is "ignored by dig and
	// smooth" (field-host.ts's own doc), so a swatch row here is a control that does
	// nothing, which is the finding this task exists to close.
	armEffect("dig");
	expect(stripParams()).toEqual(["radius", "mask"]);

	// fill: the full four — it writes a class, and the hollow shell band is fill-only.
	armEffect("fill");
	expect(stripParams()).toEqual(["radius", "mask", "material", "hollow"]);

	// paint: material yes, hollow no.
	armEffect("paint");
	expect(stripParams()).toEqual(["radius", "mask", "material"]);

	// smooth: its own knobs, and material is gone again.
	armEffect("smooth");
	expect(stripParams()).toEqual(["radius", "strength", "mode"]);

	// D-6's cap, quantified over every effect rather than spot-checked: four is the
	// number the strip's width budget was computed from.
	for (const effect of ["dig", "fill", "paint", "smooth"] as const) {
		armEffect(effect);
		expect([effect, stripParams().length <= 4]).toEqual([effect, true]);
	}
});

test("the segment gesture rides the brush family — the armed effect's own params", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	// Arm FILL, then reach segment through the rail's member flyout — the one route that
	// arms a gesture member without walking the ring past three effects on the way (⇧B
	// from dig would leave the effect on smooth, which is a true state but not the one
	// this case is about).
	armEffect("fill");
	fireEvent.click(screen.getByRole("button", { name: "Brush tools" }));
	const menu = await screen.findByRole("group", { name: "Brush tools" });
	fireEvent.click(within(menu).getByRole("button", { name: /^Segment —/ }));

	// A segment commits a brush op with the armed effect and material (host
	// `segmentClick` → `commitToolOp` → the same `toolOp` a stroke uses), so the params
	// are the EFFECT's, not a fixed segment set — a fill-segment really does honour
	// material and hollow, and hiding them would be the dead-control defect inverted.
	expect(stripParams()).toEqual(["radius", "mask", "material", "hollow"]);
	// The name says what LMB does; the suffix says what it commits with. Both, because
	// either alone is a half-truth about a gesture that is two things at once.
	expect(within(strip()).getByText("SEGMENT")).toBeTruthy();
	expect(within(strip()).getByText("fill")).toBeTruthy();
});

// --- relocated with their subjects from tests/chrome/field-panel.test.tsx ----
//
// The swatch strip and the armed tool's readout are this surface's now (F4.5b Task 8), so
// the two claims that rode them moved here rather than being dropped: the paint clamp and
// the subscribeTool echo guard.

test("picking Paint while a kit class is active clamps the material to the first organic class", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	// Fill is the effect that shows the swatches AND accepts a kit class.
	armEffect("fill");
	fireEvent.click(within(strip()).getByLabelText("material masonry"));
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		effect: "fill",
		materialId: 1,
	});

	// Kit masonry (id 1) is unpaintable — core rejects a sphere-shaped kit write — so the
	// brush pick clamps to rock (id 0). The rule lives in `brushArming`, which the rail's
	// flyout and the `B` family key both go through.
	fireEvent.click(screen.getByRole("button", { name: "Brush tools" }));
	const menu = await screen.findByRole("group", { name: "Brush tools" });
	fireEvent.click(within(menu).getByRole("button", { name: /^Paint —/ }));
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		effect: "paint",
		materialId: 0,
	});
});

test("a host-initiated tool push is adopted without re-pushing to host.setTool", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	// Arm the brush first: the strip opens on the POINTER (D-F4.5-7, the host's own
	// default), where it names no effect at all — so without this the assertion below
	// would be about the armed FAMILY, not about the echo guard this case is for. The
	// arming's own setTool is cleared so the "no echo" claim quantifies over everything
	// after the host's push.
	armEffect("dig");
	stub.calls.setTool.mockClear();
	act(() => {
		stub.fire.tool({
			effect: "fill",
			materialId: 0,
			mask: { kind: "none" },
			smooth: { strength: 16, iterations: 1, mode: "both" },
			hollow: null,
		});
	});
	// The strip MIRRORED the change (an Alt-click eyedrop or a momentary ⇧/⌃ is what
	// really pushes one)…
	expect(within(strip()).getByText("FILL")).toBeTruthy();
	// …without echoing it back: re-pushing would re-derive → re-fire → loop.
	expect(stub.calls.setTool).not.toHaveBeenCalled();
});

test("the dig↔fill re-aim survives under Segment — X swaps the sweep, it does not end it", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	armEffect("fill");
	fireEvent.click(screen.getByRole("button", { name: "Brush tools" }));
	const menu = await screen.findByRole("group", { name: "Brush tools" });
	fireEvent.click(within(menu).getByRole("button", { name: /^Segment —/ }));
	const before = stub.calls.setGesture.mock.calls.length;

	// `X` goes through `armBrush` alone, and `brushArming` deliberately keeps a live
	// segment: swapping fill→dig under it means "sweep a tunnel instead of a rampart",
	// not "stop segmenting". This is the half of that rule that survived Task 8's member
	// picks becoming exclusive.
	act(() => {
		fireEvent.keyDown(window, { key: "x" });
	});
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		effect: "dig",
	});
	expect(stub.calls.setGesture.mock.calls.length).toBe(before);
	expect(within(strip()).getByText("SEGMENT")).toBeTruthy();
	expect(within(strip()).getByText("dig")).toBeTruthy();
});

test("the hollow field is the shadcn Input, with its label and its unit (D-25)", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	armEffect("fill");
	fireEvent.click(within(strip()).getByLabelText("hollow fill"));

	const thickness = within(strip()).getByLabelText(
		"hollow thickness",
	) as HTMLInputElement;
	// The house focus vocabulary is ONE ring everywhere (D-23), and it arrives with the
	// `Input` primitive. The first cut hand-copied this control into a raw `<input>` and
	// dropped the ring with it — invisible in a screenshot, and exactly the thing nobody
	// re-checks.
	expect(thickness.className).toContain("focus-visible:ring-1");
	// Its visible LABEL and its UNIT, both of which the hand-copy also lost. The radius
	// param one place over prints its ` m`, and a bare number beside it reads as a
	// different kind of quantity.
	const row = thickness.closest("label");
	if (!(row instanceof HTMLElement))
		throw new Error("the thickness input is no longer inside its label");
	expect(row.textContent).toContain("thickness");
	expect(row.textContent).toContain("m");
});

test("clearing the hollow thickness never pushes 0 at the host (D-25 buffered parse)", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	armEffect("fill");
	fireEvent.click(within(strip()).getByLabelText("hollow fill"));
	const thickness = within(strip()).getByLabelText(
		"hollow thickness",
	) as HTMLInputElement;
	stub.calls.setTool.mockClear();

	// Select-all-and-retype is how anyone changes a number, and its first keystroke leaves
	// the field EMPTY. `Number("")` is 0 and 0 is finite, so the pre-fix guard let it
	// through: the host received `hollow: 0` per empty keystroke, and 0 is below the
	// HOLLOW_MIN_M floor the host then clamps to — so the strokes carved a 0.5 m band
	// while the field showed nothing.
	thickness.focus();
	fireEvent.change(thickness, { target: { value: "" } });
	expect(stub.calls.setTool).not.toHaveBeenCalled();
	// The buffer shows what was typed rather than snapping under the cursor…
	expect(thickness.value).toBe("");
	// …and a blur on an empty field reverts instead of committing.
	fireEvent.blur(thickness);
	expect(stub.calls.setTool).not.toHaveBeenCalled();
	expect(thickness.value).toBe("0.5");
});

test("a typed hollow thickness still reaches the host per keystroke", async () => {
	// The other half: a guard that swallowed everything would pass the case above and
	// break the control. `1.5` is two keystrokes past a decimal point, so this also pins
	// that a mid-typing "1." (which parses to 1) does not stop the entry.
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	armEffect("fill");
	fireEvent.click(within(strip()).getByLabelText("hollow fill"));
	const thickness = within(strip()).getByLabelText("hollow thickness");
	thickness.focus();
	fireEvent.change(thickness, { target: { value: "1.5" } });
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		hollow: 1.5,
	});
});

test("a kit swatch under Paint explains itself through the name AND a real tooltip", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	armEffect("paint");

	// The paint clamp is the highest-value explanation on this surface, and it was the one
	// that stayed a `title` — mouse-only, unstyleable, and unreliable on the very control
	// it describes. It rides the accessible NAME now…
	const masonry = within(strip()).getByLabelText(
		/^material masonry — kit classes can't be painted$/,
	) as HTMLButtonElement;
	expect(masonry.getAttribute("title")).toBeNull();
	// …and it is `aria-disabled`, not `disabled`, so the control stays focusable and its
	// tooltip can actually open. A `disabled` button takes no pointer events at all.
	expect(masonry.getAttribute("aria-disabled")).toBe("true");
	expect(masonry.disabled).toBe(false);

	act(() => {
		fireEvent.focus(masonry);
	});
	const tip = await screen.findByRole("tooltip");
	expect(within(tip).getByText(/kit classes can't be painted/)).toBeTruthy();

	// …and it still refuses the click. With `aria-disabled` the browser no longer does it.
	stub.calls.setTool.mockClear();
	fireEvent.click(masonry);
	expect(stub.calls.setTool).not.toHaveBeenCalled();
});

// --- (b) the two families that are not the brush -----------------------------

test("the cell-select family names the mode and what bounds it — and offers no brush knobs", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	act(() => {
		fireEvent.keyDown(window, { key: "m" });
	});
	expect(within(strip()).getByText("BOX")).toBeTruthy();
	// A box span is snapped, never budgeted — `truncated` is "always false for regions"
	// (field-host.ts), so a "budget 200k" note here would describe a limit that cannot
	// fire.
	expect(within(strip()).getByText(/snaps to 0\.5 m/)).toBeTruthy();
	expect(stripParams()).toEqual([]);

	// The two FLOOD modes are the ones the budget bounds, and it is the number the host
	// actually uses (SELECTION_UI_BUDGET = 200_000).
	act(() => {
		fireEvent.keyDown(window, { key: "M", shiftKey: true });
	});
	expect(within(strip()).getByText("WAND")).toBeTruthy();
	expect(within(strip()).getByText(/budget 200k/)).toBeTruthy();
});

test("under the pointer the strip reports WHAT IS SELECTED — the em dash is the empty answer", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	stub.setEntities([MAZE_ENTITY]);
	await renderShell(stub);
	// The host opens armed with `pointer` (D-F4.5-7), so this is the boot state.
	expect(within(strip()).getByText("SELECT")).toBeTruthy();
	// Nothing selected: a placeholder, not a control. It earns its place because every
	// pointer verb (G grab, F frame, ⌫ delete, ⌘J duplicate) acts on this and refuses
	// when it is empty — this line is where a user sees why.
	expect(within(strip()).getByText("—")).toBeTruthy();
	expect(stripParams()).toEqual([]);

	act(() => {
		stub.fire.entities();
	});
	act(() => {
		stub.fire.entitySelection(3);
	});
	// Named the way every other surface names an entity (the registry's `entityName`),
	// so the strip, the menu labels and the confirm dialog cannot drift apart.
	expect(within(strip()).getByText("maze #3")).toBeTruthy();
});

// --- (c) never wraps; degrades as a unit ------------------------------------

test("the strip is ONE row that clips rather than wraps, and its params degrade as a unit", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	armEffect("fill");

	const row = strip();
	// One flex row, no wrapping, clipped at the edge: the top bar's height is half the
	// canvas cell's inset budget (D-2), so a strip that wrapped would move the canvas.
	for (const cls of ["flex", "overflow-hidden"])
		expect(row.classList.contains(cls)).toBe(true);
	expect(row.classList.contains("flex-wrap")).toBe(false);
	// It is the container the query below resolves against (Tailwind's `@container`),
	// so the degradation follows the STRIP's width and not the window's.
	expect(row.classList.contains("@container/strip")).toBe(true);

	// The params hide as ONE unit below the branch's own min content width, leaving exactly
	// D-6's degraded state: name + ⋯. The threshold is the sum of the declared control
	// widths for THAT effect — see STRIP_PARAMS_MIN's comment in ToolStrip.tsx.
	const params = within(row).getByRole("group", { name: "tool params" });
	expect(params.classList.contains("@max-[46rem]/strip:hidden")).toBe(true);

	// …and the two survivors are never hidden, because they ARE the degraded state.
	expect(
		within(row).getByRole("button", { name: /^all fill options/ }),
	).toBeTruthy();
	expect(within(row).getByText("FILL")).toBeTruthy();
});

test("each branch degrades at its OWN width — dig does not blank at fill's threshold", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	const thresholdOf = (): number => {
		const group = within(strip()).getByRole("group", { name: "tool params" });
		const hit = Array.from(group.classList).find((c) => c.startsWith("@max-["));
		if (hit === undefined)
			throw new Error("the param group carries no container query");
		return Number(hit.replace(/^@max-\[(\d+)rem\].*$/, "$1"));
	};

	// One worst-case threshold applied to every branch blanked dig — two params — at the
	// width FILL needs, which is a strip degrading for a reason that is not about it.
	armEffect("dig");
	const dig = thresholdOf();
	armEffect("fill");
	const fill = thresholdOf();
	armEffect("paint");
	const paint = thresholdOf();
	armEffect("smooth");
	const smooth = thresholdOf();
	// Ordered by how much each set needs, which is the only property worth pinning: the
	// exact rem figures are computed estimates (see the constant's doc) and re-tuning one
	// must not fail this.
	expect(dig).toBeLessThan(paint);
	expect(paint).toBeLessThan(smooth);
	expect(smooth).toBeLessThan(fill);

	// The two NON-brush branches carry no query at all: their whole content is one short
	// span that cannot overflow a strip sized for a four-param fill set, so there is
	// nothing to degrade — and consequently nothing for a ⋯ to hold, which is why they
	// have none. D-6 satisfied rather than skipped.
	act(() => {
		fireEvent.keyDown(window, { key: "v" });
	});
	const pointerParams = within(strip()).getByRole("group", {
		name: "tool params",
	});
	expect(
		Array.from(pointerParams.classList).some((c) => c.startsWith("@max-[")),
	).toBe(false);
	expect(
		within(strip()).queryByRole("button", { name: /^all .* options/ }) === null,
	).toBe(true);
});

test("the strip's radius slider pushes through the SAME funnel the wheel and [ ] use", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	armEffect("dig");
	// `setTool` was pinned by several cases; `setDigRadius` was pinned by none, so "the
	// strip's controls push through the same funnels the panel used" was half-asserted.
	const slider = within(strip()).getByLabelText("brush radius");
	fireEvent.change(slider, { target: { value: "2.5" } });
	expect(stub.calls.setDigRadius.mock.calls.at(-1)).toEqual([2.5]);
	// …and the readout follows, with its unit (D-25: units always).
	expect(within(strip()).getByText("2.50 m")).toBeTruthy();
});

test("a settled <select> hands focus back, or every bare tool key dies behind it", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	armEffect("dig");
	const mask = within(strip()).getByLabelText(
		"brush mask",
	) as HTMLSelectElement;
	mask.focus();
	// Compared as BOOLEANS, never as elements: a happy-dom node carries React's fiber
	// graph, so a failing element comparison serialises tens of megabytes and reads as a
	// hung run rather than a failed assertion (the house rule — and the select case below
	// hit it during sabotage).
	expect(document.activeElement === mask).toBe(true);

	fireEvent.change(mask, { target: { value: "organic-only" } });
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		mask: { kind: "organic-only" },
	});
	// A native select KEEPS focus after a choice, and the app-level gate refuses every
	// `typed` action while a select holds it — correctly, since Esc on an open dropdown
	// must not discard the session behind it. In a palette the user closes that was mild;
	// in an always-on strip between the user and the canvas it kills every bare tool key
	// with nothing on screen saying why.
	expect(document.activeElement === mask).toBe(false);
	stub.calls.setGesture.mockClear();
	act(() => {
		fireEvent.keyDown(window, { key: "v" });
	});
	expect(stub.calls.setGesture.mock.calls).toEqual([["pointer"]]);
});

// --- (d) the ⋯ is the same list, not a second one ---------------------------

test("the ⋯ holds everything the strip shows PLUS the rest", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	armEffect("smooth");
	// The strip carries three of smooth's five.
	expect(stripParams()).toEqual(["radius", "strength", "mode"]);

	fireEvent.click(
		within(strip()).getByRole("button", { name: /^all smooth options/ }),
	);
	const all = await screen.findByRole("group", { name: "all smooth options" });
	// A SUPERSET — the popover renders the whole per-effect list and the strip renders
	// its prefix, so "everything the strip shows plus the rest" holds by construction
	// rather than by two lists happening to agree.
	expect(paramsIn(all)).toEqual([
		"radius",
		"mask",
		"strength",
		"iterations",
		"mode",
	]);
	for (const shown of stripParams()) expect(paramsIn(all)).toContain(shown);
});

// --- (e) the session swap (mock frame 2) ------------------------------------

test("a live session swaps the tool strip for the session strip and takes Bake off the bar", async () => {
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	// Bake is on the bar before the session (disabled until the world has a name, which
	// is a different claim — its PRESENCE is what this case is about).
	expect(screen.getByRole("button", { name: "Bake" })).toBeTruthy();

	act(() => {
		stub.fire.stamp(makeSession({ mode: "reconfigure", entityId: 3 }));
	});

	// The tool strip is GONE, not merely covered: leaving it would leave live radius and
	// mask controls beside a bar that says the tools are locked.
	expect(screen.queryByRole("group", { name: "tool options" }) === null).toBe(
		true,
	);
	const live = sessionStrip();
	// Name, state tag, and the two verbs that END it (mock frame 2). The name is the
	// ROWS' spelling (`hall #3`), so the strip and the entities palette point at one
	// thing in one vocabulary.
	expect(within(live).getByText("hall #3")).toBeTruthy();
	expect(within(live).getByText("RECONFIGURE")).toBeTruthy();
	expect(within(live).getByText(/apply/)).toBeTruthy();
	expect(within(live).getByText(/revert/)).toBeTruthy();
	// Bake writes worlds/index.json from the COMMITTED log; a session's ghost is not in
	// it, so a bake here would quietly write a world without what is on screen.
	expect(screen.queryByRole("button", { name: "Bake" }) === null).toBe(true);

	// ⏎ APPLIES a reconfigure. Pinned exactly rather than by substring: the first cut
	// matched /apply/, which "apply" and "applies" and "reapply" all satisfy, and the verb
	// is the whole content of the claim.
	expect(within(live).getByText("apply")).toBeTruthy();
	expect(within(live).queryByText("drop") === null).toBe(true);

	// A move says MOVE and DROP — the one word that distinguishes the three session
	// states, and the reason `StampSession.moving` exists at all. Both were unpinned: every
	// fixture reaching this strip was a reconfigure, so the `moving` branch of the tag AND
	// of the ⏎ verb were dead code as far as the suite could tell.
	act(() => {
		stub.fire.stamp(
			makeSession({ mode: "reconfigure", entityId: 3, moving: true }),
		);
	});
	expect(within(sessionStrip()).getByText("MOVE")).toBeTruthy();
	expect(within(sessionStrip()).getByText("drop")).toBeTruthy();
	expect(within(sessionStrip()).queryByText("apply") === null).toBe(true);
	// R is hidden on a MOVE: a move is a region translation, and `rotateStamp` would refuse
	// — advertising a key whose only answer is a refusal is the pattern D-7 retires.
	expect(within(sessionStrip()).queryByText("rotate ¼") === null).toBe(true);

	// The THIRD tag, which no fixture reached: a fresh stamp has no entity yet, so it is
	// named by its generator alone and tagged STAMP.
	act(() => {
		stub.fire.stamp(makeSession({ mode: "stamp", entityId: null }));
	});
	expect(within(sessionStrip()).getByText("STAMP")).toBeTruthy();
	expect(within(sessionStrip()).getByText("hall")).toBeTruthy();
	expect(within(sessionStrip()).getByText("rotate ¼")).toBeTruthy();
	// …and its VERBS, which is the branch that was WRONG rather than merely unpinned.
	// This strip used to read `moving` alone, so a STAMP inherited RECONFIGURE's pair and
	// said "apply / revert" — and there is nothing to revert a stamp TO. The card and the
	// status bar's keymap line, both on screen at the same moment, said "commit /
	// discard". Asserted against `SESSION_VERBS` rather than against literals, so the
	// three surfaces cannot drift apart again without this failing.
	expect(
		within(sessionStrip()).getByText(SESSION_VERBS.STAMP.primary),
	).toBeTruthy();
	expect(
		within(sessionStrip()).getByText(SESSION_VERBS.STAMP.secondary),
	).toBeTruthy();
	// The RECONFIGURE pair must be ABSENT: "revert" over a stamp is the specific
	// falsehood, and a positive assertion alone would pass under the old code the moment
	// "commit" appeared anywhere in the strip.
	expect(within(sessionStrip()).queryByText("revert") === null).toBe(true);
	expect(within(sessionStrip()).queryByText("apply") === null).toBe(true);

	// …and the strip comes back when the session ends.
	act(() => {
		stub.fire.stamp(null);
	});
	expect(strip()).toBeTruthy();
	expect(screen.getByRole("button", { name: "Bake" })).toBeTruthy();
});

// --- W-2: the radius readout tracks the HOST, not just the chrome ------------

test("a host-side radius change reaches the strip readout (F4.5 gate, W-2)", async () => {
	// The gate finding this closes: the wheel and `[` / `]` step the host's radius
	// without passing through the chrome, so the readout used to keep whatever number
	// the chrome itself last set and drift from the brush the viewport was drawing.
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	// The radius control only renders with a brush effect armed — with `pointer` armed
	// the strip carries no brush params at all.
	armEffect("dig");
	const readout = () =>
		(within(strip()).getByLabelText("brush radius") as HTMLInputElement).value;
	const before = readout();

	// The host pushes the tool AND the radius on one seam — a wheel notch looks like
	// this from the chrome's side.
	await act(async () => {
		stub.fire.tool(
			{
				effect: "dig",
				materialId: 0,
				mask: { kind: "none" },
				smooth: { strength: 16, iterations: 1, mode: "both" },
				hollow: null,
			},
			3.5,
		);
		await Promise.resolve();
	});

	expect(readout()).toBe("3.5");
	// …and the starting value was not it, so the assertion above is not vacuous.
	expect(before).not.toBe("3.5");
});

test("the mirror does NOT push the radius back at the host — no round trip", async () => {
	// The other half: a mirror that answered a host push with a `setDigRadius` would
	// fight a wheel gesture at wheel rate. The chrome ADOPTS only.
	stubCatalog();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	armEffect("dig");
	stub.calls.setDigRadius.mockClear();

	await act(async () => {
		stub.fire.tool(
			{
				effect: "dig",
				materialId: 0,
				mask: { kind: "none" },
				smooth: { strength: 16, iterations: 1, mode: "both" },
				hollow: null,
			},
			3.5,
		);
		await Promise.resolve();
	});

	expect(stub.calls.setDigRadius).not.toHaveBeenCalled();
});
