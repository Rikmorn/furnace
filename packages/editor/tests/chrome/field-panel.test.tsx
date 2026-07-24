// Harness tests for the Field panel (F2b sweep — the Task 14 review
// commitment): mock EditorContext + a minimal stub FieldHost that records
// calls and exposes its subscribe callbacks for manual firing (the
// world-panel.test.tsx precedent). The GPU never initializes here — the
// panel's initWhenSized defers host.init until the canvas measures nonzero,
// and a happy-dom canvas never does — so every behaviour under test is pure
// chrome↔host protocol: the paint organic-clamp, the catalog Load gate, the
// subscribeTool echo guard, the entity-refresh tick (F3a — the ONE trigger,
// which replaced the F2b commit-push + remeshVersion-counter pair), the F3a
// row verbs (Open / Freeze / Bake-behind-a-confirm) and the reconfigure
// session's Apply routing, stamp commit gating, slice wiring, and the
// selection footer.

import { afterEach, expect, mock, test } from "bun:test";
import type { DriftFinding } from "@furnace/core/field";
import type { ConfirmRequest } from "../../src/frontend/components/ConfirmDialog.tsx";
import { FieldPanel } from "../../src/frontend/components/FieldPanel.tsx";
import type { EntityCatalog } from "../../src/frontend/lib/catalog.ts";
// Tests are NOT part of the chrome bundle, so a value import of the viewport
// host is allowed here — and using the REAL helper is the point: the stub then
// goes stale exactly when the production host would.
import { withArchetypeOptions } from "../../src/viewport-host/field-placements.ts";
import type {
	FieldEntityInfo,
	FieldGeneratorInfo,
	FieldHost,
	FieldStats,
	FieldTool,
	SelectionInfo,
	StampSession,
} from "../../src/viewport-host/index.ts";
import {
	act,
	cleanup,
	fireEvent,
	makeEditorContext,
	renderWithEditor,
	screen,
	waitFor,
} from "../inspector/_harness.tsx";

