// Registered FIRST — the shell.test.tsx rule (Radix resolves `globalThis.document` at
// module-evaluation time; a portal never mounts if the DOM was not there yet).
import "../inspector/_register.ts";

// THE ALLOWLIST, AS A TEST. D-24 bans raw `<select>` outside `components/ui/` and exempts
// exactly four controls by name in `scripts/one-control-library.grit`. This file is the
// machine half of that exemption: the reason is prose in `field/form-bits.tsx`, and prose
// does not redden when someone migrates one of them to `ui/select.tsx`.
//
// WHAT EACH CASE CLAIMS: Esc pressed on this control does NOT reach `host.escape()` — the
// editor's one cancel ladder, whose rungs discard a live selection and a session being
// configured. What holds that line is `isTextInputTarget` (`lib/keybindings.ts`) recognising
// an `HTMLSelectElement`; it cannot recognise the `<button>` a Radix trigger is, so a
// migration turns Esc-to-close-the-dropdown into Esc-discards-my-work. That is the whole
// reason these four stayed native, and it is now asserted per site rather than argued once.
//
// THE PREMISE THIS FILE CORRECTS. Task 12's review asked for these four to be pinned with a
// LIVE SESSION standing. Three of them cannot be: a live session swaps the tool strip for
// the session strip (`tool-strip.test.tsx`, "a live session swaps the tool strip"), so the
// mask/iterations/mode selects are DETACHED the instant a session exists. Measured — after
// `fire.stamp(...)`, `select.isConnected === false` and the label no longer resolves. Only
// `merge policy` lives inside the session card, so it is the one site that gets the real
// standing, and the one that carries the ⏎ case.
//
// It replaced a pin in `shell.test.tsx` that did exactly the impossible thing — captured the
// mask select, fired a session, then dispatched Esc at a node no longer in the tree. That
// case is deleted; its epitaph is at the same spot in `shell.test.tsx` and lists the three
// separate ways it could not fail.
//
// So the standing here is the one each control actually has, and every case carries two
// guards that make the pass non-vacuous: the node is still CONNECTED when the key is
// dispatched, and the same key from a plain element DOES reach the verb (the two control
// cases at the bottom). Without that pair, "the verb was not called" is satisfied by any
// mistake that removes the element — or by watching the wrong mock.
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { Shell } from "../../src/frontend/components/shell/Shell.tsx";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import type {
	FieldGeneratorInfo,
	StampSession,
} from "../../src/viewport-host/index.ts";
import {
	act,
	cleanup,
	fireEvent,
	makeEditorContext,
	render,
	screen,
	within,
} from "../inspector/_harness.tsx";
import { makeStubHost } from "./_stub-host.ts";

// BEFORE `cleanup`, deliberately: the disclosure is undone by clicking its trigger, which
// has to still be mounted. bun runs afterEach hooks in registration order, so this one is
// registered first. A throwing case would otherwise leak the disclosure open into the next
// FILE — its memory is module-scoped and outlives this one.
afterEach(() => {
	restoreAdvanced?.();
	restoreAdvanced = null;
});
afterEach(cleanup);
afterEach(() => notify.clear());

// --- environment (the shell render recipe) -----------------------------------

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

/** The panel's run-once catalog GETs; a project without catalogs 404s, the quietest shape.
 *  None of the four controls here is catalog-dependent. */
function fetch404(): void {
	// Boundary cast: the stub serves only the toolbar's catalog GETs, so it implements the
	// call signature and none of `fetch`'s statics.
	globalThis.fetch = (() =>
		Promise.resolve(
			new Response("", { status: 404 }),
		)) as unknown as typeof fetch;
}

const withEditor = (
	ui: ReactElement,
	stub: ReturnType<typeof makeStubHost>,
): ReactElement => (
	<EditorContext.Provider
		value={makeEditorContext({ fieldHostRef: { current: stub.host } })}
	>
		{ui}
	</EditorContext.Provider>
);

async function renderShell(stub: ReturnType<typeof makeStubHost>) {
	const result = render(withEditor(<Shell />, stub));
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
	return result;
}

