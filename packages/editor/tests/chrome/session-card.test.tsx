// Registered FIRST — the shell.test.tsx rule (Radix resolves `globalThis.document` at
// module-evaluation time; the collapsible and the picker never mount if the DOM was not
// there yet).
import "../inspector/_register.ts";

// The SESSION CARD (F4.5b Task 10, D-13): the editor's properties surface, and the palette
// whose open state the editor drives rather than the user.
//
// Three states, one control set:
//   - CREATE — a `stamp` session. It is about a region, not an entity; ⏎ commits.
//   - REST — an entity is selected and NOTHING is armed. The params come off the committed
//     RECORD, no ghost is previewing, and the first control the user COMMITS through
//     promotes the card into a reconfigure carrying that edit.
//   - RECONFIGURE — a `reconfigure` session (a MOVE is one of these, flagged). The params
//     come off the SESSION, the ghost previews live, ⏎ applies.
//
// The load-bearing claims, each of which has a way to be silently wrong:
//   1. rest renders from the RECORD and reconfigure from the SESSION, and the card picks
//      ONE — never merges them. A card that read the record while a session stood would
//      show the committed values under a ghost showing something else.
//   2. the promotion carries its touch. Getting this wrong loses the FIRST edit of every
//      reconfigure, silently, which is the worst failure available here.
//   3. the seed row is gated on the generator's `usesSeed`, so a hall never shows a
//      re-roll that does nothing.
//   4. the LIFECYCLE verbs (freeze / sever / delete) are NOT here — D-14 puts them on
//      the entity row, and the card is where a user would most plausibly reach for them.
//
// HOUSE RULE, and this file learned it the hard way (a sabotage run took two minutes to
// report): every "this element is absent" assertion compares to null BEFORE the expect. A
// happy-dom element carries React's whole fiber graph, so a FAILING `toBeNull()` on one
// serialises tens of megabytes and reads as a hung run rather than as a failed assertion.
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { EditorContext } from "../../src/frontend/components/editor-context.ts";
import { Shell } from "../../src/frontend/components/shell/Shell.tsx";
import { notify } from "../../src/frontend/lib/notify-store.ts";
import type {
	FieldEntityInfo,
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
import { makeStats, makeStubHost } from "./_stub-host.ts";

afterEach(cleanup);
afterEach(() => notify.clear());

// --- environment -------------------------------------------------------------

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

/** A one-archetype `catalog/entities.json` in the v1 shape parseEntityCatalog takes. */
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
	],
});

/** 404 every catalog GET — the default for cases that are not about the catalog. */
function fetch404(): void {
	// Boundary cast: the stub serves only the catalog GETs, so it implements the call
	// signature and none of `fetch`'s statics.
	globalThis.fetch = (() =>
		Promise.resolve(
			new Response("", { status: 404 }),
		)) as unknown as typeof fetch;
}

