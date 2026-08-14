// Registered FIRST, before any other import — the `session-claim.test.tsx` ordering rule,
// which the harness this file shares depends on, and the Radix rule `shell.test.tsx`
// states for mounting the shell at all.
import "../inspector/_register.ts";

// `session.state` — what a mounted chrome ANSWERS when an agent asks it to describe the
// session (foundations T4b Task 4).
//
// THE WIRE IS NOT RE-PINNED HERE, deliberately. `tests/chrome/session-answer.test.tsx`
// drives the whole path — a `session-request` frame off a fake `EventSource`, the registry
// lookup, the answer POST — and it does so METHOD-AGNOSTICALLY, over `session.ping`. What
// is new at this task is the ANSWER: which mirrors it reads, what it says when there is no
// host, and that the cursor is read live rather than latched. Standing up a third fake
// `EventSource` to deliver a frame whose handling is already pinned would be a third copy
// of one fixture buying no new claim. So this file calls the registry row the way the seam
// does, over a REAL mounted shell — which is the half nothing else covers.
//
// The daemon's half of the same round trip (that a `session.state` command over HTTP
// starts an ask on the running server's own correlation table) is in `tests/server.test.ts`.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { Shell } from "../../src/frontend/components/shell/Shell.tsx";
import type { ActionCtx } from "../../src/frontend/lib/actions.ts";
import { DEFAULT_TOOL } from "../../src/frontend/lib/field-host-mirrors.ts";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import {
	createSessionAnswerers,
	type SessionStateReader,
} from "../../src/frontend/lib/session-answerers.ts";
import type { SessionState } from "../../src/shared/wire.ts";
import {
	act,
	cleanup,
	makeEditorContext,
	render,
} from "../inspector/_harness.tsx";
import {
	makeHistory,
	makeStats,
	makeStubHost,
	START_POSE,
} from "./_stub-host.ts";

afterEach(cleanup);
afterEach(() => notify.clear());

// CanvasHost measures the canvas at mount and FAILS LOUD on a zero box (the shell's CSS
// contract broken). happy-dom reports zero for everything, so a suite that mounts the real
// shell has to supply a measurement — `shell.test.tsx`'s fixture, and its reasoning.
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

/** The field toolbar's run-once catalog GETs 404 on a project without catalogs, which is
 *  the quietest legitimate shape (`shell.test.tsx`'s). */
function fetch404(): void {
	// Boundary cast: the stub serves only the catalog GETs, so it implements the call
	// signature and none of `fetch`'s statics.
	globalThis.fetch = (() =>
		Promise.resolve(
			new Response("", { status: 404 }),
		)) as unknown as typeof fetch;
}

/** Mount the shell over `host`, wired to the reader ref App creates — and hand back the
 *  registry row exactly as `useSessionAnswer` would resolve it.
 *
 *  The ref is a plain `{ current }`, which is what `useRef` hands out; building the
 *  registry from it BEFORE the render is the production order too (App memoizes it on its
 *  first render, and the shell fills the ref on its first effect). */
async function mountSession(host?: ReturnType<typeof makeStubHost>) {
	fetch404();
	const sessionStateRef: { current: SessionStateReader | null } = {
		current: null,
	};
	// The host ref `viewport.capture` and the two mutation rows read, and the dispatcher ref
	// `action.run` reads. This file is about `session.state`, which touches neither — they
	// are passed because the factory takes them, and the host is filled with the same stub
	// the shell mounts over so nothing here depends on it being empty.
	const answerers = createSessionAnswerers(
		sessionStateRef,
		{ current: host?.host },
		{ current: null },
	);
	const ask = (): SessionState => {
		const row = answerers["session.state"];
		if (row === undefined) throw new Error("no session.state answerer");
		// `{}` — the params the DAEMON relays for this method (`session-handlers.ts`), so
		// what the row is handed here is what it is handed in production. The method ignores
		// them; passing something else would make the claim above false for no gain.
		return row({}) as SessionState;
	};
	const before = ask();
	render(
		<EditorContext.Provider
			value={makeEditorContext({
				fieldHostRef: { current: host?.host },
				sessionStateRef,
			})}
		>
			<Shell />
		</EditorContext.Provider>,
	);
	// The catalog GET the field surfaces fire on mount: two microtask turns (fetch, then
	// res.text()), so their state lands inside act.
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	return { ask, before };
}

