// ONE tab stop for a set of controls, walked with the arrows (D-26 / the APG roving
// tabindex). Extracted from `shell/ToolRail.tsx`'s `RovingToolbar`, which shipped the
// working version at F4.5b Task 8 and is now one of FOUR consumers: the rail, plus the
// entities / flags / history row grids.
//
// Two lists in this shell are deliberately NOT consumers, and both are rulings rather
// than omissions. `LogPalette` has no controls on its rows at all, so roving would turn a
// list a screen reader reads straight through into a widget the user must arrow through
// (its own file carries that argument). `WorldDrawer` is the OTHER APG model —
// `aria-activedescendant`, where DOM focus never leaves the filter field and the "cursor"
// is an id the field points at. The two are not interchangeable and must not be mixed on
// one surface.
//
// WHAT THIS MODULE IS AND IS NOT. It owns the STOP — which control carries `tabindex="0"`,
// and moving it together with focus — plus, since F4.5c's review round, the MARKUP the row
// grids must produce ({@link Grid} / {@link GridRow} / {@link GridCell}). It owns no keys:
// every consumer claims a different set (the rail takes ↑/↓/Home/End, the row grids take
// those plus ←/→/⏎/Esc across two axes), and a hook that guessed would either swallow a key
// its caller needed or leave one unclaimed. It owns no roles beyond the grid's either —
// `role="toolbar"` and `role="grid"` are different promises about the same mechanism, and
// which one a surface may make depends on what its rows contain, not on how focus moves.
//
// FIVE DETAILS ARE LOAD-BEARING. The rail's version worked because it had the first three;
// the other two are holes the extraction found. A generalisation that drops any one of them
// passes its tests and fails in use:
//
//   1. THE STOP IS WRITTEN IN A LAYOUT EFFECT, not passed down as a `tabIndex` prop. A
//      prop changes on every focus move and defeats the memo on whatever renders the row
//      (`RailFamily` is memoized precisely so a stats push does not rebuild four Radix
//      trees). React must never set `tabIndex` on these elements in JSX or it clobbers
//      the write on the next render — every consumer therefore leaves it off. The effect
//      deliberately carries NO dependency array: the control list's LENGTH is data (a
//      one-member tool family contributes one button, a multi-member one two; a world
//      load replaces every row), so it has to be re-read after every render.
//   2. CLAMPED ON SHRINK. The list shrinks — ⌘Z undoes a commit, a delete removes a row,
//      a registry drops to one generator. Without the clamp the stop stays past the end,
//      NO control carries `tabindex="0"`, and the entire list falls out of the tab order
//      with nothing thrown and nothing logged.
//   3. THE CALLER PREVENTS DEFAULT ONLY FOR KEYS IT CLAIMED. The arrows are also the
//      stamp-region nudge on the canvas and Esc is the app's one cancel ladder, so
//      swallowing a key the list did not act on is the focus-trap class the window
//      dispatcher exists to kill. The hook cannot enforce this — it never sees the event
//      — which is why it is written down here as well as at each call site.
//   4. THE REF IS A CALLBACK. The container can be mounted by an ANCESTOR without this
//      hook's component re-rendering — a `CollapsibleSection` opening does exactly that —
//      and the layout effect would then not run again until something unrelated moved.
//   5. FOCUS IS RECOVERED, not only the stop. Clamping keeps the list reachable by Tab
//      and says nothing about where focus IS — and the flow this pattern exists for ends
//      with the focused control disappearing: ↓ selects an entity, ⌫ deletes it, the row
//      is gone and the keyboard user is standing on <body> with ↑/↓ dead until they Tab
//      back in. ⌘Z, a world reload, and a verb that disables itself under the cursor are
//      the same shape. See `settle` below for how narrowly it fires.
//
// TWO THINGS A FIFTH CONSUMER WILL OTHERWISE LEARN THE HARD WAY:
//
//   - THE SELECTOR'S MATCH ORDER IS THE CALLER'S INDEX SPACE. `items()` is a live
//     `querySelectorAll` in document order, so anything that matches becomes an index —
//     including markup nobody thought of as a row. That is why {@link useRowGrid} reports
//     the row it moved to by NAME and never by index; see `onRowChange`.
//   - RAISING THE TRAVEL FLAG BROADCASTS A `preventDefault`. {@link isRovingTravel} is
//     consumed by `components/ui/tips.tsx`, which vetoes Radix's focus-open with
//     `e.preventDefault()`. Radix composes EVERY primitive's handlers through
//     `composeEventHandlers`, which skips its own when the event came back prevented — so
//     a Radix component other than a tooltip wrapped around a stop would have its focus
//     behaviour vetoed too. Today the tooltip is the only reader; a second one makes the
//     module-level flag the wrong shape (see {@link isRovingTravel}).
//
// The control list is read from the DOM rather than tracked in state for the same reason
// the effect has no deps: the elements are the source of truth about how many there are,
// and a React-side mirror of that is one more thing to keep in sync.
import {
	type FocusEvent,
	type KeyboardEvent,
	type ReactNode,
	type Ref,
	type RefCallback,
	useCallback,
	useLayoutEffect,
	useRef,
} from "react";

