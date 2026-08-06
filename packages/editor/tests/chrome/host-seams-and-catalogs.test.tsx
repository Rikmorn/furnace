// Registered FIRST — the shell.test.tsx rule. A BARE side-effect import, the only spelling
// `organizeImports` leaves in place. See `../inspector/enum-field.test.tsx` for the
// measurement. Carried by every file in this directory so the guarantee is per-file rather
// than "whichever file bun happened to load first also registered".
import "../inspector/_register.ts";

// The two chrome↔host protocol claims that belong to NO single surface, in the harness
// this file has carried since the F2b sweep: mock EditorContext + a minimal stub FieldHost
// that records calls and exposes its subscribe callbacks for manual firing (the
// world-panel.test.tsx precedent). The GPU never initializes here — nothing in this file
// calls host.init.
//
// (1) THE ONE-CLAIMANT RULE, quantified over every seam. The claim used to be that
//     `FieldHostStateProvider` holds all thirteen and no rendered surface holds any. T3b1
//     Task 7 inverted it: ten seams are now latched per-consumer, in the surface that
//     reads them, and only three are still the shell's. So the claim is the SPLIT — which
//     three, and that the other ten are claimed by a reader and released with it. Still a
//     claim about the SET, which is why it cannot live in a per-surface file.
//
//     Since the seams went multicast (T3a) a second claimant no longer STEALS the first's
//     callback, which is why this file matters more, not less: what it catches now is a
//     mirror that outlives its surface, and that has no symptom at all except the counts
//     here.
// (2) THE CATALOG PASS: `CatalogProvider`'s run-once GETs for materials, entities and
//     agents, what each one installs on the host, and what the pass says to the toast
//     stack and the message log.
//
// This file was `field-panel.test.tsx` until F4.5b Task 14. The panel it was named for is
// deleted, and every organ that had a surface took its cases with it — the entity list and
// drift report to entities-palette.test.tsx (F4.5a Task 10), the brush and swatch strip to
// tool-strip.test.tsx and the arming to tool-rail.test.tsx (Task 8), the stamp session to
// session-card.test.tsx (Task 10), the advisor's findings to flags-palette.test.tsx and the
// selection footer to shell.test.tsx (Task 13). What is left is what was never the panel's:
// the two claims above. Renamed rather than deleted, because deleting it would have taken
// them with it.

import { afterEach, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import type { FieldTool, FlagsSummary } from "../../src/field-host/index.ts";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { Toasts } from "../../src/frontend/components/shell/Toasts.tsx";
import { CatalogProvider } from "../../src/frontend/hooks/useCatalogs.tsx";
import {
	createCell,
	FieldHostStateProvider,
	useCameraPose,
	useFieldEntities,
	useFieldEntitySelection,
	useFieldHistory,
	useFieldHostState,
	useFieldSegmentHud,
	useFieldSelection,
	useFieldStamp,
	useFieldTool,
} from "../../src/frontend/hooks/useFieldHostState.tsx";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import type { EntityCatalog } from "../../src/shared/catalog.ts";
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
 *  `<FieldHostStateProvider />` is not scenery either: every `useField*` hook reads its
 *  context (the host handle plus the chrome-owned cells), so without it a hook throws and
 *  a `stub.fire.tool` / `.selection` / `.stamp` / `.flags` reaches nothing at all — every
 *  case below would be asserting about a surface wired to a dead host. This is also the
 *  arrangement the real editor mounts, which is what makes these cases claims about the
 *  product rather than about a fixture.
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

/** Mount the provider stack with NOTHING inside it. That is not a placeholder — it is the
 *  subject: the catalog pass and the shell's three seam claims belong to the PROVIDERS, and
 *  a render with no surface in it is what proves they do not depend on one — and, since the
 *  collapse, that the other ten do. The seam case re-renders a reader over this same empty
 *  child and then swaps it back out, which is what makes all three of its halves
 *  discriminating. */
async function renderProviders(stub: ReturnType<typeof makeStubHost>) {
	const result = render(withEditor(<span />, stub));
	await flushCatalog();
	return result;
}

/** A toast row's text, SCOPED to the stack. The toast layer also publishes two
 *  persistent announcement regions carrying the same string (the house live-region
 *  pattern — see Toasts), so an unscoped `getByText` is ambiguous by design. */
const toastText = (text: string | RegExp): HTMLElement =>
	within(screen.getByRole("list", { name: "notifications" })).getByText(text);

// The one-claimant rule, pinned from the side that would break it. A panel that subscribed
// to a seam the shell owned used to STEAL it — no throw, no warning, the shell surface just
// stopped updating. Multicast retired that failure, and T3b1 Task 7 then made a second
// mirror the normal arrangement: each surface latches the seams it reads, so the status bar
// and the action registry both hold the stats seam by design.
//
// What is left to get wrong is a mirror that OUTLIVES its surface — the unmounted tree
// keeps being pushed at, the work keeps being done, and nothing anywhere says so. Plus the
// split itself: a seam that crept back into the provider would put its cost on every
// surface again, and a latch that subscribed with no reader would put it on a closed
// palette.
//
// Every seam, with the push that reports how many subscribers it reaches. Quantified rather
// than spelled out case by case: the point is that the set is CLOSED, and a fourteenth seam
// nobody accounted for is exactly what this must catch.
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
		[
			"segmentHud",
			stub.calls.subscribeSegmentHud,
			() => stub.fire.segmentHud(null),
		],
	] as const;

