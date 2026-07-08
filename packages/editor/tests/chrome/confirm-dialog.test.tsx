// ConfirmDialog behaviour (Task 5, review item #6). Lives in a subdir — like every
// DOM test in this package — so happy-dom's global-fetch registration can't pollute
// the daemon HTTP suites (a bare tests/ DOM test does; see tests/chrome/menubar.test.tsx).
import { cleanup, fireEvent, render, screen } from "../inspector/_harness.tsx";
import { afterEach, expect, mock, test } from "bun:test";
import {
  ConfirmDialog,
  type ConfirmRequest,
} from "../../src/frontend/components/ConfirmDialog.tsx";

afterEach(cleanup);

/** Render ConfirmDialog wired to a resolver that mirrors App.resolveConfirm's
 *  confirmed→onConfirm / cancelled→onCancel dispatch. `guarded` mirrors App's
 *  confirmRef re-entry guard so a double-click resolves only once. */
function renderConfirm(guarded = false, over: Partial<ConfirmRequest> = {}) {
  const onConfirm = mock(() => {});
  const onCancel = mock(() => {});
  const request: ConfirmRequest = {
    title: "Delete entities?",
    message: "Delete 2 selected entities?",
    confirmLabel: "Delete",
    destructive: true,
    onConfirm,
    onCancel,
    ...over,
  };
  let pending: ConfirmRequest | null = request;
  const onResolve = (confirmed: boolean) => {
    if (guarded) {
      if (!pending) return; // already settled — absorb the double-fire
      pending = null;
    }
    if (confirmed) request.onConfirm();
    else request.onCancel?.();
  };
  render(<ConfirmDialog request={request} onResolve={onResolve} />);
  return { onConfirm, onCancel };
}

test("Confirm fires onConfirm exactly once and never onCancel", () => {
  const { onConfirm, onCancel } = renderConfirm();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
});

test("Cancel fires onCancel exactly once and never onConfirm", () => {
  const { onConfirm, onCancel } = renderConfirm();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

test("the re-entry guard absorbs a rapid double-click (Presence keeps the button mounted)", () => {
  const { onConfirm } = renderConfirm(true);
  const button = screen.getByRole("button", { name: "Delete" });
  fireEvent.click(button);
  fireEvent.click(button); // second click lands before unmount
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
