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
// tests/chrome/entities-palette.test.tsx now, assertion for assertion.
//
// The panel now claims NO host seam at all: F4.5b Task 2 lifted its last four
// (tool / selection / stamp / flags) into the shell's provider, so every case here
// mounts under `FieldHostStateProvider` and every host push travels provider → context →
// panel. What stayed behind is the negative half, one case, quantified over all ten
// seams.

import { afterEach, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { FieldPanel } from "../../src/frontend/components/FieldPanel.tsx";
import { Toasts } from "../../src/frontend/components/shell/Toasts.tsx";
import { CatalogProvider } from "../../src/frontend/hooks/useCatalogs.tsx";
import { FieldHostStateProvider } from "../../src/frontend/hooks/useFieldHostState.tsx";
import type { EntityCatalog } from "../../src/frontend/lib/catalog.ts";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import type { FieldTool, FlagsSummary } from "../../src/viewport-host/index.ts";
import {
	act,
	cleanup,
	fireEvent,
	makeEditorContext,
	render,
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
 *  `<FieldHostStateProvider />` is not scenery either: it owns ALL NINE FieldHost
 *  subscribe seams (F4.5b Task 2 lifted the last four out of this panel), so without it
 *  a `stub.fire.tool` / `.selection` / `.stamp` / `.flags` reaches nothing at all and
 *  every case below would be asserting about a panel wired to a dead host. This is also
 *  the arrangement the real editor mounts, which is what makes these cases claims about
 *  the product rather than about a fixture.
 *
 *  Built as an ELEMENT (rather than passed straight to `renderWithEditor`) so a case can
 *  re-render the same tree with the PANEL removed — the shell.test.tsx `withEditor`
 *  precedent, and what the seam-ownership case below needs. */
const withEditor = (
	ui: ReactElement,
	stub: ReturnType<typeof makeStubHost>,
): ReactElement => (
	<EditorContext.Provider
		value={makeEditorContext({ fieldHostRef: { current: stub.host } })}
	>
		<FieldHostStateProvider host={stub.host} engineReady>
			<CatalogProvider>
				{ui}
				<Toasts />
			</CatalogProvider>
		</FieldHostStateProvider>
	</EditorContext.Provider>
);

/** Two microtask turns: the catalog path awaits fetch() then res.text(). */
const flushCatalog = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});

async function renderPanel(stub: ReturnType<typeof makeStubHost>) {
	const result = render(withEditor(<FieldPanel />, stub));
	await flushCatalog();
	return result;
}

/** A toast row's text, SCOPED to the stack. The toast layer also publishes two
 *  persistent announcement regions carrying the same string (the house live-region
 *  pattern — see Toasts), so an unscoped `getByText` is ambiguous by design. */
const toastText = (text: string | RegExp): HTMLElement =>
	within(screen.getByRole("list", { name: "notifications" })).getByText(text);

// (a) The paint organic-clamp and (c) the subscribeTool echo guard LEFT this file with
// their subjects in F4.5b Task 8: the swatch strip and the armed tool's readout are the
// top strip's now, and arming an effect is the tool rail's. Both are in
// tests/chrome/tool-strip.test.tsx, assertion for assertion.

// The single-slot rule, pinned from the side that would break it. Every FieldHost
// subscribe seam stores ONE callback (`toolCb = cb`), so a panel that subscribed to one
// would silently steal the shell's — no throw, no warning, the shell surface just stops
// updating. ALL TWELVE belong to the provider now: stats to the status bar's chips, tool
// errors to the toast stack, entities + drift + the entity selection to the entities
// palette, the camera pose to the axis triad, the named history to the Undo/Redo labels
// and the History palette (F4.5b Task 12), and — since F4.5b Task 2 — tool / selection /
// stamp / flags to the control stack, read out of context. This is the guard a re-added
// meter, a re-added status line, or a mirror that crept back into a section has to trip.
//
// Every seam, with the push that proves the slot is live. Quantified rather than spelled
// out case by case: the point is that the set is CLOSED, and a thirteenth seam claimed by
// a panel section is exactly what this must catch.
const DIG_TOOL: FieldTool = {
	effect: "dig",
	materialId: 0,
	mask: { kind: "none" },
	smooth: { strength: 16, iterations: 1, mode: "both" },
	hollow: null,
};

const NO_FLAGS: FlagsSummary = {
	total: 0,
	byKindSeverity: [],
	visible: [],
	selected: null,
};

const NO_HISTORY = { undo: [], redo: [], undoDepth: 0, redoDepth: 0 };

