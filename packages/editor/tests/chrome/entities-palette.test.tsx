// Registered FIRST, before any other import — the shell.test.tsx ordering rule (Radix
// resolves `globalThis.document` at MODULE EVALUATION time). Nothing here opens a Radix
// surface today, but the confirm dialog is one context away and the failure mode is
// silent, so the whole chrome directory keeps the same discipline.
import "../inspector/_register.ts";

// The entities palette (F4.5a Task 10): the committed-stamp list plus the drift report,
// the first organ to leave FieldPanel.
//
// Every assertion below came from tests/chrome/field-panel.test.tsx unchanged — only
// the MOUNT moved. What that mount now proves in passing is the seam relocation itself:
// the palette holds no subscription at all, and the rows it renders arrive through the
// shell's host-state provider (the sole owner of `subscribeEntities` +
// `subscribeDrift`). The matching NEGATIVE assertion stayed behind in field-panel.test.tsx,
// where F4.5b Task 2 widened it to every seam there is.

import { afterEach, expect, test } from "bun:test";
import type { ConfirmRequest } from "../../src/frontend/components/ConfirmDialog.tsx";
import { EntitiesPalette } from "../../src/frontend/components/shell/EntitiesPalette.tsx";
import { TooltipProvider } from "../../src/frontend/components/ui/tooltip.tsx";
import {
	FieldHostStateProvider,
	useFieldEntities,
} from "../../src/frontend/hooks/useFieldHostState.tsx";
import { byId } from "../../src/frontend/lib/actions.ts";
import type {
	FieldDriftReport,
	FieldEntityInfo,
} from "../../src/viewport-host/index.ts";
import {
	act,
	cleanup,
	fireEvent,
	makeEditorContext,
	render,
	renderWithEditor,
	screen,
	within,
} from "../inspector/_harness.tsx";
import { makeStubHost } from "./_stub-host.ts";

afterEach(cleanup);

// --- fixtures ---------------------------------------------------------------

const ENTITY: FieldEntityInfo = {
	entityId: 1,
	type: "generator",
	generator: "hall",
	params: { width: 4 },
	seed: 7,
	region: { min: [0, 0, 0], max: [4, 4, 4] },
	opSpan: [2, 4], // 3 ops
	placed: [], // a hall places nothing
};

const FROZEN: FieldEntityInfo = { ...ENTITY, entityId: 2, frozen: true };
const BAKED: FieldEntityInfo = { ...ENTITY, entityId: 3, baked: true };

/** A committed scatter as listEntities hands it over: a one-op span (the
 *  placement op is the ONLY op it appends) plus the host's attribution of that
 *  op's records. */
const SCATTER: FieldEntityInfo = {
	...ENTITY,
	entityId: 4,
	generator: "scatter",
	params: { archetypeId: "rock", density: 0.3 },
	seed: 9,
	opSpan: [5, 5], // 1 op
	placed: [{ archetypeId: "rock", count: 24 }],
};

/** The palette under the shell's host-state provider — the arrangement the real editor
 *  mounts. The provider owns both entity seams, so this is what a `fire.entities` tick
 *  needs to reach anything.
 *
 *  The TOOLTIP provider is part of that arrangement since F4.5c Task 8: the row verbs
 *  document themselves through `ActionTip`, and a Radix `Tooltip` outside a provider does
 *  not degrade — it THROWS. Shell.tsx mounts exactly one for the whole frame; this is that
 *  one, not a second. */
function renderPalette(
	stub: ReturnType<typeof makeStubHost>,
	overrides: { openConfirm?: (r: ConfirmRequest) => void } = {},
) {
	return renderWithEditor(
		<TooltipProvider delayDuration={300}>
			<FieldHostStateProvider host={stub.host} engineReady>
				<EntitiesPalette />
			</FieldHostStateProvider>
		</TooltipProvider>,
		makeEditorContext({
			fieldHostRef: { current: stub.host },
			...(overrides.openConfirm ? { openConfirm: overrides.openConfirm } : {}),
		}),
	);
}

/** Seed the list with `next` and fire the host's entity tick, as the real host
 *  does after a commit / apply / freeze / bake / ⌘Z. */
function pushEntities(
	stub: ReturnType<typeof makeStubHost>,
	next: FieldEntityInfo[],
): void {
	stub.setEntities(next);
	act(() => {
		stub.fire.entities();
	});
}

/** Expand the Entities section (rows render inside a collapsed section by
 *  default) after seeding `next`. */
function showEntities(
	stub: ReturnType<typeof makeStubHost>,
	next: FieldEntityInfo[],
): void {
	renderPalette(stub);
	pushEntities(stub, next);
	fireEvent.click(screen.getByText(`Entities (${next.length})`));
}

/** One row's action button, resolved by the aria-label that names BOTH the verb
 *  and the entity — the visible text ("Freeze", "Bake…") repeats on every row,
 *  so it identifies nothing once a list has two. Genuinely row-scoped: this is
 *  writable against a multi-row list, which a visible-text lookup was not. */
const rowButton = (verb: string, entityId: number): HTMLButtonElement =>
	screen.getByLabelText(`${verb} entity ${entityId}`) as HTMLButtonElement;

/** The same button when the verb is REFUSED. A blocked verb's label carries its reason
 *  after the id, so the available spelling above misses it entirely — which is how the
 *  completeness guard below came to be vacuous on a fixture where nothing is refused.
 *
 *  Anchored on `(` and NOT on the reason's first word: the three refusal sentences are
 *  prose owned by `shared/field-entity.ts`, and a test that quotes their opening breaks when
 *  someone rewords one. */
const blockedRowButton = (verb: string, entityId: number): HTMLButtonElement =>
	screen.getByLabelText(
		new RegExp(`^${verb} entity ${entityId} \\(`),
	) as HTMLButtonElement;

/** THE ROW VERB SET — one table, and the only spelling of it in this file. Every
 *  quantified assertion below derives from it (the reason convention, the D-23 tones, the
 *  refused-state dim, the glyph map), so a fifth verb cannot be added to the row and
 *  answer only some of them.
 *
 *  `destructive: true` means the D-23 destructive TEXT/ICON token (`--destructive-text`,
 *  spelled `text-destructive-text`) — never the bare `text-destructive` fill colour, which
 *  `tests/design-tokens.test.ts` bans outright.
 *
 *  `visible: ""` is the assertion that the glyph is an SVG and NOT a character: a lucide
 *  icon contributes no text, so any surviving pictograph shows up here as a non-empty
 *  string.
 *
 *  `icon` is the lucide class the rendered `<svg>` must carry — `lucide-react` stamps
 *  `lucide-<kebab-name>` on every icon it builds, so the glyph's IDENTITY is assertable in
 *  happy-dom even though nothing here lays out or paints. That is the column D-14 needs:
 *  the verb routing is pinned elsewhere, but nothing held WHICH GLYPH sat on it, and a
 *  swap to `Copy` — the exact misreading `EntitiesList`'s comment warns about at length —
 *  left all 1310 tests green while shipping a duplicate-looking button that severs a
 *  recipe on click. `null` is the one verb that shows a WORD instead. */
const ROW_VERBS = [
	{ verb: "open", destructive: false, visible: "Open", icon: null },
	{ verb: "freeze", destructive: false, visible: "", icon: "lucide-snowflake" },
	{
		verb: "sever",
		destructive: true,
		visible: "",
		icon: "lucide-arrow-down-to-line",
	},
	{ verb: "delete", destructive: true, visible: "", icon: "lucide-trash-2" },
] as const;