/** Serve the ENTITY catalog and 404 the other two. */
function stubEntityCatalog(): void {
	// Boundary cast: see fetch404.
	globalThis.fetch = ((input: unknown) =>
		Promise.resolve(
			String(input).includes("entities.json")
				? new Response(ENTITIES_JSON, { status: 200 })
				: new Response("", { status: 404 }),
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

/** Two microtask turns: the catalog path awaits fetch() then res.text(). */
const flushCatalog = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});

async function renderShell(stub: ReturnType<typeof makeStubHost>) {
	const result = render(withEditor(<Shell />, stub));
	await flushCatalog();
	return result;
}

// --- fixtures ----------------------------------------------------------------

const HALL: FieldGeneratorInfo = {
	id: "hall",
	name: "Hall",
	paramSchema: {
		type: "object",
		properties: { width: { type: "number", default: 8 } },
	},
	defaults: { width: 8 },
	placesProps: false,
	// A hall does not read its seed (core's own declaration), so the card must not offer
	// one — that is claim 3.
	usesSeed: false,
};

const MAZE: FieldGeneratorInfo = {
	id: "maze",
	name: "Maze",
	paramSchema: {
		type: "object",
		properties: { braid: { type: "number", default: 0.25 } },
	},
	defaults: { braid: 0.25 },
	placesProps: false,
	usesSeed: true,
};

const SCATTER: FieldGeneratorInfo = {
	id: "scatter",
	name: "Scatter",
	paramSchema: {
		type: "object",
		properties: { archetypeId: { type: "string", default: "rock" } },
	},
	defaults: { archetypeId: "rock" },
	placesProps: true,
	usesSeed: true,
};

function makeSession(overrides: Partial<StampSession> = {}): StampSession {
	return {
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
		...overrides,
	};
}

function makeEntity(overrides: Partial<FieldEntityInfo> = {}): FieldEntityInfo {
	return {
		entityId: 3,
		type: "generator",
		generator: "hall",
		params: { width: 8 },
		seed: 7,
		region: { min: [0, 0, 0], max: [4, 4, 4] },
		opSpan: [0, 0],
		// `frozen`/`baked` are `?: true` in core, so ABSENT is the only spelling of "not
		// frozen" — `false` does not type-check.
		placed: [],
		...overrides,
	};
}

// --- addressing --------------------------------------------------------------

/** The card's palette box, or null when it is not open. Resolved by ROLE and NAME, so the
 *  claim is about a region a screen reader reaches rather than about a div. */
const card = (): HTMLElement | null =>
	screen.queryByRole("region", { name: "Session" });

/** The card, or a throw naming what went wrong — every assertion below is meaningless
 *  without it, and `within(null)` fails with a stack that names nothing. */
function openCard(): HTMLElement {
	const box = card();
	if (!(box instanceof HTMLElement))
		throw new Error("the session card is not open");
	return box;
}

/** Open the burger. Radix opens on pointerdown, not click (the shell.test.tsx recipe). */
function openBurger(): void {
	act(() => {
		fireEvent.pointerDown(screen.getByLabelText("editor menu"), {
			button: 0,
			pointerType: "mouse",
		});
	});
}

/** Select `entity` on the host, as the viewport's pointer or an Entities row does. */
function selectEntity(
	stub: ReturnType<typeof makeStubHost>,
	entities: FieldEntityInfo[],
	id: number | null,
): void {
	stub.setEntities(entities);
	act(() => {
		stub.fire.entities();
		stub.fire.entitySelection(id);
	});
}

/** Open the card's `▸ advanced` disclosure, whatever state it is IN.
 *
 *  The disclosure remembers itself across mounts (D-25 / `AdvancedSection`), and that
 *  memory is module-scoped, so it also survives between tests in this file. A bare click
 *  would therefore CLOSE it for any test that runs after one which opened it — an order
 *  dependency that reads as a mysterious "cannot find nudge plus X". Asking the trigger
 *  what it is doing removes the dependency instead of hiding it. */
function openAdvanced(box: HTMLElement): void {
	const trigger = within(box).getByRole("button", { name: /advanced/ });
	if (trigger.getAttribute("aria-expanded") !== "true")
		fireEvent.click(trigger);
}

// --- (a) the palette id, and who decides whether it is open ------------------

test("the card ships CLOSED and auto-opens when a session begins", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	// Nothing to be about yet: no session, no selection. A properties panel open over
	// nothing is exactly the empty-inspector the category was retired for.
	expect(card() === null).toBe(true);

	act(() => {
		stub.fire.stamp(makeSession());
	});
	expect(within(openCard()).getByText("hall")).toBeTruthy();

	// …and auto-closes when the session ends with nothing selected.
	act(() => {
		stub.fire.stamp(null);
	});
	expect(card() === null).toBe(true);
});

test("the card auto-opens on a SELECTION with no session, and closes when it clears", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	selectEntity(stub, [makeEntity()], 3);
	expect(within(openCard()).getByText("hall #3")).toBeTruthy();

	selectEntity(stub, [makeEntity()], null);
	expect(card() === null).toBe(true);
});

// The auto-open is not a latch, and this is the case that says so. Closing the card is a
// statement about the thing you were just looking at, not a mode you enter: the card is the
// ONLY properties surface, so a dismissal that outlived its subject would leave `openEntity`
// with nowhere to render and no obvious way back.
test("a card closed by hand stays closed for THAT subject and returns for the next one", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	const first = makeEntity({ entityId: 3 });
	const second = makeEntity({ entityId: 4, params: { width: 12 } });
	selectEntity(stub, [first, second], 3);
	openCard();

	act(() => {
		fireEvent.click(screen.getByRole("button", { name: "close Session" }));
	});
	expect(card() === null).toBe(true);

	// The SAME subject, pushed again (an entity tick — a commit elsewhere, a freeze on
	// another row). The card must not fight the user back open.
	selectEntity(stub, [first, second], 3);
	expect(card() === null).toBe(true);

	// A DIFFERENT subject is a new question, so the card answers it.
	selectEntity(stub, [first, second], 4);
	expect(within(openCard()).getByText("hall #4")).toBeTruthy();
});

// --- (b) the three states ----------------------------------------------------

