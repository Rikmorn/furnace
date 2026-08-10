// The shell's status bar: 28 px, opaque, fixed height — the other half of the canvas
// cell's inset budget (see TopBar).
//
// It carries six things: the viewport keymap (left), the engine/error report, the ⚠
// chip that summons the message log, the agent-presence chip (T4c), the long-job readout,
// and the live host chips
// (right). The chips come from `useFieldHostState`, which IS this file's subscription to
// `subscribeStats` since T3b1 Task 7 — a per-consumer latch, carrying the value-equality
// guard that keeps an idle field from re-rendering the chrome 60×/s. What must not appear
// here is a SECOND, hand-rolled one: the guard lives in the hook, and a raw
// `host.subscribeStats` beside it would be a mirror of a per-rAF push with nothing in
// front of it.
//
// What the keymap line SAYS — and whether it is warning about something — is decided next
// door in `status-keymap.ts`: pure, React-free, and tested directly. What is left here is
// rendering it.
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useState, useSyncExternalStore } from "react";
import type { FieldStats } from "../../../field-host/index.ts"; // type-only: erased
import { useActionContext } from "../../hooks/useActionContext.tsx";
import {
	useFieldHostState,
	useFieldSegmentHud,
	useFieldSelection,
	useFieldStamp,
	useFieldTool,
} from "../../hooks/useFieldHostState.tsx";
import { usePaletteSummon } from "../../hooks/usePaletteStack.tsx";
import { useViewportFocusReturn } from "../../hooks/useViewportFocusReturn.ts";
import { useWorldState, type WorldJob } from "../../hooks/useWorld.tsx";
import type { ActionCtx } from "../../lib/actions.ts";
import { ACTIONS, runNamed } from "../../lib/actions.ts";
import { cn } from "../../lib/cn.ts";
import { notify } from "../../lib/notify-store.ts";
import type { EditorState } from "../../lib/state.ts";
import { useEditor } from "../editor-context.ts";
import { Button } from "../ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { ActionTip } from "../ui/tips.tsx";
import { armedKeymap } from "./status-keymap.ts";

function engineLabel(state: EditorState): string {
	if (state.status === "engine-error") return "engine: BUILD FAILED";
	if (state.status === "no-webgpu") return "engine: no WebGPU";
	if (state.status === "booting") return "engine: starting…";
	return "engine: ok";
}

/** A count, with digit grouping. Locale-aware deliberately — six-figure op counts are
 *  unreadable ungrouped, and the separator is the reader's, not ours. The chips
 *  themselves stay ungrouped: a glyph of bar width costs more than "1,284" buys. */
const grouped = (n: number): string => n.toLocaleString();

/** A duration, to the nearest millisecond.
 *
 *  The host's ms fields are `performance.now()` DELTAS, so they arrive fractional, and
 *  `toLocaleString` grants three fraction digits by default — which put "12.346 ms" in
 *  a readout whose whole question is "how heavy has this got?". Rounding lives here,
 *  once, rather than at each call site. */
const ms = (n: number): string => `${grouped(Math.round(n))} ms`;

/** The keymap line, in its own component so only IT re-renders: the session context pushes
 *  a clone on every nudge and every preview — pointer rate while a move is live — and the
 *  chips and the error line beside it have nothing to do with that. The segment HUD (D-25)
 *  is the second context here with that cadence, and it is the same argument twice.
 *
 *  The line grows and shrinks as the number does and CANNOT move the canvas, for a
 *  STRUCTURAL reason rather than a budget of characters: the canvas cell is a sibling of
 *  this footer inside a `fixed inset-0 flex flex-col` root, so where it sits is a function
 *  of the header's and footer's HEIGHTS and nothing else. `h-7` fixes this one (the
 *  ordering comment in `StatusBar` says the same of the chips, and it is the same `h-7`)
 *  and `whitespace-nowrap` refuses the wrap that is the only way text could ask for a
 *  second row. No length of line can reach the canvas — which matters, because `lenM` has
 *  no ceiling: only the second CLICK is capped, so a flown-away camera can put kilometres
 *  on this line. `tabular-nums` is the smaller half of the same care — without it every
 *  digit that changes mid-gesture re-measures the line and the words after it twitch.
 *
 *  The over-cap TONE arrives WITH the text rather than being worked out here, and that is
 *  a correctness point, not tidiness: `armedKeymap` answers a session and a pending stamp
 *  BEFORE the gesture, so a tone re-derived from `segment` alone painted lines the segment
 *  was not the subject of — a session opened over a pending point rendered "⏎ commit ·
 *  Esc discard" in the refusal colour. One branch cascade, one answer. All this component
 *  decides is which class says it. */
