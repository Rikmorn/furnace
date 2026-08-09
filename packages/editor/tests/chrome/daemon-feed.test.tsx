// Registered FIRST, before any other import in this file, and that ordering is
// load-bearing rather than style: Radix resolves `globalThis.document` at MODULE
// EVALUATION time to decide whether it may use layout effects, and its Portal never
// mounts if the answer was no. The drawer this file drives IS a portal (a Dialog), so
// importing it before the DOM exists leaves every case here asserting about an empty
// document.
import "../inspector/_register.ts";

// The daemon's SSE feed, end to end: a frame arrives on the EventSource, and either an
// open world list re-reads the directory or the page reloads for a stale engine bundle.
//
// Driven through the REAL `subscribeEvents` (a fake EventSource stands in for the
// browser's, since happy-dom has none) and the REAL `api.worldList` over a stubbed
// fetch — the two ends of the chain are exactly the ones that break silently: an event
// name the daemon stopped emitting, and a refetch trigger nothing re-reads.
//
// What this file cannot reach is App itself: it owns the WebGPU probe and the dynamic
// import of /engine.js, neither of which reaches `ready` outside a browser (Shell's
// header states the same boundary). `useDaemonFeed` is the seam that moves the feed
// below it; App's remaining share is the one line that hands the counter to the context,
// mirrored by `Feed` below.
import { afterEach, expect, test } from "bun:test";
import type { RefObject } from "react";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { TopBar } from "../../src/frontend/components/shell/TopBar.tsx";
import { ActionContextProvider } from "../../src/frontend/hooks/useActionContext.tsx";
import { CatalogProvider } from "../../src/frontend/hooks/useCatalogs.tsx";
import { useDaemonFeed } from "../../src/frontend/hooks/useDaemonFeed.ts";
import { FieldHostStateProvider } from "../../src/frontend/hooks/useFieldHostState.tsx";
import type { SessionFeed } from "../../src/frontend/hooks/useSessionClaim.ts";
import { ViewProvider } from "../../src/frontend/hooks/useView.tsx";
import { WorkspaceProvider } from "../../src/frontend/hooks/useWorkspace.tsx";
import { WorldProvider } from "../../src/frontend/hooks/useWorld.tsx";
import type { WorldRow } from "../../src/frontend/lib/api.ts";
import type { ServerEvent } from "../../src/frontend/lib/events.ts";
import { notify } from "../../src/frontend/lib/notify-store.ts";
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
import { makeStubHost } from "./_stub-host.ts";

/** The session claim, INERT. This file is about the feed's own two jobs — the refetch
 *  trigger and the reload guard — and the claim rides the same subscription without
 *  touching either. Its own chain (token frame → claim → steal → the lost cover) is
 *  driven end to end in `tests/chrome/session-claim.test.tsx`, where a case can stub the
 *  daemon's answer; wiring the real hook here would post a `session.claim` through this
 *  file's world-list stub on every case that emits a token, and none of them emits one.
 *  Module-level, so it satisfies the stability contract `useDaemonFeed` states. */
const inertSession: SessionFeed = {
	onOpen: () => undefined,
	onToken: () => undefined,
	onLost: () => undefined,
};

/** The backchannel's answerer, inert for the same reason and under the same stability
 *  rule — module-level, so the feed's effect does not re-subscribe per render. The real
 *  answerer's chain (request frame → registry → `session.answer` POST) is driven in
 *  `tests/chrome/session-answer.test.tsx`. */
const inertAnswerer = () => undefined;

/** The two shell-owned modal openers (⌘K, and `?`'s shortcut overlay). These cases mount
 *  the TopBar alone, where neither surface is mounted, so both funnels are inert. */
const noopOpenPalette = () => undefined;

afterEach(cleanup);
afterEach(() => notify.clear());

// --- the browser's EventSource, faked ----------------------------------------
//
// happy-dom ships none (measured, this session), so without this `subscribeEvents`
// throws on `new EventSource` and the feed cannot be driven at all.

type Listener = (event: MessageEvent) => void;

class FakeEventSource {
	/** Every source constructed since the last reset — the feed opens exactly one, and
	 *  whether it opened at all is itself an assertion (the ready gate). */
	static live: FakeEventSource[] = [];
	readonly listeners = new Map<string, Listener[]>();
	onopen: (() => void) | null = null;
	closed = false;

	constructor(readonly url: string) {
		FakeEventSource.live.push(this);
	}

	addEventListener(type: string, fn: Listener): void {
		const list = this.listeners.get(type) ?? [];
		list.push(fn);
		this.listeners.set(type, list);
	}

	close(): void {
		this.closed = true;
	}

