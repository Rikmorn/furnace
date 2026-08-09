// Registered FIRST, before any other import — the `daemon-feed.test.tsx` ordering rule,
// for the same reason: the steal prompt IS a Radix Dialog, and Radix decides at module
// evaluation time whether it may use layout effects. Import it before the DOM exists and
// the portal never mounts, leaving every case here asserting about an empty document.
import "../inspector/_register.ts";

// The chrome's half of the session claim, end to end: a connection token arrives on the
// feed, this tab claims under the world it is authoring, a switch of world RE-KEYS that
// claim, a refusal becomes the steal prompt, and a claim taken away becomes the cover.
//
// Driven through the REAL `useDaemonFeed` (a fake EventSource stands in for the browser's,
// which happy-dom does not ship) and the REAL `api` over a stubbed fetch, because the two
// ends are exactly the ones that break silently: an event NAME the daemon stopped emitting,
// and a POST body the daemon would reject. The daemon's own half — what the table does with
// these calls — is `tests/claims.test.ts` and `tests/server.test.ts`.
import { afterEach, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { useEffect, useRef } from "react";
import { ClaimLostOverlay } from "../../src/frontend/components/ClaimLostOverlay.tsx";
import { ConfirmDialog } from "../../src/frontend/components/ConfirmDialog.tsx";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { useConfirmDialog } from "../../src/frontend/hooks/useConfirmDialog.ts";
import { useDaemonFeed } from "../../src/frontend/hooks/useDaemonFeed.ts";
import { useSessionClaim } from "../../src/frontend/hooks/useSessionClaim.ts";
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
} from "../inspector/_harness.tsx";

afterEach(cleanup);
afterEach(() => notify.clear());

/** Module-level, so it satisfies the stability contract `useDaemonFeed` states for it. */
const inertAnswerer = () => undefined;

// --- the browser's EventSource, faked ----------------------------------------

type Listener = (event: MessageEvent) => void;

class FakeEventSource {
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
	 *  listeners, the JSON rides in `data`. A frame whose type is missing from
	 *  `EVENT_TYPES` reaches nobody here for exactly the reason it reaches nobody in a
	 *  browser — no listener was ever registered for the name. */
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
});

function feedSource(): FakeEventSource {
	const source = FakeEventSource.live[0];
	if (!source) throw new Error("the feed opened no EventSource");
	return source;
}

// --- the daemon, stubbed at the fetch boundary --------------------------------

type Call = { command: string; body: Record<string, unknown> };

/** Answer every command 200 `{}` except the ones named, which get the daemon's real
 *  refusal envelope — code and all, since a branch on `code` is the thing under test.
 *
 *  `world` narrows a refusal to calls naming that world, and `undefined` means every call.
 *  It exists for the re-key cases, where "another tab holds `cavern`" is the whole premise
 *  and a stub that also refused the untitled scratch would be modelling a daemon two tabs
 *  deep in a scenario about one. `null` is a world like any other here — the untitled key. */
function stubDaemon(
	refuse: {
		command: string;
		code: string;
		world?: string | null;
		/** Hold the refusal until {@link releaseHeld}, so a case can act while the POST is
		 *  still in flight. The claim's catch runs asynchronously and the authored world can
		 *  move under it, which is a real order and unreachable against an instant stub. */
		hold?: boolean;
	} | null = null,
): {
	calls: Call[];
	releaseHeld(): void;
} {
	const calls: Call[] = [];
	const held: (() => void)[] = [];
	globalThis.fetch = ((input: unknown, init?: RequestInit) => {
		const command = String(input).slice("/api/".length);
		const body = JSON.parse(String(init?.body ?? "{}")) as Record<
			string,
			unknown
		>;
		calls.push({ command, body });
		const worldMatches =
			refuse?.world === undefined || refuse.world === body["name"];
		if (refuse && refuse.command === command && worldMatches) {
			const refusal = new Response(
				JSON.stringify({
					error: { code: refuse.code, message: "the daemon said no" },
				}),
				{ status: 409 },
			);
			if (!refuse.hold) return Promise.resolve(refusal);
			return new Promise<Response>((resolve) => {
				held.push(() => resolve(refusal));
			});
		}
		return Promise.resolve(new Response("{}", { status: 200 }));
	}) as unknown as typeof fetch;
	return {
		calls,
		releaseHeld: () => {
			for (const resolve of held.splice(0)) resolve();
		},
	};
}