function KeymapLine() {
	const { tool, gesture, pendingStamp } = useFieldTool();
	const { stamp } = useFieldStamp();
	const { segment } = useFieldSegmentHud();
	const { text, overCap } = armedKeymap({
		tool,
		gesture,
		session: stamp,
		pendingStamp,
		segment,
	});
	return (
		<span
			className={cn(
				"whitespace-nowrap tabular-nums",
				overCap && "text-destructive-text",
			)}
		>
			{text}
		</span>
	);
}

/** The unread-error chip. It appears only while errors are UNREAD: a badge that never
 *  clears is a badge people stop seeing, and the log stays reachable from the View menu
 *  once it has. */
function ErrorChip() {
	const { unreadErrors } = useSyncExternalStore(
		notify.subscribe,
		notify.getSnapshot,
	);
	const summon = usePaletteSummon();
	if (unreadErrors === 0) return null;
	return (
		<ChipButton
			// SUMMONS rather than toggles: opening the log is what marks it read, which
			// takes this chip away — so there is never a second click here to close with.
			// The palette's own × and the View menu are the way back. What "summon" has to
			// do, and why all four writes are needed, lives in `usePaletteSummon`.
			onClick={() => summon("log")}
			label={`${unreadErrors} unread ${unreadErrors === 1 ? "error" : "errors"} — open the message log`}
			className="text-destructive-text"
		>
			<TriangleAlert className="h-3 w-3" />
			{unreadErrors}
		</ChipButton>
	);
}

/** The cell-selection chip, with the verbs the Field panel's footer used to hold.
 *
 *  On the STATUS BAR rather than in a palette, and the reason is the count: "how much
 *  is selected" is a live readout of what the next masked op will hit, and it lived at
 *  the bottom of a panel that had to be OPEN to be read — while the panel it was in
 *  has now dissolved entirely (F4.5b Task 13). The two verbs come with it because they
 *  are what a reader of that number wants to do about it, and a popover is what keeps
 *  a 28 px bar from growing two more buttons.
 *
 *  Absent with nothing selected. Unlike Reselect — which matters exactly when there is
 *  no selection — the CHIP is a readout, and a chip reading "sel 0 cells" on every
 *  boot is a permanent affordance for a state with nothing to say. Reselect stays
 *  reachable from the Edit menu, which is where a verb with no visible object belongs.
 */
function SelectionChip() {
	const { selection } = useFieldSelection();
	if (selection === null) return null;
	const { count, truncated, displayed } = selection;
	const cells = `${count} cell${count === 1 ? "" : "s"}`;
	return (
		<ChipPopover
			label={`${cells} selected — clear or reselect`}
			body={
				<SelectionVerbs truncated={truncated} count={count} shown={displayed} />
			}
		>
			{`sel ${cells}`}
		</ChipPopover>
	);
}

/** The chip's body: what is limiting this selection, and the two verbs for it. */
function SelectionVerbs({
	truncated,
	count,
	shown,
}: {
	truncated: boolean;
	count: number;
	shown: number | undefined;
}) {
	const ctx = useActionContext();
	return (
		<>
			{/* Two limits a selection can be under, and they are DIFFERENT things — the
			    first is about what was SELECTED, the second only about what is DRAWN.
			    Said in full here rather than compressed into the chip, which has one line
			    and a number's worth of room. */}
			{truncated && (
				<p className="text-muted-foreground">
					{`flood truncated at ${grouped(count)} cells — the budget stopped it, so this is not the whole pocket`}
				</p>
			)}
			{shown !== undefined && (
				<p className="text-muted-foreground">
					{`showing ${grouped(shown)} of ${grouped(count)} cells — the rest are selected but not drawn`}
				</p>
			)}
			<div className="flex gap-1">
				{SELECTION_ACTIONS.map((id) => (
					<SelectionVerb key={id} id={id} ctx={ctx} />
				))}
			</div>
		</>
	);
}