test("CREATE names the stamp and offers commit/discard", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(makeSession({ phase: "ready" }));
	});
	const box = openCard();
	expect(within(box).getByText("STAMP")).toBeTruthy();
	// The two verbs carry their KEY in the accessible name, because the visible glyph is
	// what the user reads and "⏎" is not a word.
	fireEvent.click(within(box).getByRole("button", { name: "commit (Enter)" }));
	// `confirmSession`, not `commitSession`: the button wears the ⏎ keycap, so it must be
	// the same verb the ⏎ KEY runs — the one that knows a live grab is dropped rather than
	// applied. Two spellings of one key is how they come to mean different things.
	expect(stub.calls.confirmSession).toHaveBeenCalledTimes(1);
	expect(stub.calls.commitSession).not.toHaveBeenCalled();

	fireEvent.click(within(box).getByRole("button", { name: "discard (Esc)" }));
	// `cancelStamp`, not `escape`: the ladder's first rung is a half-drawn box corner,
	// which CAN stand beside a session (`selectionClick` is not suspended), and a button
	// that says "revert" must revert.
	expect(stub.calls.cancelStamp).toHaveBeenCalledTimes(1);
	expect(stub.calls.escape).not.toHaveBeenCalled();
});

test("RECONFIGURE names the entity, offers apply/revert, and states the two openEntity caveats", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(
			makeSession({ mode: "reconfigure", entityId: 1, phase: "ready" }),
		);
	});
	const box = openCard();
	expect(within(box).getByText("hall #1")).toBeTruthy();
	expect(within(box).getByText("RECONFIGURE")).toBeTruthy();
	expect(
		within(box).getByRole("button", { name: "apply (Enter)" }),
	).toBeTruthy();
	expect(
		within(box).getByRole("button", { name: "revert (Esc)" }),
	).toBeTruthy();
	// The two v0 limits `openEntity`'s own contract carries, said once rather than left to
	// surprise at Apply.
	expect(within(box).getByText(/merge policy isn't recorded/)).toBeTruthy();
	expect(
		within(box).getByText(/rewinds this stamp's chunks first/),
	).toBeTruthy();
});

test("a MOVE is a reconfigure that says DROP — the session strip's own three-way tag", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(
			makeSession({
				mode: "reconfigure",
				entityId: 1,
				phase: "ready",
				moving: true,
			}),
		);
	});
	const box = openCard();
	expect(within(box).getByText("MOVE")).toBeTruthy();
	// ⏎ DROPS a grab. Naming it "apply" here would promise a reconfigure the host does not
	// perform — `confirmSession` routes a move through `dropMove`'s zero-step rule instead.
	expect(
		within(box).getByRole("button", { name: "drop (Enter)" }),
	).toBeTruthy();
	expect(
		within(box).queryByRole("button", { name: "apply (Enter)" }) === null,
	).toBe(true);
});

test("the commit verb is gated on the ghost settling", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(makeSession({ phase: "configuring" }));
	});
	const commit = (): HTMLButtonElement =>
		within(openCard()).getByRole("button", {
			name: "commit (Enter)",
		}) as HTMLButtonElement;
	expect(commit().disabled).toBe(true);
	act(() => {
		stub.fire.stamp(makeSession({ phase: "ready", opCount: 3 }));
	});
	expect(commit().disabled).toBe(false);
	fireEvent.click(commit());
	expect(stub.calls.confirmSession).toHaveBeenCalledTimes(1);
});

// --- (c) REST: the record, and the promotion ---------------------------------

test("REST renders the RECORD's params with nothing armed", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	selectEntity(stub, [makeEntity({ params: { width: 12 } })], 3);
	const box = openCard();
	expect(within(box).getByText("SELECTED")).toBeTruthy();
	// The value on screen is the committed one, and it came from the record: the session
	// seam has pushed nothing but `null`.
	expect((within(box).getByLabelText("Width") as HTMLInputElement).value).toBe(
		"12",
	);
	// Nothing is armed — there is no ghost to apply or revert, so neither verb is offered.
	// A disabled pair would be worse than none: it advertises a state the user cannot
	// reach from here, when the way in is simply to edit something.
	expect(
		within(box).queryByRole("button", { name: /\(Enter\)$/ }) === null,
	).toBe(true);
	expect(within(box).queryByRole("button", { name: /\(Esc\)$/ }) === null).toBe(
		true,
	);
	expect(stub.calls.openEntity).not.toHaveBeenCalled();
});