afterEach(cleanup);

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
function stubCatalogs(bodies: { materials?: string; entities?: string }): void {
	stubFetch((url) => {
		const body = url.includes("entities.json")
			? bodies.entities
			: bodies.materials;
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

// --- stub host --------------------------------------------------------------

const HALL_GEN: FieldGeneratorInfo = {
	id: "hall",
	name: "Hall",
	paramSchema: { type: "object", properties: { width: { type: "number" } } },
	defaults: { width: 4 },
	placesProps: false,
};

function makeStats(overrides: Partial<FieldStats> = {}): FieldStats {
	return {
		chunks: 0,
		lastRemeshMs: 0,
		remeshVersion: 0,
		totalOps: 0,
		liveGenerators: 0,
		compactableOps: 0,
		undoDepth: 0,
		lastReconfigureMs: 0,
		...overrides,
	};
}

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

const ENTITY: FieldEntityInfo = {
	entityId: 1,
	type: "generator",
	generator: "hall",
	params: { width: 4 },
	seed: 7,
	region: { min: [0, 0, 0], max: [4, 4, 4] },
	opSpan: [2, 4], // 3 ops
	placed: [], // a hall places nothing
};

/** A minimal FieldHost stub: every mutator is a recording mock; the subscribe
 *  seams latch their callback so a test can fire host-initiated pushes
 *  manually (wrap in act). subscribeSelection/subscribeStamp push the current
 *  (empty) state on subscribe, like the real host. */
function makeStubHost(opts: { generators?: FieldGeneratorInfo[] } = {}) {
	let entities: FieldEntityInfo[] = [];
	// The stub models the REAL host's snapshot semantics: setEntityCatalog stores
	// the catalog, and listGenerators() reads it AT CALL TIME through the same
	// pure helper field-host.ts uses. Without this the ordering bug (B1) is
	// invisible from the chrome — a static generator list can never go stale.
	let installedCatalog: EntityCatalog | null = null;
	// Call-order trace for the two seams whose ORDER is the contract under test.
	const order: string[] = [];
	const cbs: {
		tool: ((t: FieldTool) => void) | null;
		stamp: ((s: StampSession | null) => void) | null;
		stats: ((s: FieldStats) => void) | null;
		selection: ((i: SelectionInfo | null) => void) | null;
		toolError: ((msg: string) => void) | null;
		entities: (() => void) | null;
		drift: ((r: DriftFinding[] | null) => void) | null;
	} = {
		tool: null,
		stamp: null,
		stats: null,
		selection: null,
		toolError: null,
		entities: null,
		drift: null,
	};
	const calls = {
		setTool: mock(),
		setSlice: mock(),
		setLayers: mock(),
		setGesture: mock(),
		setDigRadius: mock(),
		setShading: mock(),
		setMaterialTable: mock(),
		setEntityCatalog: mock(),
		highlightEntity: mock(),
		startStamp: mock(),
		updateStamp: mock(),
		nudgeStamp: mock(),
		rerollStamp: mock(),
		commitStamp: mock(),
		commitSession: mock(),
		cancelStamp: mock(),
		undo: mock(),
		redo: mock(),
		clearSelection: mock(),
		reselect: mock(),
		newWorld: mock(),
		openEntity: mock(),
		applyReconfigure: mock(),
		setEntityFrozen: mock(),
		bakeEntity: mock(),
		dismissDrift: mock(),
		frameChunks: mock(),
	};
	const host: FieldHost = {
		init: () => Promise.resolve(),
		// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
		dispose: () => {},
		newWorld: calls.newWorld,
		// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
		loadWorld: () => {},
		setDigRadius: calls.setDigRadius,
		setShading: calls.setShading,
		setTool: calls.setTool,
		subscribeTool: (cb) => {
			cbs.tool = cb;
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
			return () => {};
		},
		subscribeToolError: (cb) => {
			cbs.toolError = cb;
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
			return () => {};
		},
		setGesture: calls.setGesture,
		clearSelection: calls.clearSelection,
		reselect: calls.reselect,
		subscribeSelection: (cb) => {
			cbs.selection = cb;
			cb(null);
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
			return () => {};
		},
		setLayers: calls.setLayers,
		setSlice: calls.setSlice,
		getSmoothLimits: () => ({ maxStrength: 32, maxIterations: 4 }),
		setMaterialTable: calls.setMaterialTable,
		setEntityCatalog: (catalog) => {
			order.push("setEntityCatalog");
			installedCatalog = catalog;
			calls.setEntityCatalog(catalog);
		},
		listGenerators: () => {
			order.push("listGenerators");
			return (opts.generators ?? []).map((g) => ({
				...g,
				paramSchema: withArchetypeOptions(
					structuredClone(g.paramSchema),
					(installedCatalog?.archetypes ?? []).map((a) => a.id),
				),
			}));
		},
		propInstanceCounts: () => new Map<string, number>(),
		startStamp: calls.startStamp,
		updateStamp: calls.updateStamp,
		nudgeStamp: calls.nudgeStamp,
		rerollStamp: calls.rerollStamp,
		commitStamp: calls.commitStamp,
		commitSession: calls.commitSession,
		cancelStamp: calls.cancelStamp,
		undo: calls.undo,
		redo: calls.redo,
		subscribeStamp: (cb) => {
			cbs.stamp = cb;
			cb(null);
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
			return () => {};
		},
		openEntity: calls.openEntity,
		applyReconfigure: calls.applyReconfigure,
		setEntityFrozen: calls.setEntityFrozen,
		bakeEntity: calls.bakeEntity,
		subscribeDrift: (cb) => {
			cbs.drift = cb;
			cb(null);
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
			return () => {};
		},
		dismissDrift: calls.dismissDrift,
		frameChunks: calls.frameChunks,
		subscribeEntities: (cb) => {
			cbs.entities = cb;
			cb(); // the real host's initial catch-up tick
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
			return () => {};
		},
		listEntities: () => entities.map((e) => structuredClone(e)),
		highlightEntity: calls.highlightEntity,
		exportArtifact: () => [],
		subscribeStats: (cb) => {
			cbs.stats = cb;
			// biome-ignore lint/suspicious/noEmptyBlockStatements: inert unsubscribe no-op
			return () => {};
		},
	};
	return {
		host,
		calls,
		/** Seam-call trace, in order — the B1 ordering contract's witness. */
		order,
		/** Fire a latched host→panel push (callers wrap in act). */
		fire: {
			tool: (t: FieldTool) => cbs.tool?.(t),
			stamp: (s: StampSession | null) => cbs.stamp?.(s),
			stats: (s: FieldStats) => cbs.stats?.(s),
			selection: (i: SelectionInfo | null) => cbs.selection?.(i),
			/** The entity-list change TICK (the real host's only entity signal). */
			entities: () => cbs.entities?.(),
			drift: (r: DriftFinding[] | null) => cbs.drift?.(r),
		},
		setEntities: (next: FieldEntityInfo[]) => {
			entities = next;
		},
	};
}

/** Seed the list with `next` and fire the host's entity tick, as the real host
 *  does after a commit / apply / freeze / bake / ⌘Z. */
function pushEntities(
	stub: ReturnType<typeof makeStubHost>,
	next: FieldEntityInfo[],
): void {
	stub.setEntities(next);
	act(() => {
		stub.fire.entities();
	});
}

/** One row's action button, resolved by the aria-label that names BOTH the verb
 *  and the entity — the visible text ("Freeze", "Bake…") repeats on every row,
 *  so it identifies nothing once a list has two. Genuinely row-scoped: this is
 *  writable against a multi-row list, which a visible-text lookup was not. */
const rowButton = (verb: string, entityId: number): HTMLButtonElement =>
	screen.getByLabelText(`${verb} entity ${entityId}`) as HTMLButtonElement;

/** Render the panel and flush the toolbar's catalog fetch inside act — its
 *  settle (status + Load-gate setState) otherwise lands between assertions as
 *  an un-act'ed update. Test (b) renders directly instead: its fetch stays
 *  deliberately pending. */
async function renderPanel(stub: ReturnType<typeof makeStubHost>) {
	const result = renderWithEditor(
		<FieldPanel />,
		makeEditorContext({ fieldHostRef: { current: stub.host } }),
	);
	await act(async () => {
		// Two microtask turns: the catalog path awaits fetch() then res.text().
		await Promise.resolve();
		await Promise.resolve();
	});
	return result;
}

const button = (name: string): HTMLButtonElement =>
	screen.getByRole("button", { name }) as HTMLButtonElement;

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

// --- (b) catalog-gated Load -------------------------------------------------

test("Load stays disabled until the catalog fetch settles", async () => {
	// ONLY the materials GET hangs (it is the one that gates Load); entities 404s
	// like any project without one. A URL-agnostic pending stub used to hand the
	// same `settle` slot to both GETs, so the first promise was overwritten and
	// left unresolved forever (review O7) — harmless, but it meant this test's
	// subject was ambiguous.
	let settle!: (r: Response) => void;
	stubFetch((url) =>
		url.includes("entities.json")
			? Promise.resolve(new Response("", { status: 404 }))
			: new Promise<Response>((res) => {
					settle = res;
				}),
	);
	const stub = makeStubHost();
	renderWithEditor(
		<FieldPanel />,
		makeEditorContext({ fieldHostRef: { current: stub.host } }),
	);
	fireEvent.change(screen.getByLabelText("world name"), {
		target: { value: "cavern" },
	});
	// Valid name, but the catalog is still in flight — the gate holds.
	expect(button("Load").disabled).toBe(true);
	await act(async () => {
		settle(new Response("", { status: 404 }));
	});
	await waitFor(() => expect(button("Load").disabled).toBe(false));
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

// --- (d) commit lands the entity row ----------------------------------------

test("a stamp commit (the host's entity tick) surfaces the new entity row", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await renderPanel(stub);
	expect(screen.getByText("Entities (0)")).toBeTruthy();
	act(() => {
		stub.fire.stamp(makeSession({ phase: "ready", opCount: 3 }));
	});
	// The commit appends the entity op, ends the session and ticks the list.
	act(() => {
		stub.fire.stamp(null);
	});
	pushEntities(stub, [ENTITY]);
	expect(screen.getByText("Entities (1)")).toBeTruthy();
	fireEvent.click(screen.getByText("Entities (1)"));
	expect(screen.getByText("hall · seed 7 · 3 ops")).toBeTruthy();
});

// --- (e) the entity tick is the ONLY refresh trigger ------------------------

test("an undone commit disappears on the entity tick — no session change, no remesh", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await renderPanel(stub);
	pushEntities(stub, [ENTITY]);
	expect(screen.getByText("Entities (1)")).toBeTruthy();
	// ⌘Z with NOTHING else moving: no stamp session was open (so no null push)
	// and a freeze/bake undo dirties no chunk (so the remesh counter never
	// advances). The F2b trigger pair would have missed this entirely.
	pushEntities(stub, []);
	expect(screen.getByText("Entities (0)")).toBeTruthy();
	// The proxies the tick replaced must NOT be refresh triggers any more: a
	// stats push carrying a fresh counter reads no entities back.
	stub.setEntities([ENTITY]);
	act(() => {
		stub.fire.stats(
			makeStats({ chunks: 4, lastRemeshMs: 1, remeshVersion: 9 }),
		);
	});
	expect(screen.getByText("Entities (0)")).toBeTruthy();
});

// --- (j) op-cost meter + drift report (Task 9) ------------------------------

test("the footer meter renders the logStats op-cost fields the host pushes", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	act(() => {
		stub.fire.stats(
			makeStats({
				chunks: 4,
				lastRemeshMs: 1,
				totalOps: 128,
				liveGenerators: 3,
				compactableOps: 40,
				undoDepth: 5,
				lastReconfigureMs: 12,
			}),
		);
	});
	// One span, many interpolated text nodes — assert against its textContent so
	// the split nodes don't defeat a whole-string matcher.
	const meter = screen.getByText(/chunks · remesh/);
	expect(meter.textContent).toContain("ops 128");
	expect(meter.textContent).toContain("live gens 3");
	expect(meter.textContent).toContain("compactable 40");
	expect(meter.textContent).toContain("undo 5");
	expect(meter.textContent).toContain("last reconfigure 12 ms");
});

test("last reconfigure reads — until a reconfigure lands (0 is not 0 ms)", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	act(() => {
		stub.fire.stats(makeStats({ lastReconfigureMs: 0 }));
	});
	const meter = screen.getByText(/chunks · remesh/);
	expect(meter.textContent).toContain("last reconfigure —");
	expect(meter.textContent).not.toContain("0 ms");
});

const FINDINGS: DriftFinding[] = [
	{ opId: 12, kind: "drifted", chunks: ["0,0,0", "1,0,0"] },
	{ opId: 15, kind: "orphaned", chunks: ["2,0,0"] },
];

test("the drift report renders findings, frames a click, and dismisses through the host", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	// Non-modal: nothing renders on a clean apply (the subscribe push is null).
	expect(screen.queryByText(/drifted|orphaned/)).toBeNull();

	act(() => {
		stub.fire.drift(FINDINGS);
	});
	expect(screen.getByText("op 12 drifted")).toBeTruthy();
	expect(screen.getByText("op 15 orphaned")).toBeTruthy();

	// A row click frames that finding's chunk bounds.
	fireEvent.click(screen.getByLabelText("frame op 12 (drifted)"));
	expect(stub.calls.frameChunks.mock.calls).toEqual([[["0,0,0", "1,0,0"]]]);

	// Dismiss clears through the host (the report is host state)…
	fireEvent.click(screen.getByLabelText("dismiss drift report"));
	expect(stub.calls.dismissDrift).toHaveBeenCalledTimes(1);
	// …and the host's null echo removes the list.
	act(() => {
		stub.fire.drift(null);
	});
	expect(screen.queryByText("op 12 drifted")).toBeNull();
});