// --- the seam itself: one subscription, guarded ------------------------------

test("the palette subscribes to nothing — the provider owns all three entity seams", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	// Exactly ONE subscriber each. The seams are multicast, so a second claim anywhere
	// no longer STEALS this one — it is a duplicate mirror and a leak nobody would see,
	// which is why the claim count is the only thing that can still catch it.
	expect(stub.calls.subscribeEntities.mock.calls.length).toBe(1);
	expect(stub.calls.subscribeDrift.mock.calls.length).toBe(1);
	expect(stub.calls.subscribeEntitySelection.mock.calls.length).toBe(1);
});

// The comparator guard, pinned from the side that would break it. `listEntities()`
// returns FRESH CLONES on every call, so identity says nothing and an unguarded
// refresh re-renders the list on every tick — and the host ticks from paths that
// changed no entity at all (a world load that restored the same ops, a redundant
// freeze core did not log). Sabotage-proven: dropping `sameEntities` from the
// provider's refresh makes the second assertion below fail.
test("an entity tick that changed nothing does not re-render the list", () => {
	let renders = 0;
	function Probe() {
		const { entities } = useFieldEntities();
		renders++;
		return <span>{entities.length}</span>;
	}
	const stub = makeStubHost();
	render(
		<FieldHostStateProvider host={stub.host} engineReady>
			<Probe />
		</FieldHostStateProvider>,
	);
	stub.setEntities([ENTITY]);
	act(() => {
		stub.fire.entities();
	});
	const base = renders;
	expect(screen.getByText("1")).toBeTruthy();

	// The SAME list again, through the same clone-returning path — the shape of every
	// tick that reports a change somewhere else in the log.
	act(() => {
		stub.fire.entities();
	});
	expect(renders).toBe(base);

	// …and a real change still gets through, so the guard is not just swallowing ticks.
	pushEntities(stub, [ENTITY, { ...ENTITY, entityId: 9 }]);
	expect(renders).toBe(base + 1);
});

test("the provider releases both entity slots on unmount", () => {
	const stub = makeStubHost();
	const { unmount } = render(
		<FieldHostStateProvider host={stub.host} engineReady>
			<span />
		</FieldHostStateProvider>,
	);
	/** How many live subscribers the tick seam delivered to. */
	const pushTick = (): number => {
		let delivered = 0;
		act(() => {
			delivered = stub.fire.entities();
		});
		return delivered;
	};
	/** How many live subscribers the drift seam delivered to. */
	const pushDrift = (): number => {
		let delivered = 0;
		act(() => {
			delivered = stub.fire.drift(null);
		});
		return delivered;
	};
	// The provider, and only the provider — a second delivery here would be a surface
	// below it that re-subscribed.
	expect(pushTick()).toBe(1);
	expect(pushDrift()).toBe(1);
	unmount();
	// Back to nobody. A release that did not really remove the callback leaves the
	// unmounted provider's effect wired to a live seam — the leak the count is here to
	// catch, and one a multicast seam gives no other symptom for.
	expect(pushTick()).toBe(0);
	expect(pushDrift()).toBe(0);
});

// --- the entity tick is the ONLY refresh trigger ----------------------------

test("a stamp commit (the host's entity tick) surfaces the new entity row", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	expect(screen.getByText("Entities (0)")).toBeTruthy();
	// The commit appends the entity op, ends the session and ticks the list.
	pushEntities(stub, [ENTITY]);
	expect(screen.getByText("Entities (1)")).toBeTruthy();
	fireEvent.click(screen.getByText("Entities (1)"));
	expect(screen.getByText("hall · seed 7 · 3 ops")).toBeTruthy();
});

test("an undone commit disappears on the entity tick — no session change, no remesh", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	pushEntities(stub, [ENTITY]);
	expect(screen.getByText("Entities (1)")).toBeTruthy();
	// ⌘Z with NOTHING else moving: no stamp session was open (so no null push)
	// and a freeze/bake undo dirties no chunk (so the remesh counter never
	// advances). The F2b trigger pair would have missed this entirely.
	pushEntities(stub, []);
	expect(screen.getByText("Entities (0)")).toBeTruthy();
});

// --- the drift report -------------------------------------------------------

const FINDINGS: FieldDriftReport = {
	findings: [
		{ opId: 12, kind: "drifted", chunks: ["0,0,0", "1,0,0"] },
		{ opId: 15, kind: "orphaned", chunks: ["2,0,0"] },
	],
	// Which rows the report touches is the HOST's answer (it owns the footprints
	// and the chunk arithmetic); a chrome test states it rather than deriving it.
	entityIds: [],
};

test("the drift report renders findings, frames a click, and dismisses through the host", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	// Non-modal: nothing renders on a clean apply (the subscribe push is null).
	expect(screen.queryByText(/drifted|orphaned/)).toBeNull();

	act(() => {
		stub.fire.drift(FINDINGS);
	});
	expect(screen.getByText("op 12 drifted")).toBeTruthy();
	expect(screen.getByText("op 15 orphaned")).toBeTruthy();

	// A row click frames that finding's chunk bounds.
	fireEvent.click(screen.getByLabelText("frame op 12 (drifted)"));
	expect(stub.calls.frameChunks.mock.calls).toEqual([[["0,0,0", "1,0,0"]]]);

	// Dismiss clears through the host (the report is host state)…
	fireEvent.click(screen.getByLabelText("dismiss drift report"));
	expect(stub.calls.dismissDrift).toHaveBeenCalledTimes(1);
	// …and the host's null echo removes the list.
	act(() => {
		stub.fire.drift(null);
	});
	expect(screen.queryByText("op 12 drifted")).toBeNull();
});

// --- F3a: the smart-object verbs on a committed row -------------------------

test("Open on a plain row starts a reconfigure session through the host", () => {
	const stub = makeStubHost();
	showEntities(stub, [ENTITY]);
	fireEvent.click(screen.getByLabelText("open entity 1"));
	// The HOST is the whole seam between this palette and the staged form the
	// controls palette renders: openEntity pushes the session down subscribeStamp,
	// which the shell's provider owns and publishes as a context. No chrome-to-chrome
	// channel exists or is needed.
	expect(stub.calls.openEntity.mock.calls).toEqual([[1]]);
});

test("a frozen row badges its state and refuses Open; a baked row does both too", () => {
	const stub = makeStubHost();
	showEntities(stub, [FROZEN, BAKED]);
	const frozenChip = screen.getByText("frozen").parentElement;
	expect(frozenChip).not.toBeNull();
	expect(screen.getByText("baked")).toBeTruthy();
	// THE CHIP'S GLYPH, by identity — the row verbs' assertion applied to the one icon
	// that is not a verb and that `ROW_VERBS` therefore does not reach. `Lock` is a
	// PADLOCK because the chip states a STATE ("this is protected"), while the freeze
	// verb beside it shows the ACTION; putting a trash can here would read as "this
	// deletes" and used to leave the whole suite green. `baked` carries no glyph at all
	// by design (no second pictograph for a state the word already names), which is why
	// `StateBadge`'s `Icon` is optional and this asserts only the frozen one.
	expect(frozenChip?.querySelector(".lucide-lock")).toBeTruthy();
	expect(frozenChip?.querySelector(".lucide-trash-2")).toBeNull();
	// A blocked Open's accessible name carries the reason too (see its own
	// test), so these match by prefix.
	const frozenOpen = screen.getByLabelText(
		/^open entity 2\b/,
	) as HTMLButtonElement;
	const bakedOpen = screen.getByLabelText(
		/^open entity 3\b/,
	) as HTMLButtonElement;
	expect(frozenOpen.disabled).toBe(true);
	expect(bakedOpen.disabled).toBe(true);
	fireEvent.click(frozenOpen);
	expect(stub.calls.openEntity).not.toHaveBeenCalled();
});

