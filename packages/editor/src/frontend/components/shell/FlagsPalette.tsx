// The Flags palette (D-F4.5-15): the walkability advisor's triaged findings, as a
// floating palette of its own. It is `FlagsSection` promoted out of the dissolving
// control stack — same clustering, same verify column, same filters-gate-both rule
// — with three things the section could not have.
//
// 1. THE HEADER IS A HINT, NOT AN INDICTMENT. "Flags (47)" led with the number of
//    complaints; "Flags · 3 candidates" leads with what is worth looking at, and
//    demotes the raw total to a secondary line. Same data, and the difference is
//    whether opening the palette feels like being told off.
// 2. THE VIEWPORT IS THE PRIMARY SELECTION SURFACE. Clicking a marker selects it
//    and this list follows (the row lights up and scrolls into view); clicking a
//    row selects it and the CAMERA follows, onto the finding's own 0.25 m cell
//    rather than the 4 m chunk the old click framed. Neither direction is wired
//    to the other — both read `summary.selected` off the one seam.
// 3. THE FILTERS PERSIST (D-F4.5-3). They are the user's reading preference, and
//    they survived a session but not a restart.
//
// ADVISOR POSTURE (D-F4-1), of which this file is the visible end: no row blocks a
// verb, no row mutates the field, nothing here removes a finding. The filters HIDE,
// and a hidden finding still counts in the header — which is why the palette renders
// on what was FOUND rather than on what is shown. Gating on the visible rows would
// unmount the only control that could bring them back.
import type { FieldFlag, FlagKind, FlagSeverity } from "@furnace/core/field"; // type-only: erased
import { useEffect, useMemo, useRef } from "react";
import type {
	FlagCount,
	FlagFilters,
	FlagRow,
} from "../../../viewport-host/index.ts"; // type-only: erased
import { useFieldFlags } from "../../hooks/useFieldHostState.tsx";
import {
	Grid,
	GridCell,
	GridRow,
	useRowGrid,
} from "../../hooks/useRovingList.tsx";
import { cn } from "../../lib/cn.ts";
import { useEditor } from "../editor-context.ts";
import { Button } from "../ui/button.tsx";
import { ActionTip, ReasonTip } from "../ui/tips.tsx";

/** A finding joins a cluster when it is within this world distance (metres) of
 *  ANY member — single-linkage, so a run of pinches along a corridor chains into
 *  one row instead of splitting at an arbitrary midpoint. */
const CLUSTER_RADIUS_M = 2;

/** The grid's columns: the row's own select control, then Verify. */
const COLUMNS = 2;

const CLUSTER_RADIUS_SQ = CLUSTER_RADIUS_M * CLUSTER_RADIUS_M;

/** Why a `pit` cannot be verified in v1 (the D-F4-13 spec amendment): stage 2
 *  drives DIRECTED lanes at one anchor cell, and a pit is a whole region — one
 *  anchor's lanes would prove nothing about it. Walking it is the answer, so the
 *  button says so rather than greying out mutely. */
const PIT_VERIFY_REASON = "region-level — walk it";
const VERIFY_BUSY_REASON = "a verify is already running";

const FILTER_HINTS = {
	candidates: "findings worth a stage-2 verify",
	info: "context — terrain rather than a fault, or a class this mover handles",
	pits: "whole-region traps: floor you can fall into and not climb out of",
	unreachable:
		"findings the reachability flood could not get to (demoted, never deleted)",
} as const satisfies Record<keyof FlagFilters, string>;

/** The chip row, in declaration order (string keys enumerate in insertion order)
 *  — candidates, info, pits per the mock, with `unreachable` after them because
 *  it is the one chip that is about a finding's VINTAGE rather than its kind.
 *  The `Record` above is what makes the set EXHAUSTIVE: a fifth band added to
 *  FlagFilters has no hint and stops compiling, instead of shipping a filter
 *  nobody can reach. */
// Boundary cast: `Object.keys` is typed `string[]` because a VALUE can
// structurally carry keys its type never declared — but the argument here is an
// object literal checked against `Record<keyof FlagFilters, string>`, which
// cannot. The invariant the cast re-states is that literal's own excess-property
// check, which the return type of Object.keys has no way to carry.
const FILTER_BANDS = Object.keys(FILTER_HINTS) as (keyof FlagFilters)[];

