import { type RefObject, useCallback, useRef, useState } from "react";
import type { ConfirmRequest } from "../components/ConfirmDialog.tsx";

/**
 * The in-chrome confirm-dialog state machine (replaces `window.confirm`). `confirmRef`
 * mirrors the pending request synchronously so BOTH: (a) `openConfirm` refuses to
 * clobber an already-pending prompt, and the global keydown listener can suppress every
 * binding while one is open — a second prompt would strand the first, dropping the
 * destructive action the user actually confirmed (e.g. FieldPanel's "Bake stamp?"
 * prompt, whose onConfirm is the only thing that severs the recipe); and (b)
 * `resolveConfirm` fires each request's callback exactly once — the guard also absorbs
 * a rapid double-click that lands while Radix's exit-animation `Presence` still has the
 * dialog (and its buttons) mounted.
 *
 * `confirmRef` is returned so `useGlobalKeybindings` can read it for the same
 * suppress-while-open guard.
 */
export function useConfirmDialog(): {
  confirm: ConfirmRequest | null;
  confirmRef: RefObject<ConfirmRequest | null>;
  openConfirm: (request: ConfirmRequest) => void;
  resolveConfirm: (confirmed: boolean) => void;
} {
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const confirmRef = useRef<ConfirmRequest | null>(null);

  const openConfirm = useCallback((request: ConfirmRequest) => {
    if (confirmRef.current) return; // never clobber a pending prompt
    confirmRef.current = request;
    setConfirm(request);
  }, []);

  const resolveConfirm = useCallback((confirmed: boolean) => {
    const request = confirmRef.current;
    if (!request) return; // already settled — absorb a double-fire
    confirmRef.current = null;
    setConfirm(null);
    if (confirmed) request.onConfirm();
    else request.onCancel?.();
  }, []);

  return { confirm, confirmRef, openConfirm, resolveConfirm };
}