test("the first COMMITTED touch promotes the card, and the session opens carrying that touch", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	// The real host opens the session SYNCHRONOUSLY inside `openEntity`
	// (`openEntitySession` sets the session, then `previewStamp` publishes it), so the
	// touch and the session land in ONE React commit. The stub only records, so the test
	// plays the host's half from inside the call — which is what makes this a model of the
	// production ordering rather than a convenience. Getting that ordering wrong is not
	// hypothetical: the parked touch is one-shot, and a session that arrives a commit late
	// is a session the card has already given up on (see the refusal case below).
	let updatesWhenOpened = -1;
	stub.calls.openEntity.mockImplementation(() => {
		updatesWhenOpened = stub.calls.updateStamp.mock.calls.length;
		stub.fire.stamp(
			makeSession({
				mode: "reconfigure",
				entityId: 3,
				params: { width: 8 },
				seed: 7,
				policy: "replace",
			}),
		);
	});

	selectEntity(stub, [makeEntity({ params: { width: 8 } })], 3);
	const width = within(openCard()).getByLabelText("Width") as HTMLInputElement;
	// Focus first, as a user does: NumberField's blur committer reads a baseline it
	// captures while UNfocused, and its own tests drive it the same way.
	act(() => {
		width.focus();
	});

	// TYPING is not a touch. NumberField previews on every keystroke, and a promotion per
	// keystroke would open (and cancel, and re-open) a session per character — each one
	// firing a worker ghost — and would open it on "1" while the user was typing "12".
	fireEvent.change(width, { target: { value: "12" } });
	expect(stub.calls.openEntity).not.toHaveBeenCalled();

	// The COMMIT is. NumberField commits on blur, dirty-checked.
	act(() => {
		fireEvent.blur(width);
	});
	expect(stub.calls.openEntity.mock.calls).toEqual([[3]]);
	// The session opened on the RECORD's params — nothing had been pushed into it yet,
	// because there was no session to push into. A card that guessed at what `openEntity`
	// would produce (and in particular at the merge policy, which `GeneratorEntity` does
	// not record) would have called `updateStamp` before this point.
	expect(updatesWhenOpened).toBe(0);
	// THIS is where the touch lands — patched onto the session's OWN params, seed and
	// policy.
	expect(stub.calls.updateStamp.mock.calls).toEqual([
		[{ width: 12 }, 7, "replace"],
	]);
	// The card is a reconfigure now, and the value it shows is the touched one.
	expect(within(openCard()).getByText("RECONFIGURE")).toBeTruthy();
});

test("the promotion REMOUNTS the state tag, which is what replays its animation", async () => {
	// D-23's motion channel (F4.5c Task 13). The promotion is the one state change in this
	// card the user does not ask for directly — a committed touch causes it — so the tag
	// announces itself with a 180 ms pop.
	//
	// The thing worth testing is the MECHANISM, not the class string. A CSS animation runs
	// on mount and never again, so a tag element that React merely re-labels animates
	// exactly once in the card's life: on the first render, the one nobody needs told
	// about. The `key={tag}` is what forces the unmount, and `isConnected` is what proves
	// it happened — a class assertion alone would pass just as happily with the key
	// deleted, which is the shape of vacuous pin this suite keeps finding.
	//
	// happy-dom resolves no styles and runs no animations, so this is the whole of what a
	// headless test can say here; that the pop READS as feedback is a Safari-gate question.
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	stub.calls.openEntity.mockImplementation(() => {
		stub.fire.stamp(
			makeSession({
				mode: "reconfigure",
				entityId: 3,
				params: { width: 8 },
				seed: 7,
				policy: "replace",
			}),
		);
	});

	selectEntity(stub, [makeEntity({ params: { width: 8 } })], 3);
	const restTag = within(openCard()).getByText("SELECTED");
	expect(restTag.className).toContain(
		"animate-[furnace-pop-in_180ms_ease-out]",
	);
	expect(restTag.isConnected).toBe(true);

	const width = within(openCard()).getByLabelText("Width") as HTMLInputElement;
	act(() => {
		width.focus();
	});
	fireEvent.change(width, { target: { value: "12" } });
	act(() => {
		fireEvent.blur(width);
	});

	// A NEW element carries the new tag, and the old one left the document — so the
	// animation is on its first frame rather than long finished.
	const liveTag = within(openCard()).getByText("RECONFIGURE");
	expect(liveTag === restTag).toBe(false);
	expect(restTag.isConnected).toBe(false);
	expect(liveTag.className).toContain(
		"animate-[furnace-pop-in_180ms_ease-out]",
	);
});