/** Is a roving traversal moving focus RIGHT NOW?
 *
 *  Raised around {@link RovingList.focusAt}'s `.focus()` call, which dispatches its focus
 *  events synchronously — so any handler that runs because of a keyboard traversal sees
 *  `true`, and one that runs because of a Tab or a click sees `false`. Its one reader is
 *  the tooltip trigger (`components/ui/tips.tsx`): a Radix tooltip opens on FOCUS with no
 *  delay, so without this every arrow press would pop a box the user is travelling past.
 *  See that file for the whole argument.
 *
 *  A MODULE-LEVEL FLAG, and the honest reason is plumbing rather than impossibility. A
 *  context holding a stable ref object would carry a synchronously-mutated flag perfectly
 *  well — there is no render involved either way — and it would scope the veto per list
 *  and give it a type. What it costs is a provider around every tooltip trigger in the
 *  chrome, for one boolean with one reader. If a SECOND reader ever appears, prefer the
 *  shape that is neither: a `data-roving-travel` attribute on the container, read through
 *  `e.currentTarget.closest(…)`. That is inspectable in devtools, scoped to the list it
 *  belongs to, and costs one DOM write per keypress. Do not build it for one reader. */
let travelling = false;

/** @see {@link travelling} — the reader half, for `components/ui/tips.tsx`. */
export function isRovingTravel(): boolean {
	return travelling;
}

/** Can this element still hold focus?
 *
 *  The two ways a browser drops focus to `<body>` without anyone asking it to: the focused
 *  control was removed from the document, or it just became `disabled`. Both are ordinary
 *  here — a row is deleted under the cursor, a Verify disables itself the moment it starts
 *  — which is why `settle`'s recovery below tests this rather than merely "is anything
 *  focused". A blur onto dead space leaves the last control connected and enabled, so it
 *  is not mistaken for either. */
const canHoldFocus = (el: HTMLElement | null): boolean => {
	if (el?.isConnected !== true) return false;
	return !(el instanceof HTMLButtonElement && el.disabled);
};

