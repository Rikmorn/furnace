// Harness tests for the Field panel (F2b sweep — the Task 14 review
// commitment): mock EditorContext + a minimal stub FieldHost that records
// calls and exposes its subscribe callbacks for manual firing (the
// world-panel.test.tsx precedent). The GPU never initializes here — the panel
// owns no canvas at all now (the shell's CanvasHost does), so nothing in this
// file ever calls host.init — and every behaviour under test is pure
// chrome↔host protocol: the paint organic-clamp, the catalog Load gate, the
// subscribeTool echo guard, the reconfigure session's Apply routing, stamp
// commit gating, the selection footer, and the F4 advisor's flags section.
//
// The entity list and the drift report LEFT this panel in F4.5a Task 10 — they are
// tests/chrome/entities-palette.test.tsx now, assertion for assertion. What stayed
// behind is the negative half: the panel claims neither of their seams.

import { afterEach, expect, mock, test } from "bun:test";
import type { FieldFlag, FlagKind, FlagSeverity } from "@furnace/core/field";
import { FieldPanel } from "../../src/frontend/components/FieldPanel.tsx";
import { FlagsSection } from "../../src/frontend/components/field/FlagsSection.tsx";
import { Toasts } from "../../src/frontend/components/shell/Toasts.tsx";
import { CatalogProvider } from "../../src/frontend/hooks/useCatalogs.tsx";
import { FieldHostStateProvider } from "../../src/frontend/hooks/useFieldHostState.tsx";
import type { VerifyVerdictWire } from "../../src/frontend/lib/analyzer-protocol.ts";
import type { EntityCatalog } from "../../src/frontend/lib/catalog.ts";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import type {
	FieldGeneratorInfo,
	FieldTool,
	FlagRow,
	FlagsSummary,
	StampSession,
} from "../../src/viewport-host/index.ts";
import {
	act,
	cleanup,
	fireEvent,
	makeEditorContext,
	render,
	renderWithEditor,
	screen,
	waitFor,
	within,
} from "../inspector/_harness.tsx";
import { makeStubHost } from "./_stub-host.ts";

afterEach(cleanup);
// The notification store is a module singleton (one editor, one message log), so a
// message raised by one case is still there for the next one. Clearing also cancels
// the TTL timers, which would otherwise fire into an unmounted tree.
afterEach(() => notify.clear());

// --- fetch stub (the toolbar's run-once catalog GET) ------------------------

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

/** Replace globalThis.fetch for one test (afterEach restores the real one).
 *  URL-AWARE: the toolbar fires TWO catalog GETs (materials, then entities) and
 *  a URL-agnostic stub silently fed the materials body to parseEntityCatalog —
 *  which threw a swallowed CatalogError, so the entity path was only ever
 *  covered in its error branch (review O7). */
function stubFetch(fn: (url: string) => Promise<Response>): void {
	// Boundary cast: the stub only serves the toolbar's two catalog GETs, whose
	// first argument is always a plain string URL.
	globalThis.fetch = mock((input: unknown) =>
		fn(String(input)),
	) as unknown as typeof fetch;
}

/** Serve each catalog URL its own body; anything absent 404s. */
function stubCatalogs(bodies: {
	materials?: string;
	entities?: string;
	agent?: string;
}): void {
	stubFetch((url) => {
		const pick = (): string | undefined => {
			if (url.includes("entities.json")) return bodies.entities;
			if (url.includes("agent.json")) return bodies.agent;
			return bodies.materials;
		};
		const body = pick();
		return Promise.resolve(
			body === undefined
				? new Response("", { status: 404 })
				: new Response(body, { status: 200 }),
		);
	});
}

const fetch404 = (): void =>
	stubFetch(() => Promise.resolve(new Response("", { status: 404 })));

/** A two-class catalog (rock organic + masonry kit) in the exact
 *  catalog/materials.json v1 shape parseMaterialsCatalog accepts. */
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

// --- fixtures (the stub host itself lives in ./_stub-host.ts) ---------------

const HALL_GEN: FieldGeneratorInfo = {
	id: "hall",
	name: "Hall",
	paramSchema: { type: "object", properties: { width: { type: "number" } } },
	defaults: { width: 4 },
	placesProps: false,
};