/** Rows the user can act on wear the alarm colour; context wears the warning
 *  amber. The viewport's twins of these are `CANDIDATE_TINT` / `INFO_TINT` in
 *  field-flags.ts — matched by intent, NOT by import: the chrome cannot
 *  value-import anything under `viewport-host/` (frontend-no-engine-leakage
 *  bans the directory), so the two palettes agree by review. */
const DOT_CLASS = {
	candidate: "text-destructive-text",
	info: "text-warning",
} as const;

/** The band's SHAPE, carried beside its hue: filled = candidate, hollow = info.
 *  Colour alone would be the only visual signal of the one thing this list is
 *  triaged BY — WCAG 1.4.1 — and red-against-amber is a hard pair to begin with.
 *  Sort order is a second signal but an unlabelled one. Assistive tech gets the
 *  band as a word instead; see {@link selectName}. */
const DOT_GLYPH = {
	candidate: "●",
	info: "○",
} as const;

const VERDICT_CLASS = {
	trapped: "bg-destructive/20 text-destructive-text",
	clear: "bg-success/20 text-success-text",
	/** No answer is not a third answer (the `flagTint` rule): stay neutral. */
	inconclusive: "bg-muted text-muted-foreground",
} as const;

/** One row: same kind, same triage band, one neighbourhood. */
type FlagCluster = {
	/** First member in store order — the row's identity, the position it reads
	 *  at, the cell it selects, and the ONE finding Verify is taken on. */
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
 *  cell (`FieldFlag.world`), and clicking the row goes THERE — the camera frames
 *  that cell, not its chunk. */
function rowLabel(c: FlagCluster): string {
	const { kind, world } = c.anchor.flag;
	const count = c.members.length > 1 ? ` ×${c.members.length}` : "";
	const at = world.map((n) => n.toFixed(1)).join(", ");
	const cells = regionCells(c);
	return `${kind}${count} @ (${at})${cells > 0 ? ` · ${cells} cells` : ""}`;
}

/** What a row's Verify runs on, and what its verdict badge is therefore about:
 *  ONE finding, the anchor. For a cluster that is a sample, not a survey — stage
 *  2 takes one flag, so this is the verb's SHAPE and not a shortcut (verifying a
 *  row of 12 would be 12 budgeted mover runs).
 *
 *  The one spelling of the phrase: {@link verifyName} and both tooltips read it
 *  from here, so the row cannot say it two ways. */
const anchorScope = (clustered: boolean): string =>
	clustered ? "the first finding in this row" : "this finding";

/** The verdict chip's text: `first: trapped` on a cluster row, plain `trapped`
 *  on a single.
 *
 *  The scope rides the TEXT, and that is the whole point — the misreading it
 *  stops (`narrow ×3 · trapped` read as three proven traps) is exactly what a
 *  screen reader gets from an unqualified chip, `aria-label` on a generic
 *  `<span>` has no reliable exposure, and a `title` reaches a mouse and nothing
 *  else. Compressed rather than {@link anchorScope}'s prose because a chip has no
 *  room for a clause; the chip's `title` carries the long form. */
const verdictLabel = (outcome: string, clustered: boolean): string =>
	clustered ? `first: ${outcome}` : outcome;

/** The row button's accessible NAME.
 *
 *  It carries the triage band because nothing else in the name does: the dot is
 *  `aria-hidden` (decoration to a reader) and the row's text is kind, count,
 *  position and — on a pit — its cell total. Without this, `candidate` versus
 *  `info` — the axis the whole list is triaged on, and the axis its filters are
 *  named after — would reach assistive tech not at all. {@link DOT_GLYPH} is the
 *  same split's visual half.
 *
 *  It names the ACTION too (DriftReport's reasoning): "narrow @ (2.5, 0.0, -8.0)"
 *  says nothing about what a click does, and kind + anchor is what tells two rows
 *  apart. The verb is "select", not "frame", because that is what changed —
 *  selecting is the act, and the camera move is its consequence. */
const selectName = (label: string, severity: FlagSeverity): string =>
	`select ${severity} ${label}`;

/** The Verify button's accessible NAME: the row, the scope the verb is really
 *  about, and the refusal when there is one.
 *
 *  All three belong in the NAME rather than the `title` — this button is disabled
 *  in three of its four states, and a disabled button swallows the pointer events
 *  a tooltip needs. Extracted from the JSX because it is three conditional joins,
 *  which inline is a template nobody can read.
 *
 *  The refusal rides a sentence break rather than EntitiesList's trailing
 *  parenthetical (`open entity 2 (frozen — …)`), and the deviation is forced:
 *  every per-cell row's label ENDS in parens — `narrow @ (2.5, 0.0, -8.0)` — so
 *  that convention would produce two adjacent parentheticals meaning different
 *  things, which no reader (and no test) can tell apart. (A `pit`'s label runs
 *  on past them, `· 14 cells`, but it is the one kind that is ALWAYS refused, so
 *  it cannot be the case the convention is chosen for.) The break also reads
 *  better aloud, and it is what lets the suite state the invariant that this
 *  button and {@link verifyRefusal} can never disagree. */
function verifyName(
	label: string,
	clustered: boolean,
	refusal: string | null,
): string {
	const scope = clustered ? ` — ${anchorScope(clustered)}` : "";
	const why = refusal === null ? "" : `. Unavailable: ${refusal}`;
	return `verify ${label}${scope}${why}`;
}

/** How many CANDIDATES were found — the number the header leads with, and the
 *  only one that answers "is there anything for me to do?".
 *
 *  Read off `byKindSeverity`, which describes everything FOUND rather than what
 *  the filters admit: a header that counted visible rows would drop to zero the
 *  moment someone unticked the chip, which is the reading ("nothing wrong here")
 *  a filter must never be able to produce. */
const candidateCount = (counts: readonly FlagCount[]): number =>
	counts.reduce((n, c) => n + (c.severity === "candidate" ? c.count : 0), 0);

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

/** What the list says INSTEAD of rows, or null when it has rows to show. Two
 *  different silences and they must not read alike: a world with no findings is
 *  good news, and a world whose findings are all filtered out is a control state
 *  the user can undo — naming the number is what points them at the chips. */
function emptyMessage(total: number, shown: number): string | null {
	if (total === 0)
		return "Nothing found. The advisor re-runs as you dig — anything it cannot walk shows up here and in the viewport.";
	if (shown === 0) return `all ${total} hidden by the filters`;
	return null;
}

/** A row's state chip (EntitiesList's StateBadge idiom).
 *
 *  The one control-adjacent thing in this file that KEEPS a `title` while everything
 *  around it moved to `ActionTip` (D-25), and the reason is that it is not a control: a
 *  `<span>` takes no focus, so a tooltip would reach exactly the same audience a `title`
 *  does, and the way to change that is to give a decoration a tab stop on every row — a
 *  worse trade than a mouse-only note. What the note adds is PROVENANCE ("stage 2's
 *  verdict"); the chip's SCOPE, which is the part a reader can be misled by, is already in
 *  its visible text — see {@link verdictLabel}. */
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
				"rounded bg-muted px-1 text-2xs uppercase tracking-wide text-muted-foreground",
				className,
			)}
		>
			{label}
		</span>
	);
}