export type RovingList<C extends HTMLElement, T extends HTMLElement> = {
	/** Goes on the container. Everything below is scoped to it. Load-bearing detail 4. */
	ref: RefCallback<C>;
	/** Is `node` inside this list? The callback ref keeps the element private, and a key
	 *  handler needs the answer before it acts on `document.activeElement`. */
	contains: (node: Node | null) => boolean;
	/** The controls the stop moves between, in DOM order — which is the caller's index
	 *  space. Anything matching the selector is one of these. */
	items: () => T[];
	/** Where the keyboard IS: the focused control's index, or — when focus is somewhere
	 *  the stop does not cover (a row's verb cluster, or nothing at all) — the index the
	 *  stop is parked on. */
	cursor: () => number;
	/** Move the stop AND the focus to `next`, wrapping; returns the index it settled on,
	 *  or `-1` when there was nothing to move to.
	 *
	 *  Callers must use the RETURN value rather than recomputing the wrap: two copies of
	 *  that arithmetic is how a caller comes to report a row that was never focused. */
	focusAt: (next: number) => number;
	/** Bind to the CONTAINER's `onFocus` (focus events bubble in React). Keeps the stop
	 *  where the user actually is, so clicking a control mid-list does not send the next
	 *  Tab back to the top of it. */
	onFocus: (e: FocusEvent<HTMLElement>) => void;
};

/**
 * @param selector CSS selector for the controls, evaluated INSIDE the container. The rail
 *   passes `"button"` because every button in that column is one of its controls; the row
 *   grids pass {@link ROW_STOP}, because a row's verbs are buttons the stop must never
 *   land on.
 */
export function useRovingList<
	C extends HTMLElement,
	T extends HTMLElement = HTMLElement,