function makeSession(overrides: Partial<StampSession> = {}): StampSession {
	return {
		generator: "hall",
		params: { width: 4 },
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

/** Render the panel and flush the catalog fetch inside act — its settle (the message
 *  + the table setState) otherwise lands between assertions as an un-act'ed update.
 *
 *  `<CatalogProvider />` wraps it because the three-fetch pass is the SHELL's now (the
 *  world drawer needs the same result, and the fetch has to happen whether or not this
 *  palette is open). Mounting it here keeps the panel's catalog-dependent behaviour —
 *  the swatch strip, the archetypeId picker — testable against the real fetch path
 *  rather than a hand-fed table.
 *
 *  `<Toasts />` rides along because the panel does not render what the editor SAYS: the
 *  catalog reports go to the notification store, and the toast layer is what puts them
 *  on screen. Mounting it here keeps those cases assertions about what a user sees
 *  rather than about a store's internals.
 *
 *  Deliberately NOT wrapped in FieldHostStateProvider — several cases below assert
 *  that the PANEL claims none of the shell's single-slot seams, and a provider here
 *  would claim them for it. `renderPanelUnderShellSeams` is the variant for the two
 *  cases that need the tool-error seam wired. */
async function renderPanel(stub: ReturnType<typeof makeStubHost>) {
	const result = renderWithEditor(
		<CatalogProvider>
			<FieldPanel />
			<Toasts />
		</CatalogProvider>,
		makeEditorContext({ fieldHostRef: { current: stub.host } }),
	);
	await act(async () => {
		// Two microtask turns: the catalog path awaits fetch() then res.text().
		await Promise.resolve();
		await Promise.resolve();
	});
	return result;
}

/** The panel under the shell's host-state provider — the arrangement the real editor
 *  mounts. The provider owns `subscribeToolError`, so this is what a `fire.toolError`
 *  needs to reach anything: it becomes a toast AND the tick that releases the panel's
 *  in-flight verify column. */
async function renderPanelUnderShellSeams(
	stub: ReturnType<typeof makeStubHost>,
) {
	const result = renderWithEditor(
		<FieldHostStateProvider host={stub.host} engineReady>
			<CatalogProvider>
				<FieldPanel />
				<Toasts />
			</CatalogProvider>
		</FieldHostStateProvider>,
		makeEditorContext({ fieldHostRef: { current: stub.host } }),
	);
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	return result;
}

const button = (name: string): HTMLButtonElement =>
	screen.getByRole("button", { name }) as HTMLButtonElement;

/** A toast row's text, SCOPED to the stack. The toast layer also publishes two
 *  persistent announcement regions carrying the same string (the house live-region
 *  pattern — see Toasts), so an unscoped `getByText` is ambiguous by design. */
const toastText = (text: string | RegExp): HTMLElement =>
	within(screen.getByRole("list", { name: "notifications" })).getByText(text);

// --- (a) paint organic-clamp ------------------------------------------------

test("picking Paint while a kit class is active clamps the material to the first organic class", async () => {
	stubCatalogs({ materials: CATALOG_JSON });
	const stub = makeStubHost();
	await renderPanel(stub);
	// The swatch strip appears once the catalog lands (2 classes > 1).
	await waitFor(() => screen.getByLabelText("material masonry"));
	fireEvent.click(screen.getByLabelText("material masonry"));
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		effect: "dig",
		materialId: 1,
	});
	fireEvent.click(button("Paint"));
	// Kit masonry (id 1) is unpaintable — the brush pick clamps to rock (id 0).
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		effect: "paint",
		materialId: 0,
	});
});

// --- (c) the subscribeTool echo guard ---------------------------------------

test("a host-initiated tool push is adopted without re-pushing to host.setTool", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	const fill: FieldTool = {
		effect: "fill",
		materialId: 0,
		mask: { kind: "none" },
		smooth: { strength: 16, iterations: 1, mode: "both" },
		hollow: null,
	};
	act(() => {
		stub.fire.tool(fill);
	});
	// The panel MIRRORED the change (Fill highlights)…
	expect(button("Fill").getAttribute("aria-pressed")).toBe("true");
	// …without echoing it back (re-pushing would re-derive → re-fire → loop).
	expect(stub.calls.setTool).not.toHaveBeenCalled();
});

// The single-slot rule, pinned from the side that would break it. Every FieldHost
// subscribe seam stores ONE callback (`statsCb = cb`), so a panel that re-subscribed
// to one would silently steal the shell's — no throw, no warning, the shell surface
// just stops updating. The panel reads none of these five now: stats belong to the
// status bar's chips, tool errors to the toast stack, entities + drift to the
// entities palette, and the camera pose to the axis triad (all via the shell's
// provider, at useFieldHostState). This is the guard a re-added meter, a re-added
// status line, an entity list, or a second orientation readout that crept back has to
// trip.
//
// It is the ONLY case here that must NOT be rendered under FieldHostStateProvider — a
// provider above the panel claims all five itself, and every assertion below would
// then be about the provider rather than the panel.
test("the panel never subscribes to stats, tool errors, entities, drift or the camera pose — those slots belong to the shell", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	expect(stub.calls.subscribeStats).not.toHaveBeenCalled();
	expect(stub.calls.subscribeToolError).not.toHaveBeenCalled();
	expect(stub.calls.subscribeEntities).not.toHaveBeenCalled();
	expect(stub.calls.subscribeDrift).not.toHaveBeenCalled();
	expect(stub.calls.subscribeCameraPose).not.toHaveBeenCalled();
});

test("the commit button reads its mode and routes through the ONE host verb", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await renderPanel(stub);
	act(() => {
		stub.fire.stamp(
			makeSession({ mode: "reconfigure", entityId: 1, phase: "ready" }),
		);
	});
	// The card names its destination: the entity, not a fresh stamp.
	expect(screen.getByText("reconfigure: Hall #1")).toBeTruthy();
	fireEvent.click(button("Apply"));
	// The panel does NOT re-derive mode→verb: the host owns that mapping (it
	// already owns it for Enter), so both labels reach the same seam.
	expect(stub.calls.commitSession).toHaveBeenCalledTimes(1);
	expect(stub.calls.applyReconfigure).not.toHaveBeenCalled();
	expect(stub.calls.commitStamp).not.toHaveBeenCalled();
	// The stamp path still reads Commit, through the same verb.
	act(() => {
		stub.fire.stamp(makeSession({ phase: "ready" }));
	});
	fireEvent.click(button("Commit"));
	expect(stub.calls.commitSession).toHaveBeenCalledTimes(2);
	expect(stub.calls.commitStamp).not.toHaveBeenCalled();
});

// --- (f) Commit ready-gating ------------------------------------------------

test("Commit is disabled until the stamp session reaches ready", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await renderPanel(stub);
	act(() => {
		stub.fire.stamp(makeSession({ phase: "configuring" }));
	});
	expect(button("Commit").disabled).toBe(true);
	act(() => {
		stub.fire.stamp(makeSession({ phase: "ready", opCount: 3 }));
	});
	expect(button("Commit").disabled).toBe(false);
	fireEvent.click(button("Commit"));
	expect(stub.calls.commitSession).toHaveBeenCalledTimes(1);
});

