// The committed-entities list: one row per generator entity in log order, fed
// by the shell provider's host.listEntities() mirror (F4.5a Task 10 — it used to
// be the panel's). Clicking a row SELECTS its entity and expands an inline
// READ-ONLY params <dl>; clicking again collapses it and leaves the selection
// standing. F3a added the smart-object verbs beside it: Open starts a
// reconfigure session (the same staged form a fresh stamp gets), then
// freeze/unfreeze and bake. The <dl> stays read-only — it is the record, not
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
//   - 🗑 delete joins the row, and bake adopts the mock's ⬇ glyph.
//   - a Δ badge appears on any row the standing drift report touches, and is a
//     POINTER to the report rather than a copy of it — the DriftReport section
//     stays where it is, and the badge scrolls it into view.
//
// VISUAL-GATE RIDER: the two destructive verbs (⬇ bake, 🗑 delete) carry NO
// `text-destructive`, where their worded predecessors did. The class had to go
// rather than move, because a bare emoji renders from the colour-emoji font and
// ignores `color` outright — so it was styling that did nothing while reading as
// though it did. Forcing text presentation (a `\uFE0E` variation selector) is
// unreliable across platforms, so the real answer is an SVG icon set, which is a
// design decision for the gate rather than a fix to guess at here. Until then the
// destructive pair is distinguished by its glyphs and its confirmations, not by
// colour.
//
// Verb spelling, from the spec rather than from the shape of the code: D-14 maps
// the row's glyph trio as freeze ❄ / BAKE ⬇ / delete 🗑, and the mock's own
// caption says those three "stay on the row". So ⬇ is bake — NOT duplicate — and
// DUPLICATE IS NOT A ROW VERB AT ALL: the mock puts it in the burger
// (`Duplicate "maze-3"`), which is why there is no ⬇-for-duplicate button below
// however naturally the glyph reads as one.
//
// `FieldHost.duplicateEntity` exists and is tested; it is deliberately menu-only,
// and F4.5b Task 7 gives it its binding — ⌘J plus an Edit-menu item (the
// charter's §5 ruling, superseding the mock's ⌘D, which Safari owns as
// bookmark-this-page). INTERIM GAP, stated the way Task 3 stated its Select-button
// stopgap: between this task and Task 7 the verb is reachable from tests and from
// nothing else. That is a gap in reach, not in behaviour.
//
// "Open" keeps its word because the mock RELOCATES it rather than restyling it
// (into the session card, D-13) — inventing a glyph for a control that is about
// to move would be churn with a guess in it. Four controls, three of them glyphs;
// whether a ⋯ menu earns its click gets decided when the relocation lands and it
// is clear what is left. (The original reason for inline buttons — Radix menus
// not rendering under this package's happy-dom harness — is no longer true: the
// burger menu is asserted through its content in tests/chrome/shell.test.tsx,
// once `_register.ts` is imported FIRST so Radix resolves `globalThis.document`
// at module-evaluation time.)
//
// a11y convention for the row: the four ACTION buttons all carry an aria-label
// naming their verb AND the entity id, because their visible text ("Open", "❄",
// "🗑") repeats identically on every row — a screen-reader user choosing between
// eight identically-named buttons cannot tell which stamp they are about to
// sever. Every one of them also carries its DISABLED REASON in that label when it
// has one, because the wrapper `title` a disabled button needs (it swallows
// pointer events) sits on a non-focusable span that reaches neither a screen
// reader reliably nor a keyboard user at all. The expand button is the exception
// and needs no label: its visible text already names the stamp it belongs to.
import { Fragment, useEffect, useRef, useState } from "react";
import type { FieldEntityInfo } from "../../../viewport-host/index.ts"; // type-only: erased
import { cn } from "../../lib/cn.ts";
// The committed-entity policy vocabulary: one blocked-reason rule per row verb,
// plus the param renderer the provider's push guard also compares through. A
// chrome-side lib module on purpose (see its header): the host imports it, never
// the reverse.
import {
	bakeBlockedReason,
	deleteBlockedReason,
	formatParam,
	freezeBlockedReason,
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

const ROW_BUTTON_CLASS = "h-5 px-1.5 text-xs";

/** One row verb's control, with the wrapper a DISABLED button needs: a disabled
 *  button swallows pointer events, so the mouse tooltip has to ride a span around
 *  it — and because that span is not focusable, the reason goes in the
 *  `aria-label` too or a keyboard user never gets it. One component so the four
 *  verbs cannot drift apart on this again (they did: ❄ and bake shipped bare, and
 *  bake's tooltip still promised to sever a recipe on a row where it could not).
 *
 *  `glyph` renders inside an `aria-hidden` span: the accessible name is the label,
 *  never the pictograph. */
function RowVerb(props: {
	entityId: number;
	/** The verb, as it appears in the accessible name: `freeze entity 7`. */
	verb: string;
	glyph?: string;
	label?: string;
	/** Why the verb is unavailable, or null when it is. */
	blocked: string | null;
	/** The tooltip when it is NOT blocked. */
	title: string;
	className?: string;
	onClick: () => void;
}) {
	const { blocked } = props;
	return (
		// The wrapper carries the tooltip ONLY while the button is disabled, which is
		// the one state that needs it: a disabled button swallows pointer events, so a
		// `title` on it never fires. An ENABLED button keeps its own, because the
		// element the user hovers and focuses should be the element that explains
		// itself — a wrapper span is neither focusable nor hit-tested independently.
		<span title={blocked ?? undefined}>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className={cn(ROW_BUTTON_CLASS, props.className)}
				disabled={blocked !== null}
				title={blocked === null ? props.title : undefined}
				aria-label={
					blocked === null
						? `${props.verb} entity ${props.entityId}`
						: `${props.verb} entity ${props.entityId} (${blocked})`
				}
				onClick={props.onClick}
			>
				{props.glyph === undefined ? (
					props.label
				) : (
					<span aria-hidden="true">{props.glyph}</span>
				)}
			</Button>
		</span>
	);
}

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
	// state and disagree on screen. `block: "nearest"` scrolls only when the row is
	// actually out of view. The ref is genuinely nullable — the section is
	// collapsed by default, so there is often no row element at all.
	//
	// Keyed on the SELECTION alone, deliberately. Adding `entities` would re-scroll
	// on every entity tick — a commit elsewhere, a freeze on another row, a ⌘Z —
	// and each one would throw away wherever the user had scrolled this palette to.
	// What that costs is the case where a row MOVES under a standing selection
	// (only a delete above it can do that, and only by one row), which is a far
	// smaller loss than yanking the scroll position out from under someone
	// mid-read.
	useEffect(() => {
		if (selectedId === null) return;
		selectedRow.current?.scrollIntoView({ block: "nearest" });
	}, [selectedId]);

	return (
		<CollapsibleSection
			title={`Entities (${entities.length})`}
			// INHERITED from when this was reference context inside FieldPanel, and
			// now questionable rather than obviously right: D-14 just made it the
			// layers panel, and a layers panel that starts closed hides the READ half
			// of the selection sync — pick something in the viewport and nothing
			// visibly happens until you open a section. Left closed for this task
			// because the answer belongs with the palette-layout pass (Task 8), which
			// decides what the controls column opens on and is where a default that
			// costs vertical space has to be paid for. Open-state stays per-mount
			// either way: no persistence.
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
								<RowVerb
									entityId={e.entityId}
									verb="open"
									label="Open"
									blocked={openBlockedReason(e)}
									title="reconfigure this stamp"
									onClick={() => props.onReconfigure(e.entityId)}
								/>
								<RowVerb
									entityId={e.entityId}
									verb={frozen ? "unfreeze" : "freeze"}
									glyph={frozen ? "🔓" : "❄"}
									blocked={freezeBlockedReason(e)}
									// The freeze consequence is stated UNCONDITIONALLY rather than
									// only on the row that has a session open, and it costs nothing
									// to do so: the sentence is true of every unfrozen row (the host
									// cancels a session on the entity it freezes), so the wider
									// phrasing makes the warning no weaker while leaving this list
									// uncoupled from the session. That coupling IS available since
									// F4.5b Task 2 — the session is a shell context (`useFieldStamp`)
									// any surface may read — and is declined rather than unreachable:
									// a tooltip that re-renders on every nudge of an unrelated stamp
									// is a poor trade for one word.
									title={
										frozen
											? "allow this stamp to be reconfigured again"
											: "protect this stamp from reconfigure — ends any reconfigure session open on it"
									}
									onClick={() => props.onFreeze(e.entityId, !frozen)}
								/>
								{/* ⬇ is BAKE (D-14's glyph map), not duplicate — see the header. */}
								<RowVerb
									entityId={e.entityId}
									verb="bake"
									glyph="⬇"
									blocked={bakeBlockedReason(e)}
									title="sever this stamp's recipe — permanent"
									onClick={() => props.onBake(e.entityId)}
								/>
								<RowVerb
									entityId={e.entityId}
									verb="delete"
									glyph="🗑"
									blocked={deleteBlockedReason(e)}
									title="remove this stamp and its ops"
									onClick={() => props.onDelete(e.entityId)}
								/>
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