/** One of the chip's two verbs, straight off the registry.
 *
 *  Its DOCS come off the table too — `hint`, the ONE sentence a label has no room for —
 *  as a real tooltip rather than a `title` (D-25), carrying whatever keycap the entry
 *  holds. Neither of these two has a chord today and each says why at its definition; when
 *  one gains a binding the keycap appears here without this file changing, which is the
 *  whole point of reading it off the id rather than writing it down.
 *
 *  The bare-control branch below is a GUARD rather than a state, and is named as one
 *  because a reader will look for the case that takes it: `SelectionChip` renders nothing
 *  while `selection === null`, which is the only thing that disables `edit.clearSelection`,
 *  so BOTH of today's verbs are always live inside this popover and both always carry a
 *  `hint`. It stays because the alternative is a silent trap — a third id added to
 *  {@link SELECTION_ACTIONS} that CAN be disabled would otherwise get a tooltip trigger
 *  merged onto a control that takes neither hover nor focus, which is exactly the bug
 *  `VerifyVerb` shipped and had to be fixed for. `shell.test.tsx` pins the invariant from
 *  the reachable side: both verbs live, both documented. */
function SelectionVerb({
	id,
	ctx,
}: {
	id: (typeof SELECTION_ACTIONS)[number];
	ctx: ActionCtx;
}) {
	const action = ACTIONS.find((a) => a.id === id);
	// Absent = the registry lost an id this bar names. Rendering nothing is the honest
	// failure (a dead button would be worse), and the id pair below is asserted against
	// the table in the suite.
	if (action === undefined) return null;
	// `enabled` ALONE, and this is the one refused control in the chrome that does not read
	// `controlVerdict` — so it is the site that would diverge first if the two ever disagree.
	// Correct today by policy rather than by luck: the chip carries Clear and Reselect, whose
	// only refusal is INERT (nothing selected, nothing parked), and an inert refusal is silent
	// by design — there is no sentence `controlVerdict` would add. A verb with a GATE clause
	// (a chord, a `typed` letter, `armsTool`) must not be added here without switching to
	// `controlVerdict`, or its key and its button would refuse for different reasons.
	const disabled = !action.enabled(ctx);
	const hint = action.hint;
	const control = (
		<Button
			type="button"
			size="sm"
			variant="ghost"
			className="h-6 px-2 text-xs"
			disabled={disabled}
			onClick={() => void runNamed(action, ctx)}
		>
			{action.label(ctx)}
		</Button>
	);
	return disabled || hint === undefined ? (
		control
	) : (
		<ActionTip actionId={id} hint={hint}>
			{control}
		</ActionTip>
	);
}

/** The two verbs the chip carries, by registry id — the Edit menu renders the same
 *  two from the same table, so the popover cannot say something the menu does not. */
const SELECTION_ACTIONS = ["edit.clearSelection", "edit.reselect"] as const;

/** THE one place that decides what a status chip looks like.
 *
 *  A constant rather than a component because the bar's chips split on BEHAVIOUR, not on
 *  looks: two run a verb (`ChipButton`), three open a detail layer (`ChipPopover`), and
 *  one does neither (`JobChips`). No shell can own the appearance without the others
 *  copying it — and on a 28 px bar the cost of that drift is the difference between
 *  "these are all chips" and "one of these is text". */
const CHIP_SHAPE =
	"flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-px tabular-nums";

/** `CHIP_SHAPE` plus the affordances of something you can CLICK. Split rather than
 *  duplicated, and named for what it adds: hover tint and a focus ring are promises that
 *  clicking does something, so the one chip that does nothing wears the shape alone. */
const INTERACTIVE_CHIP_CLASS = `${CHIP_SHAPE} transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`;

/** A status chip that RUNS something on click — the ⚠ chip summons the log, `undo N`
 *  summons the History palette. Chips that open detail instead go through
 *  `ChipPopover`; both wear `INTERACTIVE_CHIP_CLASS`. */
function ChipButton({
	onClick,
	label,
	className,
	children,
}: {
	onClick: () => void;
	/** The accessible name — the chips are one glyph and one number, so the sentence
	 *  cannot be the visible text. */
	label: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			className={cn(INTERACTIVE_CHIP_CLASS, className)}
		>
			{children}
		</button>
	);
}

