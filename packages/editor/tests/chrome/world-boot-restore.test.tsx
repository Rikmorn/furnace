// Registered FIRST, before any other import — the chrome directory's ordering rule
// (@testing-library binds `screen` at MODULE EVALUATION time, and Radix reads
// `globalThis.document` then too). Nothing here opens a Radix surface, but the confirm
// dialog is one context away and the failure mode is silent.
import "../inspector/_register.ts";

// The BOOT RESTORE (F4.5b Task 14): the editor reopens the world the last session left,
// and the several ways it must refuse to. `lastWorld` was write-only until this slice —
// what is pinned here is that reading it back can never cost the user work.
//
// …and the restore's OTHER outcome, the first-run hint (F4.5c Task 6): when there is
// nothing to reopen, what stays on screen is a brand-new world, and section (d) pins that
// it is told so exactly once. It lives here rather than beside the drawer because the
// decision does — one effect settles both, which is the only way "once per boot" holds.
//
// Mounted the way the shell mounts it: the host-state mirror (whose stats the dirty bit
// is derived from), then the catalogs (whose materials settle gates every Open, boot's
// included), then the world state. ViewProvider is absent on purpose — nothing on this
// path reads it, and a provider a case does not need is failure surface it does not own.
import { afterEach, expect, mock, test } from "bun:test";
import { useMemo } from "react";
import type { ConfirmRequest } from "../../src/frontend/components/ConfirmDialog.tsx";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { CatalogProvider } from "../../src/frontend/hooks/useCatalogs.tsx";
import { FieldHostStateProvider } from "../../src/frontend/hooks/useFieldHostState.tsx";
import {
	useWorldActions,
	useWorldState,
	WorldProvider,
} from "../../src/frontend/hooks/useWorld.tsx";
import type { WorldRow } from "../../src/frontend/lib/api.ts";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import type { UiStore } from "../../src/frontend/lib/persist.ts";
import {
	act,
	cleanup,
	fakeUiStore,
	fireEvent,
	makeEditorContext,
	render,
	screen,
	waitFor,
} from "../inspector/_harness.tsx";
import { makeStats, makeStubHost } from "./_stub-host.ts";

afterEach(cleanup);
afterEach(() => notify.clear());

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

// --- the daemon, stubbed at the fetch boundary --------------------------------

type Posted = { command: string; input: unknown };

const row = (over: Partial<WorldRow> = {}): WorldRow => ({
	name: "cavern",
	kind: "field",
	isDefault: false,
	tracked: null,
	manifestMtimeMs: Date.now(),
	...over,
});

/** Two chunks, so the load's own toast carries a number a case can read back. */
const LOADED = {
	manifest: { version: 2, cellSize: 0.25 },
	chunks: [
		{ key: "0,0,0", data: "AQID" },
		{ key: "1,0,0", data: "BAUG" },
	],
	materials: [],
	oplog: '{"ops":[]}',
};

/** Serve `/api/*` from `worlds` and record every command; 404 the catalog GETs.
 *
 *  The three holds are the three windows this file is about. `holdCatalog` keeps the
 *  materials fetch unsettled, which is the BOOT window itself — the restore waits for
 *  that settle, so holding it is how a case digs, or names a world, before the restore
 *  has decided. `holdList` keeps the restore's own `world.list` round trip open, which is
 *  the narrower window the same edit can land in. `holdLoad` keeps `field.load` in
 *  flight, which is where the in-flight readout is visible. */