test("each row's verbs address ITS OWN entity in a multi-row list", () => {
	const stub = makeStubHost();
	const second: FieldEntityInfo = { ...ENTITY, entityId: 7 };
	// TWO rows: "Freeze" as visible text is ambiguous here — only the id-bearing
	// accessible name distinguishes them, which is the whole point of the label
	// convention (a screen-reader user picking between identical buttons).
	showEntities(stub, [ENTITY, second]);
	fireEvent.click(rowButton("freeze", 7));
	expect(stub.calls.setEntityFrozen.mock.calls).toEqual([[7, true]]);
	fireEvent.click(rowButton("sever", 1));
	expect(stub.calls.bakeEntity).not.toHaveBeenCalled(); // routed to the confirm

	// The frozen row's button flips to Unfreeze and asks for false. This is also
	// the sameEntities guard's test — a flag-only change is the one the F2b
	// signature (id/generator/seed/opSpan) could not see.
	pushEntities(stub, [ENTITY, { ...second, frozen: true }]);
	fireEvent.click(rowButton("unfreeze", 7));
	expect(stub.calls.setEntityFrozen.mock.calls.at(-1)).toEqual([7, false]);
});

// Every row verb states its reason the same way, which is a convention that had to
// be EXTENDED rather than invented: Open and delete shipped with reasons in the
// accessible name while freeze and bake were bare `disabled` with a tooltip that still
// promised to sever a recipe already severed. Quantified over `ROW_VERBS` so a fifth
// verb cannot quietly ship bare.
test("a baked row disables every verb it cannot run, each naming its reason", () => {
	const stub = makeStubHost();
	showEntities(stub, [BAKED]);
	for (const { verb } of ROW_VERBS) {
		const button = blockedRowButton(verb, 3);
		expect([verb, button.disabled]).toEqual([verb, true]);
	}
});

test("a blocked Open carries its reason in the accessible name, not only a title", () => {
	const stub = makeStubHost();
	showEntities(stub, [FROZEN]);
	// The title sits on a non-focusable wrapper span (a disabled button eats
	// pointer events), so the accessible name is the only channel a screen
	// reader or keyboard user actually gets.
	expect(
		screen.getByLabelText("open entity 2 (frozen — unfreeze it to edit)"),
	).toBeTruthy();
});

// Freeze states its consequence on EVERY unfrozen row rather than only on the one
// carrying a live session — the row does not read the stamp session (it could, off the
// shell's context, and declines: see EntitiesList), and the sentence is true of every
// unfrozen row anyway: the host cancels whatever session sits on the entity it freezes. Pinned because the alternative ways to phrase it are all weaker: a bare
// "protect this stamp" drops the data-loss warning entirely.
test("Freeze names the session it would end, on every unfrozen row", async () => {
	const stub = makeStubHost();
	showEntities(stub, [ENTITY, FROZEN]);
	// FOCUS, not hover (D-25): the sentence a destructive-adjacent verb carries has to
	// reach a keyboard user, and a native `title` reaches nobody who does not own a mouse.
	// Its ABSENCE is half the claim — a passing assertion on tooltip text would otherwise
	// be satisfied by the attribute this task exists to remove.
	const freeze = rowButton("freeze", 1);
	expect(freeze.getAttribute("title")).toBeNull();
	act(() => {
		fireEvent.focus(freeze);
	});
	expect(
		within(await screen.findByRole("tooltip")).getByText(
			"protect this stamp from reconfigure — ends any reconfigure session open on it",
		),
	).toBeTruthy();

	// …and the frozen row's inverse verb says what it does instead, with no warning to
	// carry: a frozen entity has no session to end.
	act(() => {
		fireEvent.blur(freeze);
		fireEvent.focus(rowButton("unfreeze", 2));
	});
	expect(
		within(await screen.findByRole("tooltip")).getByText(
			"allow this stamp to be reconfigured again",
		),
	).toBeTruthy();
});

// D-25's second half — the keybinding annotation, and the reason it is a REGISTRY read
// rather than a keycap spelled into the sentence (D-12).
test("the row's Delete tooltip shows the registry's own keycap, on the selected row only", async () => {
	const stub = makeStubHost();
	showEntities(stub, [ENTITY, { ...ENTITY, entityId: 9 }]);

	// The keycap comes off the TABLE in every assertion below, this one included. A
	// literal "⌫" here would pass vacuously after a rebind — nothing named ⌫ would exist
	// anywhere on screen, so the absence it claims to prove would be free — and that is
	// precisely the drift the registry read exists to make impossible.
	const keys = byId("edit.delete").keys;
	if (keys === undefined) throw new Error("edit.delete lost its keycap");

	// Nothing selected: ⌫ deletes the SELECTED stamp, so a keycap on a row the key would
	// not touch is a lie about what the keyboard does. The sentence still shows.
	act(() => {
		fireEvent.focus(rowButton("delete", 1));
	});
	const bare = await screen.findByRole("tooltip");
	expect(within(bare).getByText("remove this stamp and its ops")).toBeTruthy();
	expect(within(bare).queryByText(keys) === null).toBe(true);

	// Select row 1 — now ⌫ and this button are the same verb on the same object, and the
	// tooltip says so with the table's own string.
	act(() => {
		fireEvent.blur(rowButton("delete", 1));
		stub.fire.entitySelection(1);
	});
	act(() => {
		fireEvent.focus(rowButton("delete", 1));
	});
	expect(
		within(await screen.findByRole("tooltip")).getByText(keys),
	).toBeTruthy();

	// The OTHER row keeps its bare tooltip: selection is what earns the keycap.
	act(() => {
		fireEvent.focus(rowButton("delete", 9));
	});
	const other = await screen.findByRole("tooltip");
	expect(within(other).queryByText(keys) === null).toBe(true);
});

// A refused verb is the one case a tooltip cannot serve at all: a `disabled` button takes
// neither pointer events nor focus. The reason therefore rides ReasonTip's wrapper for the
// mouse and the accessible NAME for everyone else — and the button carries no second
// `title` of its own (the double-`title` RowVerb shipped before F4.5c Task 8).
test("a blocked verb states its reason without a tooltip, and without a second title", () => {
	const stub = makeStubHost();
	showEntities(stub, [FROZEN]);
	const open = screen.getByLabelText(
		"open entity 2 (frozen — unfreeze it to edit)",
	);
	expect(open.getAttribute("title")).toBeNull();
	expect(open.parentElement?.getAttribute("title")).toBe(
		"frozen — unfreeze it to edit",
	);
});

test("Bake confirms before severing the recipe — cancelling never reaches the host", () => {
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	renderPalette(stub, {
		openConfirm: (r) => {
			request = r;
		},
	});
	pushEntities(stub, [ENTITY]);
	fireEvent.click(screen.getByText("Entities (1)"));
	fireEvent.click(rowButton("sever", 1));
	// The click alone must not bake: the palette routed it into the App confirm.
	expect(stub.calls.bakeEntity).not.toHaveBeenCalled();
	const pending = request as ConfirmRequest | null;
	if (pending === null) throw new Error("Bake did not open a confirmation");
	expect(pending.destructive).toBe(true);
	expect(pending.message).toMatch(/severs the recipe permanently/);
	// Confirming is what severs it.
	act(() => {
		pending.onConfirm();
	});
	expect(stub.calls.bakeEntity.mock.calls).toEqual([[1]]);
});