/** Selection, ops and analyzer — the chips that open detail. The popover is what lets a
 *  fixed-height bar carry detail at all: it is a PORTAL, so opening one cannot grow the
 *  bar or take a pixel off the canvas below it.
 *
 *  `body` is an ELEMENT, not a render callback, and that is load-bearing: Radix mounts
 *  portalled content only while the popover is open, so a closed chip costs nothing —
 *  and a React element is a descriptor, so the body component's own hooks and reads do
 *  not run until it opens.
 *
 *  A sibling of `ChipButton` rather than `PopoverTrigger asChild`-ing one: Radix's
 *  trigger already renders its own button, and composes its ref into the POPPER ANCHOR
 *  that positions the content. Routing that through a plain function component of ours
 *  would silently drop the ref under React 19 and leave the popover unanchored. The
 *  look, which is the thing that actually drifts, is shared through `INTERACTIVE_CHIP_CLASS`
 *  regardless.
 *
 *  `open`/`onOpenChange` are optional: pass them when the chip's own presence depends on
 *  state that can change WHILE it is open (see `AnalyzerChip`). */
function ChipPopover({
	label,
	body,
	open,
	onOpenChange,
	children,
}: {
	label: string;
	body: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	children: ReactNode;
}) {
	// A stats chip is READ mid-work — the answer to "how many ops" is wanted without
	// leaving the flight it is about.
	const focusReturn = useViewportFocusReturn();
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger aria-label={label} className={INTERACTIVE_CHIP_CLASS}>
				{children}
			</PopoverTrigger>
			{/* Radix gives the content `role="dialog"` and no name to go with it. The chip
			    already has the sentence, and a dialog announced as just "dialog" is one a
			    screen-reader user has to explore to identify. */}
			<PopoverContent
				aria-label={label}
				align="end"
				className="w-64 space-y-2 p-2 text-xs"
				{...focusReturn.overlay}
			>
				{body}
			</PopoverContent>
		</Popover>
	);
}

/** One label/value row in a chip's popover. Data-Is-Mono (`DESIGN.md`): the VALUE is
 *  mono + tabular so a column of them aligns and reads as data; the label is prose and
 *  never is. */
function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-2">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="font-mono text-foreground tabular-nums">{value}</dd>
		</div>
	);
}

/** The ops chip's body: the op-cost meter — the readout that answers "why has this world
 *  got heavy?".
 *
 *  Its fields moved into the stats push in F4.5a and then had NOWHERE to render: the
 *  Field panel's footer meter was deleted with the panel. One of the six carries a claim
 *  in prose below, because that number alone asserts the wrong thing — `compactableOps`
 *  looks like queued work and is not.
 *
 *  `redoDepth` rides in the same push and is deliberately absent: it is what the
 *  registry's Redo reads to know whether it is enabled, and the user already has that
 *  answer from the menu item's own disabled state. */
function OpsDetail({ stats }: { stats: FieldStats }) {
	// Both rows need a "hasn't happened yet" reading, and the two fields disagree about
	// what proves it — so each names its own signal rather than sharing a zero test.
	//
	// A remesh CAN legitimately measure 0 ms once rounded (sub-half-ms on a small edit),
	// so its duration is not a sound sentinel. `remeshVersion` is: a monotonic counter
	// bumped once per remesh COMPLETION, so 0 means none has landed, full stop. Using it
	// here also answers the standing instruction on its own TSDoc — "whoever next touches
	// this readout should either give it a consumer or delete it" — which had outlived
	// the entity-refresh trigger it was built for.
	const remesh =
		stats.remeshVersion === 0 ? "none yet" : ms(stats.lastRemeshMs);
	// A reconfigure's 0 IS the declared sentinel: FieldStats says "0 = none has run this
	// session", and "0 ms" would read as a reconfigure that cost nothing — the opposite
	// claim.
	const reconfigure =
		stats.lastReconfigureMs === 0
			? "none this session"
			: ms(stats.lastReconfigureMs);
	return (
		<>
			<dl className="space-y-0.5">
				<DetailRow label="ops in the log" value={grouped(stats.totalOps)} />
				<DetailRow label="chunks allocated" value={grouped(stats.chunks)} />
				<DetailRow label="last remesh" value={remesh} />
				<DetailRow label="last reconfigure" value={reconfigure} />
				<DetailRow
					label="live generators"
					value={grouped(stats.liveGenerators)}
				/>
				<DetailRow
					label="compactable ops"
					value={grouped(stats.compactableOps)}
				/>
			</dl>
			<p className="text-muted-foreground">
				compactable ops are what the NEXT load could fold away — they keep
				counting until the log crosses the compaction threshold, so this is a
				meter climbing toward that point, not work waiting.
			</p>
		</>
	);
}