test("the stamp nudge buttons drive host.nudgeStamp in whole lattice STEPS", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await renderPanel(stub);
	act(() => {
		stub.fire.stamp(makeSession());
	});
	// World axes, one step per press — the button twins of ←/→, ⇧↓/⇧↑, ↑/↓.
	const pressed: [string, [number, number, number]][] = [
		["nudge minus X", [-1, 0, 0]],
		["nudge plus X", [1, 0, 0]],
		["nudge minus Y", [0, -1, 0]],
		["nudge plus Y", [0, 1, 0]],
		["nudge minus Z", [0, 0, -1]],
		["nudge plus Z", [0, 0, 1]],
	];
	for (const [label] of pressed) fireEvent.click(screen.getByLabelText(label));
	expect(stub.calls.nudgeStamp.mock.calls).toEqual(pressed.map(([, s]) => s));
	// The hint line names the keyboard twins (the canvas must be focused for
	// them to land, so the buttons are not redundant).
	expect(screen.getByText(/←\/→ move X/)).toBeTruthy();
});

test("no stamp session means no nudge cluster", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await renderPanel(stub);
	expect(screen.queryByLabelText("nudge plus X")).toBeNull();
});

// (g) The slice + void wiring moved with the controls themselves: they are the View
// popover's now, covered in tests/chrome/shell.test.tsx.

// --- (h) selection footer ---------------------------------------------------

test("the footer shows the selection count + the truncation warning; Clear reaches the host", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	act(() => {
		stub.fire.selection({
			spec: { kind: "flood-void", seed: [0, 0, 0], budget: 200_000 },
			count: 1234,
			truncated: true,
			aabb: null,
		});
	});
	expect(screen.getByText(/1234 selected/)).toBeTruthy();
	expect(screen.getByText(/flood truncated at 1234/)).toBeTruthy();
	fireEvent.click(button("Clear"));
	expect(stub.calls.clearSelection).toHaveBeenCalledTimes(1);
});

// --- (i) the controls scroll inside themselves ------------------------------

/** The scroll container the control sections share, resolved through a section that
 *  must be inside it. Throws (rather than soft-failing an assertion) if the panel's
 *  shape changed — every assertion below is meaningless without it. Anchored on the
 *  brush palette now: the layers row (its first anchor) is the top bar's popover and
 *  the entities heading (its second) is a palette of its own. */
function controlsBox(): HTMLElement {
	const box = button("Dig").closest(".overflow-y-auto");
	if (!(box instanceof HTMLElement))
		throw new Error(
			"field panel shape changed: the control sections no longer share a scroll container",
		);
	return box;
}

test("the control sections share ONE scroll container, above the pinned footer", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await renderPanel(stub);
	// happy-dom runs NO layout (getBoundingClientRect is all zeros), so the pixel
	// outcome is not assertable. What IS assertable is the structure that produces
	// it: one self-scrolling stack that takes the height the selection footer below
	// leaves, and shrinks instead of pushing it out. The F2b 45% cap is gone with the
	// canvas it was protecting — the panel is controls now, and the world toolbar that
	// used to pin the top went with the world state (the shell owns it).
	const controls = controlsBox();
	for (const cls of ["flex-1", "min-h-0", "overflow-y-auto"])
		expect(controls.classList.contains(cls)).toBe(true);
	expect(controls.classList.contains("max-h-[45%]")).toBe(false);
	// The control sections live inside it…
	expect(controls.contains(button("Dig"))).toBe(true); // brush palette
	expect(controls.contains(button("Box Select"))).toBe(true); // gesture row
	// …and the selection footer does not: it stays pinned outside the scroll, which is
	// the whole point of putting it here.
	expect(controls.contains(button("Reselect"))).toBe(false);
	// The entity list is not in this panel AT ALL any more — it is the entities
	// palette's, the first organ out (F4.5a Task 10). Compared to null before the
	// expect, for the fiber-graph reason stated below.
	expect(screen.queryByText(/^Entities \(/) === null).toBe(true);
	// Nothing about the WORLD is in this panel any more — the name field, Save, Load
	// and Bake are the shell's (the world chip + the drawer + ⌘S). A control stack that
	// owns the save verb cannot be dissolved into palettes, and a palette that can be
	// closed cannot be the only way to save.
	// Compared to null BEFORE the expect: a happy-dom element carries React's fiber
	// graph, so a failing `toBeNull` on one serialises tens of megabytes and reads as a
	// hung run rather than a failed assertion.
	expect(screen.queryByLabelText("world name") === null).toBe(true);
	for (const gone of ["Save", "Load", "Bake & make default"])
		expect(screen.queryByRole("button", { name: gone }) === null).toBe(true);
	// The tall extreme: a stamp session adds the generator form to the stack — it
	// lands INSIDE the container, so the pinned rows are untouched.
	act(() => {
		stub.fire.stamp(makeSession({ phase: "configuring" }));
	});
	expect(controlsBox()).toBe(controls);
	expect(controls.contains(button("Commit"))).toBe(true);
});

// --- (k) F3b: the archetypeId picker survives the catalog's ASYNC arrival ----
//
// The ordering this pins is the whole point (review B1). The panel reads
// `host.listGenerators()` at engine-ready — SYNCHRONOUSLY, in an effect body —
// while the toolbar installs the entity catalog only after `await fetch(...)`.
// So the schema the form renders is always captured BEFORE the catalog exists,
// and unless the panel re-reads, `archetypeId` stays a free-text input forever.
// Host-level tests cannot see this: they call setEntityCatalog first, which is
// exactly the order the chrome does not produce.

/** A one-archetype `catalog/entities.json`, the v1 shape parseEntityCatalog takes. */
const ENTITIES_JSON = JSON.stringify({
	version: 1,
	archetypes: [
		{
			id: "rock",
			name: "Rock",
			material: { litColor: [0.45, 0.42, 0.4] },
			collision: { kind: "box", halfExtents: [0.4, 0.35, 0.4] },
			scatter: { density: 0.3 },
		},
		{
			id: "stalagmite",
			name: "Stalagmite",
			material: { litColor: [0.5, 0.48, 0.44] },
			collision: { kind: "capsule", halfHeight: 0.5, radius: 0.22 },
			scatter: { density: 0.15 },
		},
	],
});