// --- F3b: the prop segment on a scatter row ---------------------------------

test("a scatter row names the archetype it placed and how many; a carver row keeps no prop segment", () => {
	const stub = makeStubHost();
	showEntities(stub, [ENTITY, SCATTER]);
	// "1 ops" says nothing about a scatter's output (it writes no cells), so the
	// prop segment is the row's only reading of what this stamp put down.
	expect(
		screen.getByText("scatter · seed 9 · 1 ops · rock · 24 placed"),
	).toBeTruthy();
	// The carver's row is untouched — absent, not a permanent "· 0 placed".
	expect(screen.getByText("hall · seed 7 · 3 ops")).toBeTruthy();
});

// The branch the array-shaped `placed` EXISTS for. Scatter names one archetype
// per commit, so every other test here renders a single entry and the flatMap's
// multi-entry path never runs. `placementsByEntity` counting two archetypes is
// pinned in field-placements.test.ts; this pins what the ROW then reads like.
test("a row that placed TWO archetypes names both", () => {
	const stub = makeStubHost();
	showEntities(stub, [
		{
			...SCATTER,
			placed: [
				{ archetypeId: "rock", count: 24 },
				{ archetypeId: "stalagmite", count: 3 },
			],
		},
	]);
	expect(
		screen.getByText(
			"scatter · seed 9 · 1 ops · rock · 24 placed · stalagmite · 3 placed",
		),
	).toBeTruthy();
});

// The refresh guard's blind spot, closed. `sameEntities` compares id, generator,
// seed, opSpan and the two flags — and a world SWITCH can leave every one of
// those equal while the counts differ, because loadWorld recomputes
// `log.nextId` from the loaded ops' own maximum, so ids and spans restart. The
// world drawer's Open calls loadWorld under this same provider (no remount, no
// state reset, just an entity tick), which is exactly the tick this test fires.
// Without `placed` in the comparator the guard returns `prev` and the row keeps
// world A's count over world B.
test("a world switch that changes ONLY a prop count still re-renders the row", () => {
	const stub = makeStubHost();
	showEntities(stub, [SCATTER]);
	expect(
		screen.getByText("scatter · seed 9 · 1 ops · rock · 24 placed"),
	).toBeTruthy();
	// World B: identical in every OTHER compared field, 2 props instead of 24.
	pushEntities(stub, [
		{ ...SCATTER, placed: [{ archetypeId: "rock", count: 2 }] },
	]);
	expect(
		screen.getByText("scatter · seed 9 · 1 ops · rock · 2 placed"),
	).toBeTruthy();
});

// The chrome half of the free-ness claim (its host half is field-stamp.test.ts'
// "Open → re-roll → Apply on a SCATTER row"): a scatter is an ordinary
// GeneratorEntity, so the F3a verbs and the generic params <dl> serve it with no
// scatter-specific branch — the new segment did not cost the row anything.
test("a scatter row keeps the generic verbs and params <dl> (F3a machinery, no scatter case)", () => {
	const stub = makeStubHost();
	showEntities(stub, [SCATTER]);
	fireEvent.click(screen.getByLabelText("open entity 4"));
	expect(stub.calls.openEntity.mock.calls).toEqual([[4]]);
	// Expanding shows the scatter's own params through the same <dl> a hall gets.
	fireEvent.click(
		screen.getByText("scatter · seed 9 · 1 ops · rock · 24 placed"),
	);
	expect(screen.getByText("archetypeId")).toBeTruthy();
	expect(screen.getByText("rock")).toBeTruthy();
	expect(screen.getByText("density")).toBeTruthy();
	expect(screen.getByText("0.3")).toBeTruthy();
});

// --- the boot state ---------------------------------------------------------