const HALL: FieldGeneratorInfo = {
	id: "hall",
	name: "Hall",
	paramSchema: { type: "object", properties: {} },
	defaults: {},
	placesProps: false,
	usesSeed: false,
};

/** A live stamp session, mid-configure — the standing under which the cancel ladder has
 *  something to destroy. */
const SESSION: StampSession = {
	generator: "hall",
	params: { width: 8 },
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
};

/** Undo a disclosure this file opened, set by the `merge policy` site and run before the
 *  tree is unmounted. Module-scoped UI memory is the one kind of state `cleanup()` cannot
 *  reach, so it has to be handed back deliberately. */
let restoreAdvanced: (() => void) | null = null;

const strip = (): HTMLElement =>
	screen.getByRole("group", { name: "tool options" });

/** Arm a brush effect through the KEYBOARD family, stepping with ⇧B until the strip names
 *  the target — the family is a ring, so a fixed count is only right from one place on it.
 *  Lifted from `tool-strip.test.tsx`, which owns the same recipe. */
function armEffect(effect: "dig" | "fill" | "paint" | "smooth"): void {
	act(() => {
		fireEvent.keyDown(window, { key: "b" });
	});
	const want = effect.toUpperCase();
	for (let i = 0; i < 5; i++) {
		if (within(strip()).queryAllByText(want).length > 0) return;
		act(() => {
			fireEvent.keyDown(window, { key: "B", shiftKey: true });
		});
	}
	throw new Error(`the brush family never reached ${want}`);
}

// --- the four sites ----------------------------------------------------------

/** One allowlisted control: where it lives, and how to get it on screen.
 *
 *  Keyed by the ACCESSIBLE NAME the `.grit` allowlist pins, so this table and the rule
 *  name the same four strings — the allowlist is by name precisely so a fifth raw select
 *  cannot arrive unnoticed, and a walk keyed by anything else would not hold it to that. */
const SITES: readonly {
	label: string;
	file: string;
	/** `Promise` OR plain: only the ⋯ site has to await a portal, and making the other three
	 *  `async` for symmetry would be three `useAwait` suppressions for nothing. `await` on a
	 *  non-promise is a no-op, so the call site stays one line. */
	reach: (
		stub: ReturnType<typeof makeStubHost>,
	) => HTMLElement | Promise<HTMLElement>;
}[] = [
	{
		label: "brush mask",
		file: "shell/tool-params.tsx",
		reach: () => {
			armEffect("dig");
			return within(strip()).getByLabelText("brush mask");
		},
	},
	{
		label: "smooth mode",
		file: "shell/tool-params.tsx",
		reach: () => {
			armEffect("smooth");
			return within(strip()).getByLabelText("smooth mode");
		},
	},
	{
		label: "smooth iterations",
		file: "shell/tool-params.tsx",
		// Smooth's list is longer than its strip, so iterations lives behind the ⋯ — the
		// popover is the only place this control is reachable at all.
		reach: async () => {
			armEffect("smooth");
			fireEvent.click(
				within(strip()).getByRole("button", { name: /^all smooth options/ }),
			);
			const all = await screen.findByRole("group", {
				name: "all smooth options",
			});
			return within(all).getByLabelText("smooth iterations");
		},
	},
	{
		label: "merge policy",
		file: "shell/session-card/AdvancedSection.tsx",
		// The session card's advanced disclosure, reached through a REAL live stamp session
		// rather than through `entitySelection`. This is the only one of the four that can
		// stand beside a session at all — the other three are detached by the strip swap the
		// moment one exists — so it is the only place the session-destroying rungs of the
		// ladder are actually within reach of a keypress. That makes it the site that carries
		// the ⏎ half below.
		reach: (stub) => {
			act(() => {
				stub.fire.stamp(SESSION);
			});
			const box = screen.getByRole("region", { name: "Session" });
			// The disclosure remembers itself across mounts and that memory is module-scoped —
			// it outlives this file. So: ask what it is doing rather than clicking blind (the
			// session-card.test.tsx rule), and put it BACK, because leaving it open is a state
			// leak into whatever runs next. It already cost one cross-file failure:
			// `session-card.test.tsx` had a bare toggle that read as "open" only while nothing
			// else had opened it first.
			const trigger = within(box).getByRole("button", { name: /advanced/ });
			const wasOpen = trigger.getAttribute("aria-expanded") === "true";
			if (!wasOpen) {
				fireEvent.click(trigger);
				restoreAdvanced = () => fireEvent.click(trigger);
			}
			return within(
				screen.getByRole("region", { name: "Session" }),
			).getByLabelText("merge policy");
		},
	},
];

