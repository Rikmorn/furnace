import { type RefObject, useEffect } from "react";
import type { ConfirmRequest } from "../components/ConfirmDialog.tsx";
import { isTextInputTarget, matchBinding } from "../lib/keybindings.ts";

/**
 * The global window keydown listener. Binds once (its deps are all stable), so ⌘S/⌘Z/⇧⌘Z
 * fire wherever focus is. `preventDefault` fires on EVERY match (so ⌘S never triggers the
 * browser save-page — the P0 fix), and the `if (confirmRef.current) return` guard
 * suppresses every binding while a confirm dialog is open (it is modal; a second
 * openConfirm would strand the first, whose onCancel then never runs).
 *
 * MIGRATION (until Task 8/9 of the F4.5a plan): save/undo/redo are wired to no-ops.
 * The scene document session they used to drive is gone, and the field host's own
 * save + ONE history land in those tasks — the chord classification, the
 * preventDefault, and the confirm-dialog suppression are the parts kept alive here in
 * the meantime, because they are what a re-wire must not silently lose.
 */
export function useGlobalKeybindings(params: {
  confirmRef: RefObject<ConfirmRequest | null>;
}): void {
  const { confirmRef } = params;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (confirmRef.current) return;
      const action = matchBinding(e, isTextInputTarget(e.target));
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case "save":
          return;
        case "undo":
          return;
        case "redo":
          return;
        default:
          // Exhaustiveness guard: a new BindingAction that isn't cased above is a
          // compile error here.
          action satisfies never;
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmRef]);
}