test("a promotion the host REFUSES drops its touch instead of parking it for the next session", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	// A FROZEN entity: `openEntity` refuses it (runtime-quiet, on the tool-error seam) and
	// opens nothing. A pending touch that survived would land on whatever session opened
	// NEXT — a different entity, with the previous one's edit silently applied to it.
	selectEntity(stub, [makeEntity({ params: { width: 8 } })], 3);
	const width = within(openCard()).getByLabelText("Width") as HTMLInputElement;
	act(() => {
		width.focus();
	});
	fireEvent.change(width, { target: { value: "12" } });
	act(() => {
		fireEvent.blur(width);
	});
	expect(stub.calls.openEntity.mock.calls).toEqual([[3]]);
	// The refusal: no session arrives. Then an UNRELATED session opens later.
	act(() => {
		stub.fire.stamp(
			makeSession({ mode: "reconfigure", entityId: 9, params: { width: 4 } }),
		);
	});
	expect(stub.calls.updateStamp).not.toHaveBeenCalled();
});

// The two sources, and the rule that keeps them from disagreeing: the card SELECTS one —
// a session if there is one, the record otherwise — and never merges. This is the case
// where they hold different numbers, which is the normal state of a live reconfigure (the
// record keeps the committed value until Apply lands).
test("while a session stands the card reads the SESSION, not the record it came from", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	selectEntity(stub, [makeEntity({ params: { width: 8 } })], 3);
	act(() => {
		stub.fire.stamp(
			makeSession({
				mode: "reconfigure",
				entityId: 3,
				params: { width: 12 },
				phase: "ready",
			}),
		);
	});
	const box = openCard();
	expect((within(box).getByLabelText("Width") as HTMLInputElement).value).toBe(
		"12",
	);
	expect(within(box).getByText("RECONFIGURE")).toBeTruthy();
	expect(within(box).queryByText("SELECTED") === null).toBe(true);
});

// REST's merge select reads "Replace" for every committed stamp, because
// `GeneratorEntity` records no policy — so the value is a PREDICTION about what a
// reconfigure would open at, not a fact read off the record. Without the caveat the card
// states it as a fact, which is the one thing a properties surface must not do.
test("REST says the merge policy is unrecorded, beside the value it is showing", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	selectEntity(stub, [makeEntity()], 3);
	const box = openCard();
	expect(
		within(box).getByText(/merge policy isn't recorded/).textContent,
	).toContain("a reconfigure opens at Replace");
	// …and the control it qualifies really is showing that value (the caveat is about a
	// select the user can see, not a general disclaimer).
	//
	// Through `openAdvanced`, not a bare click: the disclosure's memory is module-scoped, so
	// a toggle here reads as "open" only while nothing else in the RUN opened it first. That
	// is the order dependency `openAdvanced`'s own note describes, and it went live when
	// `native-select-key-gate.test.tsx` started reaching the same control.
	openAdvanced(box);
	expect(
		(within(openCard()).getByLabelText("merge policy") as HTMLSelectElement)
			.value,
	).toBe("replace");

	// A CREATE session needs no caveat at all — the policy there is simply what the user
	// picked, and a permanent disclaimer under a live control is noise.
	act(() => {
		stub.fire.stamp(makeSession());
	});
	expect(
		within(openCard()).queryByText(/merge policy isn't recorded/) === null,
	).toBe(true);
});

// --- (d) usesSeed gating, and the verbs that are NOT here --------------------

test("the seed row rides the generator's usesSeed declaration", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL, MAZE] });
	await renderShell(stub);

	// A hall ignores its seed, so a seed field and a re-roll would both be dead controls.
	act(() => {
		stub.fire.stamp(makeSession({ generator: "hall" }));
	});
	expect(within(openCard()).queryByLabelText("seed") === null).toBe(true);
	expect(within(openCard()).queryByLabelText("re-roll seed") === null).toBe(
		true,
	);

	// A maze reads it, so both appear and the re-roll reaches the host.
	act(() => {
		stub.fire.stamp(
			makeSession({ generator: "maze", params: { braid: 0.25 } }),
		);
	});
	const box = openCard();
	// Resolved through the LABEL ASSOCIATION rather than an `aria-label`, which is what
	// makes this cover the association at all. The row first shipped with a sibling
	// `<label>` beside an `aria-label`-ed input: a lookup by name passed while the visible
	// 52 px "seed" target focused nothing, and a biome suppression carrying a justification
	// copied from a file where it was true hid the violation. The `htmlFor` assertion below
	// is the half that catches that.
	const seedInput = within(box).getByLabelText("seed") as HTMLInputElement;
	expect(seedInput.value).toBe("7");
	expect(box.querySelector(`label[for="${seedInput.id}"]`)?.textContent).toBe(
		"seed",
	);
	fireEvent.click(within(box).getByLabelText("re-roll seed"));
	expect(stub.calls.rerollStamp).toHaveBeenCalledTimes(1);
});

