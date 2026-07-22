// The committed-entities list: one row per generator entity in log order, fed
// by the panel's host.listEntities() clones. Clicking a row shows its amber-dim
// region box (host.highlightEntity) plus an inline READ-ONLY params <dl>;
// clicking again collapses both. F3a adds the smart-object verbs beside it:
// Open starts a reconfigure session (the same staged form a fresh stamp gets),
// then Freeze/Unfreeze and Bake…. The <dl> stays read-only — it is the record,
// not the editor; Open is how a row becomes editable, which is also why a
// FROZEN or BAKED row keeps its params visible while its Open is disabled.
//
// Three inline buttons rather than the planned ⋯ dropdown: the Radix menu family
// does not render its content under this package's happy-dom harness (verified
// on HEAD — tests/chrome/menubar.test.tsx fails 6/10 for exactly that reason),
// so a menu here would ship the two destructive-ish verbs with no test at all.
// Row density is F4's problem; unverifiable behaviour is this task's.
import type { GeneratorEntity } from "@furnace/core/field"; // type-only: erased
import { Fragment, useEffect, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { Button } from "../ui/button.tsx";

/** `opSpan` is [firstOpId, lastOpId] inclusive (commitGenerator). */
const opCount = (e: GeneratorEntity): number => e.opSpan[1] - e.opSpan[0] + 1;

/** Params are schema-driven primitives (number/boolean/enum string); the
 *  object branch is a robustness fallback, not an expected shape. */
const formatParam = (v: unknown): string =>
	typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);

/** Why Open is unavailable, or undefined when it is available. Both flags are
 *  `true`-or-absent core-side, so the checks read the presence, never `=== false`. */
const openBlockedReason = (e: GeneratorEntity): string | undefined => {
	if (e.baked === true) return "baked — the recipe was severed, permanently";
	if (e.frozen === true) return "frozen — unfreeze it to edit";
	return undefined;
};

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
	entities: GeneratorEntity[];
	onHighlight: (id: number | null) => void;
	/** Open a reconfigure session on this entity (host.openEntity). */
	onOpen: (id: number) => void;
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
			// Reference context, not the focus — closed by default (the InspectPanel
			// resources idiom). Open-state is per-mount on purpose: no persistence.
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
										{e.generator} · seed {e.seed} · {opCount(e)} ops
									</span>
									{e.frozen === true && <StateBadge label="frozen" />}
									{baked && <StateBadge label="baked" />}
								</button>
								{/* A bare title (not ReasonTip): a DISABLED button swallows
								    pointer events, so the tooltip rides the wrapper span. */}
								<span title={blocked ?? "reconfigure this stamp"}>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										className={ROW_BUTTON_CLASS}
										disabled={blocked !== undefined}
										aria-label={`open entity ${e.entityId}`}
										onClick={() => props.onOpen(e.entityId)}
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
									title={
										e.frozen === true
											? "allow this stamp to be reconfigured again"
											: "protect this stamp from reconfigure"
									}
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