// The stub's own contract, asserted rather than asserted-in-a-comment. Every one of its
// thirteen unsubscribes removes ONLY its own subscriber, exactly as all thirteen of the
// production host's do — they are the same `createViewChannel` release on both sides.
//
// The React shape it defends: on a dep change the effect BODY runs before the previous
// cleanup, so the new subscriber is added and the OLD cleanup then runs. A release keyed
// to anything but the callback identity takes the new subscriber with it and the seam
// goes silent with nothing thrown; that is what the single-slot era got wrong four times
// over (toolError, drift, entities, stats, unguarded until F4.5b Task 14). The ownership
// case below cannot see it — it swaps the CHILD under a provider that stays, so the
// provider's cleanups never run at all.
test("every stub release frees only its own subscriber, like all thirteen of the host's", () => {
	const stub = makeStubHost();
	/** A FRESH do-nothing subscriber per call. Sharing one closure across the two
	 *  subscribes would make `cbs.x === cb` true for the stale cleanup and the guard would
	 *  read as absent — a probe that destroys exactly what it measures. (It did: the first
	 *  cut hoisted a single `noop` and the case failed for that reason, not for the
	 *  seam's.) This case is about the SLOT, never the payload. */
	const noop = (): (() => void) => (): void => undefined;
	/** How many subscribers the seam should have after the sequence below: the stale one
	 *  is gone, the fresh one stands. */
	const SURVIVOR = 1;
	const seams = [
		[
			"toolError",
			() => stub.host.subscribeToolError(noop()),
			() => stub.fire.toolError("x"),
		],
		[
			"drift",
			() => stub.host.subscribeDrift(noop()),
			() => stub.fire.drift(null),
		],
		[
			"entities",
			() => stub.host.subscribeEntities(noop()),
			() => stub.fire.entities(),
		],
		[
			"stats",
			() => stub.host.subscribeStats(noop()),
			() => stub.fire.stats(makeStats()),
		],
		// The newest slot rides here from the day it lands rather than being added after
		// it breaks, which is the only difference between this list and the four above.
		[
			"segmentHud",
			() => stub.host.subscribeSegmentHud(noop()),
			() => stub.fire.segmentHud(null),
		],
	] as const;
	for (const [name, subscribe, push] of seams) {
		const stale = subscribe();
		subscribe(); // the new subscriber joins…
		stale(); // …and the OLD cleanup runs after it
		// One survivor, not zero and not two: the stale release took its own subscriber
		// and nothing else. A release keyed to the slot rather than the callback reads
		// as 0 here; one that did nothing at all reads as 2.
		expect([name, push()]).toEqual([name, SURVIVOR]);
	}
});