for (const site of SITES) {
	test(`Esc on the "${site.label}" select does NOT run the cancel ladder (${site.file})`, async () => {
		fetch404();
		const stub = makeStubHost({ generators: [HALL] });
		await renderShell(stub);
		const el = await site.reach(stub);

		// The allowlist grants a NATIVE select and nothing else. A Radix trigger is a
		// `<button>`, so this is the assertion that fails first on a migration — and it is
		// what makes the Esc claim below mean what it says.
		expect(el instanceof HTMLSelectElement).toBe(true);
		// NON-VACUITY: a detached node swallows the event before any listener sees it, which
		// is how the pre-existing shell.test.tsx pin passes without testing the gate.
		expect(el.isConnected).toBe(true);

		act(() => {
			fireEvent.keyDown(el, { key: "Escape" });
		});
		expect(stub.calls.escape).not.toHaveBeenCalled();
	});
}

// --- the ⏎ half, on the ONE control that can carry it ------------------------

test("⏎ on the merge-policy select does NOT commit the live session it sits inside", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	// BY NAME, not by position. `SITES.at(-1)` would silently retarget this case at whatever
	// a future entry appended — and the likeliest new entry is another tool-strip control,
	// which a live session DETACHES, making this assertion vacuous in exactly the way the
	// case it replaced was. The throw is the point: a missing site must stop the run, not
	// quietly test something else.
	const mergePolicy = SITES.find((s) => s.label === "merge policy");
	if (mergePolicy === undefined)
		throw new Error("the merge-policy site is gone; this case has no subject");
	const el = await mergePolicy.reach(stub);

	// ⏎ is a native select's OWN commit key — the keystroke a user presses to accept the
	// highlighted option. The editor binds it to `session.confirm` → `host.confirmSession()`,
	// which APPLIES the stamp. The VERB matters and is the third way the case this replaces
	// was vacuous: it asserted on `commitSession`, a different mock that ⏎ never touches, so
	// it would have held even against a connected node and a broken gate.
	// So the gate has to hold here for a reason Esc's case does not cover: Esc destroys
	// work, ⏎ ships it, and both are one keypress from a control the user opened on purpose.
	//
	// This claim was previously made in `shell.test.tsx` against the brush-mask select, where
	// it could never fail: that node is detached by the strip swap before the session exists,
	// so the event reached no listener. The merge-policy select is the only allowlisted
	// control that is CONNECTED while a session is live, which is what makes the assertion
	// real. Both guards below are the non-vacuity proof.
	expect(el instanceof HTMLSelectElement).toBe(true);
	expect(el.isConnected).toBe(true);

	act(() => {
		fireEvent.keyDown(el, { key: "Enter" });
	});
	expect(stub.calls.confirmSession).not.toHaveBeenCalled();
});

test("⏎ from a plain element DOES commit the session — the case above is not vacuous", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(SESSION);
	});
	const box = screen.getByRole("region", { name: "Session" });
	expect(box.isConnected).toBe(true);
	act(() => {
		fireEvent.keyDown(box, { key: "Enter" });
	});
	expect(stub.calls.confirmSession).toHaveBeenCalled();
});

// --- the control case: the assertion above can FAIL --------------------------

test("Esc from a plain element DOES reach the cancel ladder — the four cases are not vacuous", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	armEffect("dig");
	// Same standing, same key, same dispatch — the only difference is the target's TYPE.
	// Without this case, every assertion above is satisfied by an Esc that reaches nothing.
	const plain = within(strip()).getByLabelText("brush mask").parentElement;
	expect(plain instanceof HTMLElement).toBe(true);
	expect((plain as HTMLElement).isConnected).toBe(true);
	act(() => {
		fireEvent.keyDown(plain as HTMLElement, { key: "Escape" });
	});
	expect(stub.calls.escape).toHaveBeenCalled();
});
