// The committed-entities list: one row per generator entity in log order, fed
// by the shell provider's host.listEntities() mirror (F4.5a Task 10 — it used to
// be the panel's). Clicking a row SELECTS its entity and expands an inline
// READ-ONLY params <dl>; clicking again collapses it and leaves the selection
// standing. F3a added the smart-object verbs beside it: Open starts a
// reconfigure session (the same staged form a fresh stamp gets), then
// Freeze/Unfreeze and Bake…. The <dl> stays read-only — it is the record, not
// the editor; Open is how a row becomes editable, which is also why a FROZEN or
// BAKED row keeps its params visible while its Open is disabled.
//
// F3b adds nothing but a segment: a scatter is an ordinary generator entity, so
// its row already had every verb and the generic params <dl>. What it lacked was
// the one fact the rest of the row's summary could not carry — a scatter writes
// no cells, so "1 ops" says nothing about what it put down. `placed` (host-
// derived, see rowSummary) names the archetype and the count.
//
// F4.5b Task 4 makes this the LAYERS panel (D-14) rather than a read-out:
//   - the row is one half of a BIDIRECTIONAL selection sync. Clicking it calls
//     the host's `selectEntity`, which is the same state a `pointer` click in
//     the viewport writes; the id coming back down `subscribeEntitySelection`
//     styles the row and scrolls it into view. One selection concept, two
//     surfaces — which is also how expanding a row got its viewport box back
//     after `highlightEntity` was retired (Task 3): the box follows SELECTION
//     now, and selection is what a row click writes.
//   - two verbs join the three: ⬇ duplicate and 🗑 delete.
//   - a Δ badge appears on any row the standing drift report touches, and is a
//     POINTER to the report rather than a copy of it — the DriftReport section
//     stays where it is, and the badge scrolls it into view.
//
// Verb spelling: the three GLYPH verbs (❄ ⬇ 🗑) are the cockpit mock's row;
// "Open" and "Bake…" keep their words because the mock relocates them rather
// than restyling them (Open into the session card, D-13), and inventing glyphs
// for two verbs that are about to move would be churn with a guess in it. Five
// controls is over the threshold where a ⋯ menu earns its extra click — revisit
// when the relocation lands, not before, because the answer depends on what is
// left. (The original reason for inline buttons — Radix menus not rendering
// under this package's happy-dom harness — is no longer true: the burger menu is
// asserted through its content in tests/chrome/shell.test.tsx, once
// `_register.ts` is imported FIRST so Radix resolves `globalThis.document` at
// module-evaluation time.)
//
// a11y convention for the row: the five ACTION buttons all carry an aria-label
// naming their verb AND the entity id, because their visible text ("Open", "❄",
// "🗑") repeats identically on every row — a screen-reader user choosing between
// ten identically-named buttons cannot tell which stamp they are about to sever.
// The expand button is the exception and needs no label: its visible text
// already names the stamp it belongs to.
import { Fragment, useEffect, useRef, useState } from "react";
import type { FieldEntityInfo } from "../../../viewport-host/index.ts"; // type-only: erased
import { cn } from "../../lib/cn.ts";
// The shared host/chrome rules for what blocks a reconfigure and what blocks a
// delete. A chrome-side lib module on purpose (see its header): the host imports
// it, never the reverse.
import {
	deleteBlockedReason,
	openBlockedReason,
} from "../../lib/field-entity.ts";
import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { Button } from "../ui/button.tsx";

/** `opSpan` is [firstOpId, lastOpId] inclusive (commitGenerator). */
const opCount = (e: FieldEntityInfo): number => e.opSpan[1] - e.opSpan[0] + 1;

/** The row's one-line record, `·`-joined: the recipe (generator, seed, span
 *  size) plus, for a stamp that PLACED something, each archetype it placed and
 *  how many — `scatter · seed 3 · 1 ops · rock · 24 placed`.
 *
 *  Deliberately NOT the StampInspector's zero-rule, which it otherwise resembles.
 *  That one gates on the GENERATOR (`def.placesProps`) and so shows "· 0 props"
 *  at zero, because a settled preview at zero is the state whose commit refusal
 *  it is about to explain. A committed row has no such state to explain, and no
 *  per-entity `placesProps` to gate on — the chrome sees records, not schemas —
 *  so it gates on the records and shows nothing. Consequence, stated because it
 *  is a real (if unreachable) gap: a LOADED world holding a placer that placed
 *  zero would read like a carver. The host refuses to commit one, so only a
 *  hand-written oplog can produce it. */
const rowSummary = (e: FieldEntityInfo): string =>
	[
		e.generator,
		`seed ${e.seed}`,
		`${opCount(e)} ops`,
		...e.placed.flatMap((p) => [p.archetypeId, `${p.count} placed`]),
	].join(" · ");