/** Narrow to the ready arm, with a failure that says which arm arrived. */
function ready(state: SessionState): Extract<SessionState, { ready: true }> {
	if (!state.ready) throw new Error("expected a READY session state");
	return state;
}

// --- the two arms -------------------------------------------------------------

test("an UNFILLED reader and a HOSTLESS chrome share one honest arm", async () => {
	// Both are the same sentence — "there is no session state to read yet" — and NEITHER is
	// currently reachable through the daemon, which is why this case asks the registry row
	// directly. A tab is only asked if it is claimed, it only claims once its feed is open,
	// and the feed only opens at `status === "ready"` — by which point `App` has assigned
	// the host and the shell has long committed. `shared/wire.ts` works the gate through.
	//
	// The arm is still what the chrome MUST answer if it is asked anyway, and what it must
	// not answer is an empty world: `selection: null`, `stats: 0 ops` and `history: []` are
	// all innocent-looking defaults, and an agent reading them would conclude the human is
	// sitting in an empty world rather than in front of a loading screen.
	const { ask, before } = await mountSession();
	expect(before).toEqual({ ready: false });
	// Mounted, and STILL not ready — the reader is filled, and it reports the truth about
	// the host rather than the truth about itself.
	expect(ask()).toEqual({ ready: false });
});

test("a mounted chrome answers what its mirrors actually hold", async () => {
	const stub = makeStubHost();
	const { ask } = await mountSession(stub);

	// The fresh-host baseline, whole rather than field by field: every value here is one
	// the stub's seams pushed on subscribe (the production host's own split, seam for
	// seam), so this asserts the projection reads the mirrors rather than inventing
	// defaults of its own. `stats` is `null` because the stats seam pushes nothing until a
	// frame — which is exactly the sub-frame window `shared/wire.ts` types as nullable.
	expect(ask()).toEqual({
		ready: true,
		cursor: "rev-0",
		world: { name: null, dirty: false, busy: false },
		// THE T4b MISREADING, AS THE BASELINE ANSWER (T4c Task 5). A fresh session arms
		// select-by-click — the chrome's own default, `"pointer"` and not `null` — while the
		// brush is configured to DIG and is armed to do nothing at all. Those two facts used to
		// arrive as `gesture` and `tool`, and an agent joined them wrong, live, at the T4b gate
		// walk. `armed` IS the join now, and this pair is the whole of what it had to fix:
		// select-by-click, beside a dig nobody may read as armed.
		armed: { does: "selectEntity" },
		brush: {
			effect: DEFAULT_TOOL.effect,
			materialId: DEFAULT_TOOL.materialId,
			mask: DEFAULT_TOOL.mask,
		},
		session: null,
		selection: null,
		selectedEntity: null,
		camera: START_POSE,
		stats: null,
		history: { undoLabel: null, redoLabel: null, tail: [] },
	});
});

test("every mirror the payload names moves the answer", async () => {
	const stub = makeStubHost();
	const { ask } = await mountSession(stub);

	act(() => {
		stub.fire.tool({ ...DEFAULT_TOOL, effect: "fill", materialId: 2 });
		stub.fire.selection({
			spec: { kind: "region", min: [0, 0, 0], max: [1, 1, 1] },
			count: 42,
			truncated: true,
			aabb: null,
		});
		stub.fire.stats(makeStats({ totalOps: 7, undoDepth: 3, redoDepth: 1 }));
		stub.fire.history(
			makeHistory(["dig", "fill", "stamp Hall"], ["delete Hall"], {
				undoDepth: 9,
			}),
		);
	});

	const state = ready(ask());
	expect(state.brush).toEqual({
		effect: "fill",
		materialId: 2,
		mask: DEFAULT_TOOL.mask,
	});
	expect(state.selection).toEqual({ count: 42, truncated: true });
	expect(state.stats).toEqual({ totalOps: 7, undoDepth: 3, redoDepth: 1 });
	// The two LABELS are the tops, and the TAIL is the palette's list — bounded by the
	// host, which is why `undoDepth: 9` sits beside a three-entry tail rather than
	// contradicting it.
	expect(state.history).toEqual({
		undoLabel: "stamp Hall",
		redoLabel: "delete Hall",
		tail: ["dig", "fill", "stamp Hall"],
	});
});