test("before the engine lands the palette says so, rather than claiming zero stamps", () => {
	const stub = makeStubHost();
	renderWithEditor(
		<FieldHostStateProvider host={stub.host} engineReady={false}>
			<EntitiesPalette />
		</FieldHostStateProvider>,
		makeEditorContext({
			state: { status: "booting" },
			fieldHostRef: { current: stub.host },
		}),
	);
	// "Entities (0)" here would be a claim about the WORLD made from an empty mirror the
	// provider has not subscribed anything to yet — the gate FieldPanel has always held,
	// which this list used to sit behind.
	expect(screen.queryByText(/^Entities \(/) === null).toBe(true);
	expect(
		screen.getByText("the field waits for the engine bundle…"),
	).toBeTruthy();
});

// The "closing the palette clears the entity highlight" case went with
// `host.highlightEntity` itself (F4.5b Task 3's deletion pass): there is ONE
// selection concept now, written by a pointer click or `selectEntity` and read
// back off `subscribeEntitySelection`, so a row cannot own a second one that
// needs unmount cleanup. The cases below are what replaced it.

// --- F4.5b Task 4: the layers panel (D-14) ----------------------------------

/** The row's own button (the one carrying the summary), for the selected-state
 *  and expand assertions. */
const rowButtonFor = (summary: string): HTMLButtonElement => {
	const button = screen.getByText(summary).closest("button");
	if (button === null) throw new Error(`no row button for "${summary}"`);
	return button as HTMLButtonElement;
};

const HALL_ROW = "hall · seed 7 · 3 ops";

test("a row click selects its entity on the HOST — the write half of the sync", () => {
	const stub = makeStubHost();
	showEntities(stub, [ENTITY]);
	fireEvent.click(rowButtonFor(HALL_ROW));
	// Through the host, never into local state: the same write a `pointer` click
	// in the viewport makes, so the box and the row cannot disagree.
	expect(stub.calls.selectEntity.mock.calls).toEqual([[1]]);
	// …and it still expands, which is this list's own display state.
	expect(rowButtonFor(HALL_ROW).getAttribute("aria-expanded")).toBe("true");
	// Collapsing again does NOT deselect — un-expanding a row is not a statement
	// about what is being worked on.
	fireEvent.click(rowButtonFor(HALL_ROW));
	expect(rowButtonFor(HALL_ROW).getAttribute("aria-expanded")).toBe("false");
	expect(stub.calls.selectEntity.mock.calls).toEqual([[1], [1]]);
});

test("the entity-selection seam styles the row — the read half, from the viewport", () => {
	const stub = makeStubHost();
	const second: FieldEntityInfo = { ...ENTITY, entityId: 7 };
	// Two rows reading identically — only the SELECTION can tell them apart, which
	// is the point: the seam carries an id, not a label.
	showEntities(stub, [ENTITY, second]);
	const currentFlags = (): (string | null | undefined)[] =>
		screen
			.getAllByText(HALL_ROW)
			.map((r) => r.closest("button")?.getAttribute("aria-current"));
	expect(currentFlags()).toEqual([null, null]);

	// A pick in the VIEWPORT, which reaches the palette only through the provider.
	act(() => {
		stub.fire.entitySelection(7);
	});
	expect(currentFlags()).toEqual([null, "true"]);

	// Deselecting (a click on bare terrain) clears it again.
	act(() => {
		stub.fire.entitySelection(null);
	});
	expect(currentFlags()).toEqual([null, null]);
});

// D-14's glyph map, pinned from BOTH sides. The mock puts the down arrow on BAKE and
// duplicate in the burger (Task 7 binds it to ⌘J), and a downward arrow reads so naturally
// as "duplicate" that wiring it there is the obvious mistake — a SILENT one, because the
// row would look right and sever a recipe on click.
//
// So the routing is asserted (this verb opens the BAKE confirmation and never reaches
// `duplicateEntity`) AND the glyph is: `ROW_VERBS` carries the lucide class each icon must
// stamp. The second half is not a stylistic pin — swapping `ArrowDownToLine` for `Copy`
// used to leave the whole suite green, which is a duplicate-LOOKING button wired to the
// irreversible verb. Asserting the glyph's identity is different from asserting a
// pictograph as a NAME: the accessible name is still the verb, and none of the lookups in
// this file moved when these four stopped being emoji.
test("the sever verb carries D-14's BAKE glyph, and duplicate has no row affordance at all", () => {
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	renderPalette(stub, {
		openConfirm: (r) => {
			request = r;
		},
	});
	pushEntities(stub, [ENTITY]);
	fireEvent.click(screen.getByText("Entities (1)"));
	expect(screen.queryByLabelText(/^duplicate entity/)).toBeNull();

	// Every verb's glyph, by identity. happy-dom lays nothing out and resolves no styles,
	// but it DOES render lucide's real `<svg>` and the class it stamps on it.
	expect(
		ROW_VERBS.map(({ verb }) => [
			verb,
			rowButton(verb, 1).querySelector("svg")?.getAttribute("class") ?? null,
		]),
	).toEqual(
		ROW_VERBS.map(({ verb, icon }) => [
			verb,
			icon === null ? null : expect.stringContaining(icon),
		]),
	);
	// …and the ONE glyph that must not exist anywhere on this row, named rather than
	// implied. `Copy` is two offset rectangles — what duplicate would take if it were ever
	// a row verb — and it is the swap the source comment spends fifteen lines warning
	// about. Scoped to the document because the claim is about the whole rendered chrome,
	// not one button.
	expect(document.querySelectorAll(".lucide-copy").length).toBe(0);

	fireEvent.click(rowButton("sever", 1));
	expect(stub.calls.duplicateEntity).not.toHaveBeenCalled();
	const pending = request as ConfirmRequest | null;
	if (pending === null)
		throw new Error("sever did not open the bake confirmation");
	expect(pending.message).toMatch(/severs the recipe permanently/);
});

test("delete confirms before removing the stamp — cancelling never reaches the host", () => {
	const stub = makeStubHost();
	let request: ConfirmRequest | null = null;
	renderPalette(stub, {
		openConfirm: (r) => {
			request = r;
		},
	});
	pushEntities(stub, [ENTITY]);
	fireEvent.click(screen.getByText("Entities (1)"));
	fireEvent.click(rowButton("delete", 1));
	// The click alone must not delete: the palette routed it into the App confirm.
	expect(stub.calls.deleteEntity).not.toHaveBeenCalled();
	const pending = request as ConfirmRequest | null;
	if (pending === null) throw new Error("delete did not open a confirmation");
	expect(pending.destructive).toBe(true);
	// It names the entity AND how much goes with it — a row reads "3 ops", and
	// that number is the honest measure of what is about to be removed.
	expect(pending.message).toMatch(/hall #1/);
	expect(pending.message).toMatch(/3 ops/);
	act(() => {
		pending.onConfirm();
	});
	expect(stub.calls.deleteEntity.mock.calls).toEqual([[1]]);
});

test("delete is disabled with its reason on a frozen or baked row", () => {
	const stub = makeStubHost();
	showEntities(stub, [FROZEN, BAKED]);
	// The reason rides the ACCESSIBLE NAME as well as the wrapper's title, for
	// the blocked-Open reason: a disabled button eats pointer events, so the
	// title sits on a span that reaches neither a keyboard user nor a reader.
	const frozenDelete = screen.getByLabelText(
		"delete entity 2 (frozen — unfreeze it to delete)",
	) as HTMLButtonElement;
	const bakedDelete = screen.getByLabelText(
		"delete entity 3 (baked — its ops are plain history now, not a span to remove)",
	) as HTMLButtonElement;
	expect(frozenDelete.disabled).toBe(true);
	expect(bakedDelete.disabled).toBe(true);
	fireEvent.click(frozenDelete);
	expect(stub.calls.deleteEntity).not.toHaveBeenCalled();
});

// --- D-23's tones on the row verbs ------------------------------------------

/** One element's class TOKENS, as a set.
 *
 *  A `toContain` on a className is the trap this file's neighbours have been caught by
 *  four times: `text-destructive-text` is a substring of `hover:text-destructive-text`
 *  and of `text-destructive-text/70`, which are three DIFFERENT colours applied in three
 *  different states. Exact membership in the token list is the only bounded form. */
const classTokens = (el: Element): Set<string> =>
	new Set(el.className.split(/\s+/).filter((c) => c.length > 0));

test("the destructive row verbs wear D-23's destructive TONE and the neutral ones do not", () => {
	const stub = makeStubHost();
	showEntities(stub, [ENTITY]);

	// COMPLETENESS, first: `ROW_VERBS` has to describe every verb on the row, or a fifth
	// one added later ships untoned and every assertion below still passes.
	//
	// COUNTED IN BOTH SPELLINGS, which is the whole point of the pattern. This guard used
	// to match `/ entity 1$/` — the AVAILABLE form only — and was therefore vacuous for a
	// verb REFUSED on this fixture, whose label carries its reason after the id. Proven:
	// a fifth `RowVerb` with `blocked` set left it passing at 4 === 4, because `4` was a
	// coincidence of a row where every verb happens to be live. The old comment even named
	// the dependency ("a blocked one carries its reason after it, and the row here has
	// none") and then rested on it.
	//   What DID catch that fifth verb was `expect(…querySelectorAll("button").length)
	// .toBe(15)` in the D-26 section far below — a hard-coded count in a test about tab
	// stops. So the ceiling on this defect was never zero; it was "someone reads a
	// button-count failure 140 lines from the cause and works out what it means".
	//
	// The Δ badge is `show drift near entity 1`, which this pattern does not match (one
	// word before ` entity`), and is absent on an undrifted row anyway; the expand button
	// carries no label at all.
	expect(screen.getAllByLabelText(/^\w+ entity 1( \(|$)/).length).toBe(
		ROW_VERBS.length,
	);

	for (const { verb, destructive, visible } of ROW_VERBS) {
		const button = rowButton(verb, 1);
		const cls = classTokens(button);
		expect({
			verb,
			rest: cls.has("text-destructive-text"),
			// BOTH halves, and the argument for the pair is at `DESTRUCTIVE_VERB_CLASS`
			// rather than repeated here — the short version is that `ghost`'s own
			// `hover:text-accent-foreground` is in the same twMerge group, so exactly one of
			// the two survives into the rendered list and this asserts which.
			hover: cls.has("hover:text-destructive-text"),
			neutralHover: cls.has("hover:text-accent-foreground"),
			svg: button.querySelector("svg") !== null,
			text: button.textContent ?? "",
		}).toEqual({
			verb,
			rest: destructive,
			hover: destructive,
			neutralHover: !destructive,
			svg: visible === "",
			text: visible,
		});
	}
});

test("a BLOCKED destructive verb dims to D-23's 50% and keeps its hue", () => {
	// D-23's third rule, and the one a ghost button takes rather than the fill swap: a
	// variant with no coloured fill "has no hue to drop and dims instead"
	// (ui/button.tsx). So a refused sever/delete stays red and goes to 50% — which keeps
	// a dead delete distinguishable from a dead freeze, information the fill swap would
	// have thrown away for a control WCAG asks nothing of.
	//
	// TWO OF THESE FOUR ARE FACTS ABOUT A FOREIGN FILE, and the coupling is deliberate
	// rather than overlooked: `dim` and `fillSwap` are `ghost`'s own strings from
	// `ui/button.tsx`, true of every ghost button in the app, and this is currently the
	// only place in the suite asserting them — so editing that variant reds a test in the
	// entities palette. They stay because what D-23's third rule is ABOUT is observable
	// here and nowhere else (a refused destructive verb), and because the alternative is a
	// new D-23 disabled-vocabulary pin with its own scoping questions — the shape
	// `frontend-focus-vocabulary.test.ts` gives the ring strings. That is a build, not a
	// fix, and it is the right home for these two the day it exists.
	//
	// `hue` is NOT the tone test's `rest` again: the class list is computed from `tone`
	// alone, so this is the assertion that a refusal does not gate it off — the one thing
	// about the tone that only a blocked row can show.
	const stub = makeStubHost();
	showEntities(stub, [BAKED]);
	for (const { verb } of ROW_VERBS.filter((v) => v.destructive)) {
		const blocked = blockedRowButton(verb, 3);
		const cls = classTokens(blocked);
		expect({
			verb,
			disabled: blocked.disabled,
			dim: cls.has("disabled:opacity-50"),
			hue: cls.has("text-destructive-text"),
			// The fill swap belongs to the two CHROMATIC variants; a ghost verb must not
			// have picked it up.
			fillSwap: cls.has("disabled:bg-muted"),
		}).toEqual({
			verb,
			disabled: true,
			dim: true,
			hue: true,
			fillSwap: false,
		});
	}
});

// The Δ badge is a POINTER to the drift report, not a copy of it. WHICH rows it
// lands on is decided host-side and arrives on the drift push (the host owns both
// the findings' chunk keys and the footprints; the chrome cannot value-import core
// to quantize either) — so what this file pins is that the badge follows the
// pushed set exactly, and the intersection RULE is pinned host-side instead, in
// tests/field-host-entity-verbs.test.ts.
test("Δ lands on exactly the rows the pushed report names", () => {
	const stub = makeStubHost();
	const elsewhere: FieldEntityInfo = { ...ENTITY, entityId: 8 };
	showEntities(stub, [ENTITY, elsewhere]);
	expect(screen.queryByLabelText(/^show drift near entity/)).toBeNull();

	act(() => {
		stub.fire.drift({
			findings: [{ opId: 12, kind: "drifted", chunks: ["0,0,0"] }],
			entityIds: [1],
		});
	});
	expect(screen.getByLabelText("show drift near entity 1")).toBeTruthy();
	expect(screen.queryByLabelText("show drift near entity 8")).toBeNull();

	// Dismissing the report takes every badge with it — the badge has no state of
	// its own to go stale.
	act(() => {
		stub.fire.drift(null);
	});
	expect(screen.queryByLabelText(/^show drift near entity/)).toBeNull();
});

// The staleness defect that was filed rather than fixed when the `<dl>` shipped
// (`docs/backlog/editor-and-tooling/editor-chrome-authoring-gaps.md`): `loadWorld`
// recomputes `log.nextId` from the loaded ops, so ids and every opSpan RESTART
// across a world switch — two worlds can hold records agreeing on every compared
// field and differing only in their params. The world drawer's Open calls
// loadWorld under this same provider (no remount, just an entity tick), so
// without a params comparison the guard returns `prev` and an expanded row keeps
// the previous world's values.
test("a world switch that changes ONLY a param still re-renders the expanded row", () => {
	const stub = makeStubHost();
	showEntities(stub, [ENTITY]);
	fireEvent.click(rowButtonFor(HALL_ROW));
	expect(screen.getByText("4")).toBeTruthy(); // width: 4

	pushEntities(stub, [{ ...ENTITY, params: { width: 12 } }]);
	expect(screen.getByText("12")).toBeTruthy();
	expect(screen.queryByText("4")).toBeNull();
});

// --- F4.5c Task 9 (D-26): the grid, and its ONE tab stop --------------------
//
// THREE rows in every case below, never one. "The list is one tab stop" is vacuously
// true of a one-row list, and "↑ moved the focus" is unfalsifiable when the element it
// moved from and the element it moved to are the same one.

const THREE: FieldEntityInfo[] = [
	ENTITY,
	{ ...ENTITY, entityId: 5 },
	{ ...ENTITY, entityId: 9 },
];

const grid = (): HTMLElement =>
	screen.getByRole("grid", { name: "committed stamps" });

/** The row STOPS — the first cell's button on each row, which is the control the
 *  roving tabindex moves between. Resolved through the GRID STRUCTURE rather than by
 *  label, so a test that passed while the cells were mis-nested cannot exist. */
const stops = (): HTMLButtonElement[] =>
	Array.from(
		grid().querySelectorAll<HTMLButtonElement>(
			'[role="row"] > [role="gridcell"]:first-child button',
		),
	);

/** Everything inside the list that Tab can reach — the number D-26 is about. */
const tabbable = (): Element[] =>
	Array.from(grid().querySelectorAll('[tabindex="0"]'));

test("the entities list is ONE tab stop, not five per row (D-26)", () => {
	const stub = makeStubHost();
	showEntities(stub, THREE);
	// Five controls per row (select, open, freeze, sever, delete — six on a drifted
	// one), and every one of them was its own tab stop before this: ~6N tabs to reach
	// the last row of an N-entity world, with no way to move DOWN the list at all.
	expect(grid().querySelectorAll("button").length).toBe(15);
	expect(tabbable().length).toBe(1);
	expect(tabbable()[0] === stops()[0]).toBe(true);
});

test("↑/↓ move the stop, the focus and the HOST selection together", () => {
	const stub = makeStubHost();
	showEntities(stub, THREE);
	stops()[0]?.focus();
	act(() => {
		fireEvent.keyDown(grid(), { key: "ArrowDown" });
	});
	// Compared as BOOLEANS, never as elements: a happy-dom node carries React's fiber
	// graph, so a failing element comparison serialises tens of megabytes and reads as a
	// hung run rather than a failed assertion (the tool-rail house rule).
	expect(document.activeElement === stops()[1]).toBe(true);
	// The stop FOLLOWS the focus — one that did not would send the next Tab back to the
	// top of the list.
	expect(tabbable().length === 1 && tabbable()[0] === stops()[1]).toBe(true);
	// Selection follows the cursor (the Finder/Photoshop behaviour), and it is the
	// HOST's selection — the same write a viewport pick makes, not a second one.
	expect(stub.calls.selectEntity.mock.calls).toEqual([[5]]);
	// …and the row lights up only when the host echoes it back, which is what makes
	// this the read half of the existing sync rather than a local highlight.
	act(() => {
		stub.fire.entitySelection(5);
	});
	expect(stops()[1]?.getAttribute("aria-current")).toBe("true");
	expect(stops()[0]?.getAttribute("aria-current")).toBe(null);

	act(() => {
		fireEvent.keyDown(grid(), { key: "ArrowUp" });
	});
	expect(document.activeElement === stops()[0]).toBe(true);
	expect(stub.calls.selectEntity.mock.calls.at(-1)).toEqual([1]);
});

test("→ enters the ROW's own verb cluster, and ← walks back out of it", () => {
	const stub = makeStubHost();
	showEntities(stub, THREE);
	stops()[1]?.focus();
	act(() => {
		fireEvent.keyDown(grid(), { key: "ArrowRight" });
	});
	// Entity 5's verbs, not entity 1's or 9's: the cluster is row-scoped, which is the
	// half a flat "next focusable" walk would get wrong on every row but the first.
	expect(document.activeElement === rowButton("open", 5)).toBe(true);
	act(() => {
		fireEvent.keyDown(grid(), { key: "ArrowRight" });
		fireEvent.keyDown(grid(), { key: "ArrowRight" });
	});
	expect(document.activeElement === rowButton("sever", 5)).toBe(true);
	// The stop never moves INTO the cluster: the list stays one tab stop, and Tab from
	// a verb therefore leaves the whole grid rather than walking the next row's verbs.
	expect(tabbable().length === 1 && tabbable()[0] === stops()[1]).toBe(true);

	act(() => {
		fireEvent.keyDown(grid(), { key: "ArrowLeft" });
		fireEvent.keyDown(grid(), { key: "ArrowLeft" });
		fireEvent.keyDown(grid(), { key: "ArrowLeft" });
	});
	expect(document.activeElement === stops()[1]).toBe(true);
});

test("Esc leaves the verb cluster WITHOUT stepping the cancel ladder", () => {
	const stub = makeStubHost();
	showEntities(stub, THREE);
	stops()[1]?.focus();
	act(() => {
		fireEvent.keyDown(grid(), { key: "ArrowRight" });
	});

	const seen: string[] = [];
	const spy = (e: KeyboardEvent) => seen.push(e.key);
	window.addEventListener("keydown", spy);
	try {
		act(() => {
			fireEvent.keyDown(grid(), { key: "Escape" });
		});
		expect(document.activeElement === stops()[1]).toBe(true);
		// `session.escape` is the ONE cancel entry point and it is never disabled — it
		// unwinds gesture → session → selection off a WINDOW listener. A dismissal scoped
		// to a verb cluster must not step that ladder, so this Esc is stopped here.
		expect(seen.includes("Escape")).toBe(false);
		// NOT vacuous: an unclaimed key still travels, so the line above is a claim about
		// stopPropagation rather than about fireEvent failing to bubble out of the grid.
		act(() => {
			fireEvent.keyDown(grid(), { key: "q" });
		});
		expect(seen).toEqual(["q"]);
		// …and an Esc pressed ON THE ROW is not the grid's: there is no cluster to leave,
		// so it belongs to the ladder and has to reach it.
		act(() => {
			fireEvent.keyDown(grid(), { key: "Escape" });
		});
		expect(seen).toEqual(["q", "Escape"]);
	} finally {
		window.removeEventListener("keydown", spy);
	}
});

// Rule 3 of the roving mechanism, from the side that would break it. `preventDefault` on
// a key the grid did NOT act on is the focus-trap class the window dispatcher exists to
// kill, and TAB is the sharp case: prevent it and the one tab stop this task built becomes
// a place the keyboard can enter and never leave. `fireEvent` returns `dispatchEvent`'s
// own boolean — false when the event was cancelled — so this reads the actual default,
// not a proxy for it.
test("the grid claims ONLY the keys it acts on — Tab still leaves it", () => {
	const stub = makeStubHost();
	showEntities(stub, THREE);
	stops()[1]?.focus();
	// A key it DOES claim, so the assertion below is not merely "fireEvent returns true".
	expect(fireEvent.keyDown(grid(), { key: "ArrowDown" })).toBe(false);
	expect(fireEvent.keyDown(grid(), { key: "Tab" })).toBe(true);
	// …and an ordinary character, which on a canvas-focused editor is somebody's tool key.
	expect(fireEvent.keyDown(grid(), { key: "b" })).toBe(true);
	// Esc ON THE ROW is the cancel ladder's, not the grid's — the case that matters most,
	// since Esc is the app's one cancel entry point.
	//
	// This line also catches the tooltip veto from a second direction, which is how the
	// coupling was found rather than reasoned: an OPEN Radix tooltip mounts a
	// `DismissableLayer`, and that layer puts a CAPTURE-phase keydown listener on
	// `document` which calls `preventDefault()` on Escape (verified in
	// @radix-ui/react-dismissable-layer 1.1.19). Drop the veto and the ArrowDown above
	// opens a tip, so the Escape after it arrives already prevented — and because
	// `useGlobalKeybindings` never consults `defaultPrevented`, the ladder ALSO fires. One
	// Esc doing two things is precisely what the ladder's one-thing-at-a-time contract is.
	expect(fireEvent.keyDown(grid(), { key: "Escape" })).toBe(true);
});

test("the stop CLAMPS when the list shrinks out from under it", () => {
	const stub = makeStubHost();
	showEntities(stub, THREE);
	act(() => {
		fireEvent.keyDown(grid(), { key: "End" });
	});
	expect(document.activeElement === stops()[2]).toBe(true);

	// Two ⌘Z, or two deletes: the stop is now past the end of the list. Without the
	// clamp it stays there, no control carries tabindex 0, and the whole list drops out
	// of the tab order with nothing thrown and nothing logged.
	pushEntities(stub, [ENTITY]);
	expect(stops().length).toBe(1);
	expect(tabbable().length === 1 && tabbable()[0] === stops()[0]).toBe(true);
});

test("⏎ on the row is the row's own click — and the session ladder never sees it", () => {
	const stub = makeStubHost();
	showEntities(stub, THREE);
	stops()[1]?.focus();

	const seen: string[] = [];
	const spy = (e: KeyboardEvent) => seen.push(e.key);
	window.addEventListener("keydown", spy);
	try {
		act(() => {
			fireEvent.keyDown(grid(), { key: "Enter" });
		});
		// The row's click, exactly: select on the host AND expand, which is what makes ⏎
		// and a mouse click the same act rather than two that could drift.
		expect(stub.calls.selectEntity.mock.calls).toEqual([[5]]);
		expect(stops()[1]?.getAttribute("aria-expanded")).toBe("true");
		// `session.confirm` claims ⏎ on the window and preventDefaults it BEFORE its own
		// `enabled` is consulted — so a focused button's native activation never runs and
		// the grid has to claim the key itself. Letting it through would apply the live
		// session instead of opening the row.
		expect(seen.includes("Enter")).toBe(false);
	} finally {
		window.removeEventListener("keydown", spy);
	}
});

// The hazard F4.5c Task 8 handed forward: `ActionTip` is a Radix tooltip that opens on
// FOCUS, and Radix's focus path calls `onOpen()` with NO delay (`delayDuration` governs
// the hover path only — verified in @radix-ui/react-tooltip 1.2.16). So without a veto
// every arrow press pops a box, which is exactly why BurgerMenu's titles were exempted
// from the conversion.
test("arrow TRAVEL pops no tooltip; a focus that arrives any other way still does", async () => {
	const stub = makeStubHost();
	showEntities(stub, THREE);
	stops()[0]?.focus();
	act(() => {
		fireEvent.keyDown(grid(), { key: "ArrowDown" });
	});
	expect(screen.queryByRole("tooltip") === null).toBe(true);

	// D-25 is intact: the SAME control still documents itself when focus arrives by Tab
	// or by a click. The tip stopped chasing the cursor; it did not go away.
	act(() => {
		fireEvent.focus(stops()[1] as HTMLElement);
	});
	expect(
		within(await screen.findByRole("tooltip")).getByText(
			"select this stamp and show its recipe",
		),
	).toBeTruthy();
});

// The other axis, and the reason the veto is per-axis rather than global: stepping the
// verbs of ONE row is inspection, and each verb's sentence is the answer being looked
// for. Travelling the rows is navigation, and every row's sentence is the same one.
test("stepping the verb cluster DOES document each verb", async () => {
	const stub = makeStubHost();
	showEntities(stub, THREE);
	stops()[1]?.focus();
	act(() => {
		fireEvent.keyDown(grid(), { key: "ArrowRight" });
	});
	expect(
		within(await screen.findByRole("tooltip")).getByText(
			"reconfigure this stamp",
		),
	).toBeTruthy();
});

// --- F4.5c Task 9, review round --------------------------------------------

/** One row element, by a verb that names its entity. */
const rowOf = (entityId: number): HTMLElement => {
	const row = rowButton("freeze", entityId).closest('[role="row"]');
	if (!(row instanceof HTMLElement))
		throw new Error(`entity ${entityId} has no role=row`);
	return row;
};

const colIndexes = (row: HTMLElement): (string | null)[] =>
	Array.from(row.querySelectorAll('[role="gridcell"]')).map((c) =>
		c.getAttribute("aria-colindex"),
	);

// IMPORTANT 1. Clamping the stop is only half of what a shrink needs. The flow this task
// built ends here: ↓ selects an entity, ⌫ at the window deletes it, and the row the user
// was standing on is gone — so without the recovery `document.activeElement` is `<body>`
// and ↑/↓ are dead until they Tab back into the palette.
test("a shrink that removes the FOCUSED row hands focus back to the list", () => {
	const stub = makeStubHost();
	showEntities(stub, THREE);
	act(() => {
		fireEvent.keyDown(grid(), { key: "End" });
	});
	expect(document.activeElement === stops()[2]).toBe(true);

	pushEntities(stub, [ENTITY]);
	expect(stops().length).toBe(1);
	expect(document.activeElement === stops()[0]).toBe(true);
	// …and the stop went with it, so the recovery did not leave a list whose focus and
	// whose tab stop are on different controls.
	expect(tabbable().length === 1 && tabbable()[0] === stops()[0]).toBe(true);
});

// The recovery's first obligation is to do NOTHING. A list that mounts while the user is
// typing somewhere else must not seize the keyboard — and the first cut of it did exactly
// that, because "nothing has ever held focus here" and "the thing that held focus died"
// look identical to any check that only asks whether something is focused now.
test("a grid that MOUNTS does not take focus from wherever the user was", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	pushEntities(stub, THREE);
	expect(document.activeElement === document.body).toBe(true);
	// Opening the section is what mounts the grid — the case that measured BODY → the
	// first row before the guard landed.
	fireEvent.click(screen.getByText("Entities (3)"));
	expect(grid()).toBeTruthy();
	expect(document.activeElement === document.body).toBe(true);
});

// The other half of the recovery's contract, and the reason it tests the LAST FOCUSED
// CONTROL rather than "is anything focused": a list must never reach out and take focus
// from somewhere it was not. Clicking dead space elsewhere leaves that control connected
// and enabled, so a later shrink is not mistaken for a lost focus.
test("a shrink does NOT steal focus back when the user had already left", () => {
	const stub = makeStubHost();
	showEntities(stub, THREE);
	const outside = document.createElement("button");
	document.body.appendChild(outside);
	try {
		act(() => {
			fireEvent.keyDown(grid(), { key: "End" });
		});
		expect(document.activeElement === stops()[2]).toBe(true);
		// Focus leaves for a control that has nothing to do with this palette…
		outside.focus();
		expect(document.activeElement === outside).toBe(true);
		// …and a shrink under it must not yank the user back into the list.
		pushEntities(stub, [ENTITY]);
		expect(document.activeElement === outside).toBe(true);
	} finally {
		outside.remove();
	}
});

// IMPORTANT 2, from the side that would break it. `ROW_STOP` matches the first cell's
// button in EVERY row, and the expanded params row IS a row — so the stop count and the
// entity count are two different numbers the moment anything focusable lands in it. The
// row axis therefore reports the row's `rowId`, and this pins that the params row does
// not carry one.
test("an EXPANDED row adds no stop, and the params row names no entity", () => {
	const stub = makeStubHost();
	showEntities(stub, THREE);
	fireEvent.click(stops()[0] as HTMLElement);
	expect(stops()[0]?.getAttribute("aria-expanded")).toBe("true");
	// THREE entities, THREE stops — the params row contributes none.
	expect(stops().length).toBe(3);

	// Every row that IS an entity names it; the params row deliberately does not, so a
	// stop that ever did land there would select nothing rather than the wrong stamp.
	const ids = Array.from(
		grid().querySelectorAll<HTMLElement>('[role="row"]'),
	).map((r) => r.dataset["rowId"] ?? null);
	expect(ids).toEqual(["1", null, "5", "9"]);
});

// IMPORTANT 3. Replacing `button:not([disabled])` with `button` left all 79 tests across
// the three palettes green — while the comment on it names the exact failure it prevents.
// A frozen row is the fixture that has one: `openBlockedReason` is non-null, so Open is
// `disabled` and takes no focus at all.
test("→ steps OVER a verb the row cannot run", () => {
	const stub = makeStubHost();
	showEntities(stub, [ENTITY, FROZEN, { ...ENTITY, entityId: 9 }]);
	const open = screen.getByLabelText(/^open entity 2\b/) as HTMLButtonElement;
	expect(open.disabled).toBe(true);

	stops()[1]?.focus();
	act(() => {
		fireEvent.keyDown(grid(), { key: "ArrowRight" });
	});
	// UNFREEZE, not Open. Stepping onto the disabled Open would drop focus to the body and
	// strand the user outside the list — the same hole Important 1 covers from the other
	// direction, reached here by an ordinary arrow press.
	expect(document.activeElement === rowButton("unfreeze", 2)).toBe(true);
	expect(document.activeElement === open).toBe(false);
});

// The conditional-Δ design exists so that a verb reports the SAME column on every row.
// Nothing pinned it: changing `colIndex={3}` to `colIndex={6}` — two verbs claiming one
// column — left every test green.
test("a verb keeps its column whether or not the row drifted", () => {
	const stub = makeStubHost();
	showEntities(stub, THREE);
	// Undrifted: the Δ column (2) is simply absent, which is what `aria-colcount` plus a
	// stated `aria-colindex` per cell is FOR.
	expect(colIndexes(rowOf(1))).toEqual(["1", "3", "4", "5", "6"]);
	expect(grid().getAttribute("aria-colcount")).toBe("6");

	act(() => {
		stub.fire.drift({
			findings: [{ opId: 12, kind: "drifted", chunks: ["0,0,0"] }],
			entityIds: [1],
		});
	});
	expect(colIndexes(rowOf(1))).toEqual(["1", "2", "3", "4", "5", "6"]);
	// …and the row that did NOT drift is unchanged: freeze is column 4 on both.
	expect(colIndexes(rowOf(5))).toEqual(["1", "3", "4", "5", "6"]);
});