function stubDaemon(
	opts: {
		worlds?: WorldRow[];
		holdCatalog?: boolean;
		holdList?: boolean;
		holdLoad?: boolean;
	} = {},
) {
	const posted: Posted[] = [];
	const held: Record<"catalog" | "list" | "load", ((r: Response) => void)[]> = {
		catalog: [],
		list: [],
		load: [],
	};
	const json = (body: unknown): Response =>
		new Response(JSON.stringify(body), { status: 200 });
	const worldList = () => ({ defaultName: null, worlds: opts.worlds ?? [] });

	globalThis.fetch = mock((input: unknown, init?: RequestInit) => {
		const url = String(input);
		if (url === "/catalog/materials.json") {
			if (!opts.holdCatalog)
				return Promise.resolve(new Response("", { status: 404 }));
			return new Promise<Response>((res) => held.catalog.push(res));
		}
		if (!url.startsWith("/api/"))
			return Promise.resolve(new Response("", { status: 404 }));
		const command = url.slice("/api/".length);
		posted.push({
			command,
			input: JSON.parse(String(init?.body ?? "null")) as unknown,
		});
		if (command === "world.list") {
			if (!opts.holdList) return Promise.resolve(json(worldList()));
			return new Promise<Response>((res) => held.list.push(res));
		}
		if (command === "field.load") {
			if (!opts.holdLoad) return Promise.resolve(json(LOADED));
			return new Promise<Response>((res) => held.load.push(res));
		}
		if (command === "generation.bake")
			return Promise.resolve(json({ files: 3 }));
		return Promise.resolve(json({}));
	}) as unknown as typeof fetch;

	const settle = (
		which: "catalog" | "list" | "load",
		make: () => Response,
	): void => {
		for (const res of held[which].splice(0)) res(make());
	};
	return {
		posted,
		commands: () => posted.map((p) => p.command),
		countOf: (command: string) =>
			posted.filter((p) => p.command === command).length,
		inputFor: (command: string) =>
			posted.find((p) => p.command === command)?.input,
		/** 404 is an outcome like any other — every one settles the gate. */
		releaseCatalog: () =>
			settle("catalog", () => new Response("", { status: 404 })),
		releaseList: () => settle("list", () => json(worldList())),
		releaseLoad: () => settle("load", () => json(LOADED)),
	};
}

// --- mounting -----------------------------------------------------------------

/** What the world state reads as, as text. A probe rather than the top bar: the subject
 *  here is the restore, and the chip's own rendering is pinned in world-drawer.test.tsx.
 *  The button is how a case names the session the way a user does. */
function WorldProbe() {
	const { name, dirty, job } = useWorldState();
	const { saveAs } = useWorldActions();
	return (
		<>
			<span>{`world:${name ?? "untitled"}`}</span>
			<span>{`dirty:${dirty}`}</span>
			<span>{`job:${job ?? "none"}`}</span>
			<button type="button" onClick={() => saveAs("scratch")}>
				save as scratch
			</button>
		</>
	);
}

// biome-ignore lint/suspicious/noEmptyBlockStatements: inert test no-op
const noConfirm = (_: ConfirmRequest) => {};

function Boot({
	stub,
	store,
	openConfirm = noConfirm,
}: {
	stub: ReturnType<typeof makeStubHost>;
	store: UiStore | undefined;
	openConfirm?: (r: ConfirmRequest) => void;
}) {
	// Memoised on the store: a fresh context value per render would hand the providers new
	// refs every time and blur exactly the distinction the once-per-boot case draws —
	// between a re-render and a genuinely new store arriving.
	const ctx = useMemo(
		() =>
			makeEditorContext({
				fieldHostRef: { current: stub.host },
				store,
				openConfirm,
			}),
		[stub, store, openConfirm],
	);
	return (
		<EditorContext.Provider value={ctx}>
			<FieldHostStateProvider host={stub.host} engineReady>
				<CatalogProvider>
					<WorldProvider>
						<WorldProbe />
					</WorldProvider>
				</CatalogProvider>
			</FieldHostStateProvider>
		</EditorContext.Provider>
	);
}

/** Let the chains behind a settle run out. Generous on purpose: a restore is a catalog
 *  settle → `world.list` → `field.load` chain, each leg with its own `Response.json()`
 *  hop, and the negative cases have to outlast all of it. */
async function flush(): Promise<void> {
	await act(async () => {
		for (let i = 0; i < 12; i++) await Promise.resolve();
	});
}

const logText = (): string[] => notify.getSnapshot().log.map((m) => m.text);

