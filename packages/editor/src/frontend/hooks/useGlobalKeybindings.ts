import { type RefObject, useEffect } from "react";
import type { ConfirmRequest } from "../components/ConfirmDialog.tsx";
import { isTextInputTarget, matchBinding } from "../lib/keybindings.ts";

/**
 * The global window keydown listener. `preventDefault` fires on EVERY match (so ⌘S never
 * triggers the browser save-page — the P0 fix), and the `if (confirmRef.current) return`
 * guard suppresses every binding while a confirm dialog is open (it is modal; a second
 * openConfirm would strand the first, whose onCancel then never runs).
 *
 * Called from the Shell rather than App, because every binding acts on shell state: ⌘\
 * on the palette arrangement, ⌘S on the world, ⌘Z/⇧⌘Z on the field's op log. It
 * re-binds whenever a handler's identity changes — the world verbs close over the
 * current world's name, so naming one rebinds the listener. Cheap and correct; what
 * would NOT be is capturing them once and stepping a world the user has left.
 *
 * ⌘Z/⇧⌘Z reach the FIELD HOST, which is the editor's ONE history — there is no second
 * document to step. The field canvas binds the same chord itself and calls
 * `stopPropagation`, so a ⌘Z with the viewport focused steps the log exactly once
 * instead of once here and once there.
 */
export function useGlobalKeybindings(params: {
  confirmRef: RefObject<ConfirmRequest | null>;
  /** ⌘\ — hide every palette, or restore the exact prior arrangement (D-3). */
  onTogglePalettes: () => void;
  /** ⌘S — write the current world, or open the drawer to name an untitled one. */
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
}): void {
  const { confirmRef, onTogglePalettes, onSave, onUndo, onRedo } = params;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (confirmRef.current) return;
      const action = matchBinding(e, isTextInputTarget(e.target));
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case "save":
          onSave();
          return;
        case "undo":
          onUndo();
          return;
        case "redo":
          onRedo();
          return;
        case "togglePalettes":
          onTogglePalettes();
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
  }, [confirmRef, onTogglePalettes, onSave, onUndo, onRedo]);
}