// --- the tree under test ------------------------------------------------------

/** App's share of the chain, mirrored: the claim hook, the feed it rides, the one confirm
 *  dialog its refusal opens, and the cover its loss raises. Nothing below App is involved
 *  — the claim deliberately sits above the whole shell.
 *
 *  The authored world arrives as a PROP and is pushed up the seam `WorldProvider` really
 *  uses — one effect over the name it owns, calling `setAuthoredWorld`. Mirroring the
 *  effect rather than the provider is what lets a case LOAD A WORLD mid-session without
 *  mounting the shell, the providers and a canvas none of this file's subject involves.
 *
 *  `expose` hands the hook's own verb back out, because the prop route CANNOT reach every
 *  branch of it: React compares the effect's deps, so reporting the same world twice never
 *  arrives here at all. A case about the hook's internal value guard has to call the verb,
 *  or it pins React's memoisation and calls it a pin. */
function Session({
	world,
	expose,
}: {
	world: string | null;
	expose: { current: ((world: string | null) => void) | null };
}) {
	const { confirm, openConfirm, resolveConfirm } = useConfirmDialog();
	const bakeBusyRef = useRef(false);
	const claim = useSessionClaim({ openConfirm });
	const { setAuthoredWorld } = claim;
	useEffect(() => {
		expose.current = setAuthoredWorld;
		setAuthoredWorld(world);
	}, [world, setAuthoredWorld, expose]);
	// The answerer is inert here: this file is the CLAIM's chain, and the backchannel rides
	// the same subscription without touching it (`tests/chrome/session-answer.test.tsx`).
	useDaemonFeed(true, bakeBusyRef, claim.feed, inertAnswerer);
	return (
		<>
			<ConfirmDialog request={confirm} onResolve={resolveConfirm} />
			{/* THE SHELL, reduced to the one property the cover has to survive: a focusable
			    control mounted BEFORE it in document order, which is what `<Shell />`'s top
			    bar and status bar are. Tab order follows DOM order and z-index does not
			    touch it, so this button is the whole of what the focus case needs — and
			    mounting the real Shell here would need the engine, the providers and a
			    canvas none of which this file's subject involves. */}
			<button type="button">shell control</button>
			<ClaimLostOverlay lost={claim.lost} />
		</>
	);
}

/** The provider is here for `ConfirmDialog` alone, which reads the viewport-focus seam
 *  through it. Nothing in the claim itself touches the editor context — the world name
 *  arrives as a prop precisely so a case can set it, and change it. */
const tree = (
	world: string | null,
	expose: { current: ((world: string | null) => void) | null },
) => (
	<EditorContext.Provider value={makeEditorContext()}>
		<Session world={world} expose={expose} />
	</EditorContext.Provider>
);

/**
 * Mount a session on `world`, and hand back the two ways a case may move it off that world.
 *
 * `loadWorld` is the PRODUCTION route — a prop change, an effect, a call — and it is what
 * every case about a world switch should use. `reportWorld` calls the hook's verb directly,
 * for the one case the production route cannot express: reporting the SAME world twice,
 * which React's dep comparison swallows before the hook sees it.
 */
async function renderSession(world: string | null): Promise<{
	loadWorld(next: string | null): Promise<void>;
	reportWorld(next: string | null): Promise<void>;
}> {
	// Boundary cast: the fake implements the three members `subscribeEvents` uses.
	globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
	const expose: { current: ((world: string | null) => void) | null } = {
		current: null,
	};
	const view = render(tree(world, expose));
	await act(async () => {
		await Promise.resolve();
	});
	return {
		loadWorld: async (next) => {
			await act(async () => {
				view.rerender(tree(next, expose));
				await Promise.resolve();
				await Promise.resolve();
			});
		},
		reportWorld: async (next) => {
			const report = expose.current;
			if (!report) throw new Error("the session never exposed its verb");
			await act(async () => {
				report(next);
				await Promise.resolve();
				await Promise.resolve();
			});
		},
	};
}