/** The first-run hint, and how MANY times it was posted. A count rather than a presence
 *  check, deliberately: a hint that fires on every render passes a presence assertion
 *  exactly as well as one that fires once, and the store dedupes nothing. */
const FIRST_RUN_HINT = "new world — dig into the rock, then ⌘S to save";
const hintCount = (): number =>
	logText().filter((t) => t === FIRST_RUN_HINT).length;

/** Seed the dirty-bit baseline, then move it: the FIRST push is the count the world
 *  already had (never an edit), the second is one op of divergence from it. */
function makeDirty(stub: ReturnType<typeof makeStubHost>, ops: number): void {
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 0 }));
	});
	act(() => {
		stub.fire.stats(makeStats({ totalOps: ops, undoDepth: ops }));
	});
}

/** Save the session under a name, the way the drawer's form does. */
async function saveAsScratch(): Promise<void> {
	await act(async () => {
		fireEvent.click(screen.getByText("save as scratch"));
		for (let i = 0; i < 6; i++) await Promise.resolve();
	});
}

// --- (a) it happens -----------------------------------------------------------

test("boot reopens the world the last session left, through the ordinary Open", async () => {
	const daemon = stubDaemon({
		worlds: [row({ name: "cavern" })],
		holdCatalog: true,
		holdLoad: true,
	});
	const stub = makeStubHost();
	render(<Boot stub={stub} store={fakeUiStore({ lastWorld: "cavern" })} />);
	// The baseline the real host pushes on its first frame, long before any catalog
	// settles. Zero ops: an untouched scratch.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 0 }));
	});

	// NOTHING has been asked of the daemon yet. A v2 world remeshes against the material
	// table it was baked with, and boot is where a load racing that fetch is certain
	// rather than rare — the same gate the drawer puts in front of its Load button.
	await flush();
	expect(daemon.commands()).not.toContain("world.list");

	daemon.releaseCatalog();
	await waitFor(() =>
		expect(daemon.inputFor("field.load")).toEqual({ name: "cavern" }),
	);
	// WHILE it loads, the user sees what a user-driven Open shows: the controls are busy,
	// and the state names the verb the status bar puts on its progress chip. (D-19 —
	// in-flight is said at the controls and on the bar, never in a toast.)
	expect(screen.getByText("job:open")).toBeTruthy();

	daemon.releaseLoad();
	await waitFor(() => screen.getByText("world:cavern"));
	expect(screen.getByText("job:none")).toBeTruthy();
	expect(logText()).toContain("loaded cavern (2 chunks)");

	// REBASELINED like any other Open: the next stats push carries the LOADED world's op
	// count, and adopting it must read as the new save point rather than as an edit.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 7, undoDepth: 7 }));
	});
	expect(screen.getByText("dirty:false")).toBeTruthy();

	// A save rewrites `lastWorld` and rebuilds the verbs this effect depends on, so it is
	// the most likely accidental re-trigger there is. (Belt and braces: on THIS path the
	// named-session guard holds the door too — the one-shot's own proof is the skip case
	// below, where the session stays untitled.)
	await saveAsScratch();
	await waitFor(() => screen.getByText("world:scratch"));
	await flush();
	expect(daemon.countOf("field.load")).toBe(1);
});

test("a store that arrives after the catalog still restores", async () => {
	// The real ordering is not guaranteed either way: the store is keyed by the project
	// root, which comes from an async `project.get`, and the catalog is its own fetch. A
	// one-shot spent on the render where the store was still missing would mean the
	// restore silently never happens on the slower half of the boots.
	const daemon = stubDaemon({ worlds: [row({ name: "cavern" })] });
	const stub = makeStubHost();
	const { rerender } = render(<Boot stub={stub} store={undefined} />);
	await waitFor(() => expect(logText()).toContain("no catalog — rock only"));
	expect(daemon.commands()).not.toContain("world.list");

	rerender(<Boot stub={stub} store={fakeUiStore({ lastWorld: "cavern" })} />);
	await waitFor(() => screen.getByText("world:cavern"));
	expect(daemon.inputFor("field.load")).toEqual({ name: "cavern" });
});

