// Registered FIRST, before any other import — the `session-claim.test.tsx` ordering rule,
// which the harness this file shares depends on.
import "../inspector/_register.ts";

// The chrome's half of the backchannel, end to end: a `session-request` frame arrives on
// the feed, the answerer registry resolves the method, and the answer goes back as a
// `session.answer` POST carrying the request's own id.
//
// Driven through the REAL `useDaemonFeed` (a fake EventSource stands in for the browser's,
// which happy-dom does not ship), the REAL `useSessionAnswer` and the REAL `api` over a
// stubbed fetch — because the three things that break silently here are all at the seams:
// an event NAME missing from `EVENT_TYPES` (a frame that reaches no listener at all), a
// method missing from the registry, and a POST body the daemon's schema would reject. The
// daemon's own half is `tests/backchannel.test.ts`.
import { afterEach, expect, test } from "bun:test";
import { useRef } from "react";
import { useDaemonFeed } from "../../src/frontend/hooks/useDaemonFeed.ts";
import { useSessionAnswer } from "../../src/frontend/hooks/useSessionAnswer.ts";
import type { SessionFeed } from "../../src/frontend/hooks/useSessionClaim.ts";
import {
	type AgentPresenceStore,
	createAgentPresence,
} from "../../src/frontend/lib/agent-presence.ts";
import type { ServerEvent } from "../../src/frontend/lib/events.ts";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import {
	BASE_ANSWERERS,
	type SessionAnswerers,
} from "../../src/frontend/lib/session-answerers.ts";
import { act, cleanup, render } from "../inspector/_harness.tsx";

afterEach(cleanup);
afterEach(() => notify.clear());

/** The claim, inert: this file is the ANSWERER's chain, and the claim rides the same
 *  subscription without touching it (`tests/chrome/session-claim.test.tsx`). Module-level,
 *  so it satisfies the stability contract `useDaemonFeed` states. */
const inertSession: SessionFeed = {
	onOpen: () => undefined,
	onToken: () => undefined,
	onLost: () => undefined,
};

// --- the browser's EventSource, faked ----------------------------------------

type Listener = (event: MessageEvent) => void;

/** A near-twin of `session-claim.test.tsx`'s, and the ONE property that matters here is
 *  the one both copies share: a frame is dispatched to the listeners registered for its
 *  NAME, so a type missing from `EVENT_TYPES` reaches nobody — exactly as in a browser,
 *  where no listener was ever added for it. That is what makes this file the runtime pin
 *  for the subscription list, beside the type-level one in `tests/events.test.ts`. */
class FakeEventSource {
	static live: FakeEventSource[] = [];
	readonly listeners = new Map<string, Listener[]>();
	onopen: (() => void) | null = null;

	constructor(readonly url: string) {
		FakeEventSource.live.push(this);
	}

	addEventListener(type: string, fn: Listener): void {
		const list = this.listeners.get(type) ?? [];
		list.push(fn);
		this.listeners.set(type, list);
	}