/** Push one daemon frame into the live feed and let the promises it starts settle. */
async function emit(event: ServerEvent): Promise<void> {
	await act(async () => {
		feedSource().emit(event);
		await Promise.resolve();
		await Promise.resolve();
	});
}

// --- (a) the claim rides the TOKEN frame, not `onopen` -------------------------

test("the token frame is what claims, under the world this session is authoring", async () => {
	// It cannot ride `onopen`: the token a claim must present arrives as the stream's
	// FIRST frame, so at open there is nothing to present. This case is the whole reason
	// the plan's "claim on onOpen" reads as "claim on (re)connect".
	const daemon = stubDaemon();
	await renderSession("cavern");

	feedSource().onopen?.();
	expect(daemon.calls).toEqual([]);

	await emit({ type: "session-token", token: "tok-1" });

	expect(daemon.calls).toEqual([
		{ command: "session.claim", body: { name: "cavern", token: "tok-1" } },
	]);
});

test("an untitled session claims under `null`, which is what the chrome calls it", async () => {
	const daemon = stubDaemon();
	await renderSession(null);
	await emit({ type: "session-token", token: "tok-1" });
	expect(daemon.calls[0]?.body).toEqual({ name: null, token: "tok-1" });
});

test("every reconnect re-claims, because every reconnect is a new connection", async () => {
	const daemon = stubDaemon();
	await renderSession("cavern");
	await emit({ type: "session-token", token: "tok-1" });
	await emit({ type: "session-token", token: "tok-2" });
	expect(daemon.calls.map((c) => c.body["token"])).toEqual(["tok-1", "tok-2"]);
});

// --- (a2) the claim RE-KEYS on a world switch (T4c) ----------------------------
//
// The defect this closes, in the shape it actually reaches a human: a tab boots on the
// untitled scratch and claims `null`, the human loads `W`, and through T4b the tab went on
// holding `null` until some later reconnect happened to re-key it. While the key lies, the
// conflict test asks the wrong question — a SECOND tab opening `W` claims it with no
// conflict, no steal prompt and no toast, and the daemon holds two claims, which is the
// refusal every `session_state` from then on returns with nothing anywhere explaining why.
//
// ONE POST, not two, and that is `daemon/claims.ts`'s own rule rather than a shortcut: a
// connection holds AT MOST ONE world, so the successful claim of `W` drops `null` in the
// same step. `session.release` appears only where that rule does not save us — a REFUSED
// re-claim, below.

test("loading a world RE-KEYS the claim, so two tabs on one world can still find each other", async () => {
	const daemon = stubDaemon();
	const session = await renderSession(null);
	await emit({ type: "session-token", token: "tok-1" });
	await session.loadWorld("cavern");

	expect(daemon.calls).toEqual([
		{ command: "session.claim", body: { name: null, token: "tok-1" } },
		{ command: "session.claim", body: { name: "cavern", token: "tok-1" } },
	]);
});

test("a world switch with no live token posts nothing — the reconnect claims under the NEW name", async () => {
	// Between a reconnect and its token frame there is no name to present, so there is
	// nothing to re-key with. What must not happen is the switch being FORGOTTEN: the token
	// that arrives afterwards has to claim `cavern`, never the `null` the tab booted on.
	const daemon = stubDaemon();
	const session = await renderSession(null);
	await session.loadWorld("cavern");
	expect(daemon.calls).toEqual([]);

	await emit({ type: "session-token", token: "tok-1" });
	expect(daemon.calls).toEqual([
		{ command: "session.claim", body: { name: "cavern", token: "tok-1" } },
	]);
});