	/** Deliver one daemon frame the way the browser does: the event NAME selects the
	 *  listeners, the JSON rides in `data`. Both halves matter — the daemon writes
	 *  `event: <type>` and the serialized event, and a client listening on the wrong
	 *  name hears nothing at all. */
	emit(event: ServerEvent): void {
		const message = new MessageEvent(event.type, {
			data: JSON.stringify(event),
		});
		for (const fn of this.listeners.get(event.type) ?? []) fn(message);
	}
}

const realEventSource = globalThis.EventSource;
const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.EventSource = realEventSource;
	globalThis.fetch = realFetch;
	FakeEventSource.live = [];
	// Restores Location.prototype.reload by removing the own-property stub (see
	// stubReload) — a no-op in the cases that never installed one.
	delete (window.location as unknown as Record<string, unknown>)["reload"];
});

/** Install the fake and hand back the source the feed opens. */
function installEventSource(): void {
	// Boundary cast: the fake implements the three members `subscribeEvents` uses
	// (construct, addEventListener, close) and none of EventSource's constants.
	globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
}

/** The one source the feed opened, or a throw naming the failure — a case that emits
 *  into `undefined` would otherwise read as "the chain is broken" either way. */
function feedSource(): FakeEventSource {
	const source = FakeEventSource.live[0];
	if (!source) throw new Error("the feed opened no EventSource");
	return source;
}

/** Count the hard reloads instead of performing one. happy-dom's `reload` is a plain
 *  prototype method, so an own-property stub shadows it and `delete` puts it back. */
function stubReload(): () => number {
	let count = 0;
	Object.defineProperty(window.location, "reload", {
		value: () => {
			count++;
		},
		configurable: true,
	});
	return () => count;
}

// --- the daemon, stubbed at the fetch boundary --------------------------------

const row = (name: string): WorldRow => ({
	name,
	kind: "field",
	isDefault: false,
	tracked: null,
	manifestMtimeMs: Date.now(),
});

/** Serve `world.list` from a MUTABLE set and count the reads. Mutable because a refetch
 *  that returns the same rows proves nothing a stale render wouldn't: the case moves the
 *  directory under the drawer and then looks for the new world on screen. */
function stubDaemon(worlds: string[]) {
	let rows = worlds.map(row);
	let lists = 0;
	globalThis.fetch = ((input: unknown) => {
		const url = String(input);
		// The catalog GETs; a project without catalogs 404s, the quietest legitimate shape.
		if (!url.startsWith("/api/"))
			return Promise.resolve(new Response("", { status: 404 }));
		if (url === "/api/world.list") lists++;
		return Promise.resolve(
			new Response(JSON.stringify({ defaultName: null, worlds: rows }), {
				status: 200,
			}),
		);
	}) as unknown as typeof fetch;
	return {
		lists: () => lists,
		/** Move the worlds directory under the editor — a rename in another window, a git
		 *  checkout, or the editor's own verb landing on the daemon. */
		setWorlds: (next: string[]) => {
			rows = next.map(row);
		},
	};
}

// --- the tree under test ------------------------------------------------------

/** App's share of the chain, mirrored: the feed's counter goes into the editor context,
 *  and the world chip's drawer reads it from there. Everything below this component is
 *  the shell's real provider stack. */
function Feed({
	ready,
	bakeBusyRef,
	stub,
}: {
	ready: boolean;
	bakeBusyRef: RefObject<boolean>;
	stub: ReturnType<typeof makeStubHost>;
}) {
	const worldsVersion = useDaemonFeed(
		ready,
		bakeBusyRef,
		inertSession,
		inertAnswerer,
	);
	return (
		<EditorContext.Provider
			value={makeEditorContext({
				worldsVersion,
				bakeBusyRef,
				fieldHostRef: { current: stub.host },
			})}
		>
			<FieldHostStateProvider host={stub.host} engineReady>
				<ViewProvider host={stub.host} engineReady store={undefined}>
					{/* Above the world state, as the shell mounts it (the boot restore waits
					    for this provider's materials settle). */}
					<CatalogProvider>
						<WorldProvider>
							<WorkspaceProvider store={undefined}>
								{/* The burger's groups and the shortcut overlay render FROM the
								    action registry, so the bar needs the context that assembles it. */}
								<ActionContextProvider
									host={stub.host}
									openCommandPalette={noopOpenPalette}
									openShortcuts={noopOpenPalette}
								>
									<TopBar />
								</ActionContextProvider>
							</WorkspaceProvider>
						</WorldProvider>
					</CatalogProvider>
				</ViewProvider>
			</FieldHostStateProvider>
		</EditorContext.Provider>
	);
}