	close(): void {
		// no-op: nothing to tear down in a fake
	}

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

// --- the daemon, stubbed at the fetch boundary --------------------------------

type Call = { command: string; body: Record<string, unknown> };

function stubDaemon(): { calls: Call[] } {
	const calls: Call[] = [];
	globalThis.fetch = ((input: unknown, init?: RequestInit) => {
		calls.push({
			command: String(input).slice("/api/".length),
			body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
		});
		return Promise.resolve(
			new Response(JSON.stringify({ delivered: true }), { status: 200 }),
		);
	}) as unknown as typeof fetch;
	return { calls };
}

// --- the tree under test ------------------------------------------------------

/** App's share of the chain, mirrored: the answerer hook and the feed it rides. Nothing
 *  renders, which is the subject's whole posture — the backchannel is invisible. */
function Answerer({
	answerers,
	presence,
}: {
	answerers: SessionAnswerers;
	presence: AgentPresenceStore;
}) {
	const bakeBusyRef = useRef(false);
	const onRequest = useSessionAnswer(answerers, presence);
	useDaemonFeed(true, bakeBusyRef, inertSession, onRequest);
	return null;
}

/** Mount the chain over a FRESH presence store, and hand it back. Fresh per render for the
 *  reason `lib/agent-presence.ts` gives: the store is App's, not the module's, so a case can
 *  assert "no agent has been here" as an ABSOLUTE rather than as a delta against whatever
 *  another test file did earlier in this process. */
function renderAnswerer(
	answerers: SessionAnswerers = BASE_ANSWERERS,
): AgentPresenceStore {
	// Boundary cast: the fake implements the three members `subscribeEvents` uses.
	globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
	const presence = createAgentPresence();
	render(<Answerer answerers={answerers} presence={presence} />);
	return presence;
}

/** Push one daemon frame into the live feed and let the POST it starts settle.
 *
 *  IT WAITS A MACROTASK, not a fixed count of microtask ticks, because the seam answers on a
 *  promise now — a handler may return a value or a promise of one, and `Promise.resolve(…)`
 *  normalizes both, so even a synchronous answer posts one tick later than it used to.
 *  Draining to a `setTimeout(0)` covers every handler shape these cases use without any of
 *  them encoding how many ticks the seam happens to take. */
async function emit(event: ServerEvent): Promise<void> {
	await act(async () => {
		const source = FakeEventSource.live[0];
		if (!source) throw new Error("the feed opened no EventSource");
		source.emit(event);
		await new Promise((done) => setTimeout(done, 0));
	});
}

// --- the round trip -----------------------------------------------------------

test("a request frame is answered by POST, under the id it arrived with", async () => {
	// THE PIN FOR `EVENT_TYPES` AT RUNTIME. If `"session-request"` is missing from that
	// list, no listener is registered for the name, the frame reaches nobody and no POST
	// goes out — a silence that type-checks. This case reds on exactly that, which is the
	// half the type-level mirror pin cannot see.
	const daemon = stubDaemon();
	renderAnswerer();

	await emit({
		type: "session-request",
		requestId: "req-1",
		method: "session.ping",
		params: { hello: "there" },
	});

	expect(daemon.calls).toEqual([
		{
			command: "session.answer",
			body: {
				requestId: "req-1",
				ok: true,
				payload: { echo: { hello: "there" } },
			},
		},
	]);
});

test("two requests answer under their own ids, in the order they arrived", async () => {
	const daemon = stubDaemon();
	renderAnswerer();

	await emit({
		type: "session-request",
		requestId: "req-1",
		method: "session.ping",
		params: 1,
	});
	await emit({
		type: "session-request",
		requestId: "req-2",
		method: "session.ping",
		params: 2,
	});

	expect(daemon.calls.map((c) => c.body["requestId"])).toEqual([
		"req-1",
		"req-2",
	]);
	expect(daemon.calls.map((c) => c.body["payload"])).toEqual([
		{ echo: 1 },
		{ echo: 2 },
	]);
});

// --- the two ways an answer is a refusal ---------------------------------------

test("an unknown method is REFUSED rather than ignored, and names what is served", async () => {
	// Silence here would reach the asker as a `session-timeout` — a sentence about how fast
	// this tab is, for what is actually version skew between a restarted daemon and a tab
	// that kept its bundle. The refusal names the registry so the answer is a diagnosis.
	const daemon = stubDaemon();
	renderAnswerer();

	await emit({
		type: "session-request",
		requestId: "req-1",
		method: "session.somethingNew",
		params: null,
	});

	const body = daemon.calls[0]?.body;
	expect(body?.["requestId"]).toBe("req-1");
	expect(body?.["ok"]).toBe(false);
	expect(String(body?.["error"])).toContain("session.somethingNew");
	expect(String(body?.["error"])).toContain("session.ping");
});

test("an ASYNC handler's REAL payload goes back — not a stringified promise", async () => {
	// THE HOLE THIS CLOSES, and it is the one failure this seam must never produce: a promise
	// JSON-stringifies to `{}`, so posting a handler's raw return would answer `ok: true`
	// with an empty payload — a POSITIVE claim about an answer that never arrived, which
	// reads as success at both ends. Worse than the silence the seam already converts.
	//
	// `SessionAnswerers` permits an async handler by its type, and supporting one is the
	// deliberate half: some chrome facts sit behind a worker round trip, and the daemon's
	// ten-second budget only means anything if the seam can wait.
	const daemon = stubDaemon();
	renderAnswerer({
		"session.ping": async (params) => {
			await Promise.resolve();
			return { echoedLater: params };
		},
	});

	await emit({
		type: "session-request",
		requestId: "req-1",
		method: "session.ping",
		params: { hello: "there" },
	});

	expect(daemon.calls).toEqual([
		{
			command: "session.answer",
			body: {
				requestId: "req-1",
				ok: true,
				payload: { echoedLater: { hello: "there" } },
			},
		},
	]);
});

test("an async handler that REJECTS becomes a refusal, not an unhandled rejection", async () => {
	// The other half of the same hole. A rejection off a promise the seam never held would
	// escape as an unhandled one — no answer posted, so the asker waits out the full budget
	// and is told the session was SLOW about a session that failed instantly.
	const daemon = stubDaemon();
	renderAnswerer({
		"session.ping": async () => {
			await Promise.resolve();
			throw new Error("the worker never came back");
		},
	});

	await emit({
		type: "session-request",
		requestId: "req-1",
		method: "session.ping",
		params: null,
	});

	expect(daemon.calls[0]?.body["requestId"]).toBe("req-1");
	expect(daemon.calls[0]?.body["ok"]).toBe(false);
	expect(String(daemon.calls[0]?.body["error"])).toContain(
		"the worker never came back",
	);
});

test("a handler answering `undefined` posts a body with NO payload key", async () => {
	// The chrome half of the round trip whose daemon half is in `tests/backchannel.test.ts`.
	// The stub parses the REAL request body, so what is asserted is what `JSON.stringify`
	// actually produced — the key is dropped by the serializer, not by a decision here, which
	// is why the daemon's schema has to accept it rather than the chrome coercing to `null`.
	const daemon = stubDaemon();
	renderAnswerer({
		"session.ping": () => {
			// A void-returning answerer, which is the shape `SessionAnswerers` permits and
			// Task 4's first non-ping method could easily be.
		},
	});

	await emit({
		type: "session-request",
		requestId: "req-1",
		method: "session.ping",
		params: null,
	});

	const body = daemon.calls[0]?.body;
	expect(body).toEqual({ requestId: "req-1", ok: true });
	expect(Object.hasOwn(body ?? {}, "payload")).toBe(false);
});

test("a payload that will not SERIALIZE becomes a refusal, not a silent timeout", async () => {
	// THE FIFTH FAILURE MODE, and the one the seam did not convert until spec review. A
	// handler's payload can fail INSIDE the POST — `call` does `JSON.stringify(input)` — and
	// that is a handler's own bug, the same class as a throw. Left in the silent `.catch` it
	// produced the misleading `session-timeout`: a sentence about how fast the session is,
	// for a handler that failed instantly.
	//
	// The refusal is reachable precisely because the cause is local: a refusal body is three
	// primitives and always serializes, so the seam is one POST away from an honest answer.
	const daemon = stubDaemon();
	const cyclic: Record<string, unknown> = {};
	cyclic["self"] = cyclic;
	renderAnswerer({ "session.ping": () => cyclic });

	await emit({
		type: "session-request",
		requestId: "req-1",
		method: "session.ping",
		params: null,
	});

	// The failed success POST never reached the daemon; the refusal that followed it did.
	expect(daemon.calls).toHaveLength(1);
	expect(daemon.calls[0]?.body["requestId"]).toBe("req-1");
	expect(daemon.calls[0]?.body["ok"]).toBe(false);
	expect(String(daemon.calls[0]?.body["error"])).toContain("session.ping");
});

test("a handler that THROWS becomes a refusal, not a silence", async () => {
	// "Never a hang" has to be a property of the seam rather than a promise every future
	// handler keeps for itself — T4b Task 4's `session.state` reads live mirrors, which is
	// exactly the kind of body that can throw.
	const daemon = stubDaemon();
	renderAnswerer({
		"session.ping": () => {
			throw new Error("the mirror was not there");
		},
	});

	await emit({
		type: "session-request",
		requestId: "req-1",
		method: "session.ping",
		params: null,
	});

	expect(daemon.calls[0]?.body["ok"]).toBe(false);
	expect(String(daemon.calls[0]?.body["error"])).toContain(
		"the mirror was not there",
	);
});

// --- the posture --------------------------------------------------------------

test("a SERVED method is recorded as presence; an unserved one is not", async () => {
	// PRESENCE-LITE (T4c), and the ordering is the claim. The record happens after the registry
	// lookup, so what reaches the human's status bar is a verb this tab really ran — a method
	// it does not serve is a REFUSAL (version skew between a restarted daemon and an older tab),
	// and naming it would put a verb on screen that nothing in this editor performed.
	stubDaemon();
	const presence = renderAnswerer();
	expect(presence.getSnapshot()).toEqual({ verb: null, count: 0 });

	await emit({
		type: "session-request",
		requestId: "req-1",
		method: "session.ping",
		params: null,
	});
	expect(presence.getSnapshot()).toEqual({ verb: "session.ping", count: 1 });

	await emit({
		type: "session-request",
		requestId: "req-2",
		method: "session.nothingHere",
		params: null,
	});
	expect(presence.getSnapshot()).toEqual({ verb: "session.ping", count: 1 });
});

test("presence records that a verb RAN, never how it went", async () => {
	// The quiet-refusals ruling, from the presence side. A handler that refuses — every write
	// row can, and `session.interrupt` does whenever nothing is standing — is still a verb that
	// ran, and the indicator says so and stops there. It cannot say more: `ran` takes no outcome,
	// so this is a property of the seam's SHAPE rather than of care at the call site.
	stubDaemon();
	const presence = renderAnswerer({
		"session.ping": () => ({ ok: false, kind: "refused", because: "inert" }),
	});

	await emit({
		type: "session-request",
		requestId: "req-1",
		method: "session.ping",
		params: null,
	});

	expect(presence.getSnapshot()).toEqual({ verb: "session.ping", count: 1 });
	// …and still not a word on screen.
	expect(notify.getSnapshot().log).toEqual([]);
});

test("answering says NOTHING to the human — no toast, either way", async () => {
	// This tranche's human-visible surface was fixed by the claim (a steal prompt, a cover,
	// three toasts). A question an agent asks about the session must not announce itself to
	// the person sitting in it, and a refusal is about the asker rather than about them.
	stubDaemon();
	renderAnswerer();

	await emit({
		type: "session-request",
		requestId: "req-1",
		method: "session.ping",
		params: null,
	});
	await emit({
		type: "session-request",
		requestId: "req-2",
		method: "session.nope",
		params: null,
	});

	const snapshot = notify.getSnapshot();
	expect(snapshot.toasts).toEqual([]);
	expect(snapshot.log).toEqual([]);
});
