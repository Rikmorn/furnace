// The walkability advisor's panel half (F4, D-F4-13): the triaged list beside
// the viewport's severity markers, and the filters that gate BOTH (the host
// applies them once, in its store, and both the marker rebuild and this list
// read what survives — so a checkbox here also changes what the viewport draws).
//
// ADVISOR POSTURE (D-F4-1), of which this file is the visible end: no row
// blocks a verb, no row mutates the field, nothing here removes a finding. The
// filters HIDE, and a hidden finding still counts in the header — which is why
// the section renders on what was FOUND rather than on what is shown. Gating on
// the visible rows would unmount the only control that could bring them back.
//
// Presentational, like DriftReport: every host verb arrives as a prop, and so
// does the one transient fact a row reads (`verifying`) — the panel owns which
// verify is in flight, because releasing it needs signals this file cannot see
// (a verdict push, or a refusal on the tool-error seam).
import type { ChunkKey, FieldFlag, FlagKind } from "@furnace/core/field"; // type-only: erased
import { useMemo } from "react";
import type {
	FlagCount,
	FlagFilters,
	FlagRow,
	FlagsSummary,
} from "../../../viewport-host/index.ts"; // type-only: erased
import { cn } from "../../lib/cn.ts";
import { CollapsibleSection } from "../CollapsibleSection.tsx";
import { Button } from "../ui/button.tsx";

/** A finding joins a cluster when it is within this world distance (metres) of
 *  ANY member — single-linkage, so a run of pinches along a corridor chains into
 *  one row instead of splitting at an arbitrary midpoint. */
const CLUSTER_RADIUS_M = 2;
const CLUSTER_RADIUS_SQ = CLUSTER_RADIUS_M * CLUSTER_RADIUS_M;

/** Why a `pit` cannot be verified in v1 (the D-F4-13 spec amendment): stage 2
 *  drives DIRECTED lanes at one anchor cell, and a pit is a whole region — one
 *  anchor's lanes would prove nothing about it. Walking it is the answer, so the
 *  button says so rather than greying out mutely. */
const PIT_VERIFY_REASON = "region-level — walk it";
const VERIFY_BUSY_REASON = "a verify is already running";

const FILTER_TITLES = {
	candidates: "findings worth a stage-2 verify",
	info: "context — terrain rather than a fault, or a class this mover handles",
	unreachable:
		"findings the reachability flood could not get to (demoted, never deleted)",
} as const satisfies Record<keyof FlagFilters, string>;

/** The filter row, in declaration order (string keys enumerate in insertion
 *  order). The `Record` above is what makes the set EXHAUSTIVE — a fourth band
 *  added to FlagFilters has no title and stops compiling, instead of shipping a
 *  filter nobody can reach. The cast only re-narrows what that Record already
 *  guarantees: `Object.keys` is typed `string[]` because a value can structurally
 *  carry extra keys, which an object literal checked against a Record cannot. */
const FILTER_BANDS = Object.keys(FILTER_TITLES) as (keyof FlagFilters)[];

/** Rows the user can act on wear the alarm colour; context wears the warning
 *  amber. The viewport's twins of these are `CANDIDATE_TINT` / `INFO_TINT` in
 *  field-flags.ts — matched by intent, NOT by import: the chrome cannot
 *  value-import anything under `viewport-host/` (frontend-no-engine-leakage
 *  bans the directory), so the two palettes agree by review. */
const DOT_CLASS = {
	candidate: "text-destructive",
	info: "text-warning",
} as const;

const VERDICT_CLASS = {
	trapped: "bg-destructive/20 text-destructive",
	clear: "bg-success/20 text-success",
	/** No answer is not a third answer (the `flagTint` rule): stay neutral. */
	inconclusive: "bg-muted text-muted-foreground",
} as const;

/** One row: same kind, same triage band, one neighbourhood. */
type FlagCluster = {
	/** First member in store order — the row's identity, the position it reads
	 *  at, the chunks it frames, and the ONE finding Verify is taken on. */
	anchor: FlagRow;
	members: FlagRow[];
};

const near = (
	a: readonly [number, number, number],
	b: readonly [number, number, number],
): boolean => {
	const dx = a[0] - b[0];
	const dy = a[1] - b[1];
	const dz = a[2] - b[2];
	return dx * dx + dy * dy + dz * dz <= CLUSTER_RADIUS_SQ;
};