// --- (d2) F3a: the smart-object verbs on a committed row --------------------

const FROZEN: FieldEntityInfo = { ...ENTITY, entityId: 2, frozen: true };
const BAKED: FieldEntityInfo = { ...ENTITY, entityId: 3, baked: true };

/** Expand the Entities section (rows render inside a collapsed section by
 *  default) after seeding `next`. */
async function showEntities(
	stub: ReturnType<typeof makeStubHost>,
	next: FieldEntityInfo[],
): Promise<void> {
	await renderPanel(stub);
	pushEntities(stub, next);
	fireEvent.click(screen.getByText(`Entities (${next.length})`));
}

test("Open on a plain row starts a reconfigure session through the host", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await showEntities(stub, [ENTITY]);
	fireEvent.click(screen.getByLabelText("open entity 1"));
	expect(stub.calls.openEntity.mock.calls).toEqual([[1]]);
});

test("a frozen row badges its state and refuses Open; a baked row does both too", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await showEntities(stub, [FROZEN, BAKED]);
	expect(screen.getByText("frozen")).toBeTruthy();
	expect(screen.getByText("baked")).toBeTruthy();
	// A blocked Open's accessible name carries the reason too (see its own
	// test), so these match by prefix.
	const frozenOpen = screen.getByLabelText(
		/^open entity 2\b/,
	) as HTMLButtonElement;
	const bakedOpen = screen.getByLabelText(
		/^open entity 3\b/,
	) as HTMLButtonElement;
	expect(frozenOpen.disabled).toBe(true);
	expect(bakedOpen.disabled).toBe(true);
	fireEvent.click(frozenOpen);
	expect(stub.calls.openEntity).not.toHaveBeenCalled();
});