// The same release contract, for the CHROME's own cells — the six values with no host
// seam behind them (`gesture`, `tool`, `radius`, `flags`, `filters`, `verifying`). They are
// latched by the same `useSeam` the host seams are, so they are exposed to the same leak
// class, and the case above does not reach them: it counts subscribers on the STUB HOST's
// channels, and a cell is not one.
//
// The React half needs no case of its own and deliberately does not get one: `useSeam`
// hands `useSyncExternalStore` whatever `connect` returned, so if React runs the release on
// unmount for the ten host seams — which the counts above prove — it runs it for the cells
// too, through identical code. What that leaves untested is the cell's OWN release body,
// which is pure and framework-free, so it is tested that way. (Sabotage-proven: making the
// release a no-op fails this and nothing else in the suite.)
test("a cell frees only its own subscriber, and does so idempotently", () => {
	const cell = createCell("a");
	const heard: string[] = [];
	const offA = cell.subscribe((v) => heard.push(`A:${v}`));
	const offB = cell.subscribe((v) => heard.push(`B:${v}`));
	// Push-on-subscribe reaches the ARRIVING subscriber and nobody else — B's mount must
	// not re-deliver to A, which on a real mirror would be a spurious re-render of a
	// surface that changed nothing.
	expect(heard).toEqual(["A:a", "B:a"]);
	expect(cell.size()).toBe(2);

	// ONLY its own, and calling it twice is a no-op — the `view-channel.ts` contract, and
	// the property that makes React's effect re-run safe by construction: the new subscribe
	// runs BEFORE the previous cleanup, so a release keyed to anything but the callback
	// identity takes the NEW subscriber with it and the value goes silent with nothing
	// thrown.
	offA();
	offA();
	expect(cell.size()).toBe(1);
	heard.length = 0;
	cell.write("b");
	expect(heard).toEqual(["B:b"]);

	// Back to nobody, which is the leak assertion: a count that does not return to zero is
	// an unmounted surface's latch still being written to, and it has no other symptom.
	offB();
	expect(cell.size()).toBe(0);
	cell.write("c");
	expect(heard).toEqual(["B:b"]);
});

/** The three seams the SHELL owns, and the ten every other row belongs to a reader.
 *  The split is not a preference — each of the three is forced (T3b1 Task 7):
 *  `tool` writes the shared tool/radius cells (`FieldHost.setTool` publishes nothing, so
 *  a per-reader copy would never hear the strip's own change), `toolError` posts a toast
 *  that belongs to no one surface, and `flags` releases an in-flight verify that has to
 *  keep being released while the flags palette is CLOSED. */
const SHELL_SEAMS: ReadonlySet<string> = new Set([
	"tool",
	"toolError",
	"flags",
]);

/** One surface reading every LATCHED seam, so the case below can watch all ten arrive
 *  with a reader and leave with it. `useFieldTool` is here for `pendingStamp` — the one
 *  value in its shape the host really does push back — and `useFieldEntities` covers the
 *  entity PAIR. */
function AllSeamsProbe() {
	useFieldHostState();
	useCameraPose();
	useFieldEntities();
	useFieldEntitySelection();
	useFieldSelection();
	useFieldStamp();
	useFieldSegmentHud();
	useFieldHistory();
	useFieldTool();
	return <span />;
}

test("every host seam has ONE claimant: three the shell's, ten their readers'", async () => {
	fetch404();
	const stub = makeStubHost();
	const { rerender } = await renderProviders(stub);

	// (1) With NOTHING reading, the shell's three are claimed and the other ten are not.
	// A latch that subscribed without a reader would read as 1 here — which is the old
	// arrangement creeping back, and the cost the collapse bought is exactly that a
	// closed palette pays nothing.
	for (const [name, claim] of seamsOf(stub))
		expect([name, claim.mock.calls.length]).toEqual([
			name,
			SHELL_SEAMS.has(name) ? 1 : 0,
		]);

	// (2) A reader mounts and every seam delivers to EXACTLY ONE subscriber — the ten to
	// the probe, the three to the provider above it. Exactly one, not "at least one": a
	// hook that subscribed twice to the seam it reads would show up here and nowhere else.
	rerender(withEditor(<AllSeamsProbe />, stub));
	for (const [name, , push] of seamsOf(stub)) {
		let delivered = 0;
		act(() => {
			delivered = push();
		});
		expect([name, delivered]).toEqual([name, 1]);
	}

	// (3) …and the reader takes its ten with it. THIS is the claim the one-owner rule
	// became: a duplicate mirror is the normal arrangement on a multicast seam, but a
	// mirror that outlives its surface is a leak with no other symptom — the unmounted
	// tree just keeps being pushed at. The child is a `<div />` so the swap is a real
	// unmount rather than a re-render of the same element type, and the provider stays
	// mounted throughout, which is what makes the three that hold at 1 discriminating.
	rerender(withEditor(<div />, stub));
	for (const [name, , push] of seamsOf(stub)) {
		let delivered = 0;
		act(() => {
			delivered = push();
		});
		expect([name, delivered]).toEqual([name, SHELL_SEAMS.has(name) ? 1 : 0]);
	}
});