test("reporting the SAME world twice is not a re-claim — the hook's own value guard", async () => {
	// `reportWorld`, NOT `loadWorld`, and the difference is the whole case. A rerender with
	// an unchanged prop never re-runs the harness effect (React compares its deps), so a
	// version of this written the production way passes with the guard deleted: it pins
	// React's memoisation and nothing of ours. Calling the verb directly is what puts the
	// guard on the only path that reaches it.
	//
	// The guard is INSURANCE — nothing in the chrome can report the same world twice today
	// (see `setAuthoredWorld`'s docblock for the three things that would have to move). It is
	// pinned anyway because it is one line that a tidy-up could delete for free, and this
	// case is what would object.
	const daemon = stubDaemon();
	const session = await renderSession("cavern");
	await emit({ type: "session-token", token: "tok-1" });
	expect(daemon.calls.length).toBe(1);

	await session.reportWorld("cavern");
	expect(daemon.calls.length).toBe(1);

	// …and the guard is a guard, not a latch: a real change still claims.
	await session.reportWorld("other");
	expect(daemon.calls.map((c) => c.body["name"])).toEqual(["cavern", "other"]);
});

test("a second switch mid-flight is not undone when the FIRST claim's refusal lands late", async () => {
	// Two switches inside one round trip, which is one click apart in a world drawer: leave
	// the scratch for a contested world, then leave THAT for a free one before the first
	// POST answers. The 409 arrives naming a world nobody is in any more.
	//
	// Ungoverned, the late refusal acts on it anyway: `session.release` drops whatever this
	// connection holds — which by then is the claim the SECOND switch just won — and the
	// steal prompt asks the user to take over a world they have left. Both failures are
	// invisible from outside, because an unclaimed tab looks exactly like a tab that never
	// claimed. The catch re-reads the authored world before it acts on anything.
	const daemon = stubDaemon({
		command: "session.claim",
		code: "already-exists",
		world: "contested",
		hold: true,
	});
	const session = await renderSession(null);
	await emit({ type: "session-token", token: "tok-1" });
	await session.loadWorld("contested"); // POST sent, answer withheld
	await session.loadWorld("free"); // claimed, and this is what must survive

	await act(async () => {
		daemon.releaseHeld();
		await Promise.resolve();
		await Promise.resolve();
	});

	// THREE claims and nothing else. A `session.release` here is the bug, and it would be
	// the last call in the list.
	expect(daemon.calls.map((c) => c.command)).toEqual([
		"session.claim",
		"session.claim",
		"session.claim",
	]);
	expect(screen.queryByRole("dialog")).toBeNull();
});

test("a REFUSED re-claim releases the world this tab left, then offers the steal", async () => {
	// The half the claim table cannot do for us. A successful claim drops the old key; a
	// refused one leaves it, so a tab refused `cavern` would go on holding `null` — the same
	// lying key the re-key exists to end, now produced by the fix. A refusal must leave this
	// tab UNCLAIMED, which is exactly what it means on the connect path.
	const daemon = stubDaemon({
		command: "session.claim",
		code: "already-exists",
		// Only `cavern` is taken — the scratch this tab boots on is free, which is what makes
		// the refusal below a switch being refused rather than a session that never started.
		world: "cavern",
	});
	const session = await renderSession(null);
	await emit({ type: "session-token", token: "tok-1" });
	await session.loadWorld("cavern");

	await waitFor(() =>
		expect(daemon.calls.map((c) => c.command)).toEqual([
			"session.claim",
			"session.claim",
			"session.release",
		]),
	);
	// NO `name`: the daemon drops whatever this connection holds, which is the honest way
	// to say "I hold nothing" without having to know what it was.
	expect(daemon.calls.at(-1)?.body).toEqual({ token: "tok-1" });
	expect((await screen.findByRole("dialog")).textContent).toContain('"cavern"');
});