>(selector: string): RovingList<C, T> {
	const container = useRef<C | null>(null);
	const active = useRef(0);
	/** The control in this list that last held focus — the evidence {@link canHoldFocus}
	 *  is asked about, and the only thing that tells "the focused row was removed" apart
	 *  from "the user went somewhere else". */
	const held = useRef<HTMLElement | null>(null);
	// Read through a ref so the callback ref below can keep `[]` deps without capturing a
	// stale selector. Every call site passes a constant today; this costs two lines and
	// removes the class.
	const selectorRef = useRef(selector);
	selectorRef.current = selector;

	const items = (): T[] =>
		Array.from(
			container.current?.querySelectorAll<T>(selectorRef.current) ?? [],
		);

	const write = (list: T[], i: number): void => {
		active.current = i;
		for (const [n, el] of list.entries()) el.tabIndex = n === i ? 0 : -1;
	};

	/** Focus `list[i]` with the travel flag raised. SAVED AND RESTORED, not set and
	 *  cleared: a re-entrant call (a focus handler that moves focus again) would otherwise
	 *  lower the flag for the rest of the outer traversal's handlers, and the tooltips it
	 *  was suppressing would pop halfway through a keypress. */
	const travel = (list: T[], i: number): void => {
		const previously = travelling;
		travelling = true;
		try {
			list[i]?.focus();
		} finally {
			travelling = previously;
		}
	};

	/** Put the stop somewhere legal, and put FOCUS back if this list just lost it.
	 *
	 *  The recovery is deliberately narrow: it fires only when the control this list last
	 *  saw focused can no longer hold focus AND nothing else has claimed it. Clicking dead
	 *  space elsewhere in the app leaves that control connected and enabled, so the list
	 *  never reaches out and takes focus from somewhere it was not.
	 *
	 *  It TRAVELS (the flag is raised), because landing on a row after a delete is a
	 *  consequence rather than an inspection — a tooltip popping there is a box the user
	 *  did not ask for at the moment they are least expecting one. */
	const settle = (): void => {
		const list = items();
		if (list.length === 0) return;
		const i = Math.min(active.current, list.length - 1);
		write(list, i);
		const dead = held.current;
		// NOTHING HAS EVER HELD FOCUS HERE — so there is nothing to recover, and this is the
		// guard that makes that a separate sentence rather than a fallthrough. Without it
		// `canHoldFocus(null)` is false and `document.activeElement` is `<body>`, which are
		// exactly the two conditions below: every list would seize focus on the render that
		// mounted it. Measured — opening the Entities section moved focus from BODY to the
		// first row, taking the keyboard away from whatever the user was doing.
		if (dead === null || canHoldFocus(dead)) return;
		// Nothing ELSE has taken focus in the meantime. Three states count as "nobody
		// else": nothing focused, `<body>` (where a browser parks focus when it removes or
		// disables the focused control), and the dead control ITSELF — which is what a DOM
		// that has not caught up leaves behind, happy-dom among them. Recovering from all
		// three is the same claim either way: the thing that held focus can no longer hold
		// it, and nothing has replaced it. A user who clicked something else is excluded by
		// the same check, because that something else is none of the three.
		const on = document.activeElement;
		if (on !== null && on !== document.body && on !== dead) return;
		held.current = null;
		travel(list, i);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: `settle` closes over refs only (container, active, held, selectorRef), so it is safe to call from a stable callback — and depending on it would give this ref a new identity every render, which React answers by detaching and reattaching the node
	const ref = useCallback<RefCallback<C>>((node) => {
		container.current = node;
		if (node !== null) settle();
	}, []);

	useLayoutEffect(settle);

	const focusAt = (next: number): number => {
		const list = items();
		if (list.length === 0) return -1;
		const i = ((next % list.length) + list.length) % list.length;
		write(list, i);
		travel(list, i);
		return i;
	};

	const contains = (node: Node | null): boolean =>
		node !== null && container.current?.contains(node) === true;

	const cursor = (): number => {
		const list = items();
		if (list.length === 0) return 0;
		const from = list.indexOf(document.activeElement as T);
		return from === -1 ? Math.min(active.current, list.length - 1) : from;
	};

	const onFocus = (e: FocusEvent<HTMLElement>): void => {
		// EVERY control in the list, not only a stop: a verb that disables itself under the
		// cursor is one of the cases the recovery exists for, and a verb is not a stop.
		held.current = e.target;
		// The stop WRITES rather than merely records, and the difference is the whole
		// promise of this handler: recording alone leaves the DOM stop on whichever control
		// it was last written to, so a Tab out and back would land somewhere the user has
		// never been. The rail got away with recording because clicking a family re-renders
		// it and the layout effect then wrote what the record said — a list whose click
		// changes no chrome state has no such second chance.
		const list = items();
		const i = list.indexOf(e.target as T);
		if (i !== -1) write(list, i);
	};

	return { ref, contains, items, cursor, focusAt, onFocus };
}

// ——— the row grid ————————————————————————————————————————————————————————————
//
// THE KEYBOARD MODEL the three row lists share (entities, flags, history), built on the
// stop above, plus the MARKUP that model requires. Both live here because the third copy
// is where a shared rule stops being a coincidence — and because a row grid whose cells
// are hand-rolled is a contract that holds by convention, which is exactly how the
// index-identity defect below got in.
//
// WHY `grid`. APG says it outright of the listbox pattern: *"it does not provide an
// accessible way to present a list of interactive elements… see the Grid Pattern"*. That
// is the whole argument for the entities and flags lists, whose rows carry verbs — the
// often-repeated "an option's content must be text" is NOT the normative rule (ARIA 1.2
// gives `role="option"` Children Presentational: False), so it is not what this rests on.
// `tree` would claim a hierarchy that does not exist. A bare div with a roving tabindex
// claims nothing at all, which is worse than either: a keyboard user Tabs in, finds one
// control, and has no announced model telling them the arrows do anything.
//
// HISTORY IS A CHOICE, NOT A CONSTRAINT, and should not be read as forced the way the
// other two are: its rows carry ONE control, so a listbox was genuinely reachable. It is a
// one-column grid because its rows are COMMANDS rather than a selection ("undo 3 steps"),
// because the current position is the DIVIDER between rows and so there is no row for
// `aria-selected` to sit on, and because three sibling lists in one shell should answer
// the keyboard identically.
//
// TWO AXES, and which key belongs to which is the whole model:
//   ↑ ↓ Home End  the ROW axis. Always lands in column 1, whatever column focus was in.
//   ← →           the CELL axis of the focused row. Clamped, not wrapping: ← at column 1
//                 is how the cluster is left, → at the last verb stays put.
//   ⏎             activates the focused control. It has to be performed here rather than
//                 left to the browser: `session.confirm` claims ⏎ on the WINDOW and
//                 preventDefaults it BEFORE its own `enabled` is consulted, so a focused
//                 button's native activation never runs anywhere in this editor.
//   Esc           leaves the verb cluster — and ONLY from inside one. On the row itself it
//                 is not ours: Esc belongs to `session.escape`, the one cancel entry point,
//                 which unwinds gesture → session → selection.
//
// ⏎ and Esc are the two the grid must stopPropagation, because both are keys the window
// listener would otherwise ALSO act on. The arrows are not: nothing at the window claims
// them, and the canvas has its own listener on itself.

/** What every row grid's stop moves between: the control in each row's FIRST cell. One
 *  spelling, so three lists cannot come to disagree about what a row stop is — and the
 *  reason {@link GridRow} and {@link GridCell} are exported rather than left to each
 *  palette, since this selector is a claim about markup nobody else can see. */
const ROW_STOP = '[role="row"] > [role="gridcell"]:first-child button';

/** Rows and cells are programmatically focusable and NEVER focused through.
 *
 *  It is the APG grid examples' own construction — a grid's structure is focusable so an
 *  implementation MAY put focus on a cell — and here it is inert, because each of these
 *  cells holds one widget and APG lets focus live on the widget in that case. What it buys
 *  is that the structure is not a lie to a tool: `-1` says "reach me by script, never by
 *  Tab", which is exactly true, and it is what lets the one-tab-stop assertions stay a
 *  count of `[tabindex="0"]`. */
const STRUCTURE_TABINDEX = -1;

/** The grid container: the roles, the name, the column count and the two handlers, in one
 *  place so a fourth list cannot half-build the contract {@link ROW_STOP} depends on. */
export function Grid(props: {
	grid: RowGrid;
	/** The grid's accessible name. */
	label: string;
	/** How many columns its rows declare between them — `aria-colcount`. It is stated
	 *  because a conditional cell makes the per-row count vary; see {@link GridCell}. */
	columns: number;
	className?: string;
	children: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: role="grid" on a div is the ARIA pattern for a non-table grid; a <table> would drag row/cell markup into layouts whose geometry is entirely flexbox
		<div
			ref={props.grid.ref}
			role="grid"
			aria-label={props.label}
			aria-colcount={props.columns}
			onKeyDown={props.grid.onKeyDown}
			onFocus={props.grid.onFocus}
			className={props.className}
		>
			{props.children}
		</div>
	);
}

export function GridRow(props: {
	/** What this row IS. {@link useRowGrid} hands it back through `onRowChange`, so a list
	 *  never has to trust that the Nth stop is its Nth item — see that callback for the
	 *  defect this closes. A row with no id is a row nothing selects: the entities list's
	 *  expanded-params row is exactly that. */
	rowId?: string;
	className?: string;
	ref?: Ref<HTMLDivElement>;
	children: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: role="row" on a div — see Grid above
		<div
			ref={props.ref}
			role="row"
			data-row-id={props.rowId}
			tabIndex={STRUCTURE_TABINDEX}
			className={props.className}
		>
			{props.children}
		</div>
	);
}

export function GridCell(props: {
	/** 1-based, and STATED rather than counted from sibling order, because a conditional
	 *  cell would otherwise shift every later column on the rows that have it — a reader
	 *  walking → would hear a different column number for the same verb on two rows. This
	 *  is what ARIA 1.2 provides `aria-colindex` for. */
	colIndex: number;
	colSpan?: number;
	className?: string;
	children: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: role="gridcell" on a div — see Grid above
		<div
			role="gridcell"
			aria-colindex={props.colIndex}
			aria-colspan={props.colSpan}
			tabIndex={STRUCTURE_TABINDEX}
			className={props.className}
		>
			{props.children}
		</div>
	);
}

export type RowGrid = {
	ref: RefCallback<HTMLDivElement>;
	onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
	onFocus: (e: FocusEvent<HTMLElement>) => void;
};

/**
 * @param onRowChange The row the stop just moved to, identified by the `rowId` its
 *   {@link GridRow} declared — or `null` for a row that declared none. Called only on the
 *   ROW axis, so a list whose SELECTION follows the cursor can write it. Omitted where it
 *   must not: the entities list selects on arrow (its selection draws a box — cheap and
 *   reversible), the flags list does not (its selection flies the camera and can be
 *   refused), so there ⏎ is what commits.
 *
 *   BY NAME, NEVER BY INDEX, and that is a measured defect rather than a preference.
 *   {@link ROW_STOP} matches the first cell's button in EVERY row, and the entities list's
 *   expanded-params row IS a row. Put one control in it — a "copy params" button is the
 *   obvious next thing — and three entities have four stops: ↓ lands on the copy button
 *   while the host is told to select the NEXT stamp, and the cursor and the selection
 *   drift apart with every test still green. Reading the id off the DOM cannot go wrong
 *   that way, because the row that has no id selects nothing.
 */
export function useRowGrid(
	onRowChange?: (rowId: string | null) => void,
): RowGrid {
	const roving = useRovingList<HTMLDivElement, HTMLButtonElement>(ROW_STOP);

	/** The buttons of ONE row, in DOM order: the row's own control first, then its verbs.
	 *  DISABLED verbs are skipped — a disabled button takes no focus, so stepping onto one
	 *  would drop focus to the body and strand the user outside the list entirely. */
	const rowControls = (from: Element): HTMLButtonElement[] =>
		Array.from(
			from
				.closest('[role="row"]')
				?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [],
		);

	/** Where focus is on the CELL axis, or null when it is not on a control of THIS grid —
	 *  the state every branch below has to tolerate, since a palette can be handed a
	 *  keydown with focus anywhere. */
	const cell = (): { controls: HTMLButtonElement[]; at: number } | null => {
		const el = document.activeElement;
		if (!(el instanceof HTMLButtonElement)) return null;
		if (!roving.contains(el)) return null;
		const controls = rowControls(el);
		const at = controls.indexOf(el);
		return at === -1 ? null : { controls, at };
	};

	const moveRow = (next: number): void => {
		const rows = roving.items();
		const i = roving.focusAt(next);
		if (i === -1) return;
		// `dataset["rowId"]` and not `.rowId`: `noPropertyAccessFromIndexSignature` is on,
		// and it is right to be — a typo here would read `undefined` and select nothing.
		onRowChange?.(
			rows[i]?.closest<HTMLElement>('[role="row"]')?.dataset["rowId"] ?? null,
		);
	};

	/** A PLAIN `.focus()`, deliberately: this axis does NOT raise the roving-travel flag,
	 *  so each verb's tooltip opens as it is stepped onto. See `vetoTipDuringTravel`. */
	const stepCell = (
		on: { controls: HTMLButtonElement[]; at: number },
		delta: number,
	): void => {
		const next = Math.min(Math.max(on.at + delta, 0), on.controls.length - 1);
		on.controls[next]?.focus();
	};

	const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
		const on = cell();
		if (e.key === "ArrowDown") moveRow(roving.cursor() + 1);
		else if (e.key === "ArrowUp") moveRow(roving.cursor() - 1);
		else if (e.key === "Home") moveRow(0);
		else if (e.key === "End") moveRow(roving.items().length - 1);
		else if (on === null) return;
		else if (e.key === "ArrowRight") stepCell(on, 1);
		else if (e.key === "ArrowLeft") stepCell(on, -1);
		else if (e.key === "Enter") {
			on.controls[on.at]?.click();
			e.stopPropagation();
		} else if (e.key === "Escape" && on.at > 0) {
			on.controls[0]?.focus();
			e.stopPropagation();
		} else return;
		// Only after a key we CLAIMED (rule 3 at the top of this file).
		e.preventDefault();
	};

	return { ref: roving.ref, onKeyDown, onFocus: roving.onFocus };
}
