import { type RefObject, useCallback, useEffect } from "react";
import type { ConfirmRequest } from "../components/ConfirmDialog.tsx";
import type { EditorActions } from "../components/editor-context.ts";
import { isTextInputTarget, matchBinding } from "../lib/keybindings.ts";
import { SETTINGS_SELECTION } from "../lib/selection.ts";

/** Live selection + undo/redo availability, mirrored into a ref so the once-bound
 *  keydown listener reads current values without closing over stale state. App owns +
 *  syncs the ref and passes it IN (rather than this hook owning it) to break a dependency
 *  cycle: App's `actions.deleteSelection` must read `latest`, but this hook takes `actions`
 *  as input — so if the hook owned `latest`, App's actions memo couldn't reach it. */
type LatestRef = RefObject<{
  selection: string[];
  canUndo: boolean;
  canRedo: boolean;
}>;

/**
 * The global window keydown listener + the delete-routing it shares with Edit▸Delete
 * (extracted from App, Task 11). Binds once (its deps are all stable) and reads live
 * state through the `latest` ref App owns, so ⌘S/⌘Z/⇧⌘Z/F/⌫ fire against current
 * selection and undo-redo availability. Behaviour preserved verbatim: the
 * matchBinding/isTextInputTarget dispatch, `preventDefault` on EVERY match (so ⌘S
 * never triggers the browser save-page — the P0 fix), the `if (confirmRef.current)
 * return` guard that suppresses bindings while a confirm is open, the `openConfirm`
 * no-clobber guard, and the undo/redo availability gate.
 *
 * Returns `requestDelete` so App can wire it to the Toolbar/Edit▸Delete affordance.
 */
export function useGlobalKeybindings(params: {
  actions: EditorActions;
  openConfirm: (request: ConfirmRequest) => void;
  confirmRef: RefObject<ConfirmRequest | null>;
  latest: LatestRef;
}): { requestDelete: () => void } {
  const { actions, openConfirm, confirmRef, latest } = params;

  // Delete routing shared by the ⌫ keybinding and Edit▸Delete: >1 entity prompts
  // (in-chrome confirm), a single entity deletes straight away, none is a no-op.
  const requestDelete = useCallback(() => {
    // The World/settings sentinel is not deletable — drop it before counting.
    const selection = latest.current.selection.filter(
      (id) => id !== SETTINGS_SELECTION,
    );
    if (selection.length === 0) return;
    if (selection.length > 1) {
      openConfirm({
        title: "Delete entities?",
        message: `Delete ${selection.length} selected entities? This can be undone.`,
        confirmLabel: "Delete",
        destructive: true,
        onConfirm: () => void actions.deleteSelection(),
      });
      return;
    }
    void actions.deleteSelection();
  }, [actions, openConfirm, latest]);

  // Global keybindings. Binds once (actions/requestDelete are stable) and reads live
  // selection / undo-redo availability from `latest`. preventDefault fires on EVERY
  // match so ⌘S never triggers the browser save-page — the whole point of the P0 fix.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A confirm dialog is modal: suppress EVERY binding until it resolves, or a
      // second openConfirm would strand the first (its onCancel never runs).
      if (confirmRef.current) return;
      const action = matchBinding(e, isTextInputTarget(e.target));
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case "save":
          void actions.save();
          return;
        case "undo":
          if (latest.current.canUndo) void actions.undo();
          return;
        case "redo":
          if (latest.current.canRedo) void actions.redo();
          return;
        case "frame":
          actions.frameSelection();
          return;
        case "delete":
          requestDelete();
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
  }, [actions, requestDelete, confirmRef, latest]);

  return { requestDelete };
}