/** One filter chip. A toggle BUTTON rather than a checkbox (the mock's pill), and
 *  the pressed state rides `aria-pressed` so the control still announces as a
 *  two-state toggle to a screen reader — a styled `<span>` with a class would
 *  have been the same pixels and no semantics at all.
 *
 *  The chip's visible text is one word (`pits`, `unreachable`) and the band it names
 *  is a definition — what counts as a pit, why `unreachable` is demoted rather than
 *  deleted. That is documentation, so it is a tooltip and not a `title` (D-25): the
 *  chips are the first thing a keyboard user Tabs into in this palette. */
function FilterChip({
	band,
	on,
	onToggle,
}: {
	band: keyof FlagFilters;
	on: boolean;
	onToggle: () => void;
}) {
	return (
		<ActionTip hint={FILTER_HINTS[band]}>
			<button
				type="button"
				aria-pressed={on}
				onClick={onToggle}
				className={cn(
					"rounded-full border px-2 py-px text-2xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
					on
						? "border-primary bg-primary/15 text-foreground"
						: "border-border text-muted-foreground hover:bg-muted/50",
				)}
			>
				{band}
			</button>
		</ActionTip>
	);
}

/** A row's stage-2 verb, in whichever of the two documentation channels its state can use
 *  — the EntitiesList `RowVerb` idiom, both halves (D-25).
 *
 *  AVAILABLE → a real tooltip, which opens on FOCUS as well as hover: what stage 2 does
 *  (drive the project's actual mover at the finding) is not something `verify ▸` says, and
 *  before this it was mouse-only. REFUSED → no tooltip can reach it at all, because a
 *  disabled button takes neither pointer events nor focus; the reason rides `ReasonTip`'s
 *  span for the mouse, the accessible NAME for everyone else, and a toast when the verb is
 *  actually PRESSED (W-1) — that last one arrives without having to be looked for.
 *
 *  RUNNING gets NEITHER, and this is the branch the first cut got wrong: it routed on
 *  `refusal === null`, so a running verify handed the tooltip trigger a `disabled` button
 *  and the sentence reached nobody while the docblock above claimed it did. Routing on the
 *  same expression the button disables on is what stops those two disagreeing again. The
 *  ruling is that running needs no channel — the button says "Verifying…", the state is
 *  the user's own doing and momentary, and the sentence is there before and after. The
 *  wrapper stays, carrying no reason, so the row's DOM box does not change shape as the
 *  state moves. */