const SCATTER_GEN: FieldGeneratorInfo = {
	id: "scatter",
	name: "Scatter",
	paramSchema: {
		type: "object",
		properties: { archetypeId: { type: "string", default: "rock" } },
	},
	defaults: { archetypeId: "rock" },
	placesProps: true,
};

test("the entity catalog is fetched, parsed and installed on the host", async () => {
	stubCatalogs({ materials: CATALOG_JSON, entities: ENTITIES_JSON });
	const stub = makeStubHost();
	await renderPanel(stub);
	await waitFor(() =>
		expect(stub.calls.setEntityCatalog.mock.calls.length).toBe(1),
	);
	// The PARSED catalog reaches the host, not the raw text — a URL-agnostic
	// fetch stub used to hand parseEntityCatalog the materials body instead, so
	// this path only ever ran in its swallowed-error branch (review O7).
	const installed = stub.calls.setEntityCatalog.mock.calls[0]?.[0] as
		| EntityCatalog
		| undefined;
	expect(installed?.archetypes.map((a) => a.id)).toEqual([
		"rock",
		"stalagmite",
	]);
	// …and the scatter block was re-shaped into generator param spelling.
	expect(installed?.archetypes[0]?.scatter).toEqual({ density: 0.3 });
});

/** The agent profile in the exact catalog/agent.json v1 shape (D-F4-4). */
const AGENT_JSON = JSON.stringify({
	version: 1,
	capsule: { radius: 0.3, halfHeight: 0.6 },
	stepHeight: 0.4,
	climbCeiling: 0.7,
	clearance: 1.8,
	slopeLimitDeg: 55,
	skin: 0.08,
});

test("the agent catalog is fetched, parsed and installed on the host", async () => {
	stubCatalogs({ materials: CATALOG_JSON, agent: AGENT_JSON });
	const stub = makeStubHost();
	await renderPanel(stub);
	await waitFor(() =>
		expect(stub.calls.setAgentProfile.mock.calls.length).toBe(1),
	);
	// The whole profile, parsed — this is the advisor's entire premise, and a
	// field dropped here is a pass parameterized on a capsule nobody authored.
	expect(stub.calls.setAgentProfile.mock.calls[0]?.[0]).toEqual({
		capsule: { radius: 0.3, halfHeight: 0.6 },
		stepHeight: 0.4,
		climbCeiling: 0.7,
		clearance: 1.8,
		slopeLimitDeg: 55,
		skin: 0.08,
	});
});

test("no agent catalog installs nothing, quietly — the advisor says so itself", async () => {
	// A project with no agent profile is a legitimate one (the editor is
	// project-first). The host reports "advisor idle" ONCE at the first edit that
	// would have analysed, which is a better moment than load; a second message
	// here would be noise on a line that has already said what happened.
	stubCatalogs({ materials: CATALOG_JSON });
	const stub = makeStubHost();
	await renderPanel(stub);
	await waitFor(() => expect(toastText(/materials: /)).toBeTruthy());
	expect(stub.calls.setAgentProfile.mock.calls).toEqual([]);
	expect(
		within(screen.getByRole("list", { name: "notifications" })).queryByText(
			/agent/,
		),
	).toBeNull();
});

test("a MALFORMED agent catalog is setup-loud and costs the other two nothing", async () => {
	stubCatalogs({
		materials: CATALOG_JSON,
		entities: ENTITIES_JSON,
		agent: JSON.stringify({ version: 1, capsule: { radius: 0.3 } }),
	});
	const stub = makeStubHost();
	await renderPanel(stub);
	// The JSON path is in the line, so a mistyped catalog is diagnosable from the
	// panel rather than from a pass that silently never ran.
	await waitFor(() => expect(toastText(/capsule\.halfHeight/)).toBeTruthy());
	expect(stub.calls.setAgentProfile.mock.calls).toEqual([]);
	// The other two catalogs are unaffected — the agent fetch gates nothing, so
	// its failure must not cost the table that DOES gate Load.
	expect(stub.calls.setMaterialTable.mock.calls.length).toBe(1);
	expect(stub.calls.setEntityCatalog.mock.calls.length).toBe(1);
	expect(toastText(/materials: 2 classes/)).toBeTruthy();
});

/** The inspector labels a param with its humanized key, and FieldRow wraps the
 *  control in that <label> — so this resolves whichever control the field kind
 *  chose: EnumField's Radix combobox (a <button>) or StringField's <input>. */
const archetypeField = (): HTMLElement => screen.getByLabelText("Archetype Id");

test("archetypeId renders as a PICKER once the catalog lands (it arrives after the first listGenerators)", async () => {
	stubCatalogs({ materials: CATALOG_JSON, entities: ENTITIES_JSON });
	const stub = makeStubHost({ generators: [SCATTER_GEN] });
	await renderPanel(stub);
	act(() => {
		stub.fire.stamp(makeSession({ generator: "scatter", phase: "ready" }));
	});
	// The kind resolver reads `enum` FIRST, so an enum-carrying schema renders
	// EnumField (a Radix combobox trigger) and a bare string one renders
	// StringField (an <input>). Before the re-read fix this was the <input>: the
	// catalog HAD installed on the host, but the panel was still holding the
	// schema it read synchronously at engine-ready.
	await waitFor(() => expect(archetypeField().tagName).toBe("BUTTON"));
	expect(archetypeField().getAttribute("role")).toBe("combobox");

	// The mechanism, stated directly (the reviewer's probe, made permanent):
	// the catalog installs BEFORE the last listGenerators read. An implementation
	// that reads the registry once at engine-ready fails here even if some other
	// path happened to make the DOM assertion above pass.
	expect(stub.order.indexOf("setEntityCatalog")).toBeGreaterThanOrEqual(0);
	expect(stub.order.lastIndexOf("listGenerators")).toBeGreaterThan(
		stub.order.indexOf("setEntityCatalog"),
	);
});