test("a LOST tab does not claim its way back in by switching worlds", async () => {
	// The cover says RELOAD and means it. The re-key is a second route into `claimUnder`,
	// and a covered tab whose human loads another world must not take it — that would be a
	// tab holding a claim while displaying "another editor session took over".
	const daemon = stubDaemon();
	const session = await renderSession(null);
	await emit({ type: "session-token", token: "tok-1" });
	await emit({ type: "claim-lost", world: null });
	const before = daemon.calls.length;

	await session.loadWorld("cavern");

	expect(daemon.calls.length).toBe(before);
	expect(screen.getByRole("alertdialog")).toBeTruthy();
});

// --- (b) a refusal is the steal prompt ----------------------------------------

test("a world already claimed opens the steal prompt, and confirming steals", async () => {
	const daemon = stubDaemon({
		command: "session.claim",
		code: "already-exists",
	});
	await renderSession("cavern");
	await emit({ type: "session-token", token: "tok-1" });

	const prompt = await waitFor(() => screen.getByRole("dialog"));
	expect(prompt.textContent).toContain("Another editor session");
	// The world is named, because "some other tab" is not an answer a user can act on.
	expect(prompt.textContent).toContain('"cavern"');

	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Take over" }));
		await Promise.resolve();
	});

	await waitFor(() =>
		expect(daemon.calls.at(-1)).toEqual({
			command: "session.steal",
			// The SAME token: a steal is asserted by the same connection the refused
			// claim was, which is what makes it this tab taking over rather than a third.
			body: { name: "cavern", token: "tok-1" },
		}),
	);
});

test("declining the prompt leaves this tab unclaimed and steals nothing", async () => {
	const daemon = stubDaemon({
		command: "session.claim",
		code: "already-exists",
	});
	await renderSession("cavern");
	await emit({ type: "session-token", token: "tok-1" });
	await waitFor(() => screen.getByRole("dialog"));

	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await Promise.resolve();
	});

	// UNCLAIMED is now enforced rather than incidental. This case used to expect the claim
	// alone, on the reasoning that a connection that never took a world holds none anyway —
	// true then, and T4c's re-key made it a coincidence of WHICH refusal this is. The
	// release fires on every refusal so that one means one thing; here it drops nothing, and
	// after a world switch it is the whole point. No steal either way.
	expect(daemon.calls.map((c) => c.command)).toEqual([
		"session.claim",
		"session.release",
	]);
});

test("a steal confirmed AFTER a reconnect is dropped, not sent with a dead token", async () => {
	// The prompt waits at human speed and the feed can reconnect under it. The old token
	// names a connection the daemon has already forgotten, so posting it would earn
	// `no-session` — and the new connection's own claim is already in flight anyway.
	const daemon = stubDaemon({
		command: "session.claim",
		code: "already-exists",
	});
	await renderSession("cavern");
	await emit({ type: "session-token", token: "tok-1" });
	await waitFor(() => screen.getByRole("dialog"));

	act(() => {
		feedSource().onopen?.();
	});
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Take over" }));
		await Promise.resolve();
	});

	// The refusal's own release rode out before the reconnect; what must NOT appear is a
	// `session.steal` carrying a token the daemon has forgotten.
	expect(daemon.calls.map((c) => c.command)).toEqual([
		"session.claim",
		"session.release",
	]);
});