function VerifyVerb({
	refusal,
	running,
	scope,
	name,
	onClick,
}: {
	refusal: string | null;
	running: boolean;
	/** What this row's verify would act on — `anchorScope`'s prose. */
	scope: string;
	name: string;
	onClick: () => void;
}) {
	// ONE expression for "the user cannot press this", read by the button AND by the
	// channel choice below. Two spellings is exactly how the docblock came to describe a
	// branch the code did not have.
	const unavailable = refusal !== null || running;
	const control = (
		<Button
			type="button"
			size="sm"
			variant="ghost"
			// OUT of the tab order: the list is ONE tab stop and → is how this column is
			// reached. See `useRowGrid`.
			tabIndex={-1}
			className="h-5 px-1.5 text-xs"
			// DERIVED from the refusal, never restated: the two must agree, and a third
			// reason added to verifyRefusal would otherwise leave the button live while its
			// own name announced why it was not.
			disabled={unavailable}
			aria-label={name}
			onClick={onClick}
		>
			{running ? "Verifying…" : "verify ▸"}
		</Button>
	);
	return (
		<GridCell colIndex={2}>
			{unavailable ? (
				<ReasonTip reason={refusal ?? undefined}>{control}</ReasonTip>
			) : (
				<ActionTip hint={`drive the project's mover at ${scope}`}>
					{control}
				</ActionTip>
			)}
		</GridCell>
	);
}