test("with no entity catalog (404) archetypeId stays a free-text field", async () => {
	// The catalog SEEDS, it never GATES: scatter must stay authorable without one.
	stubCatalogs({ materials: CATALOG_JSON });
	const stub = makeStubHost({ generators: [SCATTER_GEN] });
	await renderPanel(stub);
	act(() => {
		stub.fire.stamp(makeSession({ generator: "scatter", phase: "ready" }));
	});
	expect(stub.calls.setEntityCatalog.mock.calls.length).toBe(0);
	expect(archetypeField().tagName).toBe("INPUT");
});

test("the props count shows for a prop generator only — a carver never reads '0 props'", async () => {
	stubCatalogs({ materials: CATALOG_JSON, entities: ENTITIES_JSON });
	const stub = makeStubHost({ generators: [HALL_GEN, SCATTER_GEN] });
	await renderPanel(stub);

	// A carver's placementCount is 0 by construction, so a permanent "· 0 props"
	// on every hall preview would be noise the user has to learn to ignore.
	act(() => {
		stub.fire.stamp(
			makeSession({ phase: "ready", opCount: 12, placementCount: 0 }),
		);
	});
	expect(screen.getByText(/12 ops/)).toBeDefined();
	// `/\d+ props/`, not `/props/` — the layer strip has a bare "props" checkbox.
	expect(screen.queryByText(/\d+ props/)).toBeNull();

	// For scatter it is the ONLY output — shown even at zero, because that is the
	// reading the host's commit refusal then explains.
	act(() => {
		stub.fire.stamp(
			makeSession({
				generator: "scatter",
				phase: "ready",
				opCount: 0,
				placementCount: 0,
			}),
		);
	});
	expect(screen.getByText(/0 props/)).toBeDefined();
});

// --- (n) the segment gesture shares the selection slot but keeps the brush ---

test("Segment arms the gesture slot, keeps the brush inspector, and survives an effect pick", async () => {
	stubCatalogs({ materials: CATALOG_JSON });
	const stub = makeStubHost();
	await renderPanel(stub);

	// Arming a SELECTION gesture hides the brush inspector — an armed flood
	// makes radius/mask promises LMB won't keep.
	fireEvent.click(button("Wand"));
	expect(stub.calls.setGesture.mock.calls.at(-1)?.[0]).toBe("material");
	expect(screen.queryByLabelText("brush radius")).toBeNull();

	// Segment does NOT: its click commits a brush op, so radius (the capsule's
	// radius) and the rest of the brush parameters stay live and visible.
	fireEvent.click(button("Segment"));
	expect(stub.calls.setGesture.mock.calls.at(-1)?.[0]).toBe("segment");
	expect(screen.getByLabelText("brush radius")).toBeTruthy();

	// …and picking an effect under it re-aims the segment (dig → fill = tunnel →
	// rampart) instead of disarming it, which is what the SELECTION gestures get.
	const before = stub.calls.setGesture.mock.calls.length;
	fireEvent.click(button("Fill"));
	expect(stub.calls.setTool.mock.calls.at(-1)?.[0]).toMatchObject({
		effect: "fill",
	});
	expect(stub.calls.setGesture.mock.calls.length).toBe(before);
	expect(
		screen
			.getByRole("button", { name: "Segment" })
			.getAttribute("aria-pressed"),
	).toBe("true");
});

// --- what the catalog pass SAYS goes to the toast stack ----------------------
// The F3b gate's finding was that refusals and routine info shared one footer line
// and read identically, i.e. as dead features. The line is gone: every report is its
// own toned toast (and its own log entry), so this asserts the routing rather than a
// tone on a shared span. The refusal half of the same story lives in
// tests/chrome/shell.test.tsx, where the seam that carries it is wired.

test("a catalog report becomes a toast — and is still in the log after the toast goes", async () => {
	stubCatalogs({ materials: CATALOG_JSON });
	const stub = makeStubHost();
	await renderPanel(stub);
	const toast = await waitFor(() => toastText("materials: 2 classes"));
	// Info, not error: a catalog that loaded is not a problem, and the tone is what
	// the gate found missing when everything shared one line.
	expect(toast.className).not.toContain("text-destructive");
	// …and it is announced POLITELY — a report waits for a pause, only refusals cut in.
	const polite = document.querySelector("div[aria-live='polite']");
	expect(polite?.textContent).toBe("materials: 2 classes");

	// Dismissed off the screen, kept in the record — which is what makes a fading
	// toast safe in the first place.
	fireEvent.click(screen.getByLabelText("dismiss: materials: 2 classes"));
	expect(screen.queryByLabelText("dismiss: materials: 2 classes")).toBeNull();
	expect(notify.getSnapshot().log.map((e) => e.text)).toContain(
		"materials: 2 classes",
	);
});

// --- (o) F4: the walkability advisor's flags section -------------------------

/** One stage-1 finding. `cell` is derived from `world` at the production 0.25 m
 *  lattice: the panel never reads it, but a fixture whose cell contradicted its
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

/** A summary row. The keys here are DELIBERATELY opaque nonsense (`a`, `b`):
 *  the host's real format is private to field-flags.ts, and a panel that hands
 *  one of these straight back cannot be reconstructing it. */
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
	byKindSeverity: [],
	visible,
	...over,
});

const NARROW = rowOf("a", flagAt("narrow", "candidate", [2.5, 0, -8]));

const VERDICT_TRAPPED: VerifyVerdictWire = {
	outcome: "trapped",
	lanes: [],
	ms: 12,
};

test("the flags section stays hidden until the advisor finds something", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	// The subscribe push is an EMPTY summary — nothing found, nothing rendered
	// (the DriftReport precedent: no permanently empty section).
	expect(screen.queryByText(/^Flags \(/)).toBeNull();
	act(() => {
		stub.fire.flags(summaryOf([NARROW]));
	});
	expect(screen.getByText("Flags (1)")).toBeTruthy();
});