const seamsOf = (stub: ReturnType<typeof makeStubHost>) =>
	[
		["stats", stub.calls.subscribeStats, () => stub.fire.stats(makeStats())],
		[
			"toolError",
			stub.calls.subscribeToolError,
			() => stub.fire.toolError("selection found no matching cells"),
		],
		[
			"cameraPose",
			stub.calls.subscribeCameraPose,
			() => stub.fire.cameraPose({ yaw: 1, pitch: 0.2 }),
		],
		["entities", stub.calls.subscribeEntities, () => stub.fire.entities()],
		["drift", stub.calls.subscribeDrift, () => stub.fire.drift(null)],
		["tool", stub.calls.subscribeTool, () => stub.fire.tool(DIG_TOOL)],
		[
			"selection",
			stub.calls.subscribeSelection,
			() => stub.fire.selection(null),
		],
		["stamp", stub.calls.subscribeStamp, () => stub.fire.stamp(null)],
		[
			"pendingStamp",
			stub.calls.subscribePendingStamp,
			() => stub.fire.pendingStamp(null),
		],
		["flags", stub.calls.subscribeFlags, () => stub.fire.flags(NO_FLAGS)],
		[
			"entitySelection",
			stub.calls.subscribeEntitySelection,
			() => stub.fire.entitySelection(null),
		],
		[
			"history",
			stub.calls.subscribeHistory,
			() => stub.fire.history(NO_HISTORY),
		],
	] as const;

test("every host seam is the SHELL's — the panel adds no claim and holds none", async () => {
	fetch404();
	const stub = makeStubHost();
	const { rerender } = await renderPanel(stub);

	// (1) Nobody claimed anything twice. A second claim is the failure this rule exists
	// for, and it reads as ONE extra call and nothing else.
	for (const [name, claim] of seamsOf(stub))
		expect([name, claim.mock.calls.length]).toEqual([name, 1]);

	// (2) …and that one claim is the PROVIDER's. Counting cannot tell the two apart — one
	// claim is one claim whoever made it, and this file's mount has both components in it
	// — so the PANEL is unmounted out from under a provider that stays, and every seam is
	// pushed again. A seam the panel owned releases here and goes dead; a seam the
	// provider owns keeps delivering. This half is what actually inverted in Task 2: with
	// the four mirrors still in FieldPanel it fails four times over.
	rerender(withEditor(<span />, stub));
	for (const [name, , push] of seamsOf(stub)) {
		let delivered = false;
		act(() => {
			delivered = push();
		});
		expect([name, delivered]).toEqual([name, true]);
	}
});

// The four STAMP-SESSION cases that lived here — the mode-aware commit verb, the ready
// gate, the nudge cluster and its absence — left with their subject in F4.5b Task 10.
// `StampInspector` was deleted, not moved: the session card (shell/SessionCard) replaces
// it, and tests/chrome/session-card.test.tsx carries that coverage assertion for
// assertion, plus the REST state the inspector never had.

// (g) The slice + void wiring moved with the controls themselves: they are the View
// popover's now, covered in tests/chrome/shell.test.tsx.

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

// The archetypeId PICKER cases (the B1 ordering contract) and the props-count case also
// left with the form that renders them — tests/chrome/session-card.test.tsx. The catalog
// FETCH half of that story stays here, because the fetch is still the shell's and this
// file is where its three outcomes are pinned.

// The mount-arming case and the segment case also left with their subjects (F4.5b Task 8):
// which family reads as armed is tests/chrome/tool-rail.test.tsx, and which params the
// armed one shows — including segment riding the brush effect, and the dig↔fill re-aim
// that survives under it — is tests/chrome/tool-strip.test.tsx.

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

// The flags SECTION left this file with its subject in F4.5b Task 13: `FlagsSection`
// was deleted, not moved, and shell/FlagsPalette is its successor — a palette of its
// own with a reframed header, pill chips, persisted filters and a two-way selection
// pair with the viewport. tests/chrome/flags-palette.test.tsx carries that coverage
// assertion for assertion, plus the selection cases the section could not have.
//
// The SELECTION FOOTER left in the same task. Its count, its truncation warning and
// its Clear / Reselect verbs are the status bar's `sel N cells` chip now — covered in
// tests/chrome/shell.test.tsx, where the bar is mounted inside the real shell.
//
// The "controls scroll inside themselves" case went with the last thing there was to
// scroll: `FieldPanel` renders null, and the `controls` palette id retires with this
// file in Task 14.