test("the live SESSION and the selected ENTITY are projected, not passed through", async () => {
	// The two members that lose the most on the way to the wire, which is why they are
	// asserted whole: the session drops `params` (a generator-shaped bag only the stamp
	// form can read) and the entity drops its region, span and placements. What survives is
	// what an agent asks about — which generator, how far along, and whether the thing it is
	// looking at can still be reconfigured.
	const stub = makeStubHost();
	const { ask } = await mountSession(stub);
	stub.setEntities([
		{
			entityId: 3,
			type: "generator",
			generator: "hall",
			params: { width: 4 },
			seed: 7,
			region: { min: [0, 0, 0], max: [4, 4, 4] },
			opSpan: [2, 4],
			placed: [],
			baked: true,
		},
	]);

	act(() => {
		stub.fire.entities();
		stub.fire.entitySelection(3);
		stub.fire.stamp({
			generator: "hall",
			params: { width: 4 },
			seed: 7,
			policy: "replace",
			region: { min: [0, 0, 0], max: [4, 4, 4] },
			phase: "previewing",
			run: 2,
			opCount: null,
			placementCount: null,
			error: null,
			truncatedSelection: false,
			mode: "reconfigure",
			entityId: 3,
		});
	});

	const state = ready(ask());
	expect(state.session).toEqual({
		generator: "hall",
		phase: "previewing",
		mode: "reconfigure",
		entityId: 3,
	});
	// AND THE SESSION SHADOWS THE GESTURE SLOT, through the real seam. The chrome's gesture
	// cell still says `"pointer"` here — nothing cleared it, and nothing should: it names what
	// LMB will do again once the session ends. What LMB does NOW is steer the ghost, which is
	// what `armed` has to say, and the slot underneath it is exactly the fact an agent must not
	// be handed to interpret (`shared/wire.ts`'s `ArmedState`).
	expect(state.armed).toEqual({ does: "session" });
	// `frozen` is FALSE rather than absent: the host spells "not frozen" by leaving the key
	// off, and a relayed wire should not make a reader reason about a missing key.
	expect(state.selectedEntity).toEqual({
		entityId: 3,
		generator: "hall",
		frozen: false,
		baked: true,
	});
});

test("a PENDING STAMP ARM shadows the gesture slot, and names its generator", async () => {
	// The second shadow, and the one the backlog entry that asked for `armed` did not name:
	// a stamp picked with nothing selected arms REGION-DRAW, LMB routes there first, and the
	// gesture slot goes on saying `"pointer"` underneath it (`field-host.ts`'s `PendingStamp`:
	// "the arm is modal ON TOP of the gesture"). Driven through the real `subscribePendingStamp`
	// seam, so what is pinned is the whole wiring — host seam → latch → `ActionCtx.pendingStamp`
	// → the payload — and not just the join's arithmetic.
	const stub = makeStubHost();
	const { ask } = await mountSession(stub);
	expect(ready(ask()).armed).toEqual({ does: "selectEntity" });

	act(() => {
		stub.fire.pendingStamp({ id: "hall", name: "Hall" });
	});

	// The ID rather than the display name: it is what `generate` and `tool.stamp` take, so it
	// is the half a caller can act on.
	expect(ready(ask()).armed).toEqual({
		does: "stampRegion",
		generator: "hall",
	});
});

test("the payload is a COPY — no member aliases live chrome state", async () => {
	// The three members whose wire shape matches a record the chrome already holds are the
	// three that could travel by reference (`world`, `tool.mask`, `history.tail`), and the
	// payload's types are not `readonly` for the first two. Documented in the projection
	// since the last review; unpinned until this case, which is the same standard this
	// commit applies to its other documented hazard — `toEqual` stays green through a
	// revert to handing the records over, and `not.toBe` does not.
	const stub = makeStubHost();
	const { ask } = await mountSession(stub);
	const pushed = makeHistory(["dig"]);
	act(() => {
		stub.fire.history(pushed);
	});

	const a = ready(ask());
	const b = ready(ask());
	// Two answers, two records, all the way down — so a caller that mutates what it was
	// given cannot reach the chrome's state or the next reader's answer.
	expect(a.world).not.toBe(b.world);
	expect(a.brush.mask).not.toBe(b.brush.mask);
	// …and the DERIVED member is a fresh record too, which is the one this rule did not
	// previously have to cover: `armed` is spread off a module constant, so an alias here
	// would let a caller mutating its answer corrupt every later answer in the tab rather
	// than just the next one.
	expect(a.armed).not.toBe(b.armed);
	expect(a.history.tail).not.toBe(b.history.tail);
	// …and the tail is not the array the host published either.
	expect(a.history.tail).not.toBe(pushed.undo);
	expect(a.history.tail).toEqual(["dig"]);
});