test("the count line reads what was found against what the filters admit", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
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
	expect(screen.getByText("12 flags · 1 shown")).toBeTruthy();
	// The tally covers everything FOUND, so it is the only reading of what the
	// filters are hiding.
	expect(screen.getByText("narrow 4 · ledge 8")).toBeTruthy();
});

test("the section survives filters that hide every finding — they are the way back", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	act(() => {
		stub.fire.flags(summaryOf([], { total: 7 }));
	});
	// Unmounting here would take the only control that can un-hide them with it.
	expect(screen.getByText("Flags (7)")).toBeTruthy();
	expect(screen.getByText("all 7 hidden by the filters")).toBeTruthy();
});

test("the panel pushes its filter defaults at engine-ready and each checkbox edits them", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	// Panel and host must start in agreement (the DEFAULT_LAYERS precedent) —
	// the host keeps the last filters across a panel remount, panel state does not.
	expect(stub.calls.setFlagFilters.mock.calls).toEqual([
		[{ candidates: true, info: false, unreachable: false }],
	]);
	act(() => {
		stub.fire.flags(summaryOf([NARROW]));
	});
	fireEvent.click(screen.getByLabelText("info"));
	expect(stub.calls.setFlagFilters.mock.calls.at(-1)?.[0]).toEqual({
		candidates: true,
		info: true,
		unreachable: false,
	});
	fireEvent.click(screen.getByLabelText("candidates"));
	expect(stub.calls.setFlagFilters.mock.calls.at(-1)?.[0]).toEqual({
		candidates: false,
		info: true,
		unreachable: false,
	});
	// The three are a GROUP, not three loose checkboxes that happen to sit in a
	// row: the leading "show" is a text node with no programmatic association, so
	// without this the only thing tying them together is proximity. The same idiom
	// the View popover's layer group uses, for the same reason.
	const group = screen.getByRole("group", { name: "flag filters" });
	for (const band of ["candidates", "info", "unreachable"])
		expect(group.contains(screen.getByLabelText(band))).toBe(true);
});

// I2's forcing function, and the reason `disabled` DERIVES from `verifyRefusal`
// rather than restating its rule: the two can only disagree if something adds a
// refusal reason to one and not the other, and the failure is silent — a live
// button whose own accessible name explains why it is not. Quantified over every
// row rather than naming the pit, so it holds for reasons that do not exist yet.
test("a Verify that ANNOUNCES a refusal is a Verify that is disabled", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
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
	// breaks the sentence rather than appending a parenthetical: a row label ends
	// in "(2.5, 0.0, -8.0)", so a trailing "(…)" would match every button here.
	const announced = buttons.filter((b) =>
		(b.getAttribute("aria-label") ?? "").includes(". Unavailable: "),
	);
	expect(announced.map((b) => b.disabled)).toEqual(announced.map(() => true));
	// Non-vacuous — the fixture's pit puts at least one button in that set, so the
	// forall above has something to be true OF. Deliberately `>= 1` and not `=== 1`:
	// pinning the exact count would turn a LEGITIMATE new refusal reason into a
	// failure of this test, which is the opposite of what it is for. Verified by
	// mutation: adding a third reason keeps this green, and adding one while
	// restating `disabled` instead of deriving it goes red.
	expect(announced.length).toBeGreaterThanOrEqual(1);
});

test("a row click frames its owner chunk; a pit frames its whole region", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	act(() => {
		stub.fire.flags(
			summaryOf([
				rowOf(
					"a",
					flagAt("narrow", "candidate", [2.5, 0, -8], { chunk: "1,0,0" }),
				),
				rowOf(
					"b",
					flagAt("pit", "candidate", [9, 0, 0], {
						chunk: "2,0,0",
						chunks: ["2,0,0", "3,0,0"],
						cells: 14,
					}),
				),
			]),
		);
	});
	fireEvent.click(
		screen.getByLabelText("frame candidate narrow @ (2.5, 0.0, -8.0)"),
	);
	expect(stub.calls.frameChunks.mock.calls.at(-1)).toEqual([["1,0,0"]]);
	// A pit is region-level: its `chunks` are the region's owners, and framing
	// only the anchor's chunk would point at a corner of the trap.
	fireEvent.click(
		screen.getByLabelText("frame candidate pit @ (9.0, 0.0, 0.0) · 14 cells"),
	);
	expect(stub.calls.frameChunks.mock.calls.at(-1)).toEqual([
		["2,0,0", "3,0,0"],
	]);
});