test("a world loaded UNDER the steal prompt cancels the steal — it would revoke the new claim", async () => {
	// THE HUMAN-SCALE WINDOW, and the reason it is the more dangerous of the two staleness
	// guards rather than the less. A prompt waits for a person; `WorldProvider`'s boot
	// restore does not wait for the person. On a clean session it opens the remembered
	// world with no discard confirm — so it never trips `openConfirm`'s never-clobber
	// guard — and the catalog it waits on can settle long after this 409 landed.
	//
	// What a steal would do from there is not "the wrong world", it is DESTRUCTIVE:
	// `claims.steal` drops everything the connection holds before it takes, so it would
	// revoke the claim the restore just won and leave this tab keyed to a world it is not
	// authoring — the exact lying key the re-key exists to end, produced by its own remedy
	// — plus a claim-lost cover for whoever held the named world and a success toast for a
	// takeover nobody wanted.
	const daemon = stubDaemon({
		command: "session.claim",
		code: "already-exists",
		world: null, // the scratch is contested; the world restored under the prompt is not
	});
	const session = await renderSession(null);
	await emit({ type: "session-token", token: "tok-1" });
	await waitFor(() => screen.getByRole("dialog"));

	// The boot restore lands while the dialog stands.
	await session.loadWorld("cavern");

	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Take over" }));
		await Promise.resolve();
	});

	// The claim of `cavern` went out and was not refused. NOTHING may follow it: no steal
	// of `null`, and no release either — this tab is legitimately claimed now.
	expect(daemon.calls.map((c) => c.command)).toEqual([
		"session.claim", // null — refused
		"session.release", // …so the tab gave up what it held
		"session.claim", // cavern — succeeded
	]);
	expect(daemon.calls.at(-1)?.body).toEqual({
		name: "cavern",
		token: "tok-1",
	});
});

test("a claim that fails for any OTHER reason is said, and offers no steal", async () => {
	// The branch is on `code`, not on the message — which is why `ApiClientError` is
	// exported now. A steal prompt raised over an `internal` would offer a remedy for a
	// conflict that does not exist.
	stubDaemon({ command: "session.claim", code: "internal" });
	await renderSession("cavern");
	await emit({ type: "session-token", token: "tok-1" });

	await waitFor(() =>
		expect(
			notify.getSnapshot().toasts.some((t) => t.severity === "error"),
		).toBe(true),
	);
	expect(screen.queryByRole("dialog")).toBeNull();
});

// --- (c) losing the claim is a cover ------------------------------------------

test("claim-lost raises a cover that names the world and offers only a reload", async () => {
	stubDaemon();
	await renderSession("cavern");
	await emit({ type: "session-token", token: "tok-1" });
	expect(screen.queryByRole("alertdialog")).toBeNull();

	await emit({ type: "claim-lost", world: "cavern" });

	const cover = screen.getByRole("alertdialog");
	expect(cover.textContent).toContain('"cavern"');
	expect(cover.textContent).toContain("no longer the editing session");
	// ONE control, and it is not a dismissal: a cover the user can wave away would leave
	// a session that looks live, still takes digs, and is reachable by nobody.
	const buttons = Array.from(cover.querySelectorAll("button"));
	expect(buttons.map((b) => b.textContent)).toEqual(["Reload"]);
});

test("an untitled session that loses its claim is told what it lost", async () => {
	stubDaemon();
	await renderSession(null);
	await emit({ type: "claim-lost", world: null });
	expect(screen.getByRole("alertdialog").textContent).toContain(
		"this untitled session",
	);
});

// --- (d) the cover outranks the layer it has to cover -------------------------

/** Every `z-<n>` / `z-[<n>]` a file declares outside a comment. */
function zIndices(text: string): number[] {
	const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
	return [...code.matchAll(/\bz-\[?(\d+)\]?/g)].map((m) => Number(m[1]));
}

test("the cover declares a z ABOVE every layer the control library can raise", () => {
	// A SOURCE SCAN, and it has to be: happy-dom runs no layout and resolves no styles, so
	// nothing in `bun test` can tell which of two elements paints on top (the instrument
	// `tests/design-tokens.test.ts` states at length). The authored class is the fact.
	//
	// WHAT WENT WRONG WITHOUT IT, because this pin exists for a defect that shipped in the
	// same commit: the cover was `z-50` and `App.tsx` argued it won on DOM ORDER, being
	// rendered after `<Shell />`. It does not. React mounts into `#root`, and every Radix
	// overlay portals to `document.body` — a SIBLING AFTER `#root` — so at equal z the
	// dialog paints over the cover, the exact inverse of the claim. Reachable by any open
	// confirm prompt (delete world, discard-unsaved, bake stamp) when a steal lands, and
	// by ⌘K, which the cover now also suppresses.
	//
	// DERIVED, not hard-coded at 51: a library-wide raise reds here instead of quietly
	// going over the top of the cover.
	const ui = join(
		import.meta.dir,
		"..",
		"..",
		"src",
		"frontend",
		"components",
		"ui",
	);
	const library = readdirSync(ui)
		.filter((f) => f.endsWith(".tsx"))
		.flatMap((f) => zIndices(readFileSync(join(ui, f), "utf8")));
	expect(library.length).toBeGreaterThan(0);

	const cover = zIndices(
		readFileSync(
			join(
				import.meta.dir,
				"..",
				"..",
				"src",
				"frontend",
				"components",
				"ClaimLostOverlay.tsx",
			),
			"utf8",
		),
	);
	expect(cover.length).toBe(1);
	expect(cover[0]).toBeGreaterThan(Math.max(...library));
});