test("the LIFECYCLE verbs are not on the card (D-14 — they live on the entity row)", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	selectEntity(stub, [makeEntity()], 3);
	const box = openCard();
	// Asserted against the CARD, not the document: the entities palette renders all three
	// for this very entity a few pixels away, which is the whole point — one place for the
	// verbs that change what an entity IS, another for the values it holds.
	for (const verb of ["freeze", "sever", "delete", "unfreeze"])
		expect(
			within(box).queryByRole("button", { name: new RegExp(`^${verb} `) }) ===
				null,
		).toBe(true);
	// …and they really are reachable on the row, so the assertion above is about
	// PLACEMENT rather than about a verb nobody implemented. (The list section starts
	// collapsed, so it takes a click to reach.)
	act(() => {
		fireEvent.click(screen.getByText("Entities (1)"));
	});
	expect(screen.getByLabelText("freeze entity 3")).toBeTruthy();
});

// --- (e) the ported stamp coverage -------------------------------------------

test("the nudge cluster drives host.nudgeStamp in whole lattice STEPS", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(makeSession());
	});
	// The region controls sit under `advanced`: they are session MECHANICS (where the
	// stamp sits, how it merges) rather than recipe values, and the mock's card shows the
	// recipe above a `▸ advanced` disclosure.
	openAdvanced(openCard());
	const box = openCard();
	const pressed: [string, [number, number, number]][] = [
		["nudge minus X", [-1, 0, 0]],
		["nudge plus X", [1, 0, 0]],
		["nudge minus Y", [0, -1, 0]],
		["nudge plus Y", [0, 1, 0]],
		["nudge minus Z", [0, 0, -1]],
		["nudge plus Z", [0, 0, 1]],
	];
	for (const [label] of pressed)
		fireEvent.click(within(box).getByLabelText(label));
	expect(stub.calls.nudgeStamp.mock.calls).toEqual(pressed.map(([, s]) => s));
});

// --- (e2) the D-25 forms vocabulary reaches the card -------------------------

/** A generator whose params are BOUNDED, so the card renders D-25's controls rather than
 *  plain text fields. `chamberRadius` is the slider (a wide continuous span with a unit);
 *  `chambers` is the stepper (four notches end to end). */
const CAVE: FieldGeneratorInfo = {
	id: "cave",
	name: "Cave",
	paramSchema: {
		type: "object",
		properties: {
			chamberRadius: {
				type: "number",
				minimum: 3,
				maximum: 8,
				default: 5,
				furnace: { unit: "m" },
			},
			chambers: {
				type: "number",
				minimum: 2,
				maximum: 6,
				multipleOf: 1,
				default: 3,
			},
		},
	},
	defaults: { chamberRadius: 5, chambers: 3 },
	placesProps: false,
	usesSeed: true,
};

const caveSession = () =>
	makeSession({
		generator: "cave",
		params: { chamberRadius: 5, chambers: 3 },
		phase: "ready",
	});

test("a bounded param renders its slider, its unit and its stepper (D-25)", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [CAVE] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(caveSession());
	});
	const box = openCard();
	expect(
		within(box).getByRole("slider", { name: "Chamber Radius" }),
	).toBeTruthy();
	expect(within(box).getByText("m")).toBeTruthy();
	// The short integer range gets ± rather than a track: four notches over a 120 px
	// slider is ~30 px per chamber.
	expect(within(box).getByLabelText("increase Chambers")).toBeTruthy();
	// `queryByRole` returns null when absent; compare to null FIRST (house rule).
	expect(within(box).queryByRole("slider", { name: "Chambers" }) === null).toBe(
		true,
	);
});

test("an out-of-range param refuses at the field AND disables ⏎ by NAME", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [CAVE] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(caveSession());
	});
	const radius = within(openCard()).getByLabelText(
		"Chamber Radius exact",
	) as HTMLInputElement;
	act(() => {
		radius.focus();
		fireEvent.change(radius, { target: { value: "40" } });
	});

	// The refusal is at the field…
	expect(within(openCard()).getByRole("alert").textContent).toContain(
		"must be at most 8",
	);
	// …the ghost never sees it (a worker round trip to be told what `maximum: 8` says)…
	expect(stub.calls.updateStamp).not.toHaveBeenCalled();
	// …and the commit verb NAMES the field rather than saying "invalid". A bottom-of-form
	// dump makes the user hunt; a verb that names one field does not.
	const commit = within(openCard()).getByRole("button", {
		name: "commit (Enter)",
	}) as HTMLButtonElement;
	expect(commit.disabled).toBe(true);
	expect(
		within(openCard()).getByText(/Chamber Radius must be at most 8/),
	).toBeTruthy();
});

