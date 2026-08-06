// Conditional viewport focus return (F4.5c Task 10, D-F4.5-26 / WCAG 2.4.3).
//
// THE RULE, whole: dismissing a chrome overlay puts the user back where they were, and
// "where they were" is the canvas ONLY when the canvas is where they came from.
//
// It has to be conditional, and the naive version is the trap. Return focus to the canvas
// on EVERY overlay close and a keyboard user who Tabbed to the top bar, opened a popover
// and pressed Esc is thrown out of the tab order they were walking — which is exactly what
// SC 2.4.3 Focus Order asks us not to do, and exactly what Radix already gets right by
// returning focus to the trigger. Return it NEVER — today's behaviour — and someone who
// clicked the ⬒ mid-flight finds W/A/S/D, `[`, `]` and the arrow nudges dead, because the
// canvas holds those bindings on its own element and they fire only while it has focus
// (`field-host/field-host.ts`'s `attachListeners`). Both halves are pinned in
// tests/chrome/viewport-focus-return.test.tsx; a mechanism that passes only the first is
// the WCAG-violating one.
//
// THE RECORD IS TAKEN ON THE CONTENT'S ref, NOT ON `onOpenAutoFocus`, and that is a
// correction rather than a preference. `onOpenAutoFocus` looks like "the open edge" and is
// not: `react-focus-scope@1.1.12` guards its ENTIRE mount block on nothing inside the
// content already holding focus (`dist/index.mjs:74-83`)
//
//     const previouslyFocusedElement = document.activeElement;
//     const hasFocusedCandidate = container.contains(previouslyFocusedElement);
//     if (!hasFocusedCandidate) { … container.dispatchEvent(mountEvent); … }
//
// so a surface that mounts with an `autoFocus` field inside it NEVER dispatches, and a
// sole writer sitting on that event never runs. Its container is `useState`, so the mount
// effect is a commit late — late enough for a parent's own effect and React's `autoFocus`
// to land first, which is exactly the world drawer opened in save-as mode. The record then
// kept its initial `false`, the close handler stood down, and Radix's modal fallback
// focused `triggerRef.current` — `null` for every dialog here, none of which has a
// `DialogTrigger`. Measured in system Chrome AND reproduced in happy-dom: `⇧⌘S` from the
// canvas → Esc → `<body>`, with every viewport key dead, while the same drawer opened in
// browse mode returned the canvas correctly.
//
// A ref callback has none of that conditionality: React calls it during the commit that
// mounts the element, once, for every mounted content — and Radix only mounts content
// while the surface is open, so "attached" IS "opened". It also fires BEFORE any effect,
// so nothing the surface itself does on mount can get in front of it. That retires the
// burger's workaround too: `DropdownMenuContent` takes a ref like every other content,
// where `onOpenAutoFocus` is private to `MenuContentImpl` and absent from react-menu
// 2.1.20's public types.
//
// WHY THE RECORD IS NOT READ AT THE OPEN EDGE AT ALL. The shape this was costed with —
// "on the false→true edge record `document.activeElement === canvas`" — does not work:
//   - THE DECISIVE REASON IS THE BROWSER'S. It focuses a clicked trigger as the default
//     action of `mousedown`, before the overlay's content mounts — so at every open edge
//     `document.activeElement` is the TRIGGER, for a mouse open and a keyboard one alike,
//     and the condition never fires. (Radix's `FocusScope` moves focus further IN a moment
//     later, from its mount effect and AFTER `onMountAutoFocus` dispatches — that deepens
//     the problem for an ancestor's `useEffect`, which runs later still, but it is not what
//     breaks the read.) Under a harness that does not move focus on a click — happy-dom
//     does not, measured — the broken shape would have gone green and shipped dead.
//   - several of these surfaces have no `open` flag to edge-detect: `ConfirmDialog`
//     derives openness from a request object, and the burger's menu was uncontrolled.
//     A content mount is the one signal all of them share.
// So the record is taken at GESTURE start (see `ViewportFocus.heldFocusAtGestureStart`)
// and merely COPIED here when the overlay opens.
//
// THE MOUNT IS THE EDGE, NOT THE SOURCE. Nothing in the copy reads
// `document.activeElement`, which is what makes the moment interchangeable: any observation
// of the same open would serve, and the ref is chosen because it is the only one that
// cannot be skipped.
//
// PER OVERLAY, never one shell-level memory, and that is what makes two open at once
// well-defined. Open the world drawer from the world chip while flying and its record is
// true; open the row ⋯ menu inside it and THAT gesture began on a control in the drawer, so
// the menu goes back to the ⋯ it came from while the drawer still goes back to the canvas —
// each surface answering for its own summoning. One shared record would have the inner
// overlay overwrite the outer one's answer and strand the user in the chrome. Pinned as
// "two stacked overlays each answer for their OWN summoning".
//
// A CHAIN IS ONE JOURNEY, which is the exception that proves it. ☰ → "Keyboard shortcuts"
// and ⌘K → "Open…" both open a surface FROM a surface, so the second one's gesture begins
// inside the first and its own answer is always no — and both of those dialogs have no
// trigger for Radix to restore to, so the chain ends on `<body>` with every viewport key
// dead. {@link ViewportFocusReturn.handOff} is how the first surface forwards its answer to
// the second. Without it the site is wired and INERT, which is worse than unwired: it looks
// covered.
//
// IT COMPOSES WITH RADIX RATHER THAN RACING IT. Radix restores focus from a
// `setTimeout(…, 0)` scheduled at unmount, so a close-edge `useEffect` that focused the
// canvas would be silently overwritten a tick later. `onCloseAutoFocus` is the seam Radix
// provides for exactly this: it runs the consumer's handler first and skips its own
// trigger-restore when the event comes back prevented (`composeEventHandlers`, verified in
// react-popover, react-dialog and react-menu). So there is exactly one focus write per
// dismissal, never two, and no screen reader announces a landing place twice.
import { useCallback, useRef } from "react";
import { useEditor } from "../components/editor-context.ts";

