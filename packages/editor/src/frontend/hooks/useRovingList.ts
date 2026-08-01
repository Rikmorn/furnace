// ONE tab stop for a set of controls, walked with the arrows (D-26 / the APG roving
// tabindex). Extracted from `shell/ToolRail.tsx`'s `RovingToolbar`, which shipped the
// working version at F4.5b Task 8 and is now one of five consumers.
//
// WHAT THIS HOOK IS AND IS NOT. It owns the STOP — which control carries `tabindex="0"`,
// and moving it together with focus. It owns no keys: every consumer claims a different
// set (the rail takes ↑/↓/Home/End, the row grids take those plus ←/→/⏎/Esc across two
// axes), and a hook that guessed would either swallow a key its caller needed or leave
// one unclaimed. It owns no roles either — `role="toolbar"` and `role="grid"` are
// different promises about the same mechanism, and which one a surface may make depends
// on what its rows contain, not on how focus moves.
//
// THREE DETAILS ARE LOAD-BEARING, and the rail's version works because it has all three.
// A generalisation that drops any one of them passes its tests and fails in use:
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
//
// The control list is read from the DOM rather than tracked in state for the same reason
// the effect has no deps: the elements are the source of truth about how many there are,
// and a React-side mirror of that is one more thing to keep in sync.
import {
  type FocusEvent,
  type KeyboardEvent,
  type RefCallback,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";

/** Is a roving traversal moving focus RIGHT NOW?
 *
 *  Raised around {@link RovingList.focusAt}'s `.focus()` call, which dispatches its focus
 *  events synchronously — so any handler that runs because of a keyboard traversal sees
 *  `true`, and one that runs because of a Tab, a click or a programmatic focus sees
 *  `false`. Its one reader is the tooltip trigger (`components/tips.tsx`): a Radix
 *  tooltip opens on FOCUS with no delay, so without this every arrow press would pop a
 *  box the user is travelling past. See that file for the whole argument.
 *
 *  A module-level flag rather than a context, because it is read during an event dispatch
 *  that is already in flight — there is no render between the `.focus()` and the handler
 *  that would let a context value through. */
let travelling = false;

/** @see {@link travelling} — the reader half, for `components/tips.tsx`. */
export function isRovingTravel(): boolean {
  return travelling;
}

export type RovingList<C extends HTMLElement, T extends HTMLElement> = {
  /** Goes on the container. Everything below is scoped to it.
   *
   *  A CALLBACK ref rather than an object one, and that is load-bearing detail four. The
   *  container can be mounted by an ANCESTOR without this hook's component re-rendering —
   *  a `CollapsibleSection` opening does exactly that, since the rows were built during an
   *  earlier render and are only now attached — and the layout effect would then not run
   *  again until something unrelated moved. The result is a list with NO control carrying
   *  `tabindex="0"`: unreachable by Tab, and silent about it. Writing the stop when the
   *  node attaches is what closes that. (The rail never met this because it is always
   *  mounted, which is why the extraction had to find it rather than inherit it.) */
  ref: RefCallback<C>;
  /** Is `node` inside this list? The callback ref keeps the element private, and a key
   *  handler needs the answer before it acts on `document.activeElement`. */
  contains: (node: Node | null) => boolean;
  /** The controls the stop moves between, in DOM order. */
  items: () => T[];
  /** Where the keyboard IS: the focused control's index, or — when focus is somewhere
   *  the stop does not cover (a row's verb cluster, or nothing at all) — the index the
   *  stop is parked on. */
  cursor: () => number;
  /** Move the stop AND the focus to `next`, wrapping. The two move together or the
   *  next Tab returns to wherever the stop was left behind. */
  focusAt: (next: number) => void;
  /** Bind to the CONTAINER's `onFocus` (focus events bubble in React). Keeps the stop
   *  where the user actually is, so clicking a control mid-list does not send the next
   *  Tab back to the top of it. */
  onFocus: (e: FocusEvent<HTMLElement>) => void;
};

/**
 * @param selector CSS selector for the controls, evaluated INSIDE the container. The rail
 *   passes `"button"` because every button in that column is one of its controls; the row
 *   grids pass a structural selector for the first cell of each row, because a row's verbs
 *   are buttons the stop must never land on.
 */
export function useRovingList<
  C extends HTMLElement,
  T extends HTMLElement = HTMLElement,
>(selector: string): RovingList<C, T> {
  const container = useRef<C | null>(null);
  const active = useRef(0);
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

  /** Put the stop somewhere legal: where it was, clamped to the list that exists now. */
  const settle = (): void => {
    const list = items();
    if (list.length === 0) return;
    write(list, Math.min(active.current, list.length - 1));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `settle` closes over refs only (container, active, selectorRef), so it is safe to call from a stable callback — and depending on it would give this ref a new identity every render, which React answers by detaching and reattaching the node
  const ref = useCallback<RefCallback<C>>((node) => {
    container.current = node;
    if (node !== null) settle();
  }, []);

  useLayoutEffect(settle);

  const focusAt = (next: number): void => {
    const list = items();
    if (list.length === 0) return;
    const i = ((next % list.length) + list.length) % list.length;
    write(list, i);
    travelling = true;
    try {
      list[i]?.focus();
    } finally {
      // `finally`, not a trailing assignment: a throw out of a focus handler must not
      // leave the flag raised, or every tooltip in the app goes quiet for the rest of
      // the session with no way to tell why.
      travelling = false;
    }
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
    // `e.target` is whatever inside the container took focus; only a matching control
    // can BE a stop, so a miss simply leaves the stop where it was.
    //
    // It WRITES rather than merely recording, and the difference is the whole promise of
    // this handler: recording alone leaves the DOM stop on whichever control it was last
    // written to, so a Tab out and back would land somewhere the user has never been. The
    // rail got away with recording because clicking a family re-renders it and the layout
    // effect then wrote what the record said — a list whose click changes no chrome state
    // has no such second chance.
    const list = items();
    const i = list.indexOf(e.target as T);
    if (i !== -1) write(list, i);
  };

  return { ref, contains, items, cursor, focusAt, onFocus };
}

// ——— the row grid ————————————————————————————————————————————————————————————
//
// THE KEYBOARD MODEL the three row lists share (entities, flags, history), built on the
// stop above. It is here rather than copied into each palette because the third copy is
// where a shared rule stops being a coincidence — and because the ROLE decision below is
// one ruling, not three.
//
// WHY `grid` AND NOT `listbox`. A grid is the only APG pattern whose cells may contain
// arbitrary widgets, and these rows carry them: the entities row has four verbs, the
// flags row has Verify. `listbox`/`option` — the obvious reach for anything called a
// list — forbids exactly that (an option's content must be text), so a "listbox" whose
// options hold buttons is a promise no screen reader can keep. `tree` would claim a
// hierarchy that does not exist. A bare div with a roving tabindex claims nothing at all,
// which is worse than either: a keyboard user Tabs in, finds one control, and has no
// announced model telling them the arrows do anything. The history palette is a grid of
// ONE column, which is legal and is the deliberate price of three sibling lists in one
// shell answering the keyboard identically.
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
 *  spelling, so three lists cannot come to disagree about what a row stop is. */
const ROW_STOP = '[role="row"] > [role="gridcell"]:first-child button';

/**
 * @param onRowChange Called with the index of the row the stop just moved to, so a list
 *   whose SELECTION follows the cursor can write it. Omitted where it must not: the
 *   entities list selects on arrow (its selection draws a box — cheap and reversible),
 *   the flags list does not (its selection flies the camera and can be refused), so there
 *   ⏎ is what commits. Same model, two answers, decided by what the selection costs.
 */
export function useRowGrid<C extends HTMLElement>(
  onRowChange?: (index: number) => void,
): {
  ref: RefCallback<C>;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
} {
  const roving = useRovingList<C, HTMLButtonElement>(ROW_STOP);

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
    if (rows.length === 0) return;
    const i = ((next % rows.length) + rows.length) % rows.length;
    roving.focusAt(i);
    onRowChange?.(i);
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