test("an external push clears a standing refusal — the verb does not stay dead", async () => {
	// The card is NOT remounted on a subject change: `SessionCardPresence` only calls
	// `setDrivenOpen("session", true)`, which is already true, so the SAME `SchemaForm`
	// instance survives every push. Refuse a field, then let ANY external push land — a
	// different entity's reconfigure, a ⚄ reroll, an undo, an SSE change. Before the fix
	// the exact input re-seeded to the incoming valid number while the row kept printing
	// `must be at most 8` and ⏎ stayed disabled naming a field that was now fine, with the
	// only exit being to edit that field again.
	fetch404();
	const stub = makeStubHost({ generators: [CAVE] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(caveSession());
	});
	const radius = within(openCard()).getByLabelText(
		"Chamber Radius exact",
	) as HTMLInputElement;
	act(() => {
		radius.focus();
		fireEvent.change(radius, { target: { value: "40" } });
		// `focusout`, not `blur`: only the bubbling event reaches the form's
		// `onBlurCapture`, which is what releases the echo guard deferring the re-seed.
		fireEvent.focusOut(radius);
	});
	expect(within(openCard()).getByRole("alert").textContent).toContain(
		"must be at most 8",
	);

	act(() => {
		stub.fire.stamp(
			makeSession({
				generator: "cave",
				params: { chamberRadius: 6, chambers: 3 },
				phase: "ready",
			}),
		);
	});
	// The field took the incoming value…
	expect(radius.value).toBe("6");
	// …so the refusal is gone from the row, from the verb's reason, and from the disable.
	// `queryByRole` returns null when absent; compare to null FIRST (house rule).
	expect(within(openCard()).queryByRole("alert") === null).toBe(true);
	expect(
		within(openCard()).queryByText(/Chamber Radius must be at most 8/) === null,
	).toBe(true);
	expect(
		(
			within(openCard()).getByRole("button", {
				name: "commit (Enter)",
			}) as HTMLButtonElement
		).disabled,
	).toBe(false);
});

test("the ▸ advanced disclosure survives the card closing and coming back", async () => {
	// The card UNMOUNTS whenever its palette closes (`PaletteLayer` renders `open ?
	// <Palette> : null`), and the nudge d-pad behind this disclosure is the only MOUSE
	// route to moving a stamp region — so a disclosure that re-collapsed per subject cost
	// a click every single session.
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(makeSession());
	});
	openAdvanced(openCard());
	expect(within(openCard()).getByLabelText("nudge plus X")).toBeTruthy();

	// Away (the card unmounts) and back on a DIFFERENT subject, so the presence driver
	// really re-opens rather than leaving the same mount standing.
	act(() => {
		stub.fire.stamp(null);
	});
	expect(card() === null).toBe(true);
	act(() => {
		stub.fire.stamp(makeSession({ generator: "hall", entityId: 42 }));
	});
	expect(within(openCard()).getByLabelText("nudge plus X")).toBeTruthy();
});

test("the merge policy re-previews through the ONE update seam", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(makeSession());
	});
	openAdvanced(openCard());
	fireEvent.change(within(openCard()).getByLabelText("merge policy"), {
		target: { value: "keep-existing-air" },
	});
	expect(stub.calls.updateStamp.mock.calls).toEqual([
		[{ width: 8 }, 7, "keep-existing-air"],
	]);
});

test("the props count shows for a prop generator only — a carver never reads '0 props'", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL, SCATTER] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(
			makeSession({ phase: "ready", opCount: 12, placementCount: 0 }),
		);
	});
	expect(within(openCard()).getByText(/12 ops/)).toBeTruthy();
	expect(within(openCard()).queryByText(/\d+ props/) === null).toBe(true);

	// For scatter it is the ONLY output — shown even at zero, because that is the reading
	// the host's commit refusal then explains.
	act(() => {
		stub.fire.stamp(
			makeSession({
				generator: "scatter",
				params: { archetypeId: "rock" },
				phase: "ready",
				opCount: 0,
				placementCount: 0,
			}),
		);
	});
	expect(within(openCard()).getByText(/0 props/)).toBeTruthy();
});

