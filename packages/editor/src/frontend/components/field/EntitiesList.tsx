// The committed-entities list: one row per generator entity in log order, fed
// by the shell provider's host.listEntities() mirror (F4.5a Task 10 — it used to
// be the panel's). Clicking a row shows its amber-dim
// region box (host.highlightEntity) plus an inline READ-ONLY params <dl>;
// clicking again collapses both. F3a adds the smart-object verbs beside it:
// Open starts a reconfigure session (the same staged form a fresh stamp gets),
// then Freeze/Unfreeze and Bake…. The <dl> stays read-only — it is the record,
// not the editor; Open is how a row becomes editable, which is also why a
// FROZEN or BAKED row keeps its params visible while its Open is disabled.
//
// F3b adds nothing but a segment: a scatter is an ordinary generator entity, so
// its row already had every verb and the generic params <dl>. What it lacked was
// the one fact the rest of the row's summary could not carry — a scatter writes
// no cells, so "1 ops" says nothing about what it put down. `placed` (host-
// derived, see rowSummary) names the archetype and the count.
//
// Three inline buttons rather than the planned ⋯ dropdown. The original reason
// was that Radix menus did not render under this package's happy-dom harness —
// no longer true (the burger menu is asserted through its content in
// tests/chrome/shell.test.tsx, once `_register.ts` is imported FIRST so Radix
// resolves `globalThis.document` at module-evaluation time). What keeps the three
// buttons is now a plain design call: three verbs is under the threshold where a
// menu earns its extra click, and the palette they live in is wide enough for
// them. Revisit if a fourth verb lands (F4.5b's row delete is the candidate).
//
// a11y convention for the row: the three ACTION buttons all carry an aria-label
// naming their verb AND the entity id, because their visible text ("Open",
// "Freeze", "Bake…") repeats identically on every row — a screen-reader user
// choosing between six identically-named buttons cannot tell which stamp they
// are about to sever. The expand button is the exception and needs no label: its
// visible text already names the stamp it belongs to.
import { Fragment, useEffect, useState } from "react";
import type { FieldEntityInfo } from "../../../viewport-host/index.ts"; // type-only: erased
import { cn } from "../../lib/cn.ts";
// The shared host/chrome rule for what blocks a reconfigure. A chrome-side lib
// module on purpose (see its header): the host imports it, never the reverse.
import { openBlockedReason } from "../../lib/field-entity.ts";
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
 *  object branch is a robustness fallback, not an expected shape. */
const formatParam = (v: unknown): string =>
	typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);

const ROW_BUTTON_CLASS = "h-5 px-1.5 text-xs";

/** The frozen/baked state chip. Muted, not semantic-coloured: these are states
 *  of a record, not warnings — the disabled Open carries the consequence. */
function StateBadge({ label }: { label: string }) {
	return (
		<span className="rounded bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
			{label}
		</span>
	);
}

export function EntitiesList(props: {
	entities: FieldEntityInfo[];
	onHighlight: (id: number | null) => void;
	/** Open a reconfigure session on this entity (host.openEntity). */
	onReconfigure: (id: number) => void;
	/** Flip the entity's frozen flag (host.setEntityFrozen). */
	onFreeze: (id: number, frozen: boolean) => void;
	/** Request a bake. The PANEL owns the confirmation — this list never severs
	 *  a recipe on its own click (bake is the one irreversible verb). */
	onBake: (id: number) => void;
}) {
	const { entities, onHighlight } = props;
	const [expandedId, setExpandedId] = useState<number | null>(null);

	// A refresh can remove the expanded entity (⌘Z undoes the whole commit):
	// drop the expansion + the highlight box so neither outlives its row.
	useEffect(() => {
		if (
			expandedId !== null &&
			!entities.some((e) => e.entityId === expandedId)
		) {
			setExpandedId(null);
			onHighlight(null);
		}
	}, [entities, expandedId, onHighlight]);

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
					const baked = e.baked === true;
					return (
						<div key={e.entityId}>
							<div className="flex items-center gap-1">
								<button
									type="button"
									aria-expanded={expanded}
									title="show this stamp's region in the viewport"
									onClick={() => {
										const next = expanded ? null : e.entityId;
										setExpandedId(next);
										onHighlight(next);
									}}
									className={cn(
										"flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/50",
										expanded && "bg-muted",
									)}
								>
									<span aria-hidden="true">▦</span>
									<span className="min-w-0 flex-1 truncate font-mono">
										{rowSummary(e)}
									</span>
									{e.frozen === true && <StateBadge label="frozen" />}
									{baked && <StateBadge label="baked" />}
								</button>
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
									// only on the row that has a session open. It reads a little
									// wider than it needs to, and it costs this list its last
									// coupling to the stamp session — which lives behind a
									// single-slot host seam FieldPanel owns, in a different
									// palette, and which this list could only learn about by
									// stealing that seam or having its value handed sideways
									// through chrome. The sentence is true of every unfrozen row
									// (the host cancels a session on the entity it freezes), so
									// nothing about the warning got weaker.
									title={
										e.frozen === true
											? "allow this stamp to be reconfigured again"
											: "protect this stamp from reconfigure — ends any reconfigure session open on it"
									}
									aria-label={`${e.frozen === true ? "unfreeze" : "freeze"} entity ${e.entityId}`}
									onClick={() => props.onFreeze(e.entityId, e.frozen !== true)}
								>
									{e.frozen === true ? "Unfreeze" : "Freeze"}
								</Button>
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