// The radius is bracketed from BOTH sides — 1.5 m must fold in, 2.5 m must not —
// which pins the constant to [1.5, 2.5) rather than merely "somewhere sane" (the
// membership test is `<=`, so 1.5 passes and 2.5 does not). A one-sided set
// (everything either well inside or 10 m out) passes at 2 m and at 4 m alike,
// which is a test that would not notice the constant changing. Verified by
// mutation: 1.4 and 2.6 both go red, and so do 1 and 4. The window is a metre
// wide on purpose — this is a triage heuristic, and pinning it to ±0.1 m would
// fail a deliberate re-tune that changed no behaviour anyone can see.
test("findings of one kind within 2 m collapse into one row; the ones outside it keep their own", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	act(() => {
		stub.fire.flags(
			summaryOf([
				rowOf("a", flagAt("narrow", "candidate", [0, 0, 0])),
				// 1.5 m from the anchor — inside the radius, so it folds in.
				rowOf("b", flagAt("narrow", "candidate", [1.5, 0, 0])),
				// 1.5 m from `b` but 3 m from the anchor: a cluster admits a flag
				// near ANY member, so the run chains rather than splitting.
				rowOf("c", flagAt("narrow", "candidate", [3, 0, 0])),
				// 2.5 m past the nearest member of that run (`c`) — the UPPER bound.
				// A radius that grew to 4 m would swallow it and this row would vanish.
				rowOf("d", flagAt("narrow", "candidate", [5.5, 0, 0])),
				// 4.5 m past `d` — out under any of the radii above, so the run's tail
				// cannot chain this far however the constant moves.
				rowOf("e", flagAt("narrow", "candidate", [10, 0, 0])),
				// Inside the radius of the anchor but a DIFFERENT kind: one row is
				// one kind, because the row's label and dot describe all of it.
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
// advisor exists to flag — with the whole suite still green. Z is no better
// covered by the run above, so all three axes are pinned here at once.
test("the cluster radius is spherical — a 3 m gap on ANY axis is two rows", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
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
	// Four rows, each reading its own anchor: any axis dropped from the distance
	// folds its pair into the first and takes one of these labels with it.
	expect(screen.getByText("narrow @ (0.0, 0.0, 0.0)")).toBeTruthy();
	expect(screen.getByText("narrow @ (3.0, 0.0, 0.0)")).toBeTruthy();
	expect(screen.getByText("narrow @ (0.0, 3.0, 0.0)")).toBeTruthy();
	expect(screen.getByText("narrow @ (0.0, 0.0, 3.0)")).toBeTruthy();
});

test("candidates sort above info, and a demoted row says so", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	act(() => {
		stub.fire.flags(
			summaryOf([
				rowOf("a", flagAt("ledge", "info", [0, 0, 0])),
				rowOf(
					"b",
					flagAt("narrow", "candidate", [0, 0, 0], {
						unreachable: true,
					}),
				),
			]),
		);
	});
	const labels = screen
		.getAllByRole("button", { name: /^frame / })
		.map((b) => b.getAttribute("aria-label"));
	expect(labels).toEqual([
		"frame candidate narrow @ (0.0, 0.0, 0.0)",
		"frame info ledge @ (0.0, 0.0, 0.0)",
	]);
	// The `unreachable` filter is opt-in, so a row it admitted has to say WHY it
	// is there — otherwise widening the filter just grows the list. Scoped to the
	// row: the filter checkbox carries the same word, deliberately (the chip names
	// the filter that let this row through).
	const demoted = screen
		.getByLabelText("frame candidate narrow @ (0.0, 0.0, 0.0)")
		.closest("li");
	if (!(demoted instanceof HTMLElement))
		throw new Error("flag rows are no longer <li> — the row scope is gone");
	expect(within(demoted).getByText("unreachable")).toBeTruthy();
	// …and the row it did NOT demote says nothing.
	const info = screen.getByLabelText("frame info ledge @ (0.0, 0.0, 0.0)");
	expect(info.closest("li")?.textContent).not.toContain("unreachable");
	// The band reaches a reader through THREE channels, and the assertions above
	// already cover the third (it is in each accessible name). The other two are
	// the dot's hue — alarm for what to act on, amber for context, the viewport's
	// CANDIDATE_TINT / INFO_TINT twins — and its SHAPE. Both are pinned because
	// hue alone is WCAG 1.4.1: red against amber is a hard pair, and this is the
	// one axis the whole list is triaged on.
	const dot = (row: HTMLElement, glyph: string): HTMLElement =>
		within(row).getByText(glyph);
	expect(dot(demoted, "●").className).toContain("text-destructive");
	const infoRow = info.closest("li");
	if (!(infoRow instanceof HTMLElement))
		throw new Error("flag rows are no longer <li> — the row scope is gone");
	expect(dot(infoRow, "○").className).toContain("text-warning");
	// …and the two glyphs are not interchangeable: a filled dot in the info row
	// would mean the shape channel had collapsed back onto colour alone.
	expect(within(infoRow).queryByText("●")).toBeNull();
	expect(within(demoted).queryByText("○")).toBeNull();
});

// The band a row groups on is everything it DISPLAYS, demotion included. Two
// findings alike in kind, severity and position but differing in `unreachable`
// are the pair that proves it: folded together, one row would wear a chip that is
// false for half its members — and the reachability tag is the one thing on a
// flag the analyzer writes AFTER the fact, so mixed vintages are the normal
// state, not a corner.
test("a demoted finding never folds into a live one's row", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
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

test("a pit refuses Verify with its reason in the accessible name", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	act(() => {
		stub.fire.flags(
			summaryOf([
				rowOf("a", flagAt("pit", "candidate", [9, 0, 0], { cells: 14 })),
			]),
		);
	});
	// The title rides a non-focusable wrapper span (a disabled button eats
	// pointer events), so the accessible name is the only channel that reaches a
	// screen reader — the EntitiesList blocked-Open convention.
	const verify = screen.getByLabelText(
		"verify pit @ (9.0, 0.0, 0.0) · 14 cells. Unavailable: region-level — walk it",
	) as HTMLButtonElement;
	expect(verify.disabled).toBe(true);
});

test("a verdict on the next push badges the row", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	act(() => {
		stub.fire.flags(summaryOf([NARROW]));
	});
	expect(screen.queryByText("trapped")).toBeNull();
	// Stage 2's answer arrives joined onto the row it was taken on (the host
	// pushes a fresh summary), not as a separate verdict channel.
	act(() => {
		stub.fire.flags(summaryOf([rowOf("a", NARROW.flag, VERDICT_TRAPPED)]));
	});
	expect(screen.getByText("trapped")).toBeTruthy();
});

// Stage 2 takes ONE flag, so a cluster row's verdict is a sample, not a survey —
// and `narrow ×2 · trapped` reads as two proven traps. The scope therefore has to
// ride the two channels assistive tech actually gets: a chip's own text (a
// `title` on a generic span reaches a mouse and nothing else, and `aria-label` on
// one has no reliable exposure) and the accessible NAME of the verb.
test("a cluster's verdict and Verify say WHICH finding they are about", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
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

// The section's own four button states, pinned against it DIRECTLY: `verifying`
// is a prop, so the section can be driven through all of them by re-rendering,
// where the panel test below can only reach the ones its host stub produces.
// The panel's half — who sets that prop, and what releases it — is the two tests
// after this one.
test("Verify hands back the row's own key, and only one runs at a time", () => {
	// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
	const noop = () => {};
	const verified: string[] = [];
	const rows = [NARROW, rowOf("b", flagAt("narrow", "candidate", [40, 0, 0]))];
	const section = (verifying: string | null) => (
		<FlagsSection
			summary={summaryOf(rows)}
			filters={{ candidates: true, info: false, unreachable: false }}
			onFilters={noop}
			onFrame={noop}
			onVerify={(key) => verified.push(key)}
			verifying={verifying}
		/>
	);
	const { rerender } = render(section(null));
	const verifyButton = (name: string): HTMLButtonElement =>
		screen.getByLabelText(name) as HTMLButtonElement;

	fireEvent.click(verifyButton("verify narrow @ (2.5, 0.0, -8.0)"));
	// The key is the store's own opaque string, handed straight back — the panel
	// never builds one (it cannot: the format is private to field-flags.ts).
	expect(verified).toEqual(["a"]);

	// Budgeted verb, one at a time. The row in flight says so on its face…
	rerender(section("a"));
	const running = verifyButton("verify narrow @ (2.5, 0.0, -8.0)");
	expect(running.disabled).toBe(true);
	expect(running.textContent).toBe("Verifying…");
	// …and every OTHER row refuses with the reason in its accessible name.
	const other = verifyButton(
		"verify narrow @ (40.0, 0.0, 0.0). Unavailable: a verify is already running",
	);
	expect(other.disabled).toBe(true);
	fireEvent.click(other);
	expect(verified).toEqual(["a"]);

	// Released when the panel says the flight ended.
	rerender(section(null));
	expect(verifyButton("verify narrow @ (2.5, 0.0, -8.0)").disabled).toBe(false);
	expect(verifyButton("verify narrow @ (40.0, 0.0, 0.0)").disabled).toBe(false);
});

/** The second of two rows far enough apart not to cluster (CLUSTER_RADIUS_M is
 *  2 m), so the list renders two independent Verify buttons. Named separately
 *  because one test rebuilds the pair with a verdict on the first. */
const FAR_ROW = rowOf("b", flagAt("narrow", "candidate", [40, 0, 0]));
const TWO_ROWS: FlagRow[] = [NARROW, FAR_ROW];

test("clicking Verify starts a REAL one on the host and marks the row in flight", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	act(() => {
		stub.fire.flags(summaryOf(TWO_ROWS));
	});

	fireEvent.click(screen.getByLabelText("verify narrow @ (2.5, 0.0, -8.0)"));
	// The host verb, with the store's own opaque key handed straight back.
	expect(stub.calls.verifyFlag.mock.calls).toEqual([["a"]]);
	// …and the panel adopts the in-flight row itself, because nothing pushes it
	// back: `verifyFlag` is fire-and-forget and the verdict is the next signal.
	expect(
		(
			screen.getByLabelText(
				"verify narrow @ (2.5, 0.0, -8.0)",
			) as HTMLButtonElement
		).textContent,
	).toBe("Verifying…");
	expect(
		screen.getByLabelText(
			"verify narrow @ (40.0, 0.0, 0.0). Unavailable: a verify is already running",
		),
	).toBeTruthy();
});

test("the in-flight column is released by a verdict AND by a refusal", async () => {
	fetch404();
	const stub = makeStubHost();
	// Under the provider: the refusal half of this test travels host → provider →
	// tick, which is the path the real shell wires.
	await renderPanelUnderShellSeams(stub);
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
	expect(verifyA().textContent).toBe("Verify");

	// (2) a REFUSAL. The host's four refusals (busy, no profile, a key it no
	// longer holds, a pit) all report on the tool-error seam and push NO flags —
	// so a column released only by (1) would stick until the next edit, showing a
	// verify that never started as one still running.
	fireEvent.click(verifyA());
	expect(verifyA().textContent).toBe("Verifying…");
	act(() => {
		stub.fire.toolError("that flag was re-analyzed away");
	});
	expect(verifyA().textContent).toBe("Verify");
	// …and the refusal is not swallowed on the way: it is on screen as a toast, which
	// is the only place it is said now.
	expect(toastText("that flag was re-analyzed away")).toBeTruthy();
	// Announced assertively: a refusal interrupts, because what the user asked for did
	// not happen. (The house pattern — the ROW carries no live role; see Toasts.)
	expect(
		document.querySelector("div[aria-live='assertive']")?.textContent,
	).toBe("that flag was re-analyzed away");
});

test("a SYNCHRONOUS refusal never leaves the column stuck", async () => {
	fetch404();
	// ALL FOUR of the host's refusals report from INSIDE verifyFlag, before it
	// returns (only a stage-2 FAILURE is async). So the panel's adopt has to
	// happen first: adopting afterwards overwrites the release that refusal
	// already performed, and the row reads "Verifying…" forever over a verify
	// that never started.
	const stub = makeStubHost({ verifyRefusal: "a verify is already running" });
	await renderPanelUnderShellSeams(stub);
	act(() => {
		stub.fire.flags(summaryOf(TWO_ROWS));
	});
	const verifyA = (): HTMLButtonElement =>
		screen.getByLabelText(/^verify narrow @ \(2\.5/) as HTMLButtonElement;

	fireEvent.click(verifyA());
	expect(stub.calls.verifyFlag.mock.calls).toEqual([["a"]]);
	expect(verifyA().textContent).toBe("Verify");
	expect(toastText("a verify is already running")).toBeTruthy();
});

// The advisor's "catching up" line rode `analyzerPending` on the panel footer; it is
// a status-bar chip now — covered in tests/chrome/shell.test.tsx.

// The flags LAYER gate — that hiding the markers is free and does not stop the analyzer
// — is asserted where the checkbox lives now: the View popover, in shell.test.tsx.