test("each row's verbs address ITS OWN entity in a multi-row list", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	const second: FieldEntityInfo = { ...ENTITY, entityId: 7 };
	// TWO rows: "Freeze" as visible text is ambiguous here — only the id-bearing
	// accessible name distinguishes them, which is the whole point of the label
	// convention (a screen-reader user picking between identical buttons).
	await showEntities(stub, [ENTITY, second]);
	fireEvent.click(rowButton("freeze", 7));
	expect(stub.calls.setEntityFrozen.mock.calls).toEqual([[7, true]]);
	fireEvent.click(rowButton("bake", 1));
	expect(stub.calls.bakeEntity).not.toHaveBeenCalled(); // routed to the confirm

	// The frozen row's button flips to Unfreeze and asks for false. This is also
	// the sameEntities guard's test — a flag-only change is the one the F2b
	// signature (id/generator/seed/opSpan) could not see.
	pushEntities(stub, [ENTITY, { ...second, frozen: true }]);
	fireEvent.click(rowButton("unfreeze", 7));
	expect(stub.calls.setEntityFrozen.mock.calls.at(-1)).toEqual([7, false]);
});

// --- (d3) F3b: the prop segment on a scatter row ----------------------------

/** A committed scatter as listEntities hands it over: a one-op span (the
 *  placement op is the ONLY op it appends) plus the host's attribution of that
 *  op's records. */