// --- (b) it skips, and every skip is silent -----------------------------------

test("a lastWorld the daemon no longer lists is skipped, silently", async () => {
	// Deleted, renamed, or gone with a branch switch between sessions.
	const daemon = stubDaemon({ worlds: [row({ name: "grotto" })] });
	const stub = makeStubHost();
	render(<Boot stub={stub} store={fakeUiStore({ lastWorld: "cavern" })} />);

	await waitFor(() => expect(daemon.commands()).toContain("world.list"));
	await flush();
	expect(daemon.commands()).not.toContain("field.load");
	expect(screen.getByText("world:untitled")).toBeTruthy();
	// SILENT. Nobody asked for this open, so a world the user themselves deleted is not
	// an error to raise at the one moment the editor is coming up — and the untitled
	// scratch on screen already says what happened.
	expect(logText().join("|")).not.toContain("cavern");
});

test("a dirty scratch keeps its work — the restore is dropped, not confirmed", async () => {
	const daemon = stubDaemon({
		worlds: [row({ name: "cavern" })],
		holdCatalog: true,
	});
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	render(
		<Boot
			stub={stub}
			store={fakeUiStore({ lastWorld: "cavern" })}
			openConfirm={(r) => {
				request = r;
			}}
		/>,
	);
	// The window is real: the store arrives from an async `project.get` and the catalog
	// settles later still, so the user can dig into the untitled scratch before the
	// restore has decided anything.
	makeDirty(stub, 3);

	daemon.releaseCatalog();
	await waitFor(() => expect(logText()).toContain("no catalog — rock only"));
	await flush();
	// Not even the LIST is asked for: the decision is made before the round trip.
	expect(daemon.commands()).not.toContain("world.list");
	expect(screen.getByText("dirty:true")).toBeTruthy();
	// DROPPED, not confirmed. An unrequested prompt at boot, asking whether to discard
	// work the user did seconds ago, is a worse answer than leaving them where they are.
	expect(request === null).toBe(true);
});

test("an op landing during the world.list round trip wins — the restore is dropped", async () => {
	const daemon = stubDaemon({
		worlds: [row({ name: "cavern" })],
		holdCatalog: true,
		holdList: true,
	});
	const stub = makeStubHost();
	render(<Boot stub={stub} store={fakeUiStore({ lastWorld: "cavern" })} />);
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 0 }));
	});

	// Decided on a CLEAN session, then it waits on the daemon.
	daemon.releaseCatalog();
	await waitFor(() => expect(daemon.commands()).toContain("world.list"));

	// One dig inside that window. `dirty` in the decision's own closure is still false,
	// and so is the copy the verbs closed over — the live op count is the only witness.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 2, undoDepth: 2 }));
	});
	daemon.releaseList();
	await flush();
	expect(daemon.commands()).not.toContain("field.load");
	expect(screen.getByText("dirty:true")).toBeTruthy();
});

test("a session that has already been named is left where it is", async () => {
	// `project.get` has not resolved, so persistence is off and this save writes no
	// `lastWorld` — the blob still names the PREVIOUS session's world. Adopting it would
	// swap the world out from under one the user has just named.
	const daemon = stubDaemon({
		worlds: [row({ name: "cavern" }), row({ name: "scratch" })],
	});
	const stub = makeStubHost();
	const { rerender } = render(<Boot stub={stub} store={undefined} />);
	await waitFor(() => expect(logText()).toContain("no catalog — rock only"));
	await saveAsScratch();
	await waitFor(() => screen.getByText("world:scratch"));

	rerender(<Boot stub={stub} store={fakeUiStore({ lastWorld: "cavern" })} />);
	await flush();
	expect(daemon.commands()).not.toContain("field.load");
	expect(screen.getByText("world:scratch")).toBeTruthy();
});

// --- (c) once per boot ---------------------------------------------------------

