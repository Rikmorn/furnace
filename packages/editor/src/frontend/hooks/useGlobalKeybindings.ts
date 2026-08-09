import { type RefObject, useEffect } from "react";
import type { ConfirmRequest } from "../components/ConfirmDialog.tsx";
import { type ActionCtx, matchAction, runAction } from "../lib/actions.ts";
import { isTextInputTarget } from "../lib/keybindings.ts";

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
 * character the user is typing still reaches their text field. That seam is `runAction`'s
 * `onClaim` callback, which fires between the two checks and which nothing else passes.
 *
 * It is `runAction` and not a sequence of its own since foundations T3b2 Task 4: the gate,
 * the claim, the enabled check, the run and the sentence that answers for it are ONE funnel
 * for a REGISTERED action — one with a row of its own in `ACTION_DESCRIPTORS` — shared with
 * every control in the chrome, so a key and a button cannot refuse a verb in different words,
 * or run it and report differently. (Deliberately not the word "named" here: `GateEnv` is
 * discriminated by `caller`, and this hook is the `"key"` half of that union. `runNamed` and
 * `namedDispatch` are the OTHER caller class, which is exactly what this hook is not.)
 * Foundations T4a gave the funnel a sibling for the one dispatch it never covered, `runMember`
 * (a pick out of a tool family), and the two share the gate-claim-check sequence itself
 * (`refuseOrClaim`) rather than agreeing by review. No key reaches a member, so nothing here
 * changed: the ⇧ chords step families through `tool.brushCycle` and its two siblings, which
 * are ordinary rows.
 *
 * NO INPUT IS PASSED, and there is nowhere for one to come from: a keypress carries a
 * keycap and nothing else, so every keyed verb falls back to what the ctx has selected.
 * `void`, because a keydown handler cannot await and the funnel has already said whatever
 * there was to say; the returned {@link ActionResult} is for a caller that can read one.
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
      void runAction(
        def,
        ctx,
        {
          caller: "key",
          inTextInput: isTextInputTarget(e.target),
          confirmOpen: confirmRef.current !== null,
          // Polled here, per keypress — never carried on the ctx.
          looking: ctx.host?.isLooking() ?? false,
        },
        undefined,
        () => e.preventDefault(),
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ctxRef, confirmRef]);
}