const SCATTER: FieldEntityInfo = {
	...ENTITY,
	entityId: 4,
	generator: "scatter",
	params: { archetypeId: "rock", density: 0.3 },
	seed: 9,
	opSpan: [5, 5], // 1 op
	placed: [{ archetypeId: "rock", count: 24 }],
};

test("a scatter row names the archetype it placed and how many; a carver row keeps no prop segment", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await showEntities(stub, [ENTITY, SCATTER]);
	// "1 ops" says nothing about a scatter's output (it writes no cells), so the
	// prop segment is the row's only reading of what this stamp put down.
	expect(
		screen.getByText("scatter · seed 9 · 1 ops · rock · 24 placed"),
	).toBeTruthy();
	// The carver's row is untouched — absent, not a permanent "· 0 placed".
	expect(screen.getByText("hall · seed 7 · 3 ops")).toBeTruthy();
});

// The branch the array-shaped `placed` EXISTS for. Scatter names one archetype
// per commit, so every other test here renders a single entry and the flatMap's
// multi-entry path never runs. `placementsByEntity` counting two archetypes is
// pinned in field-placements.test.ts; this pins what the ROW then reads like.
test("a row that placed TWO archetypes names both", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await showEntities(stub, [
		{
			...SCATTER,
			placed: [
				{ archetypeId: "rock", count: 24 },
				{ archetypeId: "stalagmite", count: 3 },
			],
		},
	]);
	expect(
		screen.getByText(
			"scatter · seed 9 · 1 ops · rock · 24 placed · stalagmite · 3 placed",
		),
	).toBeTruthy();
});