/** The analyzer chip: absent while the advisor is idle, because a chip that is always
 *  there for a state with nothing to say is a chip people stop seeing.
 *
 *  It owns its own presence rather than being rendered conditionally by the bar, and
 *  that is the whole point of the component: `analyzerPending` reaching 0 is what takes
 *  the chip away, and it can reach 0 WHILE the user is reading the popover it opened.
 *  Unmounting the trigger under an open popover snatches the layer away mid-sentence and
 *  drops focus to the body. So the chip outlives its own reason to exist for exactly as
 *  long as its popover is open — the ⚠ chip has the same vanish-at-zero shape but no
 *  race, because there the CLICK is what causes the unmount. */
function AnalyzerChip({ pending }: { pending: number }) {
	const [open, setOpen] = useState(false);
	if (pending === 0 && !open) return null;
	return (
		<ChipPopover
			open={open}
			onOpenChange={setOpen}
			label={
				pending === 0
					? "analyzer caught up"
					: `analyzer catching up — ${pending} pass${pending === 1 ? "" : "es"} owed`
			}
			body={<AnalyzerDetail pending={pending} />}
		>
			analyzer ●
		</ChipPopover>
	);
}

/** The analyzer chip's body — what being behind means for what is on screen, and no
 *  verb: nothing here waits on a decision, the passes land on their own.
 *
 *  The caught-up branch is reachable only through the case above (the chip is gone by
 *  the next render otherwise), and it is the reason that case is not merely a leak fix:
 *  a popover left saying "catching up · 0 owed" would contradict itself in front of the
 *  user who was reading it. */
function AnalyzerDetail({ pending }: { pending: number }) {
	if (pending === 0)
		return (
			<p className="text-muted-foreground">
				the advisor has caught up — the flag markers now describe the field as
				it stands.
			</p>
		);
	return (
		<>
			<dl className="space-y-0.5">
				<DetailRow label="passes owed" value={grouped(pending)} />
			</dl>
			<p className="text-muted-foreground">
				the walkability advisor is catching up with your edits — the flag
				markers on screen describe the field as it was BEFORE them. It clears
				itself when the last pass lands.
			</p>
		</>
	);
}

/** What each world verb is CALLED while it runs. `WorldJob` names the verb, not the
 *  readout — so this is the one place a state tag becomes a string on screen, and the
 *  place to change when the wording does. `Record<WorldJob, …>` is EXHAUSTIVE: a fourth
 *  world job has no label here and stops compiling, rather than shipping a chip that
 *  reads "undefined". */
const JOB_LABELS: Record<WorldJob, string> = {
	save: "saving…",
	bake: "baking…",
	open: "opening…",
};

/** The X-ray's whole-world worker job (D-F3-15) — the field-side long job, named the way
 *  the View popover names the control that starts it. */
const VOID_CAST_LABEL = "void cast…";

/** The long jobs standing RIGHT NOW, in the order they are shown. Both can be live at once
 *  (a ⌘S while a cast builds), so this is a list and not a winner: a chip that hid the
 *  other job would be a readout that lies by omission at exactly the busiest moment.
 *
 *  ONE derivation, feeding both the visible chips and the announcement — two would be two
 *  things to keep saying the same thing. */
function longJobs(job: WorldJob | null, castPending: boolean): string[] {
	const live: string[] = [];
	if (job !== null) live.push(JOB_LABELS[job]);
	if (castPending) live.push(VOID_CAST_LABEL);
	return live;
}

