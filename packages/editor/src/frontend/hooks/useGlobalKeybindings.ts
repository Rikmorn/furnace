import { type RefObject, useEffect } from "react";
import type { ConfirmRequest } from "../components/ConfirmDialog.tsx";
import { type ActionCtx, gateAction, matchAction } from "../lib/actions.ts";
import { isTextInputTarget } from "../lib/keybindings.ts";
import { notify } from "../lib/notify-store.ts";

/**
 * The editor's ONE window keydown listener: match an event to an action, gate it, run it.
 * Every binding it can answer to is declared in `lib/actions.ts` — this file holds no
 * bindings of its own, which is what stops a key from being live here and undocumented in
 * the shortcuts overlay.
 *
 * It reads the action context through a REF and therefore binds exactly once. That is not
 * an optimisation: the gate has to poll `host.isLooking()` at the instant of the keypress
 * (the right button goes down and up between renders), and every `enabled` predicate has
 * to see the state as it is now rather than as it was when the listener was last bound.
 *
 * `preventDefault` fires as soon as the gate ALLOWS the action — before `enabled` is
 * consulted — because at that point the key has been claimed. A disabled ⌘S must still
 * suppress the browser's save-page dialog, and a ⌫ over the canvas with nothing selected
 * must still not navigate. A REFUSED action is the opposite: nothing is prevented, so the
 * character the user is typing still reaches their text field.
 *
 * The field canvas has a listener of its own. Where both bind one key (⌘Z, ⏎, Esc, R, F)
 * the canvas branch that acts calls `stopPropagation`, so this listener never sees it —
 * see the ownership rule at the top of `lib/actions.ts`.
 */
export function useGlobalKeybindings(
  ctxRef: RefObject<ActionCtx>,
  confirmRef: RefObject<ConfirmRequest | null>,
): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const def = matchAction(e);
      if (def === null) return;
      const ctx = ctxRef.current;
      const verdict = gateAction(def, ctx, {
        inTextInput: isTextInputTarget(e.target),
        confirmOpen: confirmRef.current !== null,
        // Polled here, per keypress — never carried on the ctx.
        looking: ctx.host?.isLooking() ?? false,
      });
      if (!verdict.ok) {
        // A refusal with a reason the user cannot see gets said out loud; the rest
        // (a modal is open, they are typing, they are holding the right button) are
        // already visible and a toast would be noise.
        if (verdict.hint !== null) notify.info(verdict.hint);
        return;
      }
      e.preventDefault();
      if (!def.enabled(ctx)) return;
      def.run(ctx);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ctxRef, confirmRef]);
}
