// The History palette (D-11): the field's ONE history, as a visible list. The editor runs
// no scene-document session — the op log is the only undo domain — so this is the whole
// story of the session, newest at the top.
//
// A STEPPER, NOT A SEEKER, and that is a contract rather than a simplification. Core's
// undo/redo are strictly LIFO: each entry's chunk images assume the state produced by
// everything below it, and `splice`/`entity-update` entries address `log.ops`
// POSITIONALLY — so entries can only ever be applied in stack order. There is no verb
// that jumps to an arbitrary point and no honest way to build one on top of these
// primitives. A row click therefore calls `undo()` (or `redo()`) N TIMES, which is
// exactly what the user could have done with N presses of ⌘Z, and never anything else.
//
// The consequence worth stating: if the log moves between the render that drew a row and
// the click on it — a ⌘Z from the keyboard, a world load off the change feed — the click
// still takes N legal steps, just not to the state the row named. It cannot corrupt
// anything, because "N steps" is meaningful against any log, whereas "seek to entry 7"
// would not be. The palette re-renders on every push, so that window is one turn wide.
//
// Rows are NEWEST-FIRST with the current position implicit at the divider: redo rows
// (things undone, still reachable forward) sit above it, undo rows (things done) below.
// Time runs downward into the past, which is the inverse of Photoshop's list and the
// right way round for a panel whose top line answers "what did I just do?".
import { History } from "lucide-react";
import type { ReactNode } from "react";
import { useFieldHistory } from "../../hooks/useFieldHostState.tsx";
import {
	Grid,
	GridCell,
	GridRow,
	useRowGrid,
} from "../../hooks/useRovingList.tsx";
import { cn } from "../../lib/cn.ts";
import { useEditor } from "../editor-context.ts";

/** One column: the step button. */
const COLUMNS = 1;

/** One row. `steps` is what clicking it costs — always ≥ 1, always in the direction the
 *  row's side names. Rendered as a button rather than a list item with a handler so the
 *  keyboard reaches it, and so a disabled state (during the engine boot) is expressible.
 *
 *  A one-column grid row. That is a CHOICE and not a constraint, and should not be read as
 *  forced the way the entities and flags grids are: these rows carry one control, so a
 *  `listbox` was genuinely reachable. It is a grid because the rows are COMMANDS ("undo 3
 *  steps") rather than a selection, because the current position is the DIVIDER between
 *  rows so there is no row for `aria-selected` to sit on, and because three sibling lists
 *  in one shell should answer the keyboard identically.
 *
 *  It carries NO `rowId`: a history row is not something the row axis selects — arrowing
 *  onto one must not step the log, so `useRowGrid` gets no `onRowChange` here at all. */
function Row({
	label,
	steps,
	direction,
	onStep,
}: {
	label: string;
	/** How many steps of `direction` this row is, which is ALSO its 1-based position
	 *  from the current state — the two are the same number on both sides, so the row
	 *  shows one value rather than carrying two that could disagree. */
	steps: number;
	direction: "undo" | "redo";
	onStep: (direction: "undo" | "redo", steps: number) => void;
}) {
	const verb = direction === "undo" ? "Undo" : "Redo";
	return (
		<GridRow>
			<GridCell colIndex={1}>
				{/* NO `tabIndex` here on purpose: this button is the row STOP, and the roving
			    hook writes its tabIndex imperatively. A React-owned one would be re-applied
			    on every render and clobber the stop (rule 1 in `useRovingList`). */}
				<button
					type="button"
					onClick={() => onStep(direction, steps)}
					// The full sentence lives on the accessible name, because the visible row is
					// two columns of shorthand and the number of steps is the part a user would
					// most want to be sure of before clicking.
					aria-label={`${verb} ${steps} step${steps === 1 ? "" : "s"} — ${label}`}
					className={cn(
						"flex w-full items-baseline gap-2 px-2 py-1 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
						// The redo side is the FUTURE — undone work that is still reachable. Muted,
						// the way an undone state greys in every history panel that has one.
						direction === "redo" && "text-muted-foreground",
					)}
				>
					<span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">
						{direction === "redo" ? "+" : ""}
						{steps}
					</span>
					<span className="min-w-0 flex-1 truncate">{label}</span>
				</button>
			</GridCell>
		</GridRow>
	);
}

/** A grid row that is a NOTE rather than a step: the bound's two "not listed" lines. */
function Note({ children }: { children: ReactNode }) {
	return (
		<GridRow>
			<GridCell colIndex={1} className="px-2 py-1 text-muted-foreground italic">
				{children}
			</GridCell>
		</GridRow>
	);
}