// --- the catalog pass: what each GET installs, and what it says ---------------
//
// The ORDERING is what these pin, and it is a property of the chrome that host-level
// tests cannot reproduce: a surface reads `host.listGenerators()` at engine-ready —
// SYNCHRONOUSLY, in an effect body — while `CatalogProvider` installs the entity catalog
// only after `await fetch(...)`. So a schema captured at ready is always captured BEFORE
// the catalog exists. Host tests call `setEntityCatalog` first, which is exactly the order
// the chrome does not produce. The consuming half of that — the `archetypeId` control
// becoming a picker once the catalog lands — moved to session-card.test.tsx with the form
// that renders it; what stays here is the install itself.

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
	await renderProviders(stub);
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
	await renderProviders(stub);
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

test("a 404 ANSWERS the question — the host is told there is none, quietly", async () => {
	// A project with no agent profile is a legitimate one (the editor is
	// project-first). The host reports "advisor idle" ONCE at the first edit that
	// would have analysed, which is a better moment than load; a second message
	// here would be noise on a line that has already said what happened.
	//
	// But it can only say it once it KNOWS, and a 404 is the only outcome that
	// knows: the host's own `agentProfile === null` reads the same before any
	// answer as after this one. So the negative travels the same seam the positive
	// does — `setAgentProfile(null)` — and the host stays silent until it lands.
	stubCatalogs({ materials: CATALOG_JSON });
	const stub = makeStubHost();
	await renderProviders(stub);
	await waitFor(() =>
		expect(stub.calls.setAgentProfile.mock.calls).toEqual([[null]]),
	);
	await waitFor(() => expect(toastText(/materials: /)).toBeTruthy());
	expect(
		within(screen.getByRole("list", { name: "notifications" })).queryByText(
			/agent/,
		),
	).toBeNull();
});

test("an agent fetch that FAILED answers nothing — the host is left unanswered", async () => {
	// The rule, in one line: `setAgentProfile(null)` asserts *this project has no
	// agent profile*, and only a 404 knows that. A 500 says the daemon could not
	// answer — the project may well ship a perfectly good one — so passing null
	// here would put the advisor's "this project installs no agent profile" into
	// the user's face over a project that does. The failure already said what
	// happened, with the status in it; the advisor adds a worse account of it.
	stubFetch((url) =>
		Promise.resolve(
			url.includes("agent.json")
				? new Response("", { status: 500 })
				: new Response(CATALOG_JSON, { status: 200 }),
		),
	);
	const stub = makeStubHost();
	await renderProviders(stub);
	await waitFor(() =>
		expect(toastText(/agent fetch failed \(500\)/)).toBeTruthy(),
	);
	expect(stub.calls.setAgentProfile.mock.calls).toEqual([]);
});

test("a MALFORMED agent catalog is setup-loud and costs the other two nothing", async () => {
	stubCatalogs({
		materials: CATALOG_JSON,
		entities: ENTITIES_JSON,
		agent: JSON.stringify({ version: 1, capsule: { radius: 0.3 } }),
	});
	const stub = makeStubHost();
	await renderProviders(stub);
	// The JSON path is in the line, so a mistyped catalog is diagnosable from the
	// panel rather than from a pass that silently never ran.
	await waitFor(() => expect(toastText(/capsule\.halfHeight/)).toBeTruthy());
	// Not `[[null]]` — the same rule as the 500 above, from the other side: this
	// project DOES install an agent profile, it is just unusable. Answering "there
	// is none" would be the one thing the loader positively knows to be false.
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
	await renderProviders(stub);
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
// scroll. `FieldPanel` rendered `null` from Task 13, and Task 14 deleted it along with the
// `controls` palette id, its default geometry, its burger checkbox and its rail chip.