// The refresh guard's blind spot, closed. `sameEntities` compares id, generator,
// seed, opSpan and the two flags — and a world SWITCH can leave every one of
// those equal while the counts differ, because loadWorld recomputes
// `log.nextId` from the loaded ops' own maximum, so ids and spans restart. The
// toolbar's Load button calls loadWorld inside this same panel mount (no
// remount, no state reset, just an entity tick), which is exactly the tick this
// test fires. Without `placed` in the comparator the guard returns `prev` and
// the row keeps world A's count over world B.
test("a world switch that changes ONLY a prop count still re-renders the row", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await showEntities(stub, [SCATTER]);
	expect(
		screen.getByText("scatter · seed 9 · 1 ops · rock · 24 placed"),
	).toBeTruthy();
	// World B: identical in every OTHER compared field, 2 props instead of 24.
	pushEntities(stub, [
		{ ...SCATTER, placed: [{ archetypeId: "rock", count: 2 }] },
	]);
	expect(
		screen.getByText("scatter · seed 9 · 1 ops · rock · 2 placed"),
	).toBeTruthy();
});

// The chrome half of the free-ness claim (its host half is field-stamp.test.ts'
// "Open → re-roll → Apply on a SCATTER row"): a scatter is an ordinary
// GeneratorEntity, so the F3a verbs and the generic params <dl> serve it with no
// scatter-specific branch — the new segment did not cost the row anything.
test("a scatter row keeps the generic verbs and params <dl> (F3a machinery, no scatter case)", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await showEntities(stub, [SCATTER]);
	fireEvent.click(screen.getByLabelText("open entity 4"));
	expect(stub.calls.openEntity.mock.calls).toEqual([[4]]);
	// Expanding shows the scatter's own params through the same <dl> a hall gets.
	fireEvent.click(
		screen.getByText("scatter · seed 9 · 1 ops · rock · 24 placed"),
	);
	expect(screen.getByText("archetypeId")).toBeTruthy();
	expect(screen.getByText("rock")).toBeTruthy();
	expect(screen.getByText("density")).toBeTruthy();
	expect(screen.getByText("0.3")).toBeTruthy();
});

test("a baked row disables both verbs — core would refuse them anyway", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await showEntities(stub, [BAKED]);
	expect(rowButton("freeze", 3).disabled).toBe(true);
	expect(rowButton("bake", 3).disabled).toBe(true);
});

test("a blocked Open carries its reason in the accessible name, not only a title", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await showEntities(stub, [FROZEN]);
	// The title sits on a non-focusable wrapper span (a disabled button eats
	// pointer events), so the accessible name is the only channel a screen
	// reader or keyboard user actually gets.
	expect(
		screen.getByLabelText("open entity 2 (frozen — unfreeze it to edit)"),
	).toBeTruthy();
});

test("Bake confirms before severing the recipe — cancelling never reaches the host", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	let request: ConfirmRequest | null = null;
	renderWithEditor(
		<FieldPanel />,
		makeEditorContext({
			fieldHostRef: { current: stub.host },
			openConfirm: (r) => {
				request = r;
			},
		}),
	);
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	pushEntities(stub, [ENTITY]);
	fireEvent.click(screen.getByText("Entities (1)"));
	fireEvent.click(rowButton("bake", 1));
	// The click alone must not bake: the panel routed it into the App confirm.
	expect(stub.calls.bakeEntity).not.toHaveBeenCalled();
	const pending = request as ConfirmRequest | null;
	if (pending === null) throw new Error("Bake did not open a confirmation");
	expect(pending.destructive).toBe(true);
	expect(pending.message).toMatch(/severs the recipe permanently/);
	// Confirming is what severs it.
	act(() => {
		pending.onConfirm();
	});
	expect(stub.calls.bakeEntity.mock.calls).toEqual([[1]]);
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

// --- (g) slice wiring -------------------------------------------------------

test("the slice checkbox and slider drive host.setSlice(y | null)", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	fireEvent.click(screen.getByLabelText("slice view"));
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(8); // parked default
	fireEvent.change(screen.getByLabelText("slice y"), {
		target: { value: "4" },
	});
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(4);
	fireEvent.click(screen.getByLabelText("slice view"));
	expect(stub.calls.setSlice.mock.calls.at(-1)?.[0]).toBe(null); // off
});