async function renderFeed(
	opts: { ready?: boolean; busy?: boolean } = {},
): Promise<ReturnType<typeof render>> {
	installEventSource();
	const stub = makeStubHost();
	const bakeBusyRef: RefObject<boolean> = { current: opts.busy ?? false };
	const result = render(
		<Feed ready={opts.ready ?? true} bakeBusyRef={bakeBusyRef} stub={stub} />,
	);
	// Let the catalog pass settle (fetch → res.text), or the drawer mounts mid-update.
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	return result;
}

/** Summon the drawer from the world chip and wait for its first list to land. */
async function openDrawer(first: string): Promise<HTMLElement> {
	act(() => {
		fireEvent.click(screen.getByRole("button", { name: /^untitled/ }));
	});
	const drawer = await waitFor(() => screen.getByRole("dialog"));
	await waitFor(() => within(drawer).getByText(first));
	return drawer;
}

/** Push one daemon frame into the live feed. */
function emit(event: ServerEvent): void {
	act(() => {
		feedSource().emit(event);
	});
}

// --- (a) the feed's lifetime --------------------------------------------------

test("the feed opens at engine-ready, once, and closes with the editor", async () => {
	installEventSource();
	const stub = makeStubHost();
	stubDaemon([]);
	const bakeBusyRef: RefObject<boolean> = { current: false };
	const { rerender, unmount } = render(
		<Feed ready={false} bakeBusyRef={bakeBusyRef} stub={stub} />,
	);
	// Nothing yet: a `bundle-outdated` reload before the editor is up would restart a
	// boot already in progress, and no world list exists to refresh.
	expect(FakeEventSource.live.length).toBe(0);

	await act(async () => {
		rerender(<Feed ready={true} bakeBusyRef={bakeBusyRef} stub={stub} />);
		await Promise.resolve();
	});
	expect(FakeEventSource.live.length).toBe(1);
	expect(feedSource().url).toBe("/api/events");

	unmount();
	// The unsubscribe is the effect's cleanup. Without it every remount leaves a live
	// source behind, and one daemon frame lands N times.
	expect(feedSource().closed).toBe(true);
});

// --- (b) worlds-changed → an open drawer re-reads the directory ---------------

test("an OPEN drawer re-lists when the daemon says the worlds directory moved", async () => {
	const daemon = stubDaemon(["cavern"]);
	await renderFeed();
	const drawer = await openDrawer("cavern");
	expect(daemon.lists()).toBe(1);

	// A rename in another editor, a git checkout, or this editor's own world verb: the
	// daemon emits the same dirty-bit for all three, carrying no payload.
	daemon.setWorlds(["cavern", "grotto"]);
	emit({ type: "worlds-changed" });

	// The new world is ON SCREEN — the assertion the call count alone cannot make. A
	// drawer that ticked its trigger but never re-rendered the rows is the failure this
	// whole chain exists to prevent.
	await waitFor(() => expect(within(drawer).getByText("grotto")).toBeTruthy());
	expect(daemon.lists()).toBe(2);
});

test("a bake that wrote a world re-lists the same way", async () => {
	const daemon = stubDaemon(["cavern"]);
	await renderFeed();
	const drawer = await openDrawer("cavern");
	expect(daemon.lists()).toBe(1);

	// `generation-baked` is the daemon's OTHER "worlds/ moved" event: the browser bakes
	// and uploads, the daemon writes the file set. A drawer listening only for
	// `worlds-changed` would show a world the user just saved as missing until reopened.
	daemon.setWorlds(["cavern", "fresh-bake"]);
	emit({ type: "generation-baked", files: 7 });
	await waitFor(() =>
		expect(within(drawer).getByText("fresh-bake")).toBeTruthy(),
	);
	expect(daemon.lists()).toBe(2);
});

// --- (c) the reload guard -----------------------------------------------------

test("bundle-outdated reloads the page — but NEVER over a world write in flight", async () => {
	stubDaemon([]);
	const reloads = stubReload();
	installEventSource();
	const stub = makeStubHost();
	// The ref the shell's world verbs hold for the duration of an upload.
	const bakeBusyRef: RefObject<boolean> = { current: true };
	render(<Feed ready={true} bakeBusyRef={bakeBusyRef} stub={stub} />);
	await act(async () => {
		await Promise.resolve();
	});

	emit({ type: "bundle-outdated" });
	// A reload here tears down the page between `exportArtifact` and its uploads: the
	// world is half-written and the session that could rewrite it is gone.
	expect(reloads()).toBe(0);

	// The write lands, and the same event is now free to act. Read through the REF, not
	// through a re-subscribe: the feed re-binds only when `ready` changes, so a handler
	// that captured `busy` as a value would refuse forever after one save.
	bakeBusyRef.current = false;
	emit({ type: "bundle-outdated" });
	expect(reloads()).toBe(1);
});