/** What one row must be HOMOGENEOUS in, which is exactly what it displays: the
 *  kind in its label, the dot's severity, the demotion tag. (Today kind
 *  determines severity — core fixes a band per kind, at analyze.ts's push sites
 *  and reachability.ts's `pitFlag` — so the severity term never splits a group on
 *  its own; it costs nothing and keeps the dot from becoming a guess if that ever
 *  changes.) */
const bandKey = (f: FieldFlag): string =>
	`${f.kind}/${f.severity}/${f.unreachable === true}`;

const severityRank = (severity: FieldFlag["severity"]): number =>
	severity === "candidate" ? 0 : 1;

/** Findings → rows: group by band, then greedily agglomerate each band by
 *  {@link CLUSTER_RADIUS_M}, then float the candidates to the top.
 *
 *  GREEDY, not connected components: a finding near two existing clusters joins
 *  the first and does not merge them. That leaves cluster boundaries dependent
 *  on arrival order — which is stable, because the store hands its findings over
 *  in key order and the sort below is stable, so the same findings always
 *  produce the same rows in the same places. Merging would buy a tidier
 *  partition of a triage list nobody reads as a partition.
 */
function clusterRows(rows: readonly FlagRow[]): FlagCluster[] {
	const bands = new Map<string, FlagCluster[]>();
	for (const row of rows) {
		const band = bands.get(bandKey(row.flag));
		if (band === undefined) {
			bands.set(bandKey(row.flag), [{ anchor: row, members: [row] }]);
			continue;
		}
		const home = band.find((c) =>
			c.members.some((m) => near(m.flag.world, row.flag.world)),
		);
		if (home === undefined) band.push({ anchor: row, members: [row] });
		else home.members.push(row);
	}
	// Stable sort (ES2019 on), so bands keep first-appearance order within a
	// severity and clusters keep theirs within a band.
	return [...bands.values()]
		.flat()
		.sort(
			(a, b) =>
				severityRank(a.anchor.flag.severity) -
				severityRank(b.anchor.flag.severity),
		);
}

/** Standable columns the row's regions cover (`pit` only — the per-cell kinds
 *  carry no `cells`, where it would always be 1). Summed, because a row can
 *  hold more than one region. */
const regionCells = (c: FlagCluster): number =>
	c.members.reduce((sum, m) => sum + (m.flag.cells ?? 0), 0);

/** `narrow ×3 @ (2.5, 0.0, -8.0)`, plus `· 14 cells` for a trap. One decimal is
 *  a locator, not a readout: the position is the floor point under the anchor
 *  cell (`FieldFlag.world`), and clicking the row frames chunks, not points. */
function rowLabel(c: FlagCluster): string {
	const { kind, world } = c.anchor.flag;
	const count = c.members.length > 1 ? ` ×${c.members.length}` : "";
	const at = world.map((n) => n.toFixed(1)).join(", ");
	const cells = regionCells(c);
	return `${kind}${count} @ (${at})${cells > 0 ? ` · ${cells} cells` : ""}`;
}

/** What a row's Verify runs on, and what its verdict badge is therefore about:
 *  ONE finding, the anchor. For a cluster that is a sample, not a survey — said
 *  in the tooltips rather than letting `narrow ×3 · clear` read as three cleared
 *  pinches. (Stage 2 takes one flag, so this is the verb's shape, not a
 *  shortcut: verifying a row of 12 would be 12 budgeted mover runs.) */
const anchorScope = (c: FlagCluster): string =>
	c.members.length > 1 ? "the first finding in this row" : "this finding";

/** What was FOUND, by kind — the only reading of what the filters are hiding.
 *  One entry per (kind, severity) pair, which today reads as one per kind. */
const kindTally = (counts: readonly FlagCount[]): string =>
	counts.map((c) => `${c.kind} ${c.count}`).join(" · ");

/** Why this row's Verify is refused, or null when it is live. The row IN FLIGHT
 *  is disabled but not refused — it is the verify the user just started, and it
 *  says so on its face. */
function verifyRefusal(
	kind: FlagKind,
	verifying: string | null,
	key: string,
): string | null {
	if (kind === "pit") return PIT_VERIFY_REASON;
	if (verifying === null || verifying === key) return null;
	return VERIFY_BUSY_REASON;
}

/** A row's state chip (EntitiesList's StateBadge idiom). */
function Tag({
	label,
	title,
	className,
}: {
	label: string;
	title?: string;
	className?: string;
}) {
	return (
		<span
			title={title}
			className={cn(
				"rounded bg-muted px-1 text-[10px] uppercase tracking-wide text-muted-foreground",
				className,
			)}
		>
			{label}
		</span>
	);
}

