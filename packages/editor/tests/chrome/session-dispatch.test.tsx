// Registered FIRST, before any other import — the `session-claim.test.tsx` ordering rule,
// which the harness this file shares depends on, and the Radix rule `shell.test.tsx`
// states for mounting the shell at all.
import "../inspector/_register.ts";

// `action.run`'s CHROME HOP — the one place a relayed origin becomes `ActionCtx.origin`.
//
// WHY IT NEEDS A FILE AT ALL, since two other suites already cover the ends of this thread.
// `tests/session-mutation.test.ts` pins that the answerer hands `AGENT_ORIGIN` to the
// dispatch ref as a third argument; `tests/actions.test.ts` pins that a run holding a ctx
// with `origin` set passes it to the host verb. Between them sits `ActionContextProvider`,
// which folds the dispatch-time argument into the ctx the pure table is handed — three
// lines that nothing pinned, in the middle of a thread whose whole subject is attribution.
// A provider that dropped the fold would leave both existing suites GREEN and every agent
// write reading as the human's.
//
// A SHELL MOUNT IS THE ONLY WAY TO SEE IT. The dispatcher is installed in an effect on the
// provider that builds the ctx, and the ctx is assembled from a dozen chrome contexts, so
// there is nothing smaller to render. This is `session-state.test.tsx`'s fixture with the
// other ref filled — that file mounts the shell to read the reader `App` creates, and this
// one mounts it to read the DISPATCHER `App` creates. The two are the pair
// `session-answerers.ts` describes: one ref to read this session, one to drive it.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { Shell } from "../../src/frontend/components/shell/Shell.tsx";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import type { ActionDispatch } from "../../src/frontend/lib/session-answerers.ts";
import { AGENT_ORIGIN } from "../../src/shared/wire.ts";
import {
	act,
	cleanup,
	makeEditorContext,
	render,
} from "../inspector/_harness.tsx";
import { makeStubHost } from "./_stub-host.ts";

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

/** Mount the shell over `host` and hand back the dispatcher it filled — the ref App
 *  creates and `ActionContextProvider` writes on its first effect. */
async function mountDispatch(host: ReturnType<typeof makeStubHost>) {
	fetch404();
	const dispatchRef: { current: ActionDispatch | null } = { current: null };
	render(
		<EditorContext.Provider
			value={makeEditorContext({
				fieldHostRef: { current: host.host },
				dispatchRef,
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
	const dispatch = dispatchRef.current;
	if (dispatch === null)
		throw new Error("test: the shell filled no dispatcher");
	return dispatch;
}

test("a dispatch carrying an origin reaches the host verb with it", async () => {
	// END TO END over the hop: `action.run`'s third argument in, the host verb's second
	// argument out. `edit.duplicate` is the vehicle because it takes a NAMED id, so the case
	// needs no selection to set up — what is under test is the tag, not the fallback.
	const stub = makeStubHost();
	const dispatch = await mountDispatch(stub);
	await act(async () => {
		await dispatch("edit.duplicate", { entityId: 5 }, AGENT_ORIGIN);
	});
	expect(stub.calls.duplicateEntity.mock.calls).toEqual([[5, AGENT_ORIGIN]]);
});

test("a dispatch with NO origin leaves the member absent — the chrome's own shape", async () => {
	// THE OTHER HALF, and the one that keeps the fold honest rather than unconditional: a
	// provider that stamped every dispatch would attribute the human's ⌘K to the agent. The
	// ctx travels UNWRAPPED here, so `origin` is genuinely absent rather than
	// present-and-undefined — which is the same absent-means-human spelling the op log uses.
	const stub = makeStubHost();
	const dispatch = await mountDispatch(stub);
	await act(async () => {
		await dispatch("edit.duplicate", { entityId: 5 });
	});
	expect(stub.calls.duplicateEntity.mock.calls).toEqual([[5, undefined]]);
});