export function FlagsPalette() {
	const { state, fieldHostRef } = useEditor();
	const { flags, filters, setFilters, verifying, verify } = useFieldFlags();
	const clusters = useMemo(() => clusterRows(flags.visible), [flags.visible]);
	// A <div>, not an <li>: the grid roles below REPLACE list semantics, and layering them
	// on <ul>/<li> gives an element two contradictory role sets — the rule WorldDrawer's
	// listbox already states for the same reason.
	const selectedRow = useRef<HTMLDivElement | null>(null);
	// The same two-axis model the entities grid runs, minus the selection write — see the
	// list's own comment below for why this one does not select on arrow.
	const rows = useRowGrid();

	// A marker click in the VIEWPORT selects a finding that may be a hundred rows
	// down. Scrolling to it is what makes the two surfaces one selection rather
	// than two that happen to agree — and `block: "nearest"` keeps a row already on
	// screen exactly where it is, so a row CLICK does not make the list jump under
	// the cursor that clicked it (the DriftReport badge's idiom).
	// Keyed on the SELECTED KEY, not on the summary: the seam pushes on every
	// analyzer response, and re-scrolling the list because a chunk two rooms away
	// re-analysed would yank it out from under whoever is reading it. It also
	// covers the MOUNT, which is the case that matters for a summoned palette —
	// open the Flags palette with a marker already selected and the row is there.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `flags.selected` is the trigger, not a value the body reads; the ref it does read is stable and would never re-fire this
	useEffect(() => {
		selectedRow.current?.scrollIntoView({ block: "nearest" });
	}, [flags.selected]);

	// Before the engine bundle lands there is no host and the provider has subscribed
	// to nothing, so an empty summary is not a claim about the world. The same gate —
	// and deliberately the same sentence — every other host-reading palette carries.
	if (state.status !== "ready") {
		return (
			<p className="p-3 text-sm text-muted-foreground">
				the field waits for the engine bundle…
			</p>
		);
	}

	const candidates = candidateCount(flags.byKindSeverity);
	const empty = emptyMessage(flags.total, clusters.length);
	return (
		<div className="flex flex-col gap-1 px-2 py-1 text-xs">
			{/* THE HEADER, and the reframe. The count is CANDIDATES — what is worth
          acting on — with the raw total demoted to the line below it, because
          "your world has 47 problems" is what the panel this replaces said every
          time it was opened. */}
			<div className="flex flex-wrap items-baseline gap-x-2">
				<span className="font-medium text-foreground text-sm">
					{`Flags · ${candidates} candidate${candidates === 1 ? "" : "s"}`}
				</span>
				<span className="tabular-nums text-muted-foreground">
					{`${flags.visible.length} of ${flags.total} total`}
				</span>
			</div>
			{/* biome-ignore lint/a11y/useSemanticElements: role="group" is the intended ARIA grouping for this control row (the layer-group idiom the View popover uses); a native <fieldset>/<legend> would force the boxed-card look this flat UI deliberately avoids */}
			<span
				className="flex flex-wrap items-center gap-1"
				role="group"
				aria-label="flag filters"
			>
				{FILTER_BANDS.map((band) => (
					<FilterChip
						key={band}
						band={band}
						on={filters[band]}
						onToggle={() => setFilters({ ...filters, [band]: !filters[band] })}
					/>
				))}
			</span>
			{empty !== null ? (
				<p className="px-1 py-2 text-muted-foreground">{empty}</p>
			) : (
				// `useRowGrid`'s header carries the argument for `grid` over `listbox`, and
				// the markup is that module's — the stop selector is a claim about cell
				// structure, so the structure is not hand-rolled here.
				//
				// The ROW axis moves focus and nothing else, deliberately — unlike the
				// entities grid, whose selection follows the cursor. Selecting a finding
				// FLIES THE CAMERA (and can be refused with a toast), so arrowing past ten
				// rows would take ten camera trips nobody asked for. ⏎ is what commits, which
				// is why no `onRowChange` is passed.
				<Grid
					grid={rows}
					label="flag findings"
					columns={COLUMNS}
					className="flex flex-col gap-0.5 overflow-y-auto"
				>
					{clusters.map((c) => {
						const { flag } = c.anchor;
						const label = rowLabel(c);
						const refusal = verifyRefusal(flag.kind, verifying, c.anchor.key);
						const running = verifying === c.anchor.key;
						// Everything a row says about ONE of its findings rather than all of
						// them turns on this (see anchorScope).
						const clustered = c.members.length > 1;
						// The row is selected when ANY of its members is: a viewport click
						// lands on one marker, and the row that shows it is the cluster it
						// was folded into — not necessarily the anchor whose key the row
						// hands back on click.
						const selected =
							flags.selected !== null &&
							c.members.some((m) => m.key === flags.selected);
						return (
							<GridRow
								key={c.anchor.key}
								ref={selected ? selectedRow : null}
								className={cn(
									"flex items-center gap-1 rounded",
									selected && "bg-primary/15",
								)}
							>
								{/* The chips sit OUTSIDE the button on purpose: an aria-label
                    overrides its element's contents, so a verdict inside one
                    would reach a screen reader only if the label repeated it. Out
                    here the chip's own TEXT is the channel — which is why the
                    verdict's scope lives in that text (verdictLabel) and not only
                    in a tooltip. They stay inside this CELL, though: a cell may
                    hold a widget plus text, and giving two decorations their own
                    column would make the grid's shape depend on whether a row
                    happened to be demoted or verified. */}
								<GridCell
									colIndex={1}
									className="flex min-w-0 flex-1 items-center gap-1"
								>
									<ActionTip hint="select this finding and go to it">
										<button
											type="button"
											aria-label={selectName(label, flag.severity)}
											aria-current={selected ? "true" : undefined}
											onClick={() =>
												fieldHostRef.current?.selectFlag(c.anchor.key)
											}
											className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted/50"
										>
											{/* Decoration to a reader — selectName carries the band as a
                        word, so announcing a bullet too would be noise. */}
											<span
												aria-hidden="true"
												className={DOT_CLASS[flag.severity]}
											>
												{DOT_GLYPH[flag.severity]}
											</span>
											<span className="min-w-0 flex-1 truncate font-mono tabular-nums">
												{label}
											</span>
										</button>
									</ActionTip>
									{flag.unreachable === true && <Tag label="unreachable" />}
									{c.anchor.verdict !== undefined && (
										<Tag
											label={verdictLabel(c.anchor.verdict.outcome, clustered)}
											title={`stage 2's verdict on ${anchorScope(clustered)}`}
											className={VERDICT_CLASS[c.anchor.verdict.outcome]}
										/>
									)}
								</GridCell>
								<VerifyVerb
									refusal={refusal}
									running={running}
									scope={anchorScope(clustered)}
									name={verifyName(label, clustered, refusal)}
									onClick={() => verify(c.anchor.key)}
								/>
							</GridRow>
						);
					})}
				</Grid>
			)}
		</div>
	);
}