/** PRESENCE-LITE (T4c): that an agent is working in this tab, and what it last ran.
 *
 *  WHY THE BAR SAYS IT AT ALL. T4b decided the backchannel would be invisible, and the half
 *  of that decision which stands is about REFUSALS and questions — an agent's business must
 *  not interrupt the person in the tab. What changed is that a T4c agent digs, generates and
 *  runs verbs, and a world changing under someone with no sign that anyone else is here is a
 *  worse silence than the one that rule was written against. `lib/agent-presence.ts` carries
 *  the full argument and the list of what this deliberately is not.
 *
 *  WHAT IT SHOWS AND WHAT IT CANNOT. The last method's own wire name, and how many have run.
 *  It cannot show an OUTCOME: the store takes none, so a refused `edit.apply` and an applied
 *  one look identical here — which is the quiet-refusals ruling built into the shape rather
 *  than remembered at the call site. No timestamp either, for the reason the store gives (an
 *  agent that stops asking is indistinguishable from one that is thinking).
 *
 *  A `<span>`, like `JobChips` and for its reason: there is nothing to click, so none of
 *  `INTERACTIVE_CHIP_CLASS`'s hover tint or focus ring — those are promises. NO ICON either,
 *  and that is this bar's own convention rather than restraint for its own sake: the two
 *  glyphs on it (⚠, the analyzer dot) are both on chips you can press, so an icon here would
 *  read as a control. And NO live region, deliberately — an agent polling `session_state`
 *  would announce itself to a screen-reader user several times a minute, which is the
 *  definition of a notification nobody can use.
 *
 *  THE WORD "agent" IS IN THE VISIBLE TEXT, which is `SelectionChip`'s shape (`sel 42 cells`)
 *  and is doing the job a tooltip would otherwise be asked to do. It cannot be asked: D-25's
 *  machine-enforced clause is that an authored `title` may carry a NAME and never
 *  documentation (`tests/frontend-no-doc-titles.test.ts` fails the build over one), and the
 *  sentence this chip wanted — "an agent is working in this tab, N verbs run" — is
 *  documentation by any reading. So the context goes where every reader gets it, including
 *  the keyboard one a `title` never reaches.
 *
 *  FIRST in the right-anchored cluster, which is that group's own rule applied to the chip
 *  whose text moves most often: an element's arrival — or its width changing — displaces only
 *  what is to its LEFT, and to the left of this is the flex spacer. Every agent verb would
 *  otherwise shove the job chips sideways for the whole of a bake. */
function AgentChip() {
	// OFF THE CONTEXT rather than off a module singleton, which is this store's own header's
	// argument and the one thing about the wiring worth reading here: two shells in one
	// process (every chrome test file) must not share one agent.
	const { agentPresence } = useEditor();
	const { verb, count } = useSyncExternalStore(
		agentPresence.subscribe,
		agentPresence.getSnapshot,
	);
	if (verb === null) return null;
	return (
		<span className={cn(CHIP_SHAPE, "text-foreground")}>
			agent {verb}
			<span className="text-muted-foreground">{count}</span>
		</span>
	);
}

/** The long-job readout (D-19), and the one chip on this bar with NOTHING to click.
 *
 *  D-F4.5-19 wants "progress + cooperative cancel (the job polls; no cancel theater)", and
 *  it is the second clause that applies: NEITHER long job can poll. The two mechanical
 *  reasons, and the conditions under which each stops holding, are owned by the sites that
 *  would have to change — `useWorld.tsx`'s `write` and `field-voidcast.ts`'s
 *  `requestVoidCast`.
 *  Do not restate them here; a third copy is a third thing to keep true.
 *
 *  So it is INDETERMINATE and it is a `<span>`: no ✕, no percentage, and none of
 *  `INTERACTIVE_CHIP_CLASS`'s hover tint or focus ring, which are promises that a click
 *  does something. What it does claim is the one thing a user needs during a main-thread
 *  freeze — a verb is running and the editor has not hung.
 *
 *  SECOND in the right-anchored cluster since T4c, and the RULE is unchanged — only the
 *  count is: an arrival displaces only what is to its LEFT (the argument `AnalyzerChip`'s
 *  own mount below spells out in full), so nothing to the right of this moves when a job
 *  starts, not even the analyzer chip, which is merely first among the STATS. What is now to
 *  its left is `AgentChip`, whose TEXT changes on every agent verb — far oftener than this
 *  chip comes and goes, which is why that one took the first slot and this one yields it.
 *  Both are non-interactive, so the shift a job start now costs the agent chip moves no
 *  click target. */
function JobChips({ labels }: { labels: string[] }) {
	if (labels.length === 0) return null;
	return (
		<span className="flex items-center gap-2">
			{labels.map((label) => (
				<span key={label} className={cn(CHIP_SHAPE, "text-foreground")}>
					{label}
				</span>
			))}
		</span>
	);
}

