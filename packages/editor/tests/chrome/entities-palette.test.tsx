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
// shell's host-state provider (which owns `subscribeEntities` + `subscribeDrift` as
// single slots). The matching NEGATIVE assertion stayed behind in field-panel.test.tsx,
// where F4.5b Task 2 widened it to every seam there is.

import { afterEach, expect, test } from "bun:test";
import type { DriftFinding } from "@furnace/core/field";
import type { ConfirmRequest } from "../../src/frontend/components/ConfirmDialog.tsx";
import { EntitiesPalette } from "../../src/frontend/components/shell/EntitiesPalette.tsx";
import {
	FieldHostStateProvider,
	useFieldEntities,
} from "../../src/frontend/hooks/useFieldHostState.tsx";
import type { FieldEntityInfo } from "../../src/viewport-host/index.ts";
import {
	act,
	cleanup,
	fireEvent,
	makeEditorContext,
	render,
	renderWithEditor,
	screen,
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
	// The host quantizes each entity's footprint into the drift report's own
	// space so the Δ badge can be a string-set intersection here.
	footprintChunks: ["0,0,0"],
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
 *  needs to reach anything. */
function renderPalette(
	stub: ReturnType<typeof makeStubHost>,
	overrides: { openConfirm?: (r: ConfirmRequest) => void } = {},
) {
	return renderWithEditor(
		<FieldHostStateProvider host={stub.host} engineReady>
			<EntitiesPalette />
		</FieldHostStateProvider>,
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

// --- the seam itself: one subscription, guarded ------------------------------

test("the palette subscribes to nothing — the provider owns all three entity seams", () => {
	const stub = makeStubHost();
	renderPalette(stub);
	// Exactly ONE subscriber each. All three are single slots (`entitiesCb = cb`), so a
	// second claim anywhere would silently steal this one: no throw, no warning, the
	// list simply stops updating.
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
	const pushTick = (): boolean => {
		let delivered = false;
		act(() => {
			delivered = stub.fire.entities();
		});
		return delivered;
	};
	const pushDrift = (): boolean => {
		let delivered = false;
		act(() => {
			delivered = stub.fire.drift(null);
		});
		return delivered;
	};
	expect(pushTick()).toBe(true);
	expect(pushDrift()).toBe(true);
	unmount();
	// Single slots: an unsubscribe that does not FREE them leaves the next mount unable
	// to claim one — the list would be dead with nothing thrown and nothing logged.
	expect(pushTick()).toBe(false);
	expect(pushDrift()).toBe(false);
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

const FINDINGS: DriftFinding[] = [
	{ opId: 12, kind: "drifted", chunks: ["0,0,0", "1,0,0"] },
	{ opId: 15, kind: "orphaned", chunks: ["2,0,0"] },
];

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
	expect(screen.getByText("frozen")).toBeTruthy();
	expect(screen.getByText("baked")).toBeTruthy();
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
	fireEvent.click(rowButton("bake", 1));
	expect(stub.calls.bakeEntity).not.toHaveBeenCalled(); // routed to the confirm

	// The frozen row's button flips to Unfreeze and asks for false. This is also
	// the sameEntities guard's test — a flag-only change is the one the F2b
	// signature (id/generator/seed/opSpan) could not see.
	pushEntities(stub, [ENTITY, { ...second, frozen: true }]);
	fireEvent.click(rowButton("unfreeze", 7));
	expect(stub.calls.setEntityFrozen.mock.calls.at(-1)).toEqual([7, false]);
});

test("a baked row disables both verbs — core would refuse them anyway", () => {
	const stub = makeStubHost();
	showEntities(stub, [BAKED]);
	expect(rowButton("freeze", 3).disabled).toBe(true);
	expect(rowButton("bake", 3).disabled).toBe(true);
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
test("Freeze names the session it would end, on every unfrozen row", () => {
	const stub = makeStubHost();
	showEntities(stub, [ENTITY, FROZEN]);
	expect(rowButton("freeze", 1).getAttribute("title")).toBe(
		"protect this stamp from reconfigure — ends any reconfigure session open on it",
	);
	// …and the frozen row's inverse verb says what it does instead, with no warning to
	// carry: a frozen entity has no session to end.
	expect(rowButton("unfreeze", 2).getAttribute("title")).toBe(
		"allow this stamp to be reconfigured again",
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
	fireEvent.click(rowButton("bake", 1));
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

test("⬇ duplicates through the host, with no confirmation in the way", () => {
	const stub = makeStubHost();
	showEntities(stub, [ENTITY]);
	fireEvent.click(rowButton("duplicate", 1));
	// Additive and one ⌘Z away, so it asks nothing — unlike 🗑 and Bake….
	expect(stub.calls.duplicateEntity.mock.calls).toEqual([[1]]);
});

test("⬇ stays live on a frozen or baked row — a copy is a new commit, not an edit", () => {
	const stub = makeStubHost();
	showEntities(stub, [FROZEN, BAKED]);
	expect(rowButton("duplicate", 2).disabled).toBe(false);
	expect(rowButton("duplicate", 3).disabled).toBe(false);
});

test("🗑 confirms before removing the stamp — cancelling never reaches the host", () => {
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
	if (pending === null) throw new Error("🗑 did not open a confirmation");
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

test("🗑 is disabled with its reason on a frozen or baked row", () => {
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

// The Δ badge is a POINTER to the drift report, not a copy of it, and the rule
// is a chunk-set intersection: the host quantizes each entity's footprint into
// the SAME space the findings address (the chrome cannot value-import core to do
// that itself), so a badge appears exactly when the two sets meet.
test("Δ appears only on rows the standing drift report actually touches", () => {
	const stub = makeStubHost();
	const elsewhere: FieldEntityInfo = {
		...ENTITY,
		entityId: 8,
		footprintChunks: ["9,9,9"],
	};
	showEntities(stub, [ENTITY, elsewhere]);
	expect(screen.queryByLabelText(/^show drift near entity/)).toBeNull();

	act(() => {
		stub.fire.drift([{ opId: 12, kind: "drifted", chunks: ["0,0,0"] }]);
	});
	// Entity 1's footprint covers 0,0,0; entity 8's covers 9,9,9 only.
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
