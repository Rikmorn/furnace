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
// (`viewport-host/field-host.ts`'s `attachListeners`). Both halves are pinned in
// tests/chrome/viewport-focus-return.test.tsx; a mechanism that passes only the first is
// the WCAG-violating one.
//
// WHY THIS IS TWO HANDLERS AND NOT AN `open` EDGE. The shape this was costed with —
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
//     `onOpenAutoFocus` fires exactly once per open regardless.
// So the record is taken at GESTURE start (see `ViewportFocus.heldFocusAtGestureStart`)
// and merely COPIED here when the overlay opens.
//
// `onOpenAutoFocus` IS THE EDGE, NOT THE SOURCE. Nothing in the copy reads
// `document.activeElement`, so any observation of the same open serves — which is what lets
// the burger's MENU call it from `onOpenChange(true)` instead. It has to: `onOpenAutoFocus`
// is private to `MenuContentImpl` and `MenuRootContentTypeProps` omits it (react-menu
// 2.1.20's own types), so passing it to a `DropdownMenuContent` is reaching past the public
// surface for something a minor bump could take away silently.
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
import { useRef } from "react";
import { useEditor } from "../components/editor-context.ts";

/** The two handlers a dismissible overlay puts on its Radix content.
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
  onOpenAutoFocus: () => void;
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
  return {
    handOff: () => {
      viewportFocusRef.current?.carryGestureOrigin(cameFromCanvas.current);
    },
    overlay: {
      onOpenAutoFocus: () => {
        // Written unconditionally, so a stale `true` from a previous open (one the
        // burger's hand-off left unconsumed, say) can never survive into the next one.
        cameFromCanvas.current =
          viewportFocusRef.current?.heldFocusAtGestureStart() ?? false;
      },
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