export function StatusBar({ viewportError }: { viewportError: string | null }) {
	const { state } = useEditor();
	const { stats } = useFieldHostState();
	const { job } = useWorldState();
	const summon = usePaletteSummon();
	const error = state.error ?? viewportError;
	// Read HERE rather than in a leaf of its own, unlike `KeymapLine`: that one is split
	// out because the session context churns at pointer rate, while a world verb and a
	// cast start and stop at human rate. Reading them here is what lets the chips and the
	// live region below come from one derivation.
	const jobs = longJobs(job, stats?.voidCastPending === true);

	return (
		<footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border bg-card px-3 text-xs text-muted-foreground">
			<KeymapLine />
			{/* `title` is not decoration: an esbuild diagnostic is far wider than the bar
          and `truncate` clips it, so without the hover the only readers who get the
          whole message are the ones using the live region below. */}
			{error && (
				<span className="truncate text-destructive-text" title={error}>
					{error}
				</span>
			)}
			<div className="flex-1" />
			<AgentChip />
			<JobChips labels={jobs} />
			<SelectionChip />
			<ErrorChip />
			{stats && (
				<span className="flex items-center gap-3 tabular-nums">
					{/* THE ordering rule for this whole bar, stated once, here — everything
              after the spacer is anchored to the bar's RIGHT edge, so an element
              appearing at index i pushes only the elements BEFORE it leftward and
              leaves everything after it exactly where it was. Every chip that comes
              and goes therefore has to be first in its group or it shoves a click
              target sideways under a cursor already on its way there.
              This one is first among the STATS: it carries a border and padding the
              bare span it replaced did not, and `ops` sits immediately right of it.
              `AgentChip` is first in the whole cluster and `JobChips` second, for the
              same reason one level up — the agent chip's TEXT moves oftenest, so it
              takes the slot where only the spacer is to its left (T4c; this line said
              `JobChips` was first until then). None can change the bar's HEIGHT —
              `h-7` is fixed. */}
					<AnalyzerChip pending={stats.analyzerPending} />
					{/* The op count is the HANDLE on the op-cost meter (D-19): the number on
              the bar is the one everybody reads, and the five fields that explain it
              have had no home since F4.5a deleted the panel footer they lived in.
              The popover therefore shows SIX rows, not five — it repeats the handle
              as its first row (`ops in the log`) so the number the user clicked is
              named beside the ones that account for it, rather than being a heading
              they have to remember. The gate counted six and the pack's §7.3 flagged
              the arithmetic; five is the count of EXPLAINERS and always was. */}
					<ChipPopover
						label={`${stats.totalOps} ops — the op-cost meter`}
						body={<OpsDetail stats={stats} />}
					>
						{stats.totalOps} ops
					</ChipPopover>
					{/* The `undo N` readout is a BUTTON (D-11): the depth answers "can I go
			              back?", and the thing that answers "back to what?" is the History
			              palette — so the number is the way to it. Unlike the ⚠ chip it is
			              always present, including at 0, because a history you have not
			              started is still the surface a first-time user should be able to
			              find. */}
					<ChipButton
						onClick={() => summon("history")}
						label={`${stats.undoDepth} undo step${stats.undoDepth === 1 ? "" : "s"} — open the History palette`}
					>
						undo {stats.undoDepth}
					</ChipButton>
				</span>
			)}
			<span className="whitespace-nowrap">{engineLabel(state)}</span>
			{/* Robust announcement: ONE persistent, visually-hidden live region that always
          exists in the a11y tree (`sr-only` clips it without display:none/contents, so
          VoiceOver/Safari can't strip its role). Its text changing is what announces —
          decoupled from the conditional visible span above. */}
			<div className="sr-only" aria-live="polite">
				{error ?? ""}
			</div>
			{/* The long-job announcement, and its OWN persistent region rather than a share
          of the error line's: an error arriving mid-save would otherwise swap one
          sentence for the other in a node whose whole contract is "my text changing is
          the announcement". Persistent for the error line's reason — a live region added
          to the DOM already holding its text is one VoiceOver/Safari can miss entirely,
          and these chips mount and unmount by definition. `data-long-job` is the test's
          handle: there are two polite regions in this bar now, and picking the right one
          by its content is picking it by the thing under test. */}
			<div className="sr-only" aria-live="polite" data-long-job="">
				{jobs.join(" · ")}
			</div>
		</footer>
	);
}
