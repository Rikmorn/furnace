// The shell's status bar: 28 px, opaque, fixed height — the other half of the canvas
// cell's inset budget (see TopBar).
//
// It carries four things: the viewport keymap (left), the engine/error report, the ⚠
// chip that summons the message log, and the live host chips (right). The chips come
// from `useFieldHostState`, NOT from an own subscription — subscribeStats is a single
// slot and a second subscriber would silently steal the first's callback.
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useState, useSyncExternalStore } from "react";
import type {
	FieldStats,
	FieldTool,
	PendingStamp,
	StampSession,
	ViewportGesture,
} from "../../../viewport-host/index.ts"; // type-only: erased
import { useActionContext } from "../../hooks/useActionContext.tsx";
import {
	useFieldHostState,
	useFieldSelection,
	useFieldStamp,
	useFieldTool,
} from "../../hooks/useFieldHostState.tsx";
import { usePaletteSummon } from "../../hooks/usePaletteStack.tsx";
import { ACTIONS } from "../../lib/actions.ts";
import { cn } from "../../lib/cn.ts";
import { SESSION_VERBS, sessionStateTag } from "../../lib/field-session.ts";
import { notify } from "../../lib/notify-store.ts";
import type { EditorState } from "../../lib/state.ts";
import { useEditor } from "../editor-context.ts";
import { Button } from "../ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";

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

/** One line per armed state — what the keys do RIGHT NOW. It answers the question a modal
 *  editor makes people ask constantly ("what does clicking do in this mode?") at the
 *  moment they ask it, which the static line it replaces could not.
 *
 *  Enumerated here rather than derived from the action table, and deliberately so: the
 *  registry knows what a key RUNS, not which four of two dozen bindings matter in a given
 *  mode — and the canvas-owned keys (`[`/`]`, ⇧, ⌃, the arrows) are half of what belongs
 *  on this line and are not in the table at all.
 *
 *  Keycaps are written the way the rest of the editor writes them — ⌘ ⇧ ⌃ ⌥ ⏎ ⌫ and
 *  `Esc`, matching the overlay and the menu. Two spellings of one key is drift that reads
 *  as two different keys, and it is part of how this line's old static clause got away
 *  with naming three keys the host does not bind.
 *
 *  Exported for its test: these strings ARE the claim, and asserting them through the DOM
 *  would be asserting the same thing twice. */
export function armedKeymap(
	tool: FieldTool,
	gesture: ViewportGesture | null,
	session: StampSession | null,
	pendingStamp: PendingStamp | null,
): string {
	// A live session owns the interaction — the family keys refuse while it stands, so
	// what is left to say is how it ENDS. The two end verbs come from `SESSION_VERBS`,
	// the one table the card and the session strip also read: a user working a stamp has
	// all three surfaces on screen at once, and this line used to re-derive the pair from
	// `moving` alone, which collapsed STAMP into RECONFIGURE. What stays a branch here is
	// the STEERING half, which genuinely differs — a move is dragged, everything else is
	// nudged — and that is a fact about `moving`, not about the state tag.
	if (session !== null) {
		const verbs = SESSION_VERBS[sessionStateTag(session)];
		const steer = session.moving === true ? "drag ghost move" : "← → ↑ ↓ nudge";
		return `${steer} · R rotate ¼ · ⏎ ${verbs.primary} · Esc ${verbs.secondary}`;
	}
	// A pending stamp SHADOWS the armed gesture: LMB is drawing that stamp's region,
	// whatever the gesture slot still says underneath (usually `pointer`, the arm most
	// stamps are picked from). It is checked before `gesture` for exactly that reason —
	// and it NAMES the generator, because "a region" alone leaves the user to remember
	// which stamp they pressed.
	//
	// "click ×2", NOT "drag": the mechanism is the box gesture's, and it takes two
	// separate presses — `onPointerUp` has no region branch at all, so a press-drag-
	// release anchors at the PRESS and throws the release away, making the user's next
	// click anywhere corner two. The box line three cases below says "click ×2" for the
	// same mechanism; one mechanism with two verbs on one status line, with the wrong
	// verb on the flow D-F4.5-7 exists to make discoverable, is worse than either.
	if (pendingStamp !== null)
		return `click ×2 to span a region for ${pendingStamp.name} · Esc cancels`;
	if (gesture === "pointer") return "LMB select · G grab · F frame · ⌫ delete";
	if (gesture === "box") return "click ×2 spans a region · Esc clears";
	if (gesture === "material")
		return "LMB floods the clicked material · Esc clears";
	if (gesture === "void") return "LMB floods an air pocket · Esc clears";
	if (gesture === "segment")
		return "click ×2 sweeps the brush · [ ] radius · Esc drops the point";
	// The brush itself, with the armed effect NAMED: it is what LMB is about to do, and
	// the four read very differently. Joined from parts rather than interpolated, so an
	// effect with no live modifiers ends at the radius instead of a dangling separator.
	return [
		`LMB ${tool.effect}`,
		"[ ] radius",
		...modifierParts(tool.effect),
	].join(" · ");
}