/** Params are schema-driven primitives (number/boolean/enum string); the
 *  object branch is a robustness fallback, not an expected shape.
 *
 *  Exported because the provider's `sameEntities` push guard compares params
 *  through it: what must not go stale is the STRING this produces, so the guard
 *  and the `<dl>` read the same function rather than two spellings of "render a
 *  param" that can drift apart. */
export const formatParam = (v: unknown): string =>
	typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);

const ROW_BUTTON_CLASS = "h-5 px-1.5 text-xs";

/** The frozen/baked state chip. Muted, not semantic-coloured: these are states
 *  of a record, not warnings — the disabled Open carries the consequence. The
 *  glyph is decorative and the WORD is the accessible text, so a lookup by
 *  visible text still finds "frozen" / "baked". */
function StateBadge({ label, glyph }: { label: string; glyph?: string }) {
	return (
		<span className="flex items-center gap-0.5 rounded bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
			{glyph !== undefined && <span aria-hidden="true">{glyph}</span>}
			<span>{label}</span>
		</span>
	);
}

export function EntitiesList(props: {
	entities: readonly FieldEntityInfo[];
	/** The host's selected entity id (`subscribeEntitySelection`), or null. */
	selectedId: number | null;
	/** Entities the STANDING drift report touches — the Δ badge's rows. */
	driftedIds: ReadonlySet<number>;
	/** Select this entity on the host (host.selectEntity) — the write half of the
	 *  bidirectional sync. */
	onSelect: (id: number) => void;
	/** Bring the drift report into view (a Δ badge click). */
	onShowDrift: () => void;
	/** Open a reconfigure session on this entity (host.openEntity). */
	onReconfigure: (id: number) => void;
	/** Flip the entity's frozen flag (host.setEntityFrozen). */
	onFreeze: (id: number, frozen: boolean) => void;
	/** Commit a copy beside it (host.duplicateEntity). */
	onDuplicate: (id: number) => void;
	/** Request a delete. The PALETTE owns the confirmation — this list never
	 *  removes a stamp on its own click. */
	onDelete: (id: number) => void;
	/** Request a bake. The PALETTE owns the confirmation — this list never severs
	 *  a recipe on its own click (bake is the one irreversible verb). */
	onBake: (id: number) => void;
}) {
	const { entities, selectedId, driftedIds } = props;
	const [expandedId, setExpandedId] = useState<number | null>(null);
	const selectedRow = useRef<HTMLDivElement | null>(null);

	// A refresh can remove the expanded entity (⌘Z undoes the whole commit,
	// 🗑 removes it outright): drop the expansion so it does not outlive its row.
	useEffect(() => {
		if (
			expandedId !== null &&
			!entities.some((e) => e.entityId === expandedId)
		) {
			setExpandedId(null);
		}
	}, [entities, expandedId]);

	// The READ half of the sync: a selection made in the VIEWPORT has to reach a
	// row that may be scrolled out of the palette, or the two surfaces agree in
	// state and disagree on screen. `block: "nearest"` scrolls only when the row
	// is actually out of view. The ref is genuinely nullable — the section is
	// collapsed by default, so there is often no row element at all.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the ref is re-pointed during the render that `entities` triggers; re-running on a list change is what re-scrolls after a row moves.
	useEffect(() => {
		if (selectedId === null) return;
		selectedRow.current?.scrollIntoView({ block: "nearest" });
	}, [selectedId, entities]);

	return (
		<CollapsibleSection
			title={`Entities (${entities.length})`}
			// Reference context, not the focus — closed by default. Open-state is
			// per-mount on purpose: no persistence.
			defaultOpen={false}
		>
			<div className="flex flex-col gap-0.5">
				{entities.length === 0 && (
					<p className="px-1 text-xs text-muted-foreground">
						no committed stamps yet
					</p>
				)}
				{entities.map((e) => {
					const expanded = e.entityId === expandedId;
					const blocked = openBlockedReason(e);
					const deleteBlocked = deleteBlockedReason(e);
					const baked = e.baked === true;
					const frozen = e.frozen === true;
					const selected = e.entityId === selectedId;
					return (
						<div key={e.entityId} ref={selected ? selectedRow : null}>
							<div className="flex items-center gap-1">
								<button
									type="button"
									aria-expanded={expanded}
									// The selected state, in the markup rather than only in a
									// class: "the current item in this list" is exactly what
									// aria-current means, and it is what makes the sync assertable
									// without reaching for a Tailwind string.
									aria-current={selected ? "true" : undefined}
									title="select this stamp and show its recipe"
									// ONE click, two effects, and they are not redundant: the
									// selection is HOST state (it draws the footprint box and is
									// what the viewport's own pick writes), the expansion is this
									// list's display state. Collapsing therefore leaves the entity
									// selected — un-expanding a row is not a statement about what
									// is being worked on.
									onClick={() => {
										props.onSelect(e.entityId);
										setExpandedId(expanded ? null : e.entityId);
									}}
									className={cn(
										"flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/50",
										expanded && "bg-muted",
										selected && "bg-primary/15 ring-1 ring-primary/40",
									)}
								>
									<span aria-hidden="true">▦</span>
									<span
										className={cn(
											"min-w-0 flex-1 truncate font-mono",
											// A frozen row reads as protected rather than active.
											frozen && "text-muted-foreground",
										)}
									>
										{rowSummary(e)}
									</span>
									{frozen && <StateBadge label="frozen" glyph="🔒" />}
									{baked && <StateBadge label="baked" />}
								</button>
								{driftedIds.has(e.entityId) && (
									<Button
										type="button"
										size="sm"
										variant="ghost"
										className={cn(ROW_BUTTON_CLASS, "text-amber-500")}
										title="the last reconfigure disturbed something here — show the drift report"
										aria-label={`show drift near entity ${e.entityId}`}
										onClick={props.onShowDrift}
									>
										Δ
									</Button>
								)}
								{/* A bare title (not ReasonTip): a DISABLED button swallows
								    pointer events, so the mouse tooltip rides the wrapper span.
								    The reason is ALSO in the aria-label, because that span is
								    not focusable and a title on it reaches neither a screen
								    reader reliably nor a keyboard user at all. */}
								<span title={blocked ?? "reconfigure this stamp"}>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										className={ROW_BUTTON_CLASS}
										disabled={blocked !== null}
										aria-label={
											blocked === null
												? `open entity ${e.entityId}`
												: `open entity ${e.entityId} (${blocked})`
										}
										onClick={() => props.onReconfigure(e.entityId)}
									>
										Open
									</Button>
								</span>
								{/* Both verbs refuse a baked entity core-side (a severed recipe
								    has nothing left to protect and cannot re-bake), so the row
								    disables rather than reports. */}
								<Button
									type="button"
									size="sm"
									variant="ghost"
									className={ROW_BUTTON_CLASS}
									disabled={baked}
									// The freeze consequence is stated UNCONDITIONALLY rather than
									// only on the row that has a session open, and it costs
									// nothing to do so: the sentence is true of every unfrozen
									// row (the host cancels a session on the entity it freezes),
									// so the wider phrasing makes the warning no weaker while
									// leaving this list uncoupled from the session. That
									// coupling IS available since F4.5b Task 2 — the session is
									// a shell context (`useFieldStamp`) any surface may read —
									// and is declined rather than unreachable: a tooltip that
									// re-renders on every nudge of an unrelated stamp is a poor
									// trade for one word.
									title={
										frozen
											? "allow this stamp to be reconfigured again"
											: "protect this stamp from reconfigure — ends any reconfigure session open on it"
									}
									aria-label={`${frozen ? "unfreeze" : "freeze"} entity ${e.entityId}`}
									onClick={() => props.onFreeze(e.entityId, !frozen)}
								>
									<span aria-hidden="true">{frozen ? "🔓" : "❄"}</span>
								</Button>
								{/* Enabled on frozen AND baked rows, unlike every other verb
								    here, because the copy is a fresh commit from recorded
								    provenance rather than an edit of the protected record — see
								    FieldHost.duplicateEntity. No confirmation: it is additive
								    and ⌘Z is one step. */}
								<Button
									type="button"
									size="sm"
									variant="ghost"
									className={ROW_BUTTON_CLASS}
									title="commit a copy of this stamp beside it"
									aria-label={`duplicate entity ${e.entityId}`}
									onClick={() => props.onDuplicate(e.entityId)}
								>
									<span aria-hidden="true">⬇</span>
								</Button>
								<span title={deleteBlocked ?? "remove this stamp and its ops"}>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										className={cn(ROW_BUTTON_CLASS, "text-destructive")}
										disabled={deleteBlocked !== null}
										aria-label={
											deleteBlocked === null
												? `delete entity ${e.entityId}`
												: `delete entity ${e.entityId} (${deleteBlocked})`
										}
										onClick={() => props.onDelete(e.entityId)}
									>
										<span aria-hidden="true">🗑</span>
									</Button>
								</span>
								<Button
									type="button"
									size="sm"
									variant="ghost"
									className={cn(ROW_BUTTON_CLASS, "text-destructive")}
									disabled={baked}
									title="sever this stamp's recipe — permanent"
									aria-label={`bake entity ${e.entityId}`}
									onClick={() => props.onBake(e.entityId)}
								>
									Bake…
								</Button>
							</div>
							{expanded && (
								<dl className="grid grid-cols-[auto_1fr] gap-x-3 px-6 py-1 text-xs text-muted-foreground">
									{Object.entries(e.params).map(([k, v]) => (
										<Fragment key={k}>
											<dt className="font-mono">{k}</dt>
											<dd className="tabular-nums">{formatParam(v)}</dd>
										</Fragment>
									))}
								</dl>
							)}
						</div>
					);
				})}
			</div>
		</CollapsibleSection>
	);
}