test("the void checkbox drives host.setLayers(voidCast) and leaves the other layers alone", async () => {
	fetch404();
	const stub = makeStubHost();
	await renderPanel(stub);
	fireEvent.click(screen.getByLabelText("void cast"));
	expect(stub.calls.setLayers.mock.calls.at(-1)?.[0]).toEqual({
		field: true,
		kit: true,
		props: true,
		ghost: true,
		selection: true,
		grid: true,
		voidCast: true,
	});
	// Off again — the host reads the false→true EDGE, so a panel that only ever
	// sent `true` would leave the X-ray unbuildable after its first edit.
	fireEvent.click(screen.getByLabelText("void cast"));
	expect(stub.calls.setLayers.mock.calls.at(-1)?.[0]).toMatchObject({
		voidCast: false,
	});
});

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

// --- (i) bounded controls / canvas priority ---------------------------------

/** The panel root plus the two boxes its height budget is split between: the
 *  controls container and the canvas cell that follows it. Throws (rather than
 *  soft-failing an assertion) if the panel's shape changed — every assertion
 *  below is meaningless without it. */
function layoutBoxes(): {
	root: HTMLElement;
	controls: HTMLElement;
	canvas: HTMLElement;
} {
	const canvas = screen.getByLabelText("field dig surface").parentElement;
	const controls = canvas?.previousElementSibling;
	const root = canvas?.parentElement;
	if (
		!(canvas instanceof HTMLElement) ||
		!(controls instanceof HTMLElement) ||
		!(root instanceof HTMLElement)
	)
		throw new Error(
			"field panel shape changed: expected the canvas cell to follow a controls container",
		);
	return { root, controls, canvas };
}

test("the control sections share ONE bounded scroll container; the canvas cell is its sibling", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL_GEN] });
	await renderPanel(stub);
	// happy-dom runs NO layout (getBoundingClientRect is all zeros — the same
	// reason host.init never fires here), so the pixel outcome is not assertable.
	// What IS assertable is the structure that produces it: the controls stack
	// capped + self-scrolling, the canvas cell OUTSIDE that cap taking the rest.
	// Unbounded, a tall StampInspector crushed the canvas to a sliver.
	const { root, controls, canvas } = layoutBoxes();
	// h-full is the last hop of the containing block chain that makes the cap's
	// percentage resolve — and the only hop this component owns (the rest is
	// App/dockview). Without a definite-height parent max-height:45% computes to
	// none and the cap silently stops existing, with every other assertion green.
	expect(root.classList.contains("h-full")).toBe(true);
	// min-h-0 on the container is deliberately NOT pinned: the source calls it
	// redundant (an overflow!=visible flex item already gets an auto min-size of
	// 0), so a cleanup dropping it must not fail a test.
	for (const cls of ["max-h-[45%]", "overflow-y-auto"])
		expect(controls.classList.contains(cls)).toBe(true);
	// All three control sections live inside the cap…
	expect(controls.contains(button("Dig"))).toBe(true); // palette
	expect(controls.contains(screen.getByLabelText("slice view"))).toBe(true); // layers
	expect(controls.contains(screen.getByText("Entities (0)"))).toBe(true); // entities
	// …the persistence toolbar does NOT (it stays pinned above the scroll)…
	expect(controls.contains(screen.getByLabelText("world name"))).toBe(false);
	// …and neither does the canvas, which grows into whatever the cap leaves.
	expect(controls.contains(canvas)).toBe(false);
	for (const cls of ["flex-1", "min-h-24"])
		expect(canvas.classList.contains(cls)).toBe(true);
	// The floor is not interchangeable with min-h-0 (mechanism: the canvas-cell
	// comment in FieldPanel.tsx — kept in ONE place). Both halves are pinned: the
	// floor present, and min-h-0 ABSENT rather than merely outranked. The absence
	// is belt-and-braces — emitted CSS orders .min-h-0 before .min-h-24, so both
	// present already resolves to 96px — but it fails loudly on exactly the
	// "min-h-0 is the flex idiom" edit it names.
	expect(canvas.classList.contains("min-h-0")).toBe(false);
	// The tall extreme: a stamp session adds the generator form to the stack —
	// it lands INSIDE the bounded container, so the canvas cell is untouched.
	act(() => {
		stub.fire.stamp(makeSession({ phase: "configuring" }));
	});
	const tall = layoutBoxes();
	expect(tall.controls).toBe(controls);
	expect(tall.canvas).toBe(canvas);
	expect(controls.contains(button("Commit"))).toBe(true);
	expect(controls.contains(canvas)).toBe(false);
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