/** What a dismissible overlay puts on its Radix content: the ref that RECORDS and the
 *  handler that RETURNS.
 *
 *  THREE RULES, and all three have already been broken once here:
 *    - SPREAD IT LAST. `{...focusReturn.overlay}` before an `onCloseAutoFocus` of the
 *      site's own means the later prop wins and the return silently never fires.
 *    - ONLY ONTO A RADIX `*Content`. Spread onto one of OUR wrappers and both props land
 *      on a component that does not forward them, with nothing thrown — `ui/command.tsx`
 *      named them explicitly for exactly this reason, after it happened.
 *    - A WRAPPER MUST FORWARD BOTH BY NAME. Not through a rest spread aimed at some other
 *      child; `CommandDialog`'s `...commandProps` goes to cmdk's root, which knows nothing
 *      about either.
 *  Nested under `overlay` rather than returned flat so {@link ViewportFocusReturn.handOff}
 *  cannot ride the spread onto a DOM element, which React would warn about at runtime and
 *  nothing would catch at build time. */
export type OverlayFocusProps = {
  /** Records this open. On the CONTENT, because a mount is the only open signal Radix
   *  cannot skip — see the header for the dispatch it replaces and the bug that proved
   *  it was needed. Called with `null` at unmount, which is not an open and is ignored. */
  ref: (element: HTMLElement | null) => void;
  onCloseAutoFocus: (event: Event) => void;
};

export type ViewportFocusReturn = {
  /** Spread onto the Radix content, LAST — see {@link OverlayFocusProps}. */
  overlay: OverlayFocusProps;
  /**
   * This overlay's dismissal is OPENING another surface: give that surface this one's
   * answer, so a journey that started on the canvas still ends there.
   *
   * Call it at SELECT time — in the handler that opens the next surface, beside whatever
   * flag already marks the hand-off. Not from the close handler and not from the
   * stand-down branch: the new surface's `onOpenAutoFocus` runs BEFORE this one's
   * deferred `onCloseAutoFocus`, so anything that waits for the close is a tick late and
   * arms a record the next overlay has already read.
   *
   * It forwards the ANSWER, not a blanket yes: a chain begun in the chrome forwards
   * `false` and correctly stays there. And it does not consume this overlay's own record,
   * so a select whose verb opens nothing still hands the canvas back the ordinary way —
   * which is what lets the command palette call this on every pick without knowing which
   * of forty verbs open a surface.
   */
  handOff: () => void;
};

