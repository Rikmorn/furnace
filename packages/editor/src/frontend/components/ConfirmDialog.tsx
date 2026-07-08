import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

/** A pending confirmation. `onConfirm`/`onCancel` run exactly once — the owner
 *  (App) clears its confirmRef synchronously in `resolveConfirm`, so a rapid
 *  double-click that lands while Radix's exit-animation `Presence` still has the
 *  button mounted resolves only the first click. */
export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
};

/** The single in-chrome confirm dialog (replaces `window.confirm`). Rendered once
 *  at App level and reused for the discard-unsaved prompt and multi-entity delete. */
export function ConfirmDialog({
  request,
  onResolve,
}: {
  request: ConfirmRequest | null;
  onResolve: (confirmed: boolean) => void;
}) {
  return (
    <Dialog
      open={request !== null}
      // Any dismissal that isn't the confirm button (Escape, overlay, X) is a cancel.
      onOpenChange={(open) => {
        if (!open) onResolve(false);
      }}
    >
      <DialogContent className="max-w-sm">
        {request && (
          <>
            <DialogHeader>
              <DialogTitle>{request.title}</DialogTitle>
              <DialogDescription>{request.message}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => onResolve(false)}>
                Cancel
              </Button>
              <Button
                variant={request.destructive ? "destructive" : "default"}
                onClick={() => onResolve(true)}
              >
                {request.confirmLabel}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