// --- (e) the cover is terminal for FOCUS too ----------------------------------

test("focus cannot rest on the shell behind the cover — it is handed back", async () => {
	// THE THIRD CHANNEL. The pointer is stopped by a full-viewport layer and the window
	// keybindings by `claimLostRef`; focus is stopped by neither. `<Shell />` stays mounted
	// behind the cover with real buttons in it, tab order follows DOM order, and z-index
	// does not touch tab order — so Tab off "Reload" walked into the shell and ⏎ invoked
	// that button's own `onClick`, in a tab the daemon had already handed to someone else.
	//
	// It MOVES FOCUS rather than asserting an attribute: `aria-modal` is a declaration and
	// `inert` is unimplemented in happy-dom, so either would pass while the hole stayed
	// open. This drives the mechanism.
	stubDaemon();
	await renderSession("cavern");
	await emit({ type: "claim-lost", world: "cavern" });

	const reload = screen.getByRole("button", { name: "Reload" });
	const behind = screen.getByRole("button", { name: "shell control" });

	// The browser's own way in: Tab from the cover wraps to the top of the document, which
	// is the shell. Modelled as the focus that lands, which is all the DOM ever sees.
	behind.focus();
	expect(document.activeElement).toBe(reload);

	// …and a programmatic focus, which is what a stray autofocus or a restore-on-close
	// would do. Same answer, because the trap watches focus rather than the Tab key.
	behind.focus();
	expect(document.activeElement).toBe(reload);
});

test("before the claim is lost, focus moves freely — the trap is not always on", async () => {
	// The control. Without it the case above passes on any harness where `.focus()` is a
	// no-op, and it would also pass on a trap that never turned off — which would break
	// every ordinary overlay in the chrome.
	stubDaemon();
	// No `emit` at all: nothing has been lost, so the cover is not mounted.
	await renderSession("cavern");
	const behind = screen.getByRole("button", { name: "shell control" });
	behind.focus();
	expect(document.activeElement).toBe(behind);
	expect(screen.queryByRole("alertdialog")).toBeNull();
});

// --- (f) a lost tab never re-claims -------------------------------------------

test("a lost tab does NOT re-claim when the feed reconnects — it says reload, and means it", async () => {
	// The reachable sequence: B steals from A, then the daemon restarts (every source
	// change in the `bun run edit` loop does that) or the stream blips. `EventSource`
	// reconnects both tabs and the daemon mints A a fresh token. Without the guard A
	// re-claims and may WIN, holding the claim while showing "another editor session took
	// over" and suppressing its own keyboard — an agent wired to a tab the human cannot
	// operate, and B refused and steal-prompted.
	const daemon = stubDaemon();
	await renderSession("cavern");
	await emit({ type: "session-token", token: "tok-1" });
	await emit({ type: "claim-lost", world: "cavern" });
	const before = daemon.calls.length;

	// The reconnect: `onOpen` forgets the dead token, then a fresh one arrives.
	act(() => {
		feedSource().onopen?.();
	});
	await emit({ type: "session-token", token: "tok-2" });

	expect(daemon.calls.length).toBe(before);
	expect(screen.getByRole("alertdialog")).toBeTruthy();
});