/** Which momentary/sticky overrides are LIVE under `effect`, derived rather than stated.
 *
 *  A static clause was wrong three ways at once, and none of them was catchable by a test
 *  that pinned the string: `deriveMomentary` swaps dig↔fill SYMMETRICALLY, so under fill
 *  ⌃ gives *dig*, not fill; under paint and smooth ⌃ passes through entirely and
 *  `tool.swapEffect` is disabled, so both "⌃ fill" and "X swap" named dead keys; and
 *  "⇧ smooth" under smooth names a no-op. Verified against `field-host.ts`'s
 *  `deriveMomentary` and the registry's own `enabled`. */
function modifierParts(effect: FieldTool["effect"]): string[] {
	const parts: string[] = [];
	// ⇧ derives smooth from whatever is armed — nothing to say when it already is.
	if (effect !== "smooth") parts.push("⇧ smooth");
	// ⌃ is the momentary half of the swap `X` makes sticky, and both are live only on the
	// two carving effects. The swap is SYMMETRIC, so each names what it would give.
	if (effect === "dig") parts.push("⌃ fill", "X swap");
	if (effect === "fill") parts.push("⌃ dig", "X swap");
	return parts;
}

/** The keymap line, in its own component so only IT re-renders: the session context pushes
 *  a clone on every nudge and every preview — pointer rate while a move is live — and the
 *  chips and the error line beside it have nothing to do with that. */
function KeymapLine() {
	const { tool, gesture, pendingStamp } = useFieldTool();
	const { stamp } = useFieldStamp();
	return (
		<span className="whitespace-nowrap">
			{armedKeymap(tool, gesture, stamp, pendingStamp)}
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
				{SELECTION_ACTIONS.map((id) => {
					const action = ACTIONS.find((a) => a.id === id);
					// Absent = the registry lost an id this bar names. Rendering nothing is
					// the honest failure (a dead button would be worse), and the id pair
					// below is asserted against the table in the suite.
					if (action === undefined) return null;
					return (
						<Button
							key={id}
							type="button"
							size="sm"
							variant="ghost"
							className="h-6 px-2 text-xs"
							disabled={!action.enabled(ctx)}
							title={action.menuTitle}
							onClick={() => action.run(ctx)}
						>
							{action.label(ctx)}
						</Button>
					);
				})}
			</div>
		</>
	);
}

/** The two verbs the chip carries, by registry id — the Edit menu renders the same
 *  two from the same table, so the popover cannot say something the menu does not. */
const SELECTION_ACTIONS = ["edit.clearSelection", "edit.reselect"] as const;

/** THE one place that decides what a status chip looks like.
 *
 *  A constant rather than a component because the bar's chips split on BEHAVIOUR, not on
 *  looks: two run a verb (`ChipButton`) and three open a detail layer (`ChipPopover`).
 *  Neither shell can own the appearance without the other copying it — and on a 28 px
 *  bar the cost of that drift is the difference between "these are all buttons" and
 *  "one of these is text". */
const CHIP_CLASS =
	"flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-px tabular-nums transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** A status chip that RUNS something on click — the ⚠ chip summons the log, `undo N`
 *  summons the History palette. Chips that open detail instead go through
 *  `ChipPopover`; both wear `CHIP_CLASS`. */
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
			className={cn(CHIP_CLASS, className)}
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
 *  look, which is the thing that actually drifts, is shared through `CHIP_CLASS`
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
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger aria-label={label} className={CHIP_CLASS}>
				{children}
			</PopoverTrigger>
			{/* Radix gives the content `role="dialog"` and no name to go with it. The chip
			    already has the sentence, and a dialog announced as just "dialog" is one a
			    screen-reader user has to explore to identify. */}
			<PopoverContent
				aria-label={label}
				align="end"
				className="w-64 space-y-2 p-2 text-xs"
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

export function StatusBar({ viewportError }: { viewportError: string | null }) {
	const { state } = useEditor();
	const { stats } = useFieldHostState();
	const summon = usePaletteSummon();
	const error = state.error ?? viewportError;

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
			<SelectionChip />
			<ErrorChip />
			{stats && (
				<span className="flex items-center gap-3 tabular-nums">
					{/* FIRST in a right-anchored cluster, and that ordering is the point: this
              is the only chip here that comes and goes, and it now carries a border
              and padding the bare span it replaced did not. Anywhere further right and
              its arrival would shove `ops` — newly a click target — sideways under a
              cursor already on its way there. */}
					<AnalyzerChip pending={stats.analyzerPending} />
					{/* The op count is the HANDLE on the op-cost meter (D-19): the number on
              the bar is the one everybody reads, and the five fields that explain it
              have had no home since F4.5a deleted the panel footer they lived in. */}
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
		</footer>
	);
}
