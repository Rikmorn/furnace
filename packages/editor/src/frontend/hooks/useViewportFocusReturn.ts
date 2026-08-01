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
// "on the false→true edge record `document.activeElement === canvas`" — does not work,
// measured rather than reasoned:
//   - by the open edge the canvas has ALREADY lost focus. A browser focuses a clicked
//     trigger as the default action of `mousedown`, and Radix's `FocusScope` then moves
//     focus INTO the content from a mount effect that runs BEFORE any ancestor's effect
//     (@radix-ui/react-focus-scope 1.1.12, and traced in this shell: after clicking ⬒,
//     `document.activeElement` is the first radio inside the popover). The condition would
//     be one that never fires in a browser.
//   - several of these surfaces have no `open` flag to edge-detect: `ConfirmDialog`
//     derives openness from a request object, and the two `DropdownMenu`s were
//     uncontrolled. `onOpenAutoFocus` fires exactly once per open regardless.
// So the record is taken at GESTURE start (see `ViewportFocus.heldFocusAtGestureStart`)
// and merely COPIED here when the overlay opens.
//
// `onOpenAutoFocus` IS THE EDGE, NOT THE SOURCE, and the distinction matters at two sites.
// Nothing in the copy reads `document.activeElement`, so any observation of the same open
// serves — which is what lets the two Radix MENUS call it from `onOpenChange(true)`
// instead. They have to: `onOpenAutoFocus` is private to `MenuContentImpl` and
// `MenuRootContentTypeProps` omits it (react-menu 2.1.20's own types), so passing it to a
// `DropdownMenuContent` is reaching past the public surface for something a minor bump
// could take away silently. Each of those two sites says so where it sits.
//
// PER OVERLAY, never one shell-level memory, and that is what makes two open at once
// well-defined. Open the world drawer from the world chip while flying and its record is
// true; open the row ⋯ menu inside it and THAT record is false, because the gesture began
// on a control in the drawer. Dismissing the menu therefore goes back to the ⋯ it came
// from and dismissing the drawer goes back to the canvas — each surface answering for its
// own summoning. One shared record would have the inner overlay overwrite the outer one's
// answer, and the drawer would strand the user in the chrome. Pinned as
// "two stacked overlays each answer for their OWN summoning".
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

/** The two handlers a dismissible overlay spreads onto its Radix content.
 *
 *  Deliberately named for Radix's props, so the call site is `{...focusReturn}` and there
 *  is nothing to wire wrongly. Three sites cannot spread and each says why where it sits:
 *  the two `DropdownMenu`s (Radix does not expose `onOpenAutoFocus` on a menu, so they call
 *  it from `onOpenChange`), and the burger again, which already owned an `onCloseAutoFocus`
 *  for its hand-off and composes the two by hand. */
export type ViewportFocusReturn = {
  onOpenAutoFocus: () => void;
  onCloseAutoFocus: (event: Event) => void;
};

/**
 * Hand the keyboard back to the viewport when this overlay is dismissed — but only if the
 * viewport is where the user came from.
 *
 * Every dismissible surface in the chrome calls it. That is a completeness claim rather
 * than a coincidence, and `tests/frontend-overlay-focus-return.test.ts` enforces it: a
 * focus rule that holds for some overlays and not others is unlearnable, so a new
 * `PopoverContent` / `DialogContent` / `DropdownMenuContent` that does not spread this
 * fails the suite. The two surfaces that are exempt are exempt because they move no focus
 * at all, and each says so where it lives.
 */
export function useViewportFocusReturn(): ViewportFocusReturn {
  const { viewportFocusRef } = useEditor();
  /** This overlay's own answer, frozen at ITS open. */
  const cameFromCanvas = useRef(false);
  return {
    onOpenAutoFocus: () => {
      // Written unconditionally, so a stale `true` from a previous open (one the
      // burger's hand-off left unconsumed, say) can never survive into the next one.
      cameFromCanvas.current =
        viewportFocusRef.current?.heldFocusAtGestureStart() ?? false;
    },
    onCloseAutoFocus: (event) => {
      if (!cameFromCanvas.current) return;
      // CONSUMED. Radix dispatches this once per close, but a record left standing is a
      // record that could answer for a dismissal it knows nothing about.
      cameFromCanvas.current = false;
      // NOTHING ELSE HAS CLAIMED FOCUS. The same guard `useRovingList`'s recovery uses,
      // stated the same way on purpose — two mechanisms that both move focus on a
      // lifecycle edge must agree about when they may.
      //
      // It is load-bearing in two flows that are not hypothetical. Clicking a SECOND
      // overlay's trigger dismisses the first: that dismissal's close-autofocus fires
      // while the new surface already holds focus, and without this the canvas would
      // take it and shut the surface the user just opened. And a ⌘K row whose verb OPENS
      // something (Worlds…, History…) runs before this deferred handler does, for the
      // same reason — so the palette needs no hand-off flag of its own; the verb's own
      // surface simply owns focus by the time this is asked.
      //
      // `isConnected` is the third state, and it is not defensive padding: a browser
      // parks focus on `<body>` when it removes the focused element, but a DOM that has
      // not caught up leaves the DETACHED element as `activeElement` — happy-dom among
      // them. An element out of the document has claimed nothing.
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
  };
}
