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
  type RefObject,
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
  /** Goes on the container. Everything below is scoped to it. */
  ref: RefObject<C | null>;
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
  const ref = useRef<C | null>(null);
  const active = useRef(0);

  const items = (): T[] =>
    Array.from(ref.current?.querySelectorAll<T>(selector) ?? []);

  const write = (list: T[], i: number): void => {
    active.current = i;
    for (const [n, el] of list.entries()) el.tabIndex = n === i ? 0 : -1;
  };

  useLayoutEffect(() => {
    const list = items();
    if (list.length === 0) return;
    write(list, Math.min(active.current, list.length - 1));
  });

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

  const cursor = (): number => {
    const list = items();
    if (list.length === 0) return 0;
    const from = list.indexOf(document.activeElement as T);
    return from === -1 ? Math.min(active.current, list.length - 1) : from;
  };

  const onFocus = (e: FocusEvent<HTMLElement>): void => {
    // `e.target` is whatever inside the container took focus; only a matching control
    // can BE a stop, so a miss simply leaves the stop where it was.
    const i = items().indexOf(e.target as T);
    if (i !== -1) active.current = i;
  };

  return { ref, items, cursor, focusAt, onFocus };
}