export function FlagsSection(props: {
	summary: FlagsSummary;
	filters: FlagFilters;
	/** Push the whole filter set (host.setFlagFilters). */
	onFilters: (next: FlagFilters) => void;
	/** Frame a row in the viewport (host.frameChunks) — a pit's whole region,
	 *  a per-cell finding's owner chunk. */
	onFrame: (chunks: readonly ChunkKey[]) => void;
	/** Run stage 2 on ONE finding, named by its opaque row key. */
	onVerify: (key: string) => void;
	/** The row key stage 2 is running on, or null. One at a time: while it is
	 *  set, EVERY row's Verify refuses — the verb is budgeted (seconds of real
	 *  mover), so a second one would queue behind the first with nothing on
	 *  screen saying so. */
	verifying: string | null;
}) {
	const { summary, filters, onFilters, onFrame, onVerify, verifying } = props;
	const clusters = useMemo(
		() => clusterRows(summary.visible),
		[summary.visible],
	);

	if (summary.total === 0) return null;
	return (
		<div className="border-b border-border px-2 py-1 text-sm">
			<CollapsibleSection title={`Flags (${summary.total})`} defaultOpen={true}>
				<div className="flex flex-col gap-1">
					<div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
						<span className="tabular-nums">
							{`${summary.total} flags · ${summary.visible.length} shown`}
						</span>
						<span className="tabular-nums">
							{kindTally(summary.byKindSeverity)}
						</span>
					</div>
					<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
						show
						{FILTER_BANDS.map((band) => (
							<label
								key={band}
								title={FILTER_TITLES[band]}
								className="flex items-center gap-1"
							>
								<input
									type="checkbox"
									checked={filters[band]}
									onChange={(e) =>
										onFilters({ ...filters, [band]: e.target.checked })
									}
								/>
								{band}
							</label>
						))}
					</div>
					{clusters.length === 0 ? (
						<p className="px-1 text-xs text-muted-foreground">
							{`all ${summary.total} hidden by the filters`}
						</p>
					) : (
						<ul className="flex flex-col gap-0.5">
							{clusters.map((c) => {
								const { flag } = c.anchor;
								const label = rowLabel(c);
								const refusal = verifyRefusal(
									flag.kind,
									verifying,
									c.anchor.key,
								);
								const running = verifying === c.anchor.key;
								return (
									<li key={c.anchor.key} className="flex items-center gap-1">
										{/* The chips sit OUTSIDE the button on purpose: an
										    aria-label overrides its element's contents, so a
										    verdict inside would be invisible to a screen reader.
										    The label names the ACTION plus the row (DriftReport's
										    reasoning) — "narrow @ (2.5, 0.0, -8.0)" alone says
										    nothing about what a click does, and kind + anchor is
										    what distinguishes two rows. */}
										<button
											type="button"
											title="frame the chunks this covers"
											aria-label={`frame ${label}`}
											onClick={() => onFrame(flag.chunks ?? [flag.chunk])}
											className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted/50"
										>
											<span
												aria-hidden="true"
												className={DOT_CLASS[flag.severity]}
											>
												●
											</span>
											<span className="min-w-0 flex-1 truncate font-mono tabular-nums">
												{label}
											</span>
										</button>
										{flag.unreachable === true && <Tag label="unreachable" />}
										{c.anchor.verdict !== undefined && (
											<Tag
												label={c.anchor.verdict.outcome}
												title={`stage 2's verdict on ${anchorScope(c)}`}
												className={VERDICT_CLASS[c.anchor.verdict.outcome]}
											/>
										)}
										{/* A bare title on a WRAPPER span, the EntitiesList idiom:
										    a disabled button swallows pointer events, so the
										    tooltip never fires on the button itself — and the span
										    is not focusable, so the reason has to be in the
										    accessible name too. */}
										<span
											title={
												refusal ??
												`drive the project's mover at ${anchorScope(c)}`
											}
										>
											<Button
												type="button"
												size="sm"
												variant="ghost"
												className="h-5 px-1.5 text-xs"
												disabled={flag.kind === "pit" || verifying !== null}
												aria-label={`verify ${label}${refusal === null ? "" : ` (${refusal})`}`}
												onClick={() => onVerify(c.anchor.key)}
											>
												{running ? "Verifying…" : "Verify"}
											</Button>
										</span>
									</li>
								);
							})}
						</ul>
					)}
				</div>
			</CollapsibleSection>
		</div>
	);
}