test("the CAMERA is POLLED at answer time — never mirrored, never on the ctx", async () => {
	// Why it is a poll is `FieldHost.cameraPose`'s docblock to say. What this case asserts is
	// that the wiring actually is one: the pose reaches the answer, and — the half only a
	// count can show — the seam still has exactly ONE subscriber, which either mirror-shaped
	// route would have made two.
	const stub = makeStubHost();
	const { ask } = await mountSession(stub);
	expect(ready(ask()).camera).toEqual(START_POSE);

	act(() => {
		stub.fire.cameraPose({ yaw: 1.25, pitch: -0.5 });
	});
	expect(ready(ask()).camera).toEqual({ yaw: 1.25, pitch: -0.5 });

	// AND THE DISCRIMINATOR, which is a count rather than a value: STILL exactly one
	// subscriber to the pose seam — the triad's latch, the surface that draws it. Either
	// mirror-shaped route to this payload would make it two, which is the rule
	// `tests/chrome/shell.test.tsx` states for the seam and the reason this is a poll.
	expect(stub.calls.subscribeCameraPose.mock.calls.length).toBe(1);
});

test("the CURSOR and the HISTORY it certifies come from ONE payload", async () => {
	// THE COHERENCE THIS ARM IS BUILT ON, and the reason the token rides the payload
	// instead of being polled off the host. A polled token would move the instant the log
	// did — synchronously, inside a pointer handler — while the labels beside it still
	// described the previous commit, so an ask landing in between would answer with a
	// post-edit cursor over a pre-edit picture. A reader caches both, every later ask
	// returns that same cursor, and "nothing has changed" stays true for ever over a
	// world one edit old.
	//
	// Riding the payload makes the two inseparable, which is what this asserts: one push,
	// and BOTH move; and there is no state of the stub in which one can move without the
	// other, because there is only one thing to move.
	const stub = makeStubHost();
	const { ask } = await mountSession(stub);
	const before = ready(ask());

	act(() => {
		stub.fire.history(makeHistory(["dig"]));
	});

	const after = ready(ask());
	expect(after.cursor).not.toBe(before.cursor);
	expect(after.history.tail).toEqual(["dig"]);
	expect(after.history.undoLabel).toBe("dig");
	// The token is the one the PAYLOAD carried, not one the projection invented.
	expect(after.cursor).toBe(makeHistory(["dig"]).revision);
});

// --- the decision this task made, as a type ------------------------------------

/** `true` only if the two unions are mutually assignable — `tests/events.test.ts`'s
 *  spelling, borrowed for the same job one layer over. */
type Mirrors<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** What `ActionCtx` carries, frozen at the commit that added `session.state`.
 *
 *  ONE MEMBER SINCE, and it is the kind this pin exists to make deliberate rather than the
 *  kind it exists to refuse. `origin` arrived with undo attribution: it is written by the
 *  agent relay alone, read by the mutating runs, and — the reason it is not the churn the
 *  case below argues against — it moves at DISPATCH time rather than at render time, so it
 *  is never in this provider's memo deps and re-renders nobody. It is also absent from the
 *  `session.state` payload on purpose: what an agent asked FOR is not a fact about the
 *  session, and relaying its own tag back to it would say nothing. */
const CTX_MEMBERS = [
	"host",
	"isConfirmOpen",
	"origin",
	"gesture",
	"tool",
	"session",
	"selectedEntity",
	"selection",
	"stats",
	"world",
	"view",
	"workspace",
	"generators",
	"stampCursor",
	"pendingStamp",
	"history",
	"run",
] as const;

test("the ACTION CONTEXT did not grow a member for this", () => {
	// THE DECISION, PINNED AS A TYPE. `session.state` needs the camera pose, and the
	// cheapest way to get it would have been a ctx member — which would re-render all six
	// of that context's consumers at pointer rate during a look drag, including the ⌘K
	// table's whole gate pass, to serve a question asked now and then. The pose rides a ref
	// filled by a raw host subscription instead.
	//
	// MUTUAL, so both directions earn their keep: a new member is the churn this refuses,
	// and a REMOVED one means this list has stopped describing the type it claims to freeze.
	// Enforced by `bun run typecheck` rather than by this run — drift makes the annotation
	// `false` and the assignment a compile error.
	const unchanged: Mirrors<keyof ActionCtx, (typeof CTX_MEMBERS)[number]> =
		true;
	expect(unchanged).toBe(true);
});