test("the restore is decided ONCE per boot — a second store arrival does not ask again", async () => {
	// The SKIP path is where the one-shot earns its keep: the session stays untitled and
	// clean, so nothing else would stop a re-run — and a world that appears in the list
	// later (another process, a branch switch) would then be opened over a live session.
	const daemon = stubDaemon({ worlds: [] });
	const stub = makeStubHost();
	const { rerender } = render(
		<Boot stub={stub} store={fakeUiStore({ lastWorld: "cavern" })} />,
	);
	await waitFor(() => expect(daemon.countOf("world.list")).toBe(1));

	rerender(<Boot stub={stub} store={fakeUiStore({ lastWorld: "cavern" })} />);
	await flush();
	expect(daemon.countOf("world.list")).toBe(1);

	// A stats push re-renders the provider and rebuilds the verbs the effect depends on.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 0 }));
	});
	await flush();
	expect(daemon.countOf("world.list")).toBe(1);
	expect(screen.getByText("world:untitled")).toBeTruthy();
});

// --- (d) the FIRST-RUN hint: the restore's other outcome -----------------------
//
// D-21's "new = untitled scratch, name at first save", said out loud once. A boot with
// nothing to reopen lands on solid rock with no world named and no control pressed,
// which is indistinguishable from a broken editor until something says otherwise. It
// rides the restore's own decision because that is the instant all three facts settle
// together — the catalog gate, the session's emptiness, and the restore declining.

test("a boot with nothing to reopen says what to do — ONCE per boot", async () => {
	const daemon = stubDaemon({ worlds: [] });
	const stub = makeStubHost();
	const { rerender } = render(<Boot stub={stub} store={fakeUiStore()} />);
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 0 }));
	});

	await waitFor(() => expect(hintCount()).toBe(1));
	// No `lastWorld` at all: the decision short-circuits before the round trip, so a
	// first-ever boot does not pay for a list it has nothing to look up in.
	expect(daemon.commands()).not.toContain("world.list");

	// A NEW store object rebuilds the context and re-runs the effect — the same shape as
	// the once-per-boot case above, and the only thing standing between this hint and a
	// second copy of itself.
	rerender(<Boot stub={stub} store={fakeUiStore()} />);
	await flush();
	expect(hintCount()).toBe(1);

	// …and so does a dig, which flips `dirty` and rebuilds the verbs the effect depends on.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 1, undoDepth: 1 }));
	});
	await flush();
	expect(hintCount()).toBe(1);
});

test("a boot that REOPENS a world says nothing about new rock", async () => {
	// The hint would be contradicted by the world arriving a moment later — which is why
	// it is posted from inside the restore's decision rather than from an effect of its
	// own that could win the race.
	const daemon = stubDaemon({
		worlds: [row({ name: "cavern" })],
		holdLoad: true,
	});
	const stub = makeStubHost();
	render(<Boot stub={stub} store={fakeUiStore({ lastWorld: "cavern" })} />);
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 0 }));
	});

	await waitFor(() =>
		expect(daemon.inputFor("field.load")).toEqual({ name: "cavern" }),
	);
	// Nothing while it loads, either: the hint is decided before the load starts, so a
	// late one would already be too late to be about anything.
	expect(hintCount()).toBe(0);
	daemon.releaseLoad();
	await waitFor(() => screen.getByText("world:cavern"));
	await flush();
	expect(hintCount()).toBe(0);
});

test("a boot into a session that already has ops is not a first run", async () => {
	// The case `dirty` alone cannot tell apart: ONE stats push seeds the baseline rather
	// than marking an edit, so the session reads CLEAN while plainly not being empty.
	const daemon = stubDaemon({ worlds: [], holdCatalog: true });
	const stub = makeStubHost();
	render(<Boot stub={stub} store={fakeUiStore()} />);
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 5, undoDepth: 5 }));
	});

	daemon.releaseCatalog();
	await waitFor(() => expect(logText()).toContain("no catalog — rock only"));
	await flush();
	expect(screen.getByText("dirty:false")).toBeTruthy();
	expect(hintCount()).toBe(0);
});