test("a failed preview reports ABOVE the verbs", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	act(() => {
		stub.fire.stamp(makeSession({ error: "region is empty" }));
	});
	const box = openCard();
	const alert = within(box).getByRole("alert");
	expect(alert.textContent).toBe("region is empty");
	// ABOVE the footer in DOM order, which is the reading order: a refusal printed under
	// the button that provoked it is read after the user has already pressed it again.
	const commit = within(box).getByRole("button", { name: "commit (Enter)" });
	expect(
		alert.compareDocumentPosition(commit) & Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeGreaterThan(0);
});

// The ordering contract this pins is the whole point (review B1, ported from the panel).
// The card reads `host.listGenerators()` when it MOUNTS, which — for a card that mounts on
// the session that opens it — can easily be before the catalog's async fetch has settled.
// Unless it re-reads on the catalog tick, `archetypeId` stays a free-text field forever.
test("archetypeId becomes a PICKER when the catalog lands AFTER the card opened", async () => {
	stubEntityCatalog();
	const stub = makeStubHost({ generators: [SCATTER] });
	// Deliberately NOT `renderShell`: the session has to open BEFORE the fetch settles, so
	// the card's mount-time registry read is the pre-catalog one.
	render(withEditor(<Shell />, stub));
	act(() => {
		stub.fire.stamp(
			makeSession({ generator: "scatter", params: { archetypeId: "rock" } }),
		);
	});
	const field = (): HTMLElement =>
		within(openCard()).getByLabelText("Archetype Id");
	// A bare string schema renders StringField (an <input>)…
	expect(field().tagName).toBe("INPUT");

	await flushCatalog();
	// …and an enum-carrying one renders D-25's SEGMENTED control. This catalog has ONE
	// archetype, so the enum sits under the cardinality cap; above four members
	// `resolveKind` sends it to EnumField's Radix combobox instead, and that decision is
	// the registry's, not this field's.
	expect(field().getAttribute("role")).toBe("radiogroup");
	// Named by its MEMBER, which is the half that would silently break: a segmented
	// control whose buttons all answer to the row caption is one a screen reader cannot
	// tell apart, and a `getByRole("radio")` count alone would not see it.
	expect(within(field()).getByRole("radio", { name: "rock" })).toBeTruthy();
	// The mechanism, stated directly: the catalog installed BEFORE the last read.
	expect(stub.order.lastIndexOf("listGenerators")).toBeGreaterThan(
		stub.order.indexOf("setEntityCatalog"),
	);
});

// The card has a user-facing checkbox after all — `BurgerMenu` maps `PALETTE_IDS`, so
// `session` gets one like every other palette. It is KEPT deliberately: the × closes the
// card and the driver will not re-open it for the same subject, so without the menu item
// that close is a latch with no exit. What it costs is that the card can be opened with
// nothing to be about, and the placeholder it shows then is not "one frame" — it stands
// until the next subject change.
test("the burger can summon the card with no subject, and the placeholder STANDS", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	expect(card() === null).toBe(true);

	openBurger();
	act(() => {
		fireEvent.click(screen.getByText("Session palette"));
	});
	// It opens, and it says what it has: nothing.
	expect(within(openCard()).getByText("nothing selected")).toBeTruthy();

	// …and it is still there after an unrelated host push, which is the half that makes
	// "one frame, at most" false and the reason the card's own comment now says so.
	act(() => {
		stub.fire.stats(makeStats({ totalOps: 3 }));
	});
	expect(within(openCard()).getByText("nothing selected")).toBeTruthy();

	// Selecting something fills it in, so the summon is a real way back rather than a
	// dead end.
	selectEntity(stub, [makeEntity()], 3);
	expect(within(openCard()).getByText("hall #3")).toBeTruthy();
});

// --- (f) the card and the pending-stamp arm do not fight ---------------------

test("a stamp ARMED for region-draw opens no card — there is nothing to configure yet", async () => {
	fetch404();
	const stub = makeStubHost({ generators: [HALL] });
	await renderShell(stub);
	act(() => {
		stub.fire.pendingStamp({ id: "hall", name: "Hall" });
	});
	// The arm is a question about a REGION, and the card is about params. Opening one here
	// would put an empty form over the canvas the user is being asked to draw on.
	expect(card() === null).toBe(true);
	// …and the session the region opens is what brings it.
	act(() => {
		stub.fire.pendingStamp(null);
		stub.fire.stamp(makeSession());
	});
	expect(openCard()).toBeTruthy();
});