export function HistoryPalette() {
	const { history } = useFieldHistory();
	const { state, fieldHostRef } = useEditor();
	// The same two-axis model the entities and flags grids run. No `onRowChange`: a
	// history row is a COMMAND, and arrowing onto one must not step the log — ⏎ or a click
	// is what takes the steps.
	const rows = useRowGrid();

	// Reaches the host for its VERBS the way every other shell surface does —
	// `fieldHostRef` off EditorContext (EntitiesPalette's rationale). Fire-and-forget:
	// each step publishes a fresh history through the seam, so nothing here holds state.
	//
	// The loop is what makes this a stepper. It is bounded by construction: no row can
	// name more steps than there are rows, and there are at most HISTORY_TAIL of those.
	// Over-stepping is harmless anyway — core's `undo`/`redo` return an empty dirty set
	// on an empty stack rather than throwing — which is what makes a click safe even if
	// the log moved underneath it.
	const step = (direction: "undo" | "redo", steps: number): void => {
		const host = fieldHostRef.current;
		if (!host) return;
		for (let i = 0; i < steps; i++)
			if (direction === "undo") host.undo();
			else host.redo();
	};

	// Before the engine bundle lands there is no host and the provider has subscribed to
	// nothing, so an empty history is not a claim about the session. The same gate — and
	// deliberately the same sentence — every other host-reading palette carries.
	if (state.status !== "ready") {
		return (
			<p className="p-3 text-sm text-muted-foreground">
				the field waits for the engine bundle…
			</p>
		);
	}

	const empty = history.undoDepth === 0 && history.redoDepth === 0;
	// How much of each side is NOT on screen. The seam bounds BOTH lists so that neither
	// the label derivation nor the DOM grows with a long session, and both sides are
	// reported for the same reason: saying so is the difference between a bound and a lie,
	// because ⌘Z and ⇧⌘Z really do still reach past them. The redo side is the easier one
	// to forget — 60 presses of ⌘Z is a reachable thing to do, and the first draft of this
	// panel silently dropped ten of them.
	//
	// Each is (true depth − rows in hand) rather than a comparison against the seam's own
	// bound, which the chrome cannot import: the bound is a value behind the engine barrel,
	// and a chrome VALUE import of that barrel pulls core into this bundle
	// (frontend-no-engine-leakage machine-enforces it). The subtraction is also exact at
	// the boundary — a history of exactly the bound reports zero hidden steps — where a
	// `length === TAIL` test would claim hidden steps that do not exist.
	const older = history.undoDepth - history.undo.length;
	// The redo tail keeps the entries NEAREST the current state, so what falls off is the
	// furthest future — which is the top of the list, where this line goes.
	const further = history.redoDepth - history.redo.length;

	// Both sides through ONE shape, and in the order they are drawn: the redo list runs
	// furthest-future first (so the next redo lands nearest the divider) and the undo list
	// newest first, which is the same arithmetic read from opposite ends. `steps` is
	// `length − index` on both.
	//
	// `key` is the entry's position from the BOTTOM of the whole stack, not its position
	// from the current state: pushing a new op shifts every visible row's `steps` by one
	// while leaving what each row IS untouched, and a key that moved with `steps` would
	// remount the entire list on every stroke.
	const side = (
		labels: readonly string[],
		depth: number,
		dir: "undo" | "redo",
	) =>
		labels.map((label, i) => ({
			label,
			steps: labels.length - i,
			key: `${dir}-${depth - (labels.length - i)}`,
		}));
	const redoRows = side(history.redo, history.redoDepth, "redo");
	const undoRows = side(history.undo, history.undoDepth, "undo").reverse();

	return (
		<div className="flex flex-col text-xs">
			<div className="flex items-center gap-2 border-border border-b px-2 py-1 text-muted-foreground">
				<History className="h-3 w-3 shrink-0" />
				<span className="flex-1 tabular-nums">
					{empty
						? "nothing yet"
						: `${history.undoDepth} step${history.undoDepth === 1 ? "" : "s"}`}
					{history.redoDepth > 0 && ` · ${history.redoDepth} undone`}
				</span>
			</div>
			{empty ? (
				<p className="px-2 py-3 text-muted-foreground">
					Every dig, stamp and edit lands here. Click a row to step back to it.
				</p>
			) : (
				<Grid
					grid={rows}
					label="history"
					columns={COLUMNS}
					className="overflow-y-auto"
				>
					{/* The two "not listed" lines and the divider are rows of the grid that
					    carry no control. They are rows rather than loose text because a
					    `role="grid"` may hold rows and nothing else — and the stop skips them
					    for free, since it moves between BUTTONS. */}
					{further > 0 && (
						<Note>
							{further} further redo step{further === 1 ? "" : "s"} not listed
						</Note>
					)}
					{/* The REDO side — undone work, still reachable forward — above the divider
					    so the whole list reads as one timeline running downward into the past,
					    rather than two stacks that happen to be adjacent. */}
					{redoRows.map((row) => (
						<Row
							key={row.key}
							label={row.label}
							steps={row.steps}
							direction="redo"
							onStep={step}
						/>
					))}
					{/* WHERE YOU ARE. A line rather than a step, so it must not look like
					    something clickable that happens to do nothing — `aria-hidden` keeps it
					    out of the grid's row count as well as off the keyboard. */}
					<div aria-hidden className="my-1 border-primary border-t-2" />
					{undoRows.map((row) => (
						<Row
							key={row.key}
							label={row.label}
							steps={row.steps}
							direction="undo"
							onStep={step}
						/>
					))}
					{older > 0 && (
						<Note>
							{/* Named rather than hidden, the message log's rule: the bound dropped
							    these from the SCREEN, not from the history, and ⌘Z still walks
							    them. A list that silently ended at 50 would read as "that is all
							    there is". */}
							{older} older step{older === 1 ? "" : "s"} not listed — ⌘Z still
							reaches {older === 1 ? "it" : "them"}
						</Note>
					)}
				</Grid>
			)}
		</div>
	);
}