/**
 * Hand the keyboard back to the viewport when this overlay is dismissed — but only if the
 * viewport is where the user came from.
 *
 * Every dismissible surface in the chrome calls it. That is a completeness claim rather
 * than a coincidence, and `tests/frontend-overlay-focus-return.test.ts` enforces it: a
 * focus rule that holds for some overlays and not others is unlearnable. The surfaces that
 * are exempt are listed there with their reasons, so the exemption is read in the same
 * place as the requirement.
 */
export function useViewportFocusReturn(): ViewportFocusReturn {
  const { viewportFocusRef } = useEditor();
  /** This overlay's own answer, frozen at ITS open. */
  const cameFromCanvas = useRef(false);
  /**
   * STABLE IDENTITY IS THE WHOLE OF THIS `useCallback`, and it is load-bearing rather
   * than a memo. React detaches and re-attaches a callback ref whenever the callback's
   * identity changes, so a fresh closure per render would re-record on EVERY re-render of
   * the surface — and by then focus is inside the overlay, so the answer flips to `false`
   * exactly when it matters. Measured: the burger's menu recorded `held=true` at its open
   * and `held=false` on the very next render, and the canvas return was lost.
   *
   * With a stable identity React calls it exactly twice per open — the element, then
   * `null` — which is precisely the "once per open" the record needs.
   */
  const record = useCallback(
    (element: HTMLElement | null) => {
      // The DETACH is not an open — React calls a ref callback with `null` as the element
      // goes, and recording there would answer for the dismissal itself with whatever the
      // last keystroke inside the overlay happened to leave behind.
      if (element === null) return;
      // Written unconditionally, so a stale `true` from a previous open (one the burger's
      // hand-off left unconsumed, say) can never survive into the next one.
      cameFromCanvas.current =
        viewportFocusRef.current?.heldFocusAtGestureStart() ?? false;
    },
    [viewportFocusRef],
  );
  return {
    handOff: () => {
      viewportFocusRef.current?.carryGestureOrigin(cameFromCanvas.current);
    },
    overlay: {
      ref: record,
      onCloseAutoFocus: (event) => {
        if (!cameFromCanvas.current) return;
        // CONSUMED. Radix dispatches this once per close, but a record left standing is
        // a record that could answer for a dismissal it knows nothing about.
        cameFromCanvas.current = false;
        // NOTHING ELSE HAS CLAIMED FOCUS — the same idea as `useRovingList`'s recovery
        // guard, though not the same test (that one also asks whether the element it
        // remembers has become `disabled`, which has no analogue here). Two mechanisms
        // that both move focus on a lifecycle edge have to agree about when they may.
        //
        // It is load-bearing in two flows that are not hypothetical. Clicking a SECOND
        // overlay's trigger dismisses the first: that dismissal's close-autofocus fires
        // while the new surface already holds focus, and without this the canvas would
        // take it and shut the surface the user just opened. And a ⌘K row whose verb
        // OPENS something ("Open…", "History…") runs before this deferred handler does,
        // for the same reason — which is why {@link ViewportFocusReturn.handOff} can be
        // called on every pick: the ones that open something stand this branch down.
        //
        // `isConnected` is the third state and it is cheap insurance rather than an
        // observed case: a browser parks focus on `<body>` when it removes the focused
        // element, and happy-dom does the same (probed both removal shapes). What it
        // costs is one property read; what it buys is that a DOM which has NOT caught up
        // cannot make a detached element look like a claim.
        const on = document.activeElement;
        if (on !== null && on !== document.body && on.isConnected) return;
        // Suppresses Radix's own restore — see the header. Only on the branch that
        // actually writes focus: preventing it on the other branch would leave the
        // dismissal with no landing place at all.
        event.preventDefault();
        // NOT under the roving-travel flag (`useRovingList`'s `isRovingTravel`), and the
        // reason is that the flag means one specific thing: "a list traversal is stepping
        // PAST this control, so do not pop its tooltip". Its one reader is the tooltip
        // trigger, the canvas is not one, and raising it from here would make a flag with
        // a precise meaning mean "some code is calling .focus()" instead.
        viewportFocusRef.current?.focus();
      },
    },
  };
}
